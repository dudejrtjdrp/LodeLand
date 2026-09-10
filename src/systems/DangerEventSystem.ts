// 위험 이벤트 (2026-09-04)
//
// "15~20라부터 서 있기만 해도 된다" 에 대한 답 중 하나. 라운드 중간에 **처리하면 보상,
// 방치하면 페널티**인 사건이 하나 터진다 — 서 있는 것이 손해가 되도록.
//
//   정예 습격 (raid)   정예 3기가 키퍼 둘레에 떨어진다. 제한 시간 안에 전부 처치 → 황금 상자.
//                       놓치면 살아남은 정예가 격노(피해·속도 ×1.3)한 채 남는다.
//   보물 골렘 (golem)  움직이지 않는 골렘. 제한 시간 안에 부수면 골드 더미 + 상자 + 필살기 30%.
//                       놓치면 땅속으로 사라진다 (보상 없음).
//   저주 구역 (curse)  근처에 저주 장판. 안에 서면 초당 최대체력 2.5% 손실, 중심 제단에
//                       누적 4초 서 있으면 정화 → 필살기 50% + 골드. 방치하면 터지며 15% 피해
//                       + 잡몹 6기 소환.
//
// 규칙
//  1. 15라운드부터, 보스 라운드(10의 배수) 제외, 라운드당 최대 1회. 확률은 라운드가 갈수록 오른다.
//  2. 라운드가 끝나면(roundActive=false) 진행 중인 이벤트는 조용히 정리된다.
//  3. 연출은 공유 FX 레이어 + Graphics 1개. 핫패스에서 배열/객체를 만들지 않는다.

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite } from '../types/actors';
import { UI, style, TEXT_RESOLUTION, FONT } from '../ui/theme';
import { reduceMotion } from '../core/settings';
import { formatHudNumber } from '../logic/growth';

export type DangerEventKind = 'raid' | 'golem' | 'curse';

/** 이벤트 시작 라운드 · 확률 곡선 · 제한 시간 — 밸런스 조정은 여기서 */
export const DANGER_EVENTS = {
	startRound: 15,
	/** 라운드 r 에 이벤트가 뜰 확률: base + perRound×(r-15), cap */
	chanceBase: 0.45,
	chancePerRound: 0.012,
	chanceCap: 0.85,
	/** 라운드 경과 중 이벤트가 터지는 시각(ms) 범위 */
	triggerMinMs: 7000,
	triggerMaxMs: 20000,
	raid: { count: 3, limitMs: 18000, distance: 360, frenzyMult: 1.3, chestTier: 2 },
	golem: { limitMs: 22000, distance: 300, hpMult: 0.7, goldCoins: 6, chestTier: 1, ultCharge: 0.3 },
	curse: {
		limitMs: 35000, distance: 320, radius: 240, altarRadius: 72, purifyMs: 4000,
		drainPctPerSec: 0.025, burstPct: 0.15, burstSpawn: 6, ultCharge: 0.5, goldCoins: 4,
	},
} as const;

interface ActiveEvent {
	kind: DangerEventKind;
	startedAt: number;
	until: number;
	x: number;
	y: number;
	/** raid/golem: 이 이벤트가 낳은 적 (spawnGeneration 으로 재사용 감지) */
	enemies: Array<{ enemy: EnemySprite; gen: number }>;
	/** curse: 제단 누적 정화 시간(ms) */
	purifyMs: number;
	/** curse: 마지막 손실 틱 */
	drainAcc: number;
	/** 마지막 표시 초 (텍스트 갱신 가드) */
	lastSecondsShown: number;
	resolved: boolean;
}

const QUERY: EnemySprite[] = [];

export default class DangerEventSystem {
	scene: GameScene;
	current: ActiveEvent | null = null;
	/** 이번 라운드에 이벤트가 터질 경과 시각 (-1 = 없음) */
	private scheduledAt = -1;
	private lastRound = -1;
	/** 통계/테스트 */
	history: Array<{ round: number; kind: DangerEventKind; success: boolean }> = [];
	private g: Phaser.GameObjects.Graphics | null = null;
	private label: Phaser.GameObjects.Text | null = null;
	private destroyed = false;
	/** 테스트 훅: 다음 라운드에 강제로 이 종류를 띄운다 */
	forceKind: DangerEventKind | null = null;

