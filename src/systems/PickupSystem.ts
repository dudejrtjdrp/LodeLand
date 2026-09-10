import Phaser from 'phaser';
import MetaProgression from './MetaProgression';
import type GameScene from '../scenes/GameScene';
import type { EnemyDefinition } from '../types/catalogs';
import type { EnemySprite } from '../types/actors';
import type ProgressionSystem from './ProgressionSystem';
import type { EnemyDiedPayload, XPOrbSprite } from './ProgressionSystem';
import type LevelUpSystem from './LevelUpSystem';
import { GameEvents } from '../core/events';
import { screenShakeEnabled } from '../core/settings';

const PICKUP_DROP_CHANCE = 0.015; // chicken / magnet / bomb from normal enemies
/**
 * 골드 하향 (2026-09-04): "돈이 너무 잘 모인다" — 잡몹 금화 드랍 확률 ×0.7, 상자 골드 ×0.8.
 * 카탈로그 45종을 일일이 고치는 대신 여기 한 곳에서 곱한다 (시뮬·테스트가 카탈로그 값을 참조).
 */
const GOLD_DROP_CHANCE_MULT = 0.7;
const CHEST_GOLD_MULT = 0.8;
const COLLECT_RADIUS = 55;

/** Minimal structural view of EnemyManager (converted by another agent). */
interface EnemyManagerLike {
	enemies: Phaser.Physics.Arcade.Group;
	isAliveEnemy(enemy: EnemySprite): boolean;
	takeDamage(enemy: EnemySprite, amount: number, player?: unknown, options?: unknown): unknown;
}

export interface PickupItem {
	obj: (Phaser.GameObjects.Text | Phaser.GameObjects.Image | Phaser.GameObjects.Sprite) & { destroyed?: boolean };
	kind: string;
	amount: number;
	x: number;
	y: number;
	attracting?: boolean;
	/** 트윈 없는 흔들림용 위상 (성능: 아이템당 무한 트윈 제거) */
	bobPhase?: number;
	baseY?: number;
	/** 상자 등급 (0 나무 / 1 흑단 / 2 적금 / 3 서리) */
	tier?: number;
	/** 스폰 시각 — 버려진 픽업 자동 정리(TTL) 판정용. */
	spawnedAt?: number;
	/** 화면 안에 있었는지 (컬링 상태 전이 감지용). */
	wasOnScreen?: boolean;
}

/** 이 거리를 넘으면 플레이어가 다시 오지 않을 픽업으로 본다. */
const PICKUP_ABANDON_RADIUS = 1100;
/** 멀리 있는 일반 픽업이 정리되기까지의 시간 (상자·💎는 제외). */
const PICKUP_TTL_MS = 25000;

/** 상자 등급별 스펙: 등급명·알림색·골드 배수·잭팟 보정·검 획득 확률 */
const CHEST_TIERS = [
	{ label: '상자', color: '#c9a25f', goldMult: 1, jackpotBonus: 0, swordChance: 0 },
	{ label: '흑철 상자', color: '#c9d2d8', goldMult: 1.5, jackpotBonus: 0.15, swordChance: 0.15 },
	{ label: '황금 상자', color: '#d9a83c', goldMult: 2, jackpotBonus: 0.3, swordChance: 0.35 },
	{ label: '서리 상자', color: '#8fc3d8', goldMult: 3, jackpotBonus: 0.5, swordChance: 1 },
] as const;

/** 금화 병합 반경/상한 — 후반 코인 수백 개로 인한 렉 방지 */
const GOLD_MERGE_RADIUS = 56;
// 상한 도달 시엔 가장 가까운 금화로 강제 병합되므로 값은 하나도 잃지 않는다.
// 120은 화면 밖 Image 120개가 상주한다는 뜻이라 45로 낮췄다 (14라운드 렉 대응).
const GOLD_ITEM_CAP = 45;

/** 드랍 글리프 스펙: kind → [텍스처, 크기(px), 틴트]. 모듈 상수(호출마다 재생성 금지). */
const ITEM_SPEC: Record<string, readonly [string, number, number]> = {
	gold: ['g-chip', 15, 0xd9a83c],
	chicken: ['g-cross', 22, 0x9bc25b],
	magnet: ['g-magnet', 22, 0x8fc3d8],
	bomb: ['g-spark', 24, 0xe8874a],
	gcoin: ['g-chip', 26, 0x8fc3d8],
};
const ITEM_SPEC_FALLBACK: readonly [string, number, number] = ['g-spark', 22, 0xdfe6ea];

