// 음량 설정 블록 (BGM/SFX 슬라이더 + 마스터 음소거).
//
// 타이틀의 설정 창과 게임 내 일시정지 메뉴가 같은 컴포넌트를 쓴다.
// 값은 core/settings 에 즉시 저장되고(localStorage 영속), BGM 은 재생 중인
// 트랙에 바로 반영된다. 드래그 중 자주 바뀌는 퍼센트 숫자는 BitmapText —
// Text 는 값이 바뀔 때마다 캔버스를 다시 굽는다(ui/damageFont.ts 주석 참고).

import Phaser from 'phaser';
import { loadSettings, saveSettings, sfxVolume } from '../core/settings';
import BgmSystem from '../systems/BgmSystem';
import { SFX_BASE } from '../systems/SoundSystem';
import { UI, style, slider, button, iconImage, type UiSlider, type UiButton } from './theme';
import { damageFontKey, DAMAGE_FONT_GLYPH_PX } from './damageFont';

export interface AudioSettingsUi {
	/** 부모가 컨테이너에 담거나 depth 를 지정할 오브젝트들 */
	objects: Phaser.GameObjects.GameObject[];
	/** 이 블록의 전체 높이 (레이아웃 계산용) */
	height: number;
	/** 외부에서 음소거가 바뀌었을 때(M 키 등) 라벨 동기화 */
	refresh(): void;
	destroy(): void;
}

const ROW_H = 54;

export function createAudioSettings(
	scene: Phaser.Scene, x: number, y: number, width: number,
	opts: { scrollFactor?: number; depth?: number; onChange?: () => void } = {},
): AudioSettingsUi {
	const { scrollFactor, depth, onChange } = opts;
	const objects: Phaser.GameObjects.GameObject[] = [];
	const sliders: UiSlider[] = [];

	const track = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
		if (scrollFactor !== undefined) {
			(object as unknown as { setScrollFactor?: (v: number) => void }).setScrollFactor?.(scrollFactor);
		}
		if (depth !== undefined) {
			(object as unknown as { setDepth?: (v: number) => void }).setDepth?.(depth);
		}
		objects.push(object);
		return object;
	};

	const previewClick = () => {
		if (scene.cache.audio.exists('click')) {
			scene.sound.play('click', { volume: sfxVolume() * SFX_BASE });
		}
	};

	const percentLabel = (value: number) => `${Math.round(value * 100)}`;

	const makeRow = (
		rowY: number, icon: string, label: string, initial: number,
		apply: (value: number) => void, commit: () => void,
	): UiSlider => {
		track(iconImage(scene, icon, x + 16, rowY, 18, UI.quenchText));
		track(scene.add.text(x + 34, rowY, label, style(15, UI.text, { display: true })).setOrigin(0, 0.5));

		const valueText = track(scene.add.bitmapText(
			x + width - 18, rowY - 9, damageFontKey('#94a3b8'), percentLabel(initial),
		)).setOrigin(1, 0).setScale(15 / DAMAGE_FONT_GLYPH_PX);
		track(scene.add.text(x + width - 2, rowY, '%', style(12, UI.textDim)).setOrigin(1, 0.5));

		const sliderW = Math.max(120, width - 240);
		const ui = slider(scene, x + 130 + sliderW / 2, rowY, sliderW, initial, {
			fill: 'teal',
			onChange: (value) => {
				valueText.setText(percentLabel(value));
				apply(value);
			},
			onCommit: () => commit(),
		});
		if (scrollFactor !== undefined) {
			ui.setScrollFactor(scrollFactor);
		}
		if (depth !== undefined) {
			ui.root.setDepth(depth);
		}
		objects.push(ui.root);
		sliders.push(ui);
		return ui;
	};

	const settings = loadSettings();

	makeRow(y + ROW_H * 0.5, 'g-bird', '배경음', settings.bgmVolume,
		(value) => {
			saveSettings({ bgmVolume: value });
			BgmSystem.peek()?.refreshVolume();
		},
		() => onChange?.());

	makeRow(y + ROW_H * 1.5, 'g-spark', '효과음', settings.sfxVolume,
		(value) => { saveSettings({ sfxVolume: value }); },
		() => { previewClick(); onChange?.(); });

	const muteLabel = () => (loadSettings().muted ? '소리 끔 (음소거)' : '소리 켬');
	let muteButton: UiButton | null = null;
	muteButton = button(scene, x + width / 2, y + ROW_H * 2 + 26, width, 44, muteLabel(), {
		variant: 'dark', fontSize: 15, display: true, key: 'M',
		onClick: () => {
			const muted = !loadSettings().muted;
			saveSettings({ muted });
			scene.sound.mute = muted;
			BgmSystem.peek()?.refreshVolume();
			muteButton?.setLabel(muteLabel());
			if (!muted) {
				previewClick();
			}
			onChange?.();
		},
	});
	track(muteButton.container);

	return {
		objects,
		height: ROW_H * 2 + 52,
		refresh() {
			muteButton?.setLabel(muteLabel());
			const current = loadSettings();
			sliders[0]?.setValue(current.bgmVolume);
			sliders[1]?.setValue(current.sfxVolume);
		},
		destroy() {
			for (const ui of sliders) {
				ui.destroy();
			}
			for (const object of objects) {
				if (!sliders.some((s) => s.root === object)) {
					object.destroy();
				}
			}
			objects.length = 0;
		},
	};
}
