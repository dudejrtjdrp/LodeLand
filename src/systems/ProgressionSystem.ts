import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite, PlayerSprite } from '../types/actors';
import { GameEvents } from '../core/events';
import { xpRequiredForLevel } from '../logic/growth';

/** XP orb pooled sprite with the runtime fields this system attaches. */
export interface XPOrbSprite extends Phaser.Physics.Arcade.Sprite {
	amount?: number;
	_isAttracting?: boolean;
	/** 스폰 시각 — 버려진 오브 자동 회수(TTL) 판정용. */
	_spawnedAt?: number;
	destroyed?: boolean;
}

/**
 * 오브 개수 억제 파라미터.
 *
 * 오브에는 원래 만료가 없어서 플레이어가 지나온 자리에 영원히 남았다. 회수 경로는
 * "플레이어가 반경 안에 들어옴"뿐이라 라운드 10 전후면 상한(160)까지 포화하고,
 * 그만큼의 스프라이트 + 아케이드 body가 화면 밖에서 매 프레임 순회·렌더 대상이 됐다.
 * XP는 잃지 않고(회수 시 그대로 지급) 오브젝트만 줄인다.
 */
const ORB_MERGE_THRESHOLD = 40;
/** 이 거리를 넘어가면 "플레이어가 다시 오지 않을" 오브로 본다 (화면 대각선의 약 2배). */
const ORB_ABANDON_RADIUS = 1100;
/** 멀리 있는 오브가 자동 회수되기까지의 시간. */
const ORB_TTL_MS = 20000;

/** Runtime HUD mirror fields written onto the player (not in PlayerSprite). */
export interface ProgressionPlayer extends PlayerSprite {
	xp?: number;
	level?: number;
	xpToNext?: number;
}

/** Payload emitted by EnemyManager on GameEvents.ENEMY_DIED. */
export interface EnemyDiedPayload {
	enemy?: EnemySprite;
	x?: number;
	y?: number;
	amount?: number;
	player?: PlayerSprite;
}

export interface ProgressionSystemOptions {
	maxLevel?: number;
	orbXp?: number;
	collectRadius?: number;
	maxOrbs?: number;
	magnetRadius?: number;
	orbAttractDurationPerPx?: number;
}

export default class ProgressionSystem {
	scene: GameScene;
	swordOrbit: unknown;
	player: ProgressionPlayer | null;
	level: number;
	xp: number;
	maxLevel: number;
	xpToNext: number;
	orbXp: number;
	collectRadius: number;
	orbs: Phaser.Physics.Arcade.Group;
	magnetRadius: number;
	/** 런 시작 시점(메타 적용 후) 획득 반경 — 상한(base×3) 계산 기준. GameScene 이 스냅샷. */
	baseMagnetRadius?: number;
	orbAttractDurationPerPx: number;
	hudBackground: Phaser.GameObjects.Graphics;
	hudFill: Phaser.GameObjects.Graphics;
	hudText: Phaser.GameObjects.Text;
	/** Set externally (shop XP upgrade); read with `?? 1` fallback. */
	xpMultiplier?: number;

	constructor(scene: GameScene, swordOrbit?: unknown, options: ProgressionSystemOptions = {}) {
		this.scene = scene;
		this.swordOrbit = swordOrbit ?? null;
		this.player = null;
		this.level = 1;
		this.xp = 0;
		this.maxLevel = options.maxLevel ?? 120;
		this.xpToNext = this.xpRequiredFor(1);
		this.orbXp = options.orbXp ?? 25;
		this.collectRadius = options.collectRadius ?? 120;
		this.orbs = scene.physics.add.group({ maxSize: options.maxOrbs ?? 256 });
		this.magnetRadius = options.magnetRadius ?? 220;
		this.orbAttractDurationPerPx = options.orbAttractDurationPerPx ?? 2.5; // ms per pixel
		// 레벨/XP 표시는 HudSystem(좌상단 클러스터)이 담당 — 기존 오브젝트는 숨김 유지
		this.hudBackground = scene.add.graphics().setScrollFactor(0).setDepth(1000).setVisible(false);
		this.hudFill = scene.add.graphics().setScrollFactor(0).setDepth(1001).setVisible(false);
		this.hudText = scene.add.text(18, 16, 'Lv. 1', {
			fontFamily: 'Arial, sans-serif',
			fontSize: '18px',
			color: '#ffffff',
		}).setScrollFactor(0).setDepth(1002).setVisible(false);
		this.scene.events.on(GameEvents.ENEMY_DIED, this.handleEnemyDeath, this);
		this.refreshPlayerStats();
		this.drawHud();
	}

	attachPlayer(player: ProgressionPlayer): void {
		this.player = player;
		this.refreshPlayerStats();
		this.drawHud();
	}

