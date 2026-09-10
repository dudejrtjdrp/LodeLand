// 원소 세트 공명 & 필살기 — 장착 검만 집계된다.
// 8원소: 화염 노바 / 낙뢰 / 특이점 / 서리 노바 / 맹독 구름 / 황금 소나기 / 피의 수확 / 회오리.
// 순수 집계 규칙은 src/logic/resonance.ts 에 있다.

import Phaser from 'phaser';
import type { EnemySprite, PlayerSprite } from '../../types/actors';
import type { UltimateElement } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';

/** 필살기 원소 목록 — 매 프레임 배열 리터럴을 새로 만들지 않도록 모듈 상수로 고정. */
const ULTIMATE_ELEMENTS: readonly UltimateElement[] = [
	'fire', 'electric', 'void', 'ice', 'poison', 'gold', 'blood', 'wind',
];

/** 반경 질의 결과 버퍼와, 피해 적용 전에 확정한 대상 목록 (프레임당 할당 0). */
const ULT_QUERY: EnemySprite[] = [];
const ULT_TARGETS: EnemySprite[] = [];

/**
 * (cx, cy) 반경 안의 살아있는 적을 ULT_TARGETS에 확정해 반환한다.
 * 피해를 적용하기 **전에** 목록을 확정하므로, 피해로 인한 연쇄 사망이 질의 버퍼를
 * 건드려도 안전하다. 그리드가 없으면 전체 순회로 폴백한다.
 */
function collectInRadius(
	enemyManager: NonNullable<SwordOrbitSystem['scene']>['enemyManager'],
	cx: number,
	cy: number,
	radius: number,
): EnemySprite[] {
	ULT_TARGETS.length = 0;
	const radiusSquared = radius * radius;
	const candidates = enemyManager.queryRadius
		? enemyManager.queryRadius(cx, cy, radius, ULT_QUERY)
		: (enemyManager.enemies.getChildren() as EnemySprite[]);
	for (const enemy of candidates) {
		if (!enemyManager.isAliveEnemy(enemy)) {
			continue;
		}
		const dx = enemy.x - cx;
		const dy = enemy.y - cy;
		if (dx * dx + dy * dy <= radiusSquared) {
			ULT_TARGETS.push(enemy);
		}
	}
	return ULT_TARGETS;
}

export function checkSetAnnouncements(system: SwordOrbitSystem): void {
	const names: Record<string, string> = {
		fire: '불', electric: '번개', void: '공허', poison: '독',
		gold: '황금', ice: '얼음', blood: '피', wind: '바람',
	};

	for (const element of Object.keys(names)) {
		// 공명(2자루 = 원소 효과 1.5배)은 이제 "2세트" 배너가 함께 알린다
		// (ElementSetSystem.announceNewTiers) — 여기서 또 띄우면 배너가 겹친다.
		// 효과 자체는 그대로 유지되고, 안내만 세트 쪽으로 일원화했다.
		system.setAnnounced.add(element);
		// 필살기는 2026-09-04 부터 게이지(R)로 수동 발동한다 — 해금 배너 없음
		system.setAnnounced.add(`${element}-ult`);
	}
}

/**
 * @deprecated 2026-09-04 — 자동 시전 타이머는 꺼졌다. 필살기는 ActiveSkillSystem 의
 * 게이지(R)로만 나간다. 호환을 위해 함수는 남기되 즉시 반환한다.
 */
export function updateUltimates(system: SwordOrbitSystem, player: PlayerSprite | null, delta: number): void {
	if (!player || player.isDead || !system.autoUltimates) {
		return;
	}

	for (const element of ULTIMATE_ELEMENTS) {
		if (!system.isUltimateUnlocked(element)) {
			continue;
		}

		system.ultimateTimers[element] += delta;
		if (system.ultimateTimers[element] >= system.ultimateIntervals[element]) {
			system.ultimateTimers[element] = 0;
			system.castUltimate(element, player);
		}
	}
}

export interface UltimateCastOptions {
	/** 기준 피해 (없으면 예전 자동 필살기 값: 40 × 가산 배율 × 성장) */
	damageBase?: number;
	/** 반경 배율 */
	radiusMult?: number;
	/** 반경 안 보스/중간보스에게 추가로 깎는 최대체력 비율 (트루 피해) */
	bossBonusPctMaxHp?: number;
}

