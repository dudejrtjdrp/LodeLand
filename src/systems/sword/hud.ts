// 좌하단 PERCH 스트립: 장착 무리의 슬롯 + 상태 링(ORBIT/STRIKE/RETURN) + 레벨 눈금.
// 상태 링은 movement.updateSystem 이 updateStateRings() 를 호출해 갱신한다.
// describeSword 는 상점(ShopSystem)과 HUD 툴팁이 공유한다.

import Phaser from 'phaser';
import type { OrbitSword, OrbitSwordDefinition } from './types';
import type SwordOrbitSystem from './SwordOrbitSystem';
import {
	UI, style, panel, divider, slot, ELEMENT_THEME, hudScaleFor, iconImage, expandHit, MIN_TOUCH,
	type SlotKind,
} from '../../ui/theme';
import { behaviorOf, behaviorSpec } from '../../logic/swordBehavior';
import { softSwordTintFlat } from '../../logic/swordTint';

// 상태 → 슬롯 프레임 색 (선회=회색 / 사냥=주황 / 귀소=파랑) — Flat 팩 슬롯 스왑
const STATE_SLOT: Record<string, SlotKind> = {
	orbiting: 'gray',
	launched: 'orange',
	returning: 'blue',
	// 말뚝검이 꽂혀 있는 동안 그 자리는 비어 있다 — 빈 홰로 보이게 한다
	planted: 'ghostorange',
};

// refreshSwordHud 가 만든 슬롯 프레임들 (updateStateRings 가 텍스처 스왑)
const slotFramesBySystem = new WeakMap<SwordOrbitSystem, Array<Phaser.GameObjects.NineSlice | null>>();

const STATE_LABEL: Record<string, string> = {
	orbiting: '궤도',
	launched: '출격',
	returning: '귀환',
	planted: '박힘',
};

// Compact one-line-per-stat description (HUD tooltip & shop share this)
export function describeSword(system: SwordOrbitSystem, sword: OrbitSword): string {
	const definition: Partial<OrbitSwordDefinition> = sword.definition ?? {};
	const lines: string[] = [];
	const typeLabel = definition.damageType === 'magic' ? '마법' : '물리';
	const pen = definition.damageType === 'magic' ? definition.magicPen : definition.physicalPen;

	lines.push(`${typeLabel} 피해 ${sword.damage}${pen ? ` · 관통 ${Math.round(pen * 100)}%` : ''}`);
	lines.push(`쿨다운 ${Math.round(sword.scanInterval)}ms · 연속타 ${sword.hitsPerLaunch}`);

	// 거동 아키타입 (기본 거동은 표기하지 않는다 — 대부분의 검이 그러하므로)
	const behavior = behaviorOf(definition);
	if (behavior !== 'orbit') {
		lines.push(`거동: ${behaviorSpec(behavior).label}`);
	}

	if (definition.element) {
		const theme = ELEMENT_THEME[definition.element];
		lines.push(`속성: ${theme?.label ?? definition.element}${system.hasSetResonance(definition.element) ? ' (공명!)' : ''}`);
	}
	if (definition.special) {
		lines.push(`고유: ${definition.special.label}`);
	}
	if (definition.trueDamage) {
		lines.push(`고정 피해 +${definition.trueDamage}`);
	}
	if (definition.maxHpDamage) {
		lines.push(`최대체력 ${Math.round(definition.maxHpDamage * 100)}% 추가`);
	}

	const state = system.getSlotState(system.swords.indexOf(sword));
	if ((state?.enhance ?? 0) > 0) {
		lines.push(`자리 강화 +${state!.enhance}`);
	}
	if ((sword.traits?.length ?? 0) > 0) {
		lines.push(`각인: ${sword.traits.map((id) => system.getTraitById(id)?.name ?? '?').join(', ')}`);
	}

	return lines.join('\n');
}