export interface PickupSystemOptions {
	progression?: ProgressionSystem | null;
	levelUpSystem?: LevelUpSystem | null;
	enemyManager?: EnemyManagerLike | null;
	goldMult?: number;
}

// Gold coins, treasure chests (elite/boss) and field pickups.
export default class PickupSystem {
	scene: GameScene;
	progression: ProgressionSystem | null;
	levelUpSystem: LevelUpSystem | null;
	enemyManager: EnemyManagerLike | null;
	items: PickupItem[];
	runGold: number;
	goldMult: number;
	onEnemyDied: (payload: EnemyDiedPayload) => void;

	constructor(scene: GameScene, options: PickupSystemOptions = {}) {
		this.scene = scene;
		this.progression = options.progression ?? null;
		this.levelUpSystem = options.levelUpSystem ?? null;
		this.enemyManager = options.enemyManager ?? null;

		this.items = [];
		this.runGold = 0;
		// meta greed x character trait x danger bonus
		this.goldMult = (1 + (MetaProgression.getBonuses().goldMult ?? 0)) * (options.goldMult ?? 1);

		// 정철 표시는 HudSystem(좌상단 클러스터)이 전담한다. 예전엔 여기에 항상 숨겨진
		// Text가 하나 있었고 골드 획득/소비마다 setText로 캔버스를 다시 구웠다 —
		// 보이지도 않는 텍스처를 재생성하던 순수 낭비라 객체째로 제거했다.

		this.onEnemyDied = (payload: EnemyDiedPayload) => this.handleEnemyDeath(payload);
		scene.events.on(GameEvents.ENEMY_DIED, this.onEnemyDied);
	}

	handleEnemyDeath(payload: EnemyDiedPayload): void {
		const enemy = payload?.enemy;
		const catalog: Partial<EnemyDefinition> = enemy?.catalog ?? {};
		const x = payload?.x;
		const y = payload?.y;

		if (typeof x !== 'number' || typeof y !== 'number') {
			return;
		}

		// Bosses/minibosses: 0.5% chance to drop a 💎 (guaranteed-enhancement coin)
		if ((catalog.isBoss || catalog.isMiniboss) && Math.random() < 0.005) {
			this.spawnItem(x, y - 20, 'gcoin', 1);
		}

		// Elites, minibosses and bosses drop treasure chests (등급별 색상)
		if (catalog.isElite || catalog.isBoss || catalog.isMiniboss) {
			const round = this.scene.enemyManager?.currentRound ?? 1;
			const tier = catalog.isBoss ? (round >= 100 ? 3 : 2) : catalog.isMiniboss ? 1 : 0;
			this.spawnChest(x, y, tier, catalog.goldValue ?? 50);
			return;
		}

		// Gold coins — 스킬 트리 [미다스의 손] 중에는 확정 드랍
		const goldRush = (this.scene.skillTree?.goldRushUntil ?? 0) > (this.scene.time?.now ?? 0);
		if (goldRush) {
			this.spawnItem(x, y, 'gold', Math.max(1, catalog.goldValue ?? 1));
		} else if ((catalog.goldValue ?? 0) > 0 && Math.random() < (catalog.goldChance ?? 0) * GOLD_DROP_CHANCE_MULT) {
			this.spawnItem(x + Phaser.Math.Between(-10, 10), y + Phaser.Math.Between(-10, 10), 'gold', catalog.goldValue);
		}

		// Rare field pickups
		if (!catalog.isReaper && Math.random() < PICKUP_DROP_CHANCE) {
			const kind = Phaser.Math.RND.pick(['chicken', 'magnet', 'bomb']);
			this.spawnItem(x, y, kind, 0);
		}
	}