	constructor(scene: GameScene) {
		this.scene = scene;
	}

	// ------------------------------------------------------------------
	// 스케줄
	// ------------------------------------------------------------------

	chanceForRound(round: number): number {
		if (round < DANGER_EVENTS.startRound || round % 10 === 0) {
			return 0;
		}
		return Math.min(DANGER_EVENTS.chanceCap,
			DANGER_EVENTS.chanceBase + DANGER_EVENTS.chancePerRound * (round - DANGER_EVENTS.startRound));
	}

	private pickKind(round: number): DangerEventKind {
		if (this.forceKind) {
			const kind = this.forceKind;
			this.forceKind = null;
			return kind;
		}
		const roll = Math.random();
		if (round < 20) {
			return roll < 0.5 ? 'raid' : 'golem';
		}
		return roll < 0.38 ? 'raid' : roll < 0.68 ? 'golem' : 'curse';
	}

	update(delta: number): void {
		if (this.destroyed) {
			return;
		}
		const scene = this.scene;
		const wave = scene.waveSystem;
		if (!wave || scene.isGameOver || scene.villageSystem?.isActive || !scene.player || scene.player.isDead) {
			return;
		}
		if (!wave.roundActive) {
			if (this.current) {
				this.cleanup();
			}
			return;
		}
		if (wave.round !== this.lastRound) {
			this.lastRound = wave.round;
			if (this.current) {
				this.cleanup();
			}
			const chance = this.chanceForRound(wave.round);
			this.scheduledAt = (this.forceKind || Math.random() < chance)
				? DANGER_EVENTS.triggerMinMs + Math.random() * (DANGER_EVENTS.triggerMaxMs - DANGER_EVENTS.triggerMinMs)
				: -1;
		}
		if (!this.current && this.scheduledAt >= 0 && wave.roundElapsedMs >= this.scheduledAt) {
			this.scheduledAt = -1;
			this.start(this.pickKind(wave.round));
		}
		if (this.current) {
			this.tick(this.current, delta);
		}
	}

	/** 테스트/디버그: 지금 즉시 이벤트 시작 */
	trigger(kind: DangerEventKind): boolean {
		if (this.current || !this.scene.player) {
			return false;
		}
		this.start(kind);
		return this.current !== null;
	}

	// ------------------------------------------------------------------
	// 시작
	// ------------------------------------------------------------------

	private start(kind: DangerEventKind): void {
		const scene = this.scene;
		const player = scene.player;
		const now = scene.time.now;
		const spec = DANGER_EVENTS[kind];
		const angle = Math.random() * Math.PI * 2;
		const x = player.x + Math.cos(angle) * spec.distance;
		const y = player.y + Math.sin(angle) * spec.distance;
		const event: ActiveEvent = {
			kind, startedAt: now, until: now + spec.limitMs, x, y,
			enemies: [], purifyMs: 0, drainAcc: 0, lastSecondsShown: -1, resolved: false,
		};

		if (kind === 'raid') {
			const ids = this.raidIds(scene.waveSystem.round);
			for (let i = 0; i < ids.length; i += 1) {
				const a = angle + (i / ids.length) * Math.PI * 2;
				const enemy = scene.enemyManager.spawnEnemy(scene, player, ids[i], {
					x: player.x + Math.cos(a) * DANGER_EVENTS.raid.distance,
					y: player.y + Math.sin(a) * DANGER_EVENTS.raid.distance,
				});
				if (enemy) {
					event.enemies.push({ enemy, gen: enemy.spawnGeneration });
				}
			}
			if (event.enemies.length === 0) {
				return;
			}
			scene.waveSystem.announce?.(`정예 습격 — ${Math.round(spec.limitMs / 1000)}초 안에 전부 베면 황금 상자`, '#e0623c');
		} else if (kind === 'golem') {
			const id = scene.waveSystem.round >= 40 ? 'mb-magma-golem' : 'mb-frost-golem';
			const enemy = scene.enemyManager.spawnEnemy(scene, player, id, { x, y });
			if (!enemy) {
				return;
			}
			enemy.speed = 0;
			enemy.knockbackResist = 1;
			enemy.hp = Math.round(enemy.hp * DANGER_EVENTS.golem.hpMult);
			enemy.maxHp = enemy.hp;
			enemy.enemyName = '보물 골렘';
			// 골렘은 스킬을 쓰지 않는다 — 부수는 데 집중하게
			enemy.skillIds = [];
			enemy.nextSkillAt = Number.MAX_SAFE_INTEGER;
			event.enemies.push({ enemy, gen: enemy.spawnGeneration });
			scene.waveSystem.announce?.(`보물 골렘 출현 — ${Math.round(spec.limitMs / 1000)}초 안에 부수면 골드 더미`, '#d9a83c');
		} else {
			scene.waveSystem.announce?.('저주 구역 — 중심 제단에 4초 서서 정화하라 (방치 시 폭발)', '#a78bda');
		}

		this.current = event;
		this.ensureGraphics();
		scene.soundSystem?.play('warning', { volume: 0.5 });
		if (!reduceMotion()) {
			scene.visualEffects?.fxRing(x, y, { r0: 20, r1: 120, w: 4, color: kind === 'curse' ? 0xa78bda : 0xe0623c, alpha: 0.9, dur: 600 });
		}
	}