// 좌측 검 상세 패널 (호버 툴팁)
export function showHudTooltip(system: SwordOrbitSystem, sword: OrbitSword, _x: number, _y: number): void {
	system.hideHudTooltip();

	const scene = system.scene!;
	const definition: Partial<OrbitSwordDefinition> = sword.definition ?? {};
	const slotIndex = system.swords.indexOf(sword);
	const state = system.getSlotState(slotIndex);

	const panelW = 300;
	const rows: Array<[string, string, string?]> = [];
	const typeLabel = definition.damageType === 'magic' ? '마법' : '물리';
	const pen = definition.damageType === 'magic' ? definition.magicPen : definition.physicalPen;

	rows.push(['피해', `${sword.damage} (${typeLabel})`]);
	rows.push(['쿨다운', `${(Math.round(sword.scanInterval) / 1000).toFixed(2)}s`]);
	rows.push(['상태', STATE_LABEL[sword.state] ?? sword.state]);
	const tipBehavior = behaviorOf(definition);
	if (tipBehavior !== 'orbit') {
		rows.push(['거동', behaviorSpec(tipBehavior).label, UI.quenchText]);
	}
	if (definition.element) {
		const theme = ELEMENT_THEME[definition.element];
		rows.push(['속성', theme?.label ?? definition.element, theme?.css]);
	}
	if (pen) {
		rows.push(['관통', `${Math.round(pen * 100)}%`]);
	}
	if ((state?.enhance ?? 0) > 0) {
		rows.push(['자리 강화', `+${state!.enhance}`, UI.goldText]);
	}
	if ((sword.traits?.length ?? 0) > 0) {
		const traitNames = sword.traits.map((id) => system.getTraitById(id)?.name ?? '?').join(', ');
		rows.push(['각인', traitNames]);
	}
	if (definition.special) {
		rows.push(['고유', definition.special.label ?? '']);
	}
	if (definition.element && system.hasSetResonance(definition.element)) {
		const theme = ELEMENT_THEME[definition.element];
		rows.push(['공명', `${theme?.label ?? definition.element} 공명 중`, UI.green]);
	}

	const hs = hudScaleFor(scene);
	const headerH = 74;
	const rowH = 27;
	const lore = definition.lore ?? '';
	const loreH = lore ? 40 : 0;
	const panelH = headerH + rows.length * rowH + loreH + 18;
	const px = 18 * hs;
	const py = scene.scale.height - 128 * hs - panelH * hs;

	const bg = panel(scene, 0, 0, panelW, panelH, { alpha: 0.98 });

	const parts: Phaser.GameObjects.GameObject[] = [bg];

	// 헤더: 검 아이콘 + 이름/등급
	const icon = scene.add.image(36, 38, 'sword', definition.sheetOrder ?? 0).setDisplaySize(42, 42);
	if (sword.effect?.tint) {
		icon.setTint(softSwordTintFlat(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color));
	}
	parts.push(icon);
	parts.push(scene.add.text(66, 26, definition.name ?? '검', style(17, UI.text, { display: true })).setOrigin(0, 0.5));
	parts.push(scene.add.text(panelW - 18, 26, `Lv.${sword.level}`, style(14, UI.text, { display: true })).setOrigin(1, 0.5));
	const gradeLabel = definition.evolved ? '조합 검' : (sword.level ?? 1) >= 5 ? 'MAX' : `레벨 ${sword.level}`;
	parts.push(scene.add.text(66, 48, gradeLabel, style(12, UI.quenchText)).setOrigin(0, 0.5));

	// 구분선
	parts.push(divider(scene, panelW / 2, headerH - 8, panelW - 28));

	rows.forEach(([label, value, color], index) => {
		const rowY = headerH + 4 + index * rowH + rowH / 2;
		parts.push(scene.add.text(24, rowY, label, style(13, UI.textDim)).setOrigin(0, 0.5));
		parts.push(scene.add.text(panelW - 18, rowY, value, style(13, color ?? UI.text)).setOrigin(1, 0.5));
	});

	if (lore) {
		const loreY = headerH + 6 + rows.length * rowH;
		parts.push(divider(scene, panelW / 2, loreY, panelW - 28));
		parts.push(scene.add.text(panelW / 2, loreY + 20, lore, {
			...style(11.5, UI.textFaint, { bold: false }),
			align: 'center',
			wordWrap: { width: panelW - 40 },
		}).setOrigin(0.5));
	}

	const container = scene.add.container(px, py, parts).setScrollFactor(0).setDepth(3500).setScale(hs);
	system.hudTooltip = container;
}