	handleEnemyDeath(payload: EnemyDiedPayload): void {
		const x = payload?.x ?? payload?.enemy?.x;
		const y = payload?.y ?? payload?.enemy?.y;
		if (typeof x !== 'number' || typeof y !== 'number') {
			return;
		}

		const amount = payload?.amount ?? this.orbXp;
		if (amount <= 0) {
			return;
		}

		this.spawnXPOrb(x, y, amount);
	}

	spawnXPOrb(x: number, y: number, amount: number = this.orbXp): XPOrbSprite | false {
		// 오브 과밀 시 근처 오브에 병합 — 오브젝트 수 억제 + 풀 상한(256) 도달로
		// XP가 통째로 사라지던 문제 해결 (30라+ 렉/손실 모두 방지)
		// 병합 임계 40. 예전엔 160이라 "상한"이 아니라 "도달 목표"처럼 동작했고,
		// 오브에 만료·거리 회수가 없어서 라운드 10 전후면 화면 밖 오브 160개 +
		// 아케이드 body 160개가 상주했다 (14라운드 렉의 주요 지분).
		const liveOrbs = this.orbs.countActive(true);
		if (liveOrbs >= ORB_MERGE_THRESHOLD) {
			let nearest: XPOrbSprite | null = null;
			let nearestDistSq = Infinity;
			for (const other of this.orbs.getChildren() as XPOrbSprite[]) {
				if (!this.isAliveOrb(other)) {
					continue;
				}
				const dx = other.x - x;
				const dy = other.y - y;
				const distSq = dx * dx + dy * dy;
				if (distSq < nearestDistSq) {
					nearestDistSq = distSq;
					nearest = other;
				}
			}
			if (nearest) {
				nearest.amount = (nearest.amount ?? 0) + amount;
				// 뭉친 오브는 조금 크게 (최대 20px)
				const size = Math.min(20, 12 + Math.floor((nearest.amount ?? 0) / 150));
				nearest.setDisplaySize(size, size);
				return nearest;
			}
		}

		let orb = this.orbs.getFirstDead(false) as XPOrbSprite | null;

		if (!orb) {
			orb = this.orbs.create(x, y, 'xp_orb') as XPOrbSprite | null;
		}

		if (!orb) {
			return false;
		}

		orb.setDepth(50);
		orb.setPosition(x, y);
		orb.setActive(true);
		orb.setVisible(true);
		orb.amount = amount;
		orb.setTint(0xfbbf24);
		orb.setDisplaySize(12, 12);
		orb.setAlpha(0.95);
		orb._isAttracting = false;
		orb._spawnedAt = this.scene.time.now;
		if (orb.body) {
			orb.body.reset(x, y);
			orb.setCircle(9);
		}

		if (orb.body) {
			(orb.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
			(orb.body as Phaser.Physics.Arcade.Body).setImmovable(true);
		}

		return orb;
	}

	update(player: ProgressionPlayer | null = this.player, delta: number): void {
		if (player) {
			this.player = player;
		}

		if (!this.player) {
			return;
		}

		const now = this.scene.time.now;
		const magnetSq = this.magnetRadius * this.magnetRadius;
		const collectSq = this.collectRadius * this.collectRadius;
		const abandonSq = ORB_ABANDON_RADIUS * ORB_ABANDON_RADIUS;

		for (const orb of this.orbs.getChildren() as XPOrbSprite[]) {
			if (!this.isAliveOrb(orb)) {
				continue;
			}

			const dx = this.player.x - orb.x;
			const dy = this.player.y - orb.y;
			const distanceSq = dx * dx + dy * dy;

			// 버려진 오브 회수: 오래됐고 멀리 떨어진(플레이어가 다시 갈 일 없는) 오브는
			// XP를 그대로 지급하고 오브젝트를 반납한다. 손실 없이 개수만 억제한다.
			if (distanceSq > abandonSq && now - (orb._spawnedAt ?? now) > ORB_TTL_MS) {
				this.addXP(orb.amount ?? this.orbXp);
				this.recycleOrb(orb);
				continue;
			}

			// (성능) 12px 오브의 개별 회전은 시각 효과 대비 비용이 커서 제거
			// 화면 밖 오브는 그리지 않는다 (Phaser는 프러스텀 컬링을 하지 않는다)
			orb.setVisible(distanceSq <= abandonSq);

			// If within magnet radius, use physics to move the orb toward player
			if (distanceSq <= magnetSq) {
				const distance = Math.sqrt(distanceSq);
				orb._isAttracting = true;
				if (orb.body) {
					orb.body.enable = true;
				}
				// slower attraction: gentler pull toward player
				const attractionSpeed = Phaser.Math.Clamp(distance * 1.6, 120, 420);
				this.scene.physics.moveToObject(orb, this.player, attractionSpeed);
			}

			// safety: collect if already very close
			if (distanceSq <= collectSq) {
				this.collectOrb(orb);
			}
		}
		// (성능) drawHud는 XP 변동 시에만 (addXP/levelUp에서 호출)
	}

	/**
	 * 라운드 전환 시 호출: 플레이어에게서 멀리 떨어진 구슬을 XP만 지급하고 회수한다.
	 * (근처 구슬은 곧 주울 테니 그대로 둔다.)
	 */
	sweepAbandonedOrbs(): void {
		const player = this.player;
		if (!player) {
			return;
		}
		const keepSq = this.magnetRadius * this.magnetRadius;
		let gained = 0;
		for (const orb of this.orbs.getChildren() as XPOrbSprite[]) {
			if (!this.isAliveOrb(orb)) {
				continue;
			}
			const dx = player.x - orb.x;
			const dy = player.y - orb.y;
			if (dx * dx + dy * dy <= keepSq) {
				continue;
			}
			gained += orb.amount ?? this.orbXp;
			this.recycleOrb(orb);
		}
		if (gained > 0) {
			this.addXP(gained);
		}
	}

	/**
	 * 라운드 종료: 거리 불문 남은 구슬 전부 즉시 흡수. 마을로 넘어가기 전에
	 * 필드의 경험치를 정산해 유저가 주우러 되돌아다닐 필요를 없앤다.
	 */
	collectAllOrbs(): void {
		let gained = 0;
		for (const orb of this.orbs.getChildren() as XPOrbSprite[]) {
			if (!this.isAliveOrb(orb)) {
				continue;
			}
			gained += orb.amount ?? this.orbXp;
			this.recycleOrb(orb);
		}
		if (gained > 0) {
			this.scene?.soundSystem?.play('pickup', { volume: 0.7 });
			this.addXP(gained);
		}
	}

	collectOrb(orb: XPOrbSprite): void {
		if (!this.isAliveOrb(orb)) {
			return;
		}

		this.scene?.soundSystem?.play('pickup', { volume: 0.6 });
		this.addXP(orb.amount ?? this.orbXp);
		this.recycleOrb(orb);
	}

	/**
	 * 레벨업 요구 경험치 — 곡선의 단일 출처는 logic/growth.ts (balance-sim 도 같은 함수를 본다).
	 * 여기에 수식을 다시 적지 말 것: 예전에 이 자리의 2차식과 growth.expectedLevelForRound 가
	 * 어긋나면서 22라운드 Lv96(기대 31) → 적이 설계보다 훨씬 약해지는 버그가 났다.
	 */
	xpRequiredFor(level: number): number {
		return xpRequiredForLevel(level);
	}

	addXP(amount: number): void {
		if (this.level >= this.maxLevel) {
			return;
		}

		this.xp += amount * (this.xpMultiplier ?? 1);

		while (this.xp >= this.xpToNext && this.level < this.maxLevel) {
			this.xp -= this.xpToNext;
			this.levelUp();
		}

		this.refreshPlayerStats();
		this.drawHud();
	}

	levelUp(): void {
		this.level += 1;
		this.xpToNext = this.xpRequiredFor(this.level);

		this.refreshPlayerStats();
		this.scene.events.emit(GameEvents.LEVEL_UP, this.level);
	}

	refreshPlayerStats(): void {
		if (!this.player) {
			return;
		}

		this.player.xp = this.xp;
		this.player.level = this.level;
		this.player.xpToNext = this.xpToNext;
	}

	drawHud(): void {
		const barX = 16;
		const barY = 44;
		const barWidth = 180;
		const barHeight = 12;
		const fillRatio = Phaser.Math.Clamp(this.xpToNext > 0 ? this.xp / this.xpToNext : 0, 0, 1);

		this.hudBackground.clear();
		this.hudBackground.fillStyle(0x111827, 0.78);
		this.hudBackground.fillRoundedRect(12, 10, 220, 54, 10);
		this.hudBackground.fillStyle(0x2b3440, 1);
		this.hudBackground.fillRoundedRect(barX, barY, barWidth, barHeight, 6);

		this.hudFill.clear();
		this.hudFill.fillStyle(0xfbbf24, 1);
		this.hudFill.fillRoundedRect(barX, barY, barWidth * fillRatio, barHeight, 6);

		if (this.level >= this.maxLevel) {
			this.hudText.setText(`Lv. ${this.level} (MAX)`);
		} else {
			this.hudText.setText(`Lv. ${this.level}   ${Math.floor(this.xp)} / ${this.xpToNext}`);
		}
	}

	/**
	 * 생존 판정은 `active`만 본다. `visible`은 화면 밖 렌더 컬링에 쓰이므로
	 * 생존 신호로 겸용하면 "안 보이는 구슬 = 죽은 구슬"이 되어 회수되지 않는다.
	 * 회수 경로(recycleOrb)는 항상 setActive(false)를 부르므로 active만으로 충분하다.
	 */
	isAliveOrb(orb: XPOrbSprite | null | undefined): boolean {
		return Boolean(orb && orb.active !== false && !orb.destroyed);
	}

	recycleOrb(orb: XPOrbSprite | null): void {
		if (!orb) {
			return;
		}

		orb.setVelocity(0, 0);
		orb.disableBody?.(true, true);
		orb.setActive(false);
		orb.setVisible(false);
	}
}