	private raidIds(round: number): string[] {
		const manager = this.scene.enemyManager;
		const elites = manager.enemyCatalog.filter((def) => def.isElite).map((def) => def.id);
		const minis = manager.enemyCatalog.filter((def) => def.isMiniboss && !def.isBoss).map((def) => def.id);
		const out: string[] = [];
		const count = DANGER_EVENTS.raid.count;
		for (let i = 0; i < count; i += 1) {
			const useMini = round >= 30 && i === count - 1 && minis.length > 0;
			const pool = useMini ? minis : (elites.length > 0 ? elites : minis);
			out.push(pool[Math.floor(Math.random() * pool.length)]);
		}
		return out;
	}

	// ------------------------------------------------------------------
	// 진행
	// ------------------------------------------------------------------

	private aliveCount(event: ActiveEvent): number {
		const manager = this.scene.enemyManager;
		let alive = 0;
		for (const entry of event.enemies) {
			if (entry.enemy.spawnGeneration === entry.gen && manager.isAliveEnemy(entry.enemy) && !entry.enemy.isDying) {
				alive += 1;
			}
		}
		return alive;
	}

	private tick(event: ActiveEvent, delta: number): void {
		const scene = this.scene;
		const now = scene.time.now;
		const player = scene.player;
		const left = Math.max(0, event.until - now);

		if (event.kind === 'raid' || event.kind === 'golem') {
			// 남은 적의 위치를 라벨 기준으로 (골렘은 제자리, 습격은 첫 생존 정예)
			let anchor: EnemySprite | null = null;
			for (const entry of event.enemies) {
				if (entry.enemy.spawnGeneration === entry.gen && scene.enemyManager.isAliveEnemy(entry.enemy) && !entry.enemy.isDying) {
					anchor = entry.enemy;
					break;
				}
			}
			if (!anchor) {
				this.resolve(event, true);
				return;
			}
			this.drawTimer(anchor.x, anchor.y - (anchor.displayHeight ?? 60) * 0.7, left, event);
			if (left <= 0) {
				this.resolve(event, false);
			}
			return;
		}

		// ── 저주 구역
		const spec = DANGER_EVENTS.curse;
		const dx = player.x - event.x;
		const dy = player.y - event.y;
		const d2 = dx * dx + dy * dy;
		const inside = d2 <= spec.radius * spec.radius;
		const onAltar = d2 <= spec.altarRadius * spec.altarRadius;
		if (onAltar) {
			event.purifyMs += delta;
			if (event.purifyMs >= spec.purifyMs) {
				this.resolve(event, true);
				return;
			}
		} else if (inside) {
			// 손실 틱 (0.5초마다, 무적/넉백을 타지 않는 직접 손실)
			event.drainAcc += delta;
			if (event.drainAcc >= 500) {
				event.drainAcc = 0;
				const loss = Math.max(1, Math.round(player.maxHp * spec.drainPctPerSec * 0.5));
				player.hp = Math.max(1, player.hp - loss);
				scene.visualEffects?.showDamageText?.(player.x, player.y - 50, loss, false, '#e879f9');
			}
		}
		this.drawCurse(event, now, onAltar);
		this.drawTimer(event.x, event.y - spec.radius - 18, left, event,
			onAltar ? `정화 ${Math.min(100, Math.floor(event.purifyMs / spec.purifyMs * 100))}%` : null);
		if (left <= 0) {
			this.resolve(event, false);
		}
	}

