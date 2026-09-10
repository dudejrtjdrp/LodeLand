// 원소 세트 오라 — 픽셀 마법진 시트 8장(public/assets/auras/*.png, 사용자 제공 4장 +
// 동일 문법으로 생성한 4장)을 플레이어 발밑에 깔고, 같은 원소 검 2~7자루에 따라
// 크기·밝기·겹(글로우/외곽 링)이 단계적으로 자란다. 여러 원소가 동시에 활성이면
// 기존 규약대로 반경을 슬롯만큼 어긋나게 깔아 겹쳐 보인다.
//
// 단계 연출 사다리
//  2  마법진 등장 (은은한 알파, 기본 크기)
//  3  더 크고 또렷하게
//  4  가산 글로우 겹 점화 (숨쉬듯 밝아진다)
//  5  글로우가 천천히 역회전하며 진해진다
//  6  바깥에 두 번째 마법진 링(가산·반전)이 돌기 시작
//  7  완전 개방 — 본체 불투명, 애니메이션 가속, 글로우·링이 맥동
//
// 성능 규약
//  - 매 프레임 Graphics 재렌더 없음. 원소당 스프라이트 1~3장만 유지하고
//    위치·스케일·알파만 갱신한다. 트윈 금지 — 맥동은 update 의 sin.
//  - fxThrottle>1 또는 reduceMotion 이면 글로우·링을 끄고 본체만 남긴다.
//  - 활성 원소가 없으면 스프라이트를 해제한다.

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import { SET_ELEMENTS, type SetElement } from '../logic/elementSets';
import { AURA_SHEETS } from '../logic/auraSheets';
import { reduceMotion } from '../core/settings';

const DEPTH = 6;
/** 원소 슬롯당 반경 간격 — 여러 오라가 겹쳐도 서로 구분된다. */
const SLOT_GAP = 22;
const BASE_RADIUS = 62;
/** 단계당 반경 성장 (2단계 = 기본). */
const TIER_GROW = 7;

type AuraSprite = import('phaser').GameObjects.Sprite;

interface AuraLayer {
	main: AuraSprite;
	glow: AuraSprite;
	ring: AuraSprite;
}

export default class ElementAuraSystem {
	scene: GameScene;
	private layers = new Map<SetElement, AuraLayer>();
	private time = 0;
	destroyed = false;

	constructor(scene: GameScene) {
		this.scene = scene;
	}

	private ensure(element: SetElement): AuraLayer | null {
		const existing = this.layers.get(element);
		if (existing && existing.main.active) {
			return existing;
		}
		const key = `aura-${element}`;
		if (!this.scene.textures.exists(key)) {
			return null;
		}
		const animKey = `${key}-idle`;
		const make = (): AuraSprite => {
			const s = this.scene.add.sprite(0, 0, key, 0).setDepth(DEPTH);
			if (this.scene.anims.exists(animKey)) {
				s.play(animKey);
			}
			return s;
		};
		const main = make();
		const glow = make().setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH - 0.1).setVisible(false);
		const ring = make().setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH + 0.2).setVisible(false);
		ring.setFlipX(true); // 외곽 링은 반전 — 같은 시트라도 다른 진처럼 읽힌다
		const layer: AuraLayer = { main, glow, ring };
		this.layers.set(element, layer);
		return layer;
	}

	private release(element: SetElement): void {
		const layer = this.layers.get(element);
		if (!layer) {
			return;
		}
		layer.main.destroy();
		layer.glow.destroy();
		layer.ring.destroy();
		this.layers.delete(element);
	}

	private releaseAll(): void {
		for (const element of [...this.layers.keys()]) {
			this.release(element);
		}
	}

	update(delta: number): void {
		if (this.destroyed) {
			return;
		}
		const sets = this.scene.elementSets;
		const player = this.scene.player;
		if (!sets || !player || player.isDead) {
			this.releaseAll();
			return;
		}

		this.time += delta;
		const t = this.time / 1000;
		const throttle = this.scene.visualEffects?.fxThrottle?.() ?? 1;
		const still = reduceMotion();
		const low = throttle > 1 || still;

		let slot = 0;
		for (const element of SET_ELEMENTS) {
			const tier = sets.tierOf(element);
			if (tier < 2) {
				this.release(element);
				continue;
			}
			const layer = this.ensure(element);
			if (!layer) {
				continue;
			}
			this.apply(layer, element, tier, slot, t, low, still);
			slot += 1;
		}
		if (slot === 0 && this.layers.size > 0) {
			this.releaseAll();
		}
	}

	private apply(
		layer: AuraLayer,
		element: SetElement,
		tier: number,
		slot: number,
		t: number,
		low: boolean,
		still: boolean,
	): void {
		const { main, glow, ring } = layer;
		const player = this.scene.player!;
		const spec = AURA_SHEETS[element];
		const frame = spec?.frameSize ?? 256;

		const radius = BASE_RADIUS + slot * SLOT_GAP + (tier - 2) * TIER_GROW;
		const scale = (radius * 2) / frame;
		// 숨쉬기 — 단계가 오를수록 살짝 깊어진다 (7단계 ≈ ±2%)
		const breath = still ? 1 : 1 + Math.sin(t * 2.2 + slot * 1.7) * (0.006 + (tier - 2) * 0.0028);

		main.setPosition(player.x, player.y);
		main.setScale(scale * breath);
		main.setAlpha(Math.min(1, 0.6 + (tier - 2) * 0.08));
		const timeScale = still ? 0 : 1 + (tier - 2) * 0.12;
		if (main.anims) {
			main.anims.timeScale = timeScale;
			if (still && main.anims.isPlaying) {
				main.anims.pause();
			} else if (!still && main.anims.isPaused) {
				main.anims.resume();
			}
		}

		// 4단계+: 가산 글로우 (5단계부터 역회전, 7단계 맥동)
		const showGlow = tier >= 4 && !low;
		glow.setVisible(showGlow);
		if (showGlow) {
			const pulse = tier >= 7 ? Math.sin(t * 3.1 + slot) * 0.06 : 0;
			glow.setPosition(player.x, player.y);
			glow.setScale(scale * 1.06 * breath);
			glow.setAlpha(0.1 + (tier - 4) * 0.055 + pulse);
			glow.setRotation(tier >= 5 ? -t * 0.14 : 0);
			if (glow.anims) {
				glow.anims.timeScale = timeScale;
			}
		}

		// 6단계+: 바깥 두 번째 마법진 링
		const showRing = tier >= 6 && !low;
		ring.setVisible(showRing);
		if (showRing) {
			const pulse = tier >= 7 ? Math.sin(t * 2.4 + slot * 0.9) * 0.05 : 0;
			ring.setPosition(player.x, player.y);
			ring.setScale(((radius * 2 + 52) / frame) * breath);
			ring.setAlpha(0.15 + (tier - 6) * 0.09 + pulse);
			ring.setRotation(t * 0.1);
			if (ring.anims) {
				ring.anims.timeScale = timeScale * 0.75;
			}
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.releaseAll();
	}
}
