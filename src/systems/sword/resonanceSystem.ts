// 원소 세트 공명 & 필살기 (화염 노바 / 낙뢰 / 특이점) — 장착 검만 집계된다.
// 순수 집계 규칙은 src/logic/resonance.ts 에 있다.
// 원본 SwordOrbitSystem.js 의 해당 구간을 기계적으로 옮긴 것 —
// 타이머 간격(8000/4000/15000ms)과 발동 순서를 바꾸지 않는다.

import Phaser from 'phaser';
import type { EnemySprite, PlayerSprite } from '../../types/actors';
import type { UltimateElement } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';

export function checkSetAnnouncements(system: SwordOrbitSystem): void {
	const names: Record<string, string> = { fire: '🔥 화염', electric: '⚡ 전기', void: '🕳️ 공허' };

	for (const element of Object.keys(names)) {
		if (system.hasSetResonance(element) && !system.setAnnounced.has(element)) {
			system.setAnnounced.add(element);
			system.scene?.waveSystem?.announce?.(`${names[element]} 세트 공명! (원소 효과 1.5배)`, '#fbbf24');
			system.scene?.soundSystem?.play('evolve');
		}
		const ultKey = `${element}-ult`;
		if (system.isUltimateUnlocked(element) && !system.setAnnounced.has(ultKey)) {
			system.setAnnounced.add(ultKey);
			system.scene?.waveSystem?.announce?.(`${names[element]} 필살기 해금!`, '#ef4444');
			system.scene?.soundSystem?.play('chest');
		}
	}
}

export function updateUltimates(system: SwordOrbitSystem, player: PlayerSprite | null, delta: number): void {
	if (!player || player.isDead) {
		return;
	}

	for (const element of ['fire', 'electric', 'void'] as const) {
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

export function castUltimate(system: SwordOrbitSystem, element: UltimateElement, player: PlayerSprite): void {
	const enemyManager = system.scene?.enemyManager;
	if (!enemyManager) {
		return;
	}

	// enemyManager 가 있으면 scene 도 반드시 존재한다 (원본은 가드 없이 this.scene 접근)
	const scene = system.scene!;
	const damageBase = Math.round(40 * system.damageMultiplier);

	if (element === 'fire') {
		// 화염 노바: 주변 220px 전체 화상 + 피해
		const ring = scene.add.circle(player.x, player.y, 220, 0xf97316, 0.25)
			.setStrokeStyle(3, 0xf97316, 0.9).setDepth(58);
		scene.tweens.add({ targets: ring, scale: { from: 0.3, to: 1 }, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
		scene.soundSystem?.play('bigkill', { volume: 0.5 });

		for (const enemy of enemyManager.enemies.getChildren() as EnemySprite[]) {
			if (enemyManager.isAliveEnemy(enemy)
				&& Phaser.Math.Distance.Between(player.x, player.y, enemy.x, enemy.y) <= 220) {
				system.applyDamage(enemy, damageBase, false, { damageType: 'magic', pen: 0.2 });
				enemyManager.applyDot(enemy, 8, 2000, 0xf97316);
			}
		}
		return;
	}

	if (element === 'electric') {
		// 낙뢰: 가장 가까운 적 1기 강타 + 연쇄 1
		const target = system.findNearestEnemy(player.x, player.y, system.enemyGroup, 500);
		if (!target) {
			return;
		}
		const bolt = scene.add.line(0, 0, target.x, target.y - 300, target.x, target.y, 0x93c5fd, 0.95)
			.setOrigin(0).setLineWidth(3).setDepth(59);
		scene.tweens.add({ targets: bolt, alpha: 0, duration: 200, onComplete: () => bolt.destroy() });
		scene.soundSystem?.play('crit', { volume: 0.7 });
		system.applyDamage(target, Math.round(damageBase * 1.5), true, { damageType: 'magic', pen: 0.3 });

		const next = system.findNearestEnemy(target.x, target.y, system.enemyGroup, 200, new Set([target]));
		if (next) {
			system.applyDamage(next, damageBase, false, { damageType: 'magic', pen: 0.3 });
			system.playChainEffect(target, next);
		}
		return;
	}

	if (element === 'void') {
		// 특이점: 근처 적들을 끌어당기고 피해
		const anchor = system.findNearestEnemy(player.x, player.y, system.enemyGroup, 450);
		const cx = anchor?.x ?? player.x + 200;
		const cy = anchor?.y ?? player.y;
		const hole = scene.add.circle(cx, cy, 26, 0x7c3aed, 0.8).setDepth(58);
		scene.tweens.add({ targets: hole, scale: 3, alpha: 0, duration: 700, onComplete: () => hole.destroy() });
		scene.soundSystem?.play('warning', { volume: 0.5 });

		for (const enemy of enemyManager.enemies.getChildren() as EnemySprite[]) {
			if (!enemyManager.isAliveEnemy(enemy) || enemy.catalog?.isBoss || enemy.catalog?.isReaper) {
				continue;
			}
			const distance = Phaser.Math.Distance.Between(cx, cy, enemy.x, enemy.y);
			if (distance <= 260) {
				const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, cx, cy);
				enemy.setVelocity(Math.cos(angle) * 400, Math.sin(angle) * 400);
				enemy.knockbackUntil = (scene.time?.now ?? 0) + 250;
				system.applyDamage(enemy, damageBase, false, { damageType: 'magic', pen: 0.4 });
			}
		}
	}
}