	spawnItem(x: number, y: number, kind: string, amount = 0): void {
		// 금화 병합: 가까운 기존 금화에 합쳐서 오브젝트 수를 억제 (렉 방지)
		if (kind === 'gold') {
			const merged = this.tryMergeGold(x, y, amount);
			if (merged) {
				return;
			}
		}

		// 드랍 아이템: 코드 드로잉 글리프 (kind → [텍스처, 크기(px), 틴트])
		// 스펙 표는 모듈 상수 — 예전엔 호출마다 객체 1개 + 배열 5개를 새로 만들었다
		// (골드 드랍/미다스/황금 소나기까지 합치면 초당 수백 개).
		const spec = ITEM_SPEC[kind] ?? ITEM_SPEC_FALLBACK;

		const obj = this.scene.add.image(x, y, spec[0])
			.setDisplaySize(spec[1], spec[1])
			.setTint(spec[2])
			.setOrigin(0.5)
			.setDepth(45);

		// 흔들림은 update()에서 sin으로 계산 (아이템당 무한 트윈 제거 — 성능)
		this.items.push({ obj, kind, amount, x, y, baseY: y, bobPhase: Math.random() * Math.PI * 2, spawnedAt: this.scene.time.now, wasOnScreen: true });
	}

	/** 등급별 보물상자 스폰 — 닫힘 idle 애니메이션 재생 (홀수줄), 수집 시 열림(짝수줄) */
	spawnChest(x: number, y: number, tier: number, amount: number): void {
		const t = Phaser.Math.Clamp(tier, 0, CHEST_TIERS.length - 1);

		// 시트 미로드 시 기존 글리프로 폴백
		if (!this.scene.textures.exists('chests')) {
			const obj = this.scene.add.image(x, y, 'g-crate')
				.setDisplaySize(30, 30)
				.setTint(0xc9a25f)
				.setOrigin(0.5)
				.setDepth(45);
			this.items.push({ obj, kind: 'chest', amount, x, y, baseY: y, bobPhase: Math.random() * Math.PI * 2, tier: t, spawnedAt: this.scene.time.now, wasOnScreen: true });
			return;
		}

		const obj = this.scene.add.sprite(x, y, 'chests', t * 10)
			.setOrigin(0.5)
			.setScale(1.35)
			.setDepth(45);
		obj.play(`chest${t}-idle`);

		this.items.push({ obj, kind: 'chest', amount, x, y, baseY: y, bobPhase: Math.random() * Math.PI * 2, tier: t, spawnedAt: this.scene.time.now, wasOnScreen: true });
	}

	/** 반경 내 금화에 합치기. 상한 초과 시엔 가장 가까운 금화에 강제 병합. */
	private tryMergeGold(x: number, y: number, amount: number): boolean {
		let nearest: PickupItem | null = null;
		let nearestDistSq = Infinity;
		let goldCount = 0;

		for (const item of this.items) {
			if (item.kind !== 'gold' || !item.obj || item.obj.destroyed || item.attracting) {
				continue;
			}
			goldCount += 1;
			const dx = item.obj.x - x;
			const dy = item.obj.y - y;
			const distSq = dx * dx + dy * dy;
			if (distSq < nearestDistSq) {
				nearestDistSq = distSq;
				nearest = item;
			}
		}

		const withinRadius = nearestDistSq <= GOLD_MERGE_RADIUS * GOLD_MERGE_RADIUS;
		if (nearest && (withinRadius || goldCount >= GOLD_ITEM_CAP)) {
			nearest.amount += amount;
			// 커진 금화는 살짝 크게 보여 준다 (최대 22px)
			const size = Math.min(22, 15 + Math.floor(nearest.amount / 8));
			nearest.obj.setDisplaySize(size, size);
			return true;
		}
		return false;
	}

