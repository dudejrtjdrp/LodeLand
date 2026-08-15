// 좌하단 검 HUD(아이콘 스트립 + 레벨 배지)와 호버 툴팁, 검 설명 텍스트 빌더.
// describeSword 는 상점(ShopSystem)과 HUD 툴팁이 공유한다.
// 원본 SwordOrbitSystem.js 의 해당 구간을 기계적으로 옮긴 것.

import Phaser from 'phaser';
import type { OrbitSword, OrbitSwordDefinition } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';

// Compact one-line-per-stat description (HUD tooltip & shop share this)
export function describeSword(system: SwordOrbitSystem, sword: OrbitSword): string {
	const definition: Partial<OrbitSwordDefinition> = sword.definition ?? {};
	const lines: string[] = [];
	const typeLabel = definition.damageType === 'magic' ? '🔮 마법' : '⚔️ 물리';
	const pen = definition.damageType === 'magic' ? definition.magicPen : definition.physicalPen;

	lines.push(`${typeLabel} 피해 ${sword.damage}${pen ? ` · 관통 ${Math.round(pen * 100)}%` : ''}`);
	lines.push(`쿨다운 ${Math.round(sword.scanInterval)}ms · 연속타 ${sword.hitsPerLaunch}`);

	if (definition.element) {
		lines.push(`원소: ${definition.element}${system.hasSetResonance(definition.element) ? ' (세트 공명!)' : ''}`);
	}
	if (definition.special) {
		lines.push(`✨ ${definition.special.label}`);
	}
	if (definition.trueDamage) {
		lines.push(`💛 고정 피해 +${definition.trueDamage}`);
	}
	if (definition.maxHpDamage) {
		lines.push(`💛 최대체력 ${Math.round(definition.maxHpDamage * 100)}% 추가`);
	}

	const state = system.getSlotState(system.swords.indexOf(sword));
	if ((state?.enhance ?? 0) > 0) {
		lines.push(`강화 +${state!.enhance}`);
	}
	if ((state?.traits?.length ?? 0) > 0) {
		lines.push(state!.traits.map((id) => system.getTraitById(id)?.icon ?? '❔').join(' '));
	}

	return lines.join('\n');
}

// In-game tooltip for the bottom-left sword HUD
export function showHudTooltip(system: SwordOrbitSystem, sword: OrbitSword, x: number, y: number): void {
	system.hideHudTooltip();

	// HUD 아이콘이 존재하는 한 scene 은 반드시 있다 (원본은 가드 없이 접근)
	const scene = system.scene!;
	const body = `${sword.definition?.name ?? '검'}  Lv${sword.level}\n${system.describeSword(sword)}`;
	const text = scene.add.text(x, y - 46, body, {
		fontFamily: 'Arial, sans-serif',
		fontSize: '12px',
		color: '#e5e7eb',
		backgroundColor: '#0d1322',
		padding: { x: 10, y: 8 },
		lineSpacing: 4,
	}).setOrigin(0, 1).setScrollFactor(0).setDepth(3500);

	// Keep on screen
	const overflow = text.x + text.width - scene.scale.width + 8;
	if (overflow > 0) {
		text.setX(text.x - overflow);
	}

	system.hudTooltip = text;
}

// Small icon strip (bottom-left) showing the current loadout
export function refreshSwordHud(system: SwordOrbitSystem): void {
	if (!system.scene?.add) {
		return;
	}

	// 위 가드로 scene 존재가 보장된다 (클로저 안에서도 사용하므로 로컬로 고정)
	const scene = system.scene;

	for (const icon of system.hudIcons) {
		icon.destroy();
	}
	system.hudIcons = [];

	const baseX = 24;
	const iconSize = 30;
	const gap = 36;
	const y = scene.scale.height - 28;

	system.hideHudTooltip();

	system.swords.forEach((sword, index) => {
		const frame = sword.definition?.sheetOrder ?? 0;
		const icon = scene.add.image(baseX + index * gap, y, 'sword', frame)
			.setScrollFactor(0)
			.setDepth(1002)
			.setDisplaySize(iconSize, iconSize);

		if (sword.definition?.evolved) {
			icon.setDisplaySize(iconSize + 6, iconSize + 6);
		}

		if (sword.effect?.tint) {
			icon.setTint(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color);
		}

		// In-game hover: sword details tooltip
		icon.setInteractive({ useHandCursor: true });
		icon.on('pointerover', () => system.showHudTooltip(sword, icon.x - 14, icon.y - 8));
		icon.on('pointerout', () => system.hideHudTooltip());

		system.hudIcons.push(icon);

		// 단계 표시 (Lv2+)
		if ((sword.level ?? 1) > 1) {
			const levelBadge = scene.add.text(baseX + index * gap + 10, y + 6, `${sword.level}`, {
				fontFamily: 'Arial Black, Arial, sans-serif',
				fontSize: '12px',
				color: '#fbbf24',
			}).setOrigin(0.5).setScrollFactor(0).setDepth(1003);
			levelBadge.setShadow(0, 1, '#000000', 2, false, true);
			system.hudIcons.push(levelBadge);
		}
	});
}