	// ------------------------------------------------------------------
	// 결과
	// ------------------------------------------------------------------

	private resolve(event: ActiveEvent, success: boolean): void {
		if (event.resolved) {
			return;
		}
		event.resolved = true;
		const scene = this.scene;
		const player = scene.player;
		const pickup = scene.pickupSystem;
		this.history.push({ round: scene.waveSystem?.round ?? 0, kind: event.kind, success });

		if (event.kind === 'raid') {
			if (success) {
				pickup?.spawnChest(player.x + 40, player.y, DANGER_EVENTS.raid.chestTier, 120);
				scene.waveSystem?.announce?.('정예 습격 격퇴 — 황금 상자', '#9bc25b');
				scene.soundSystem?.play('chest');
			} else {
				let survivors = 0;
				for (const entry of event.enemies) {
					const enemy = entry.enemy;
					if (entry.enemy.spawnGeneration === entry.gen && scene.enemyManager.isAliveEnemy(enemy) && !enemy.isDying) {
						enemy.damage = Math.round(enemy.damage * DANGER_EVENTS.raid.frenzyMult);
						enemy.speed = Math.round(enemy.speed * DANGER_EVENTS.raid.frenzyMult);
						enemy.frenzied = true;
						survivors += 1;
						if (!reduceMotion()) {
							scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: 14, r1: 40, w: 3, color: 0xef4444, alpha: 0.9, dur: 360 });
						}
					}
				}
				scene.waveSystem?.announce?.(`정예 ${survivors}기가 격노했다 — 피해·속도 ×${DANGER_EVENTS.raid.frenzyMult}`, '#e0623c');
			}
		} else if (event.kind === 'golem') {
			const entry = event.enemies[0];
			if (success) {
				const ex = entry?.enemy.x ?? player.x;
				const ey = entry?.enemy.y ?? player.y;
				const goldEach = Math.max(5, Math.round((entry?.enemy.catalog?.goldValue ?? 60) * 0.8));
				for (let i = 0; i < DANGER_EVENTS.golem.goldCoins; i += 1) {
					const a = (i / DANGER_EVENTS.golem.goldCoins) * Math.PI * 2;
					pickup?.spawnItem(ex + Math.cos(a) * 34, ey + Math.sin(a) * 34, 'gold', goldEach);
				}
				pickup?.spawnChest(ex, ey - 10, DANGER_EVENTS.golem.chestTier, 80);
				scene.activeSkills?.addUltCharge(DANGER_EVENTS.golem.ultCharge);
				scene.waveSystem?.announce?.(`보물 골렘 파괴 — 골드 ${formatHudNumber(goldEach * DANGER_EVENTS.golem.goldCoins)} + 필살기 +30%`, '#d9a83c');
				scene.soundSystem?.play('chest');
			} else if (entry && entry.enemy.spawnGeneration === entry.gen && scene.enemyManager.isAliveEnemy(entry.enemy)) {
				const enemy = entry.enemy;
				if (!reduceMotion()) {
					scene.visualEffects?.fxRing(enemy.x, enemy.y, { r0: 40, r1: 6, w: 3, color: 0x8d7bb5, alpha: 0.9, dur: 420 });
				}
				scene.enemyManager.recycleEnemy(enemy);
				scene.waveSystem?.announce?.('보물 골렘이 땅속으로 사라졌다', '#8d9aa5');
			}
		} else {
			const spec = DANGER_EVENTS.curse;
			if (success) {
				scene.activeSkills?.addUltCharge(spec.ultCharge);
				for (let i = 0; i < spec.goldCoins; i += 1) {
					const a = (i / spec.goldCoins) * Math.PI * 2;
					pickup?.spawnItem(event.x + Math.cos(a) * 30, event.y + Math.sin(a) * 30, 'gold', 25);
				}
				scene.waveSystem?.announce?.('제단 정화 — 필살기 +50%', '#9bc25b');
				scene.soundSystem?.play('levelup', { volume: 0.5 });
				if (!reduceMotion()) {
					scene.visualEffects?.fxRing(event.x, event.y, { r0: 30, r1: spec.radius, w: 4, color: 0x9bd66a, alpha: 0.9, dur: 520 });
				}
			} else {
				// 폭발: 반경 1.5배 안이면 최대체력 15% + 잡몹 소환
				const dx = player.x - event.x;
				const dy = player.y - event.y;
				const r = spec.radius * 1.5;
				if (dx * dx + dy * dy <= r * r) {
					scene.applyPlayerDamage(Math.round(player.maxHp * spec.burstPct), event.x, event.y, 'magic', '저주 구역');
				}
				for (let i = 0; i < spec.burstSpawn; i += 1) {
					const a = (i / spec.burstSpawn) * Math.PI * 2;
					scene.enemyManager.spawnEnemy(scene, player, null, {
						x: event.x + Math.cos(a) * 80, y: event.y + Math.sin(a) * 80,
					});
				}
				scene.waveSystem?.announce?.('저주가 터졌다', '#e0623c');
				scene.soundSystem?.play('bigkill', { volume: 0.6 });
				if (!reduceMotion()) {
					scene.visualEffects?.fxRing(event.x, event.y, { r0: 40, r1: r, w: 5, color: 0xa78bda, alpha: 0.9, dur: 500 });
				}
			}
		}
		this.cleanup();
	}

	// ------------------------------------------------------------------
	// 표시
	// ------------------------------------------------------------------

	private ensureGraphics(): void {
		if (!this.g) {
			this.g = this.scene.add.graphics().setDepth(2);
		}
		if (!this.label) {
			this.label = this.scene.add.text(0, 0, '', {
				fontFamily: FONT.display, resolution: TEXT_RESOLUTION, fontSize: '15px', fontStyle: '900',
				color: UI.white, stroke: '#000000', strokeThickness: 4, align: 'center',
			}).setOrigin(0.5).setDepth(120);
		}
		this.label.setVisible(true);
	}

	private drawTimer(x: number, y: number, leftMs: number, event: ActiveEvent, extra: string | null = null): void {
		const label = this.label;
		if (!label) {
			return;
		}
		label.setPosition(x, y);
		const seconds = Math.ceil(leftMs / 1000);
		const key = extra ? -1 : seconds;
		if (key !== event.lastSecondsShown || extra) {
			event.lastSecondsShown = key;
			const title = event.kind === 'raid' ? '정예 습격' : event.kind === 'golem' ? '보물 골렘' : '저주 구역';
			label.setText(extra ? `${title} ${seconds}s · ${extra}` : `${title} ${seconds}s`);
			label.setColor(seconds <= 5 ? '#ff8a63' : UI.white);
		}
	}

	private drawCurse(event: ActiveEvent, now: number, onAltar: boolean): void {
		const g = this.g;
		if (!g) {
			return;
		}
		const spec = DANGER_EVENTS.curse;
		const pulse = 0.5 + 0.5 * Math.sin(now / 160);
		g.clear();
		g.fillStyle(0x5b3f8a, 0.16 + 0.05 * pulse);
		g.fillCircle(event.x, event.y, spec.radius);
		g.lineStyle(2.5, 0xa78bda, 0.7);
		g.strokeCircle(event.x, event.y, spec.radius);
		// 제단
		g.fillStyle(onAltar ? 0x9bd66a : 0xa78bda, onAltar ? 0.45 : 0.28 + 0.1 * pulse);
		g.fillCircle(event.x, event.y, spec.altarRadius);
		g.lineStyle(2, onAltar ? 0xdfffc0 : 0xe0d0ff, 0.9);
		g.strokeCircle(event.x, event.y, spec.altarRadius);
		// 정화 진행 호
		const progress = Math.min(1, event.purifyMs / spec.purifyMs);
		if (progress > 0) {
			g.lineStyle(5, 0x9bd66a, 0.95);
			g.beginPath();
			g.arc(event.x, event.y, spec.altarRadius + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
			g.strokePath();
		}
	}

	private cleanup(): void {
		this.current = null;
		this.g?.clear();
		this.label?.setVisible(false);
	}

	destroy(): void {
		this.destroyed = true;
		this.current = null;
		this.g?.destroy();
		this.g = null;
		this.label?.destroy();
		this.label = null;
	}
}