// 좌하단 홰 스트립 (장착 검 + 잠금 홰)
export function refreshSwordHud(system: SwordOrbitSystem): void {
	if (!system.scene?.add) {
		return;
	}

	const scene = system.scene;

	for (const icon of system.hudIcons) {
		icon.destroy();
	}
	system.hudIcons = [];
	system.hudSlotRects = [];
	system.hudStateSig = '';
	system.hideHudTooltip();

	const hs = hudScaleFor(scene);
	const slotSize = 58 * hs;
	const gap = 8 * hs;
	const baseX = 20 * hs;
	const y = scene.scale.height - 20 * hs - slotSize;

	// 표시 슬롯: 장착 검 + (남은 잠금이 있으면) 잠금 홰 1개
	const slotCount = Math.min(system.swords.length + (system.unlockedSlots < system.maxSwords || system.swords.length < system.unlockedSlots ? 1 : 0), system.maxSwords);
	const shown = Math.max(slotCount, system.swords.length);

	const stripG = scene.add.graphics().setScrollFactor(0).setDepth(1000);
	system.hudIcons.push(stripG);

	// PERCH 라벨 (스트립 상단) — 월드 위라 밝은 텍스트
	const stripLabel = scene.add.text(baseX + 2, y - 14 * hs, `내 검 ${system.swords.length}`,
		style(11 * hs, '#c3ccd3'))
		.setOrigin(0, 0.5).setScrollFactor(0).setDepth(1001);
	stripLabel.setShadow(0, 1, '#000000', 2, false, true);
	system.hudIcons.push(stripLabel);

	const slotFrames: Array<Phaser.GameObjects.NineSlice | null> = [];
	slotFramesBySystem.set(system, slotFrames);

	for (let i = 0; i < shown; i += 1) {
		const x = baseX + i * (slotSize + gap);
		const sword = system.swords[i] ?? null;
		const isLockSlot = !sword;

		// Flat 팩 슬롯 프레임 (잠금 홰는 반투명 고스트)
		const slotImg = slot(scene, x + slotSize / 2, y + slotSize / 2, slotSize, isLockSlot ? 'ghost' : 'gray')
			.setScrollFactor(0)
			.setDepth(1000);
		system.hudIcons.push(slotImg);
		slotFrames.push(isLockSlot ? null : slotImg);

		system.hudSlotRects.push({ x, y, size: slotSize });

		if (!sword) {
			const lock = iconImage(scene, 'g-lock', x + slotSize / 2, y + slotSize / 2, 16 * hs, 0x232a31);
			(lock as Phaser.GameObjects.Image).setScrollFactor?.(0);
			lock.setDepth(1002).setAlpha(0.9);
			system.hudIcons.push(lock);
			continue;
		}

		const frame = sword.definition?.sheetOrder ?? 0;
		const icon = scene.add.image(x + slotSize / 2, y + slotSize / 2 - 2, 'sword', frame)
			.setScrollFactor(0)
			.setDepth(1002)
			.setDisplaySize(slotSize - 18 * hs, slotSize - 18 * hs);

		if (sword.definition?.evolved) {
			icon.setDisplaySize(slotSize - 12 * hs, slotSize - 12 * hs);
		}
		if (sword.effect?.tint) {
			// 본체와 같은 규약: 휘도 복원한 약한 틴트 (작은 아이콘이라 그라디언트 없이 단색)
			icon.setTint(softSwordTintFlat(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color));
		}

		// 아이콘은 홰(slot)보다 작다 — 호버 판정은 홰 전체(최소 44px)로 넓힌다
		expandHit(icon, { minW: Math.max(MIN_TOUCH, slotSize), minH: Math.max(MIN_TOUCH, slotSize) });
		icon.on('pointerover', () => {
			system.showHudTooltip(sword, icon.x, icon.y);
		});
		icon.on('pointerout', () => {
			system.hideHudTooltip();
		});
		system.hudIcons.push(icon);

		// Lv 눈금 (홰 하단) — 월드 위라 밝은 텍스트
		const levelLabel = scene.add.text(x + slotSize / 2, y + slotSize + 10 * hs, `Lv.${sword.level ?? 1}`,
			style(11 * hs, (sword.level ?? 1) >= 5 ? UI.goldTextBright : '#c3ccd3'))
			.setOrigin(0.5).setScrollFactor(0).setDepth(1002);
		levelLabel.setShadow(0, 1, '#000000', 2, false, true);
		system.hudIcons.push(levelLabel);
	}

	// 상태 링 전용 그래픽 (updateStateRings 가 갱신)
	if (system.hudStateG && !system.hudStateG.active) {
		system.hudStateG = null;
	}
	if (!system.hudStateG) {
		system.hudStateG = scene.add.graphics().setScrollFactor(0).setDepth(1003);
	}
	system.hudIcons.push(system.hudStateG);
	updateStateRings(system, true);
}

/**
 * 상태 표시 갱신 — 매 프레임 호출되지만 상태 시그니처가 바뀔 때만 반영.
 * Flat 팩 슬롯 텍스처를 상태색으로 스왑한다 (선회=회색 / 사냥=주황 / 귀소=파랑).
 * hudStateG(Graphics)는 더 이상 그리지 않지만 타입 호환을 위해 유지된다.
 */
export function updateStateRings(system: SwordOrbitSystem, force = false): void {
	const frames = slotFramesBySystem.get(system);
	if (!frames?.length) {
		return;
	}

	const sig = system.swords.map((sword) => sword.state).join(',');
	if (!force && sig === system.hudStateSig) {
		return;
	}
	system.hudStateSig = sig;

	frames.forEach((frame, index) => {
		const sword = system.swords[index];
		if (!sword || !frame || !frame.active) {
			return;
		}
		const kind = STATE_SLOT[sword.state] ?? 'gray';
		frame.setTexture(`uf-slot-${kind}`);
		// 사냥 나간 홰는 살짝 비운 표시
		frame.setAlpha(sword.state === 'launched' ? 0.92 : 1);
	});
}