	update(): void {
		const player = this.scene.player;
		if (!player || player.isDead) {
			return;
		}

		const magnetRadius = this.progression?.magnetRadius ?? 200;
		const bobT = this.scene.time.now * 0.004;
		const now = this.scene.time.now;
		const abandonSq = PICKUP_ABANDON_RADIUS * PICKUP_ABANDON_RADIUS;

		for (let i = this.items.length - 1; i >= 0; i -= 1) {
			const item = this.items[i];

			if (!item.obj || item.obj.destroyed) {
				this.items.splice(i, 1);
				continue;
			}

			const dx = player.x - item.obj.x;
			const dy = player.y - item.obj.y;
			const distanceSq = dx * dx + dy * dy;

			// 버려진 픽업 회수: 플레이어가 한참 전에 지나친 자리의 아이템은 정리한다.
			// 예전엔 만료도 상한도 없어서(금화만 120 상한) 시간이 갈수록 화면 밖에
			// Image/Sprite가 쌓였고, 상자는 화면 밖에서도 idle 애니메이션을 계속 돌렸다.
			// 상자·💎는 보상이므로 만료시키지 않는다 (컬링만 적용).
			const expirable = item.kind !== 'chest' && item.kind !== 'gcoin';
			if (expirable && distanceSq > abandonSq && now - (item.spawnedAt ?? now) > PICKUP_TTL_MS) {
				this.scene.tweens.killTweensOf(item.obj);
				item.obj.destroy();
				this.items.splice(i, 1);
				continue;
			}

			// 화면 밖 픽업은 그리지도, 애니메이션을 돌리지도 않는다
			const onScreen = distanceSq <= abandonSq;
			if (onScreen !== item.wasOnScreen) {
				item.wasOnScreen = onScreen;
				item.obj.setVisible(onScreen);
				const anims = (item.obj as Phaser.GameObjects.Sprite).anims;
				if (anims?.currentAnim) {
					if (onScreen) {
						anims.resume();
					} else {
						anims.pause();
					}
				}
			}
			if (!onScreen) {
				continue; // 흔들림·자석 계산도 생략
			}

			const distance = Math.sqrt(distanceSq);

			// Gold is pulled in by the magnet like XP orbs
			if (item.kind === 'gold' && distance <= magnetRadius) {
				item.attracting = true;
				const pull = Phaser.Math.Clamp(distance * 1.6, 120, 420) * (this.scene.game.loop.delta / 1000);
				const angle = Phaser.Math.Angle.Between(item.obj.x, item.obj.y, player.x, player.y);
				item.obj.x += Math.cos(angle) * pull;
				item.obj.y += Math.sin(angle) * pull;
			} else if (!item.attracting) {
				// 트윈 없는 흔들림 (성능)
				item.obj.y = (item.baseY ?? item.obj.y) + Math.sin(bobT + (item.bobPhase ?? 0)) * 4;
			}

			if (distance <= COLLECT_RADIUS) {
				this.collect(item);
				this.items.splice(i, 1);
			}
		}
	}

	/**
	 * 라운드 전환 시 호출: 멀리 떨어진 금화는 정철로 정산하고 오브젝트를 반납한다.
	 * 상자·💎는 남긴다(보상이므로 플레이어가 직접 주우러 갈 수 있어야 한다).
	 */
	sweepAbandonedItems(): void {
		const player = this.scene.player;
		if (!player) {
			return;
		}
		const keepRadius = (this.progression?.magnetRadius ?? 200) + 200;
		const keepSq = keepRadius * keepRadius;
		for (let i = this.items.length - 1; i >= 0; i -= 1) {
			const item = this.items[i];
			if (!item.obj || item.obj.destroyed) {
				this.items.splice(i, 1);
				continue;
			}
			if (item.kind === 'chest' || item.kind === 'gcoin') {
				continue;
			}
			const dx = player.x - item.obj.x;
			const dy = player.y - item.obj.y;
			if (dx * dx + dy * dy <= keepSq) {
				continue;
			}
			// 금화는 값을 잃지 않도록 정산 후 제거, 나머지는 그냥 정리
			if (item.kind === 'gold') {
				this.addGold(item.amount);
			}
			this.scene.tweens.killTweensOf(item.obj);
			item.obj.destroy();
			this.items.splice(i, 1);
		}
	}

	/**
	 * 라운드 종료: 바닥의 금화·보스 상자·보장석·필드 아이템 전부 자동 수령.
	 * 금화는 소리 폭주를 막으려 합산해 1회로 정산하고, 상자는 각자 열림
	 * 애니메이션을 재생한다 (보통 라운드당 몇 개 수준).
	 */
	collectAllItems(): void {
		let gold = 0;
		for (let i = this.items.length - 1; i >= 0; i -= 1) {
			const item = this.items[i];
			this.items.splice(i, 1);
			if (!item.obj || item.obj.destroyed) {
				continue;
			}
			if (item.kind === 'gold') {
				gold += item.amount;
				this.scene.tweens.killTweensOf(item.obj);
				item.obj.destroy();
				continue;
			}
			this.collect(item);
		}
		if (gold > 0) {
			this.scene.soundSystem?.play('gold');
			this.addGold(gold);
		}
	}