export function castUltimate(
	system: SwordOrbitSystem,
	element: UltimateElement,
	player: PlayerSprite,
	options: UltimateCastOptions = {},
): void {
	const enemyManager = system.scene?.enemyManager;
	if (!enemyManager) {
		return;
	}

	// enemyManager 가 있으면 scene 도 반드시 존재한다 (원본은 가드 없이 this.scene 접근)
	const scene = system.scene!;
	const damageBase = Math.max(1, Math.round(options.damageBase ?? 40 * system.flatDamageScale()));
	const radiusMult = options.radiusMult ?? 1;
	// 보스 파훼 보너스: 반경(가장 넓은 필살기 기준 260) 안 보스의 최대체력 일부를 트루 피해로
	const bossPct = options.bossBonusPctMaxHp ?? 0;
	if (bossPct > 0) {
		for (const enemy of collectInRadius(enemyManager, player.x, player.y, 320 * radiusMult)) {
			if (enemy.catalog?.isBoss || enemy.catalog?.isMiniboss) {
				const bonus = Math.max(1, Math.round(enemy.maxHp * bossPct));
				system.applyDamage(enemy, bonus, true, { ignoreResist: true });
				system.recordDamage('필살기', bonus);
			}
		}
	}

	if (element === 'fire') {
		// 화염 노바: 주변 220px 전체 화상 + 피해
		const fx = scene.visualEffects;
		fx?.ultimateCalloutFX?.('fire', player.x, player.y);
		fx?.fxDot(player.x, player.y, { r: 66, color: 0xf97316, alpha: 0.25, scale1: 3.33, dur: 450 });
		fx?.fxRing(player.x, player.y, { r0: 66, r1: 220, w: 3, color: 0xf97316, alpha: 0.9, dur: 450 });
		// 2차 잔광 링 + 사방으로 튀는 잉걸 입자
		fx?.fxRing(player.x, player.y, { r0: 33, r1: 238, w: 6, color: 0xffb066, alpha: 0.5, dur: 620 });
		for (let i = 0; i < 10; i += 1) {
			const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
			const dist = 140 + Math.random() * 90;
			fx?.fxDot(player.x, player.y, {
				r: 3 + Math.random() * 2.5, color: i % 2 ? 0xf97316 : 0xffd27a, alpha: 0.95,
				scale1: 0.3, dx: Math.cos(a) * dist, dy: Math.sin(a) * dist,
				dur: 480 + Math.random() * 200,
			});
		}
		scene.soundSystem?.play('bigkill', { volume: 0.5 });

		for (const enemy of collectInRadius(enemyManager, player.x, player.y, 220 * radiusMult)) {
			system.applyDamage(enemy, damageBase, false, { damageType: 'magic', pen: 0.2 });
			system.recordDamage('필살기', damageBase);
			enemyManager.applyDot(enemy, Math.max(8, damageBase * 0.12), 2000, 0xf97316);
		}
		return;
	}

	if (element === 'electric') {
		// 낙뢰: 가장 가까운 적 1기 강타 + 연쇄 1
		const target = system.findNearestEnemy(player.x, player.y, system.enemyGroup, 500 * radiusMult);
		if (!target) {
			return;
		}
		const fx = scene.visualEffects;
		fx?.ultimateCalloutFX?.('electric', player.x, player.y);

		// 하늘에서 내리꽂는 지그재그 낙뢰 (굵은 흐린 층 + 밝은 심)
		const points: number[] = [];
		const steps = 6;
		for (let i = 0; i <= steps; i += 1) {
			const t = i / steps;
			points.push(
				target.x + (i === 0 || i === steps ? 0 : (Math.random() - 0.5) * 44),
				target.y - 300 + 300 * t,
			);
		}
		fx?.fxPoly(points, {
			layers: [[7, 0x3b5f8f, 0.45], [3, 0x93c5fd, 0.95], [1.2, 0xffffff, 0.95]],
			dur: 240,
		});

		// 착탄 플래시 + 링
		fx?.fxDot(target.x, target.y, { r: 16, color: 0xffffff, alpha: 0.9, scale1: 0.2, dur: 180 });
		fx?.fxRing(target.x, target.y, { r0: 12, r1: 36, w: 2.5, color: 0x93c5fd, alpha: 0.9, dur: 300 });

		scene.soundSystem?.play('crit', { volume: 0.7 });
		system.applyDamage(target, Math.round(damageBase * 1.5), true, { damageType: 'magic', pen: 0.3 });
		system.recordDamage('필살기', Math.round(damageBase * 1.5));

		const next = system.findNearestEnemy(target.x, target.y, system.enemyGroup, 200, new Set([target]));
		if (next) {
			system.applyDamage(next, damageBase, false, { damageType: 'magic', pen: 0.3 });
			system.recordDamage('필살기', damageBase);
			system.playChainEffect(target, next);
		}
		return;
	}

	if (element === 'ice') {
		// 서리 노바: 주변 240px 피해 + 강감속
		const fx = scene.visualEffects;
		fx?.ultimateCalloutFX?.('ice', player.x, player.y);
		fx?.fxDot(player.x, player.y, { r: 60, color: 0x8fc3d8, alpha: 0.22, scale1: 4, dur: 520 });
		fx?.fxRing(player.x, player.y, { r0: 60, r1: 240, w: 3, color: 0xbfe6f2, alpha: 0.9, dur: 520 });
		for (let i = 0; i < 8; i += 1) {
			const a = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
			const dist = 120 + Math.random() * 110;
			// 파편(polygon) → 마름모 FX. 표류 벡터로 바깥으로 튄다.
			fx?.fxDiamond(player.x + Math.cos(a) * dist * 0.5, player.y + Math.sin(a) * dist * 0.5, {
				r: 6, color: 0xbfe6f2, alpha: 0.95, dur: 460 + Math.random() * 180,
			});
			fx?.fxDot(player.x, player.y, {
				r: 3.5, color: 0xbfe6f2, alpha: 0.9, scale1: 0.4,
				dx: Math.cos(a) * dist, dy: Math.sin(a) * dist, dur: 460 + Math.random() * 180,
			});
		}
		scene.soundSystem?.play('crit', { volume: 0.45 });
		const now = scene.time?.now ?? 0;
		for (const enemy of collectInRadius(enemyManager, player.x, player.y, 240 * radiusMult)) {
			system.applyDamage(enemy, damageBase, false, { damageType: 'magic', pen: 0.2 });
			system.recordDamage('필살기', damageBase);
			system.scene?.statusEffects?.slow(enemy, 0.6, 2200);
		}
		return;
	}

	if (element === 'poison') {
		// 맹독 구름: 근처 밀집 지점에 지속 독 (구름 안 전원 DoT)
		const anchor = system.findNearestEnemy(player.x, player.y, system.enemyGroup, 420 * radiusMult);
		const cx = anchor?.x ?? player.x;
		const cy = anchor?.y ?? player.y;
		const fx = scene.visualEffects;
		fx?.ultimateCalloutFX?.('poison', cx, cy);
		for (let i = 0; i < 6; i += 1) {
			fx?.fxDot(cx + (Math.random() - 0.5) * 140, cy + (Math.random() - 0.5) * 140, {
				r: 26 + Math.random() * 22, color: 0x84b04a, alpha: 0.28, scale1: 1.6,
				dur: 900 + Math.random() * 400,
			});
		}
		scene.soundSystem?.play('warning', { volume: 0.35 });
		for (const enemy of collectInRadius(enemyManager, cx, cy, 200 * radiusMult)) {
			system.applyDamage(enemy, Math.round(damageBase * 0.5), false, { damageType: 'magic', pen: 0.2 });
			system.recordDamage('필살기', Math.round(damageBase * 0.5));
			enemyManager.applyDot(enemy, Math.max(14, damageBase * 0.15), 3000, 0x84b04a);
		}
		return;
	}

	if (element === 'gold') {
		// 황금 소나기: 주변 피해 + 처치 없이도 금화가 쏟아진다
		const fx = scene.visualEffects;
		fx?.ultimateCalloutFX?.('gold', player.x, player.y);
		fx?.fxDot(player.x, player.y, { r: 69, color: 0xd9a83c, alpha: 0.2, scale1: 3.33, dur: 480 });
		fx?.fxRing(player.x, player.y, { r0: 69, r1: 230, w: 3, color: 0xf2d488, alpha: 0.9, dur: 480 });
		scene.soundSystem?.play('chest', { volume: 0.5 });
		let coins = 0;
		for (const enemy of collectInRadius(enemyManager, player.x, player.y, 230 * radiusMult)) {
			system.applyDamage(enemy, damageBase, false, { damageType: 'physical', pen: 0.2 });
			system.recordDamage('필살기', damageBase);
			if (coins < 5 && Math.random() < 0.4) {
				coins += 1;
				scene.pickupSystem?.spawnItem?.(enemy.x, enemy.y, 'gold', 1);
			}
		}
		return;
	}

	if (element === 'blood') {
		// 피의 수확: 주변 피해의 일부를 키퍼의 체력으로
		const fx = scene.visualEffects;
		fx?.ultimateCalloutFX?.('blood', player.x, player.y);
		fx?.fxDot(player.x, player.y, { r: 63, color: 0xc9455a, alpha: 0.24, scale1: 3.33, dur: 460 });
		fx?.fxRing(player.x, player.y, { r0: 63, r1: 210, w: 3, color: 0xe0798a, alpha: 0.9, dur: 460 });
		scene.soundSystem?.play('hurt', { volume: 0.35 });
		let dealt = 0;
		// 적 200마리 밀집 시 방울을 적마다 만들면 1회 시전에 GameObject 200개 + 트윈 200개가
		// 생겼다. FX 레이어로 옮기고 개수도 12개로 상한을 둔다 (시각적 차이 없음).
		let drops = 0;
		for (const enemy of collectInRadius(enemyManager, player.x, player.y, 210 * radiusMult)) {
			system.applyDamage(enemy, damageBase, false, { damageType: 'physical', pen: 0.2 });
			system.recordDamage('필살기', damageBase);
			dealt += damageBase;
			if (drops < 12) {
				drops += 1;
				fx?.fxDot(enemy.x, enemy.y, {
					r: 3, color: 0xc9455a, alpha: 0.9, scale1: 1,
					dx: player.x - enemy.x, dy: player.y - enemy.y, dur: 320, ease: 'in',
				});
			}
		}
		if (dealt > 0 && player.maxHp) {
			// 필살기 회복은 예산 밖 — 최대체력 8% (수동 발동의 보상)
			const heal = Math.max(1, Math.round(player.maxHp * 0.08));
			player.hp = Math.min(player.maxHp, (player.hp ?? 0) + heal);
			scene.visualEffects?.showDamageText?.(player.x, player.y - 46, `+${heal}`, false, '#84b04a');
		}
		return;
	}

	if (element === 'wind') {
		// 회오리: 주변 적을 바깥으로 밀쳐내고 피해
		const fx = scene.visualEffects;
		fx?.ultimateCalloutFX?.('wind', player.x, player.y);
		for (let i = 0; i < 3; i += 1) {
			const r = 60 + i * 55;
			fx?.fxRing(player.x, player.y, {
				r0: r, r1: r * 1.8, w: 2.5, color: 0x9fd8c0, alpha: 0.7 - i * 0.15, dur: 420 + i * 120,
			});
		}
		scene.soundSystem?.play('bigkill', { volume: 0.35 });
		for (const enemy of collectInRadius(enemyManager, player.x, player.y, 250 * radiusMult)) {
			if (enemy.catalog?.isBoss || enemy.catalog?.isReaper) {
				continue;
			}
			const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
			enemy.setVelocity(Math.cos(angle) * 480, Math.sin(angle) * 480);
			enemy.knockbackUntil = (scene.time?.now ?? 0) + 280;
			system.applyDamage(enemy, Math.round(damageBase * 0.8), false, { damageType: 'physical', pen: 0.15 });
			system.recordDamage('필살기', Math.round(damageBase * 0.8));
		}
		return;
	}

	if (element === 'void') {
		// 특이점: 근처 적들을 끌어당기고 피해
		const anchor = system.findNearestEnemy(player.x, player.y, system.enemyGroup, 450 * radiusMult);
		const cx = anchor?.x ?? player.x + 200;
		const cy = anchor?.y ?? player.y;
		const fx = scene.visualEffects;
		fx?.ultimateCalloutFX?.('void', cx, cy);
		fx?.fxDot(cx, cy, { r: 26, color: 0x8d7bb5, alpha: 0.8, scale1: 3, dur: 700 });
		// 어두운 코어 + 흡입 라인들 (바깥→중심)
		fx?.fxDot(cx, cy, { r: 12, color: 0x241a33, alpha: 0.95, scale1: 2.2, dur: 700, ease: 'in' });
		for (let i = 0; i < 8; i += 1) {
			const a = (i / 8) * Math.PI * 2;
			const startDist = 190 + Math.random() * 60;
			// 바깥 → 중심으로 빨려드는 선분. poly는 정적이므로 안쪽 절반 위치에 짧게 그린다.
			fx?.fxPoly(
				[
					cx + Math.cos(a) * startDist, cy + Math.sin(a) * startDist,
					cx + Math.cos(a) * (startDist - 46), cy + Math.sin(a) * (startDist - 46),
				],
				{ layers: [[2, 0xa78bda, 0.85]], dur: 240 },
			);
			fx?.fxDot(cx + Math.cos(a) * startDist, cy + Math.sin(a) * startDist, {
				r: 3, color: 0xa78bda, alpha: 0.85, scale1: 0.5,
				dx: -Math.cos(a) * (startDist - 30), dy: -Math.sin(a) * (startDist - 30),
				dur: 460 + Math.random() * 150, ease: 'in',
			});
		}
		scene.soundSystem?.play('warning', { volume: 0.5 });

		for (const enemy of collectInRadius(enemyManager, cx, cy, 260 * radiusMult)) {
			if (enemy.catalog?.isBoss || enemy.catalog?.isReaper) {
				continue;
			}
			const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, cx, cy);
			enemy.setVelocity(Math.cos(angle) * 400, Math.sin(angle) * 400);
			enemy.knockbackUntil = (scene.time?.now ?? 0) + 250;
			system.applyDamage(enemy, damageBase, false, { damageType: 'magic', pen: 0.4 });
			system.recordDamage('필살기', damageBase);
		}
	}
}