	collect(item: PickupItem): void {
		const player = this.scene.player;

		switch (item.kind) {
			case 'gold':
				this.scene.soundSystem?.play('gold');
				this.addGold(item.amount);
				break;
			case 'chest':
				// openChest가 열림 애니메이션 재생 후 스스로 오브젝트를 파괴한다
				this.openChest(item);
				return;
			case 'gcoin': {
				const total = MetaProgression.addGuaranteeCoin(1);
				this.scene.soundSystem?.play('chest');
				if (screenShakeEnabled()) {
					this.scene.cameras.main.flash(500, 143, 195, 216);
				}
				this.scene.waveSystem?.announce?.(`보장석 획득 — 다음 강화는 실패하지 않는다 (보유 ${total})`, '#8fc3d8');
				break;
			}
			case 'chicken': {
				this.scene.soundSystem?.play('revive', { volume: 0.5 });
				const heal = Math.round((player.maxHp ?? 100) * 0.3);
				player.hp = Math.min(player.maxHp, player.hp + heal);
				this.scene.visualEffects?.showDamageText?.(player.x, player.y - 60, `+${heal}`, false);
				break;
			}
			case 'magnet': {
				// Vacuum: collect every live XP orb instantly
				if (this.progression) {
					for (const orb of this.progression.orbs.getChildren() as XPOrbSprite[]) {
						if (this.progression.isAliveOrb(orb)) {
							this.progression.collectOrb(orb);
						}
					}
				}
				if (screenShakeEnabled()) {
					this.scene.cameras.main.flash(250, 143, 195, 216);
				}
				break;
			}
			case 'bomb': {
				// Damage every enemy near the screen
				this.scene.soundSystem?.play('bigkill');
				const camera = this.scene.cameras.main;
				if (screenShakeEnabled()) {
					this.scene.cameras.main.shake(350, 0.012);
					this.scene.cameras.main.flash(300, 255, 255, 255);
				}

				if (this.enemyManager) {
					for (const enemy of this.enemyManager.enemies.getChildren() as EnemySprite[]) {
						if (!this.enemyManager.isAliveEnemy(enemy)) {
							continue;
						}

						const inView = enemy.x > camera.scrollX - 100 && enemy.x < camera.scrollX + camera.width + 100
							&& enemy.y > camera.scrollY - 100 && enemy.y < camera.scrollY + camera.height + 100;

						if (inView) {
							this.enemyManager.takeDamage(enemy, Math.round(200 * (this.scene.swordOrbit?.flatDamageScale?.() ?? 1)), player);
						}
					}
				}
				break;
			}
			default:
				break;
		}

		this.scene.tweens.killTweensOf(item.obj);
		item.obj.destroy();
	}

	addGold(amount: number): void {
		// MIDAS 해금 스탯: INGOT 획득 보너스 (최대 +50%)
		const midas = 1 + Math.min(0.5, this.scene.player?.goldBonus ?? 0);
		const gained = Math.max(1, Math.round(amount * this.goldMult * midas));
		this.runGold += gained;
		// 황금 4세트 [탐욕의 대가]: 런 중 벌어들인 총액이 검 피해로 환산된다
		this.scene.elementSets?.onGoldEarned?.(gained);
		// Lifetime gold counts at EARN time (character unlocks) - spending in the shop doesn't reduce it
		MetaProgression.addLifetime(gained);
	}

	spendGold(amount: number): boolean {
		if (this.runGold < amount) {
			return false;
		}

		this.runGold -= amount;
		return true;
	}

	openChest(item: PickupItem): void {
		const player = this.scene.player;
		const luck = player?.luck ?? 0;
		const tier = Phaser.Math.Clamp(item.tier ?? 0, 0, CHEST_TIERS.length - 1);
		const spec = CHEST_TIERS[tier];

		// Gold jackpot: 1x / 3x / 5x rolls — luck + 상자 등급이 확률을 끌어올린다 (VS-style)
		const jackpotRoll = Math.random() * (1 + luck * 0.5 + spec.jackpotBonus);
		const rolls = jackpotRoll > 0.95 ? 5 : jackpotRoll > 0.8 ? 3 : 1;
		const gold = Math.round((item.amount ?? 50) * spec.goldMult * CHEST_GOLD_MULT * (this.scene.skillTree?.mods.chestGoldMult ?? 1) * rolls * Phaser.Math.FloatBetween(0.8, 1.3));
		this.addGold(gold);

		// Bonus: one random upgrade, auto-applied (rarity rolled with luck)
		let rewardLabel = '';
		if (this.levelUpSystem) {
			const choice = this.levelUpSystem.rollSingleChoice();
			if (choice) {
				this.levelUpSystem.applyChoice(choice);
				rewardLabel = ` + ${choice.upgrade.name} (${choice.rarity.name})`;
			}
		}

		// 상위 상자: 검 획득 확률 (서리는 확정)
		if (spec.swordChance > 0 && Math.random() < spec.swordChance) {
			rewardLabel += this.grantSword(tier);
		}

		this.scene.soundSystem?.play('chest');
		if (screenShakeEnabled()) {
			this.scene.cameras.main.flash(400, 217, 168, 60);
		}
		this.scene.visualEffects?.hitStop?.(100, { force: true });
		this.scene.waveSystem?.announce?.(`${spec.label} — 골드 +${gold}${rewardLabel}`, rolls >= 5 ? '#d9a83c' : spec.color);

		// 열림 애니메이션 (짝수줄) 재생 후 페이드아웃·파괴
		const obj = item.obj as Phaser.GameObjects.Sprite;
		this.scene.tweens.killTweensOf(obj);
		if (typeof obj.play === 'function' && this.scene.anims.exists(`chest${tier}-open`)) {
			obj.play(`chest${tier}-open`);
			obj.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
				if (!obj.active) {
					return;
				}
				this.scene.tweens.add({
					targets: obj,
					alpha: 0,
					duration: 300,
					delay: 250,
					onComplete: () => obj.destroy(),
				});
			});
		} else {
			obj.destroy();
		}
	}

	/** 상자에서 검 지급 — 자리가 없으면 보관함으로. 등급이 높을수록 상위 검 풀에서 뽑는다. */
	/** 상자 티어별 검 등급 가중치 — mythic 은 조합 전용이라 상자에서 안 나온다. */
	private static readonly CHEST_RARITY_WEIGHTS: Array<Record<string, number>> = [
		{ common: 60, uncommon: 40 },
		{ common: 45, uncommon: 35, rare: 20 },
		{ uncommon: 30, rare: 45, epic: 20, legendary: 5 },
		{ rare: 25, epic: 45, legendary: 30 },
	];

	private grantSword(tier: number): string {
		const catalog = this.levelUpSystem?.swordCatalog ?? [];
		const so = this.scene.swordOrbit;
		if (!so || catalog.length === 0) {
			return '';
		}

		// 등급 가중 추첨 (evolved·mythic 제외)
		const weights = PickupSystem.CHEST_RARITY_WEIGHTS[
			Phaser.Math.Clamp(tier, 0, PickupSystem.CHEST_RARITY_WEIGHTS.length - 1)
		];
		const pool = catalog.filter(
			(sword) => !sword.evolved && (weights[sword.rarity ?? 'common'] ?? 0) > 0,
		);
		if (pool.length === 0) {
			return '';
		}
		const total = pool.reduce((sum, s) => sum + (weights[s.rarity ?? 'common'] ?? 0), 0);
		let roll = Math.random() * total;
		let definition = pool[pool.length - 1];
		for (const sword of pool) {
			roll -= weights[sword.rarity ?? 'common'] ?? 0;
			if (roll <= 0) {
				definition = sword;
				break;
			}
		}

		// 이미 보유한 검이면 합성 레벨업 (중복 보유 없음)
		const result = so.acquireSword(this.scene, definition);
		if (result === 'merged') {
			return ` + ${definition.name} 합성 (레벨 ↑)`;
		}
		if (result === 'equipped') {
			return ` + ${definition.name} 합류`;
		}
		if (result === 'reserved') {
			return ` + ${definition.name} (보관함)`;
		}
		return '';
	}

	destroy(): void {
		this.scene.events.off(GameEvents.ENEMY_DIED, this.onEnemyDied);
		for (const item of this.items) {
			item.obj?.destroy();
		}
		this.items = [];
	}
}
