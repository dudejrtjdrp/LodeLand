// 배경음(BGM) — 씬/상황별 트랙 전환과 크로스페이드.
//
// Phaser 의 사운드 매니저는 게임 전역(game.sound)이라 씬이 바뀌어도 재생이 끊기지
// 않는다. 그래서 BgmSystem 도 게임당 하나의 싱글턴으로 두고, 씬은 "지금 이 트랙"만
// 요청한다 (TitleScene → CharacterSelectScene 이동 시 곡이 다시 시작되지 않는다).
//
// 트랙 (scripts/generate-bgm.py 로 절차 생성 · public/bgm/*.ogg):
//   title   타이틀·캐릭터 선택·영구 강화 (잔잔·신비)
//   battle  전투 라운드 (드라이브 미드템포)
//   boss    보스가 살아 있는 동안 (긴박) — 보스 사망 후 battle 로 복귀
//   village 대기마을 (따뜻·한가) — depart() 로 출격하면 battle
//
// 페이드는 게임 STEP 이벤트로 돌린다: 씬이 물리를 멈추거나(일시정지) 트윈을
// 정리해도 음악은 계속 자연스럽게 이어져야 하기 때문이다.
//
// 긴장도 레이어링 (2026-09-01)
// ---------------------------
// battle 은 한 장이 아니라 **세 장이 동시에 도는** 트랙이다:
//   bgm-battle          base   항상 들린다
//   bgm-battle-layer1   퍼커션 증강 (엇박 16분 하이햇·고스트 스네어·뒷박 킥)
//   bgm-battle-layer2   리드 증강   (옥타브 리드·파워 스탭·대선율)
// 셋은 같은 BPM·같은 길이(43.6초)로 생성됐고 play() 한 번에 **동시에** 시작하므로
// 이후 영원히 싱크가 맞는다. 긴장도(setTension)가 오르내리면 레이어 음량만
// 800ms 램프로 오간다 — 트랙 전환이 아니라서 곡이 끊기지 않는다.
//
// 음량 = 사용자 BGM 설정 × 크로스페이드 레벨 × 레이어 믹스. 레이어도 설정 음량의
// 지배를 받는다 (음소거면 같이 사라진다).

import Phaser from 'phaser';
import { bgmVolume } from '../core/settings';

export type BgmTrack = 'title' | 'battle' | 'boss' | 'village';

export const BGM_TRACKS: BgmTrack[] = ['title', 'battle', 'boss', 'village'];

/** 트랙별 강화 레이어 파일 이름 (public/bgm/<이름>.ogg) */
export const BGM_LAYERS: Partial<Record<BgmTrack, string[]>> = {
	battle: ['battle-layer1', 'battle-layer2'],
};

/** 모든 레이어 이름 (BootScene 로더가 순회한다) */
export const BGM_LAYER_NAMES: string[] = Object.values(BGM_LAYERS).flat();

/** 오디오 캐시 키 (BootScene 로드 키와 동일) */
export function bgmKey(track: BgmTrack | string): string {
	return `bgm-${track}`;
}

/** 기본 크로스페이드 길이 — 요구 사양 최소 600ms */
export const BGM_FADE_MS = 900;

/** 긴장도 레이어가 들고 나는 램프 길이 */
export const BGM_LAYER_RAMP_MS = 800;

/**
 * 레이어별 긴장도 구간 [들어오기 시작, 완전히 들어옴].
 * 레이어 1(퍼커션)이 먼저 붙고, 레이어 2(리드)는 더 위에서 열린다 —
 * 한 번에 둘 다 켜지면 "음악이 갑자기 바뀌었다"로 들린다.
 */
export const BGM_LAYER_RANGES: Array<[number, number]> = [[0.22, 0.52], [0.56, 0.86]];

/** 긴장도 t 에서 layerIndex(1-based) 레이어의 목표 음량 0~1 */
export function layerMixFor(layerIndex: number, tension: number): number {
	const range = BGM_LAYER_RANGES[layerIndex - 1];
	if (!range) {
		return 0;
	}
	const [lo, hi] = range;
	if (tension <= lo) {
		return 0;
	}
	if (tension >= hi) {
		return 1;
	}
	// smoothstep — 경계에서 음량이 툭 튀지 않게
	const x = (tension - lo) / (hi - lo);
	return x * x * (3 - 2 * x);
}

interface Voice {
	track: BgmTrack;
	/** 0 = base, 1.. = 강화 레이어 (BGM_LAYERS 순서) */
	layer: number;
	sound: Phaser.Sound.BaseSound & { setVolume(value: number): unknown };
	/** 현재 페이드 진행도 0~1 (1 = 완전히 들림) */
	level: number;
	target: number;
	fadeMs: number;
	/** 레이어 믹스 0~1 (base 는 항상 1) */
	mix: number;
	mixTarget: number;
}

export default class BgmSystem {
	private static instance: BgmSystem | null = null;

	private game: Phaser.Game;
	private manager: Phaser.Sound.BaseSoundManager;
	private voices: Voice[] = [];
	private desired: BgmTrack | null = null;
	private pendingUnlock = false;
	private destroyed = false;
	/** 현재 긴장도 0~1 (GameScene 이 400ms 폴링으로 넣는다) */
	private tension = 0;

	/** 게임당 하나 — 씬이 바뀌어도 같은 인스턴스를 돌려준다. */
	static for(scene: Phaser.Scene): BgmSystem {
		const existing = BgmSystem.instance;
		if (existing && !existing.destroyed && existing.game === scene.game) {
			return existing;
		}
		BgmSystem.instance = new BgmSystem(scene);
		return BgmSystem.instance;
	}

	/** 이미 만들어진 인스턴스 (없으면 null) — 설정 UI 가 음량을 즉시 반영할 때 쓴다. */
	static peek(): BgmSystem | null {
		return BgmSystem.instance && !BgmSystem.instance.destroyed ? BgmSystem.instance : null;
	}

	private constructor(scene: Phaser.Scene) {
		this.game = scene.game;
		this.manager = scene.sound;
		this.game.events.on(Phaser.Core.Events.STEP, this.step, this);
		this.game.events.once(Phaser.Core.Events.DESTROY, () => this.destroy());
		if (import.meta.env.DEV) {
			window.__bgm = this; // dev-only debug hook (bgm-test.mjs)
		}
	}

	get currentTrack(): BgmTrack | null {
		return this.desired;
	}

	/** 지금 실제로 소리를 내고 있는 트랙 (크로스페이드 중이면 가장 큰 쪽) */
	get audibleTrack(): BgmTrack | null {
		let best: Voice | null = null;
		for (const voice of this.voices) {
			if (voice.layer !== 0) {
				continue; // 레이어는 base 를 대표하지 않는다
			}
			if (!best || voice.level > best.level) {
				best = voice;
			}
		}
		return best && best.level > 0.01 ? best.track : null;
	}

	/** 현재 긴장도 (0~1) */
	get tensionLevel(): number {
		return this.tension;
	}

	/**
	 * 전투 긴장도 갱신 (0~1). 레이어 음량 목표만 바꾸고, 실제 이동은 STEP 램프가 한다.
	 * 매 프레임 불러도 안전하지만 GameScene 은 400ms 폴링에서만 호출한다.
	 */
	setTension(value: number): void {
		if (this.destroyed) {
			return;
		}
		const next = value < 0 ? 0 : value > 1 ? 1 : value;
		if (Math.abs(next - this.tension) < 0.001) {
			return;
		}
		this.tension = next;
		this.retargetLayers();
	}

	/** 레이어별 현재 음량 (테스트·디버그) */
	layerMix(): number[] {
		const out: number[] = [];
		for (const voice of this.voices) {
			if (voice.layer > 0 && voice.track === this.desired) {
				out[voice.layer - 1] = voice.mix;
			}
		}
		return out;
	}

	private retargetLayers(): void {
		for (const voice of this.voices) {
			// 물러나는 트랙의 레이어는 건드리지 않는다 — base 와 함께 크로스페이드로 빠진다
			if (voice.layer === 0 || voice.track !== this.desired) {
				continue;
			}
			voice.mixTarget = layerMixFor(voice.layer, this.tension);
		}
	}

	/**
	 * 트랙 전환. 같은 트랙이면 아무것도 하지 않는다(재시작 금지 — 라운드마다
	 * 전투곡이 처음부터 다시 나오면 귀에 거슬린다).
	 */
	play(track: BgmTrack, fadeMs: number = BGM_FADE_MS): void {
		if (this.destroyed || this.desired === track) {
			return;
		}
		this.desired = track;

		for (const voice of this.voices) {
			voice.target = 0;
			voice.fadeMs = fadeMs;
		}

		const key = bgmKey(track);
		if (!this.game.cache.audio.exists(key)) {
			return; // 에셋 미로드 환경(테스트 등)에서도 조용히 넘어간다
		}

		// 오디오가 잠겨 있으면(자동재생 정책) 해제 시점에 다시 시도한다
		if (this.manager.locked) {
			if (!this.pendingUnlock) {
				this.pendingUnlock = true;
				this.manager.once(Phaser.Sound.Events.UNLOCKED, () => {
					this.pendingUnlock = false;
					const want = this.desired;
					this.desired = null;
					if (want) {
						this.play(want, 200);
					}
				});
			}
			return;
		}

		// base 와 레이어를 **연속으로** 만들어 같은 프레임에 play() 한다 —
		// 시작 시점이 같아야(둘 다 offset 0, loop) 이후 싱크가 유지된다.
		const sound = this.manager.add(key, { loop: true, volume: 0 }) as Voice['sound'];
		sound.play();
		this.voices.push({ track, layer: 0, sound, level: 0, target: 1, fadeMs, mix: 1, mixTarget: 1 });

		const layers = BGM_LAYERS[track] ?? [];
		layers.forEach((name, index) => {
			const layerKey = bgmKey(name);
			if (!this.game.cache.audio.exists(layerKey)) {
				return; // 레이어가 없어도 base 는 그대로 돈다
			}
			const layerSound = this.manager.add(layerKey, { loop: true, volume: 0 }) as Voice['sound'];
			layerSound.play();
			this.voices.push({
				track,
				layer: index + 1,
				sound: layerSound,
				level: 0,
				target: 1,
				fadeMs,
				// 0 에서 출발해 램프로 올라온다 — 트랙이 바뀌자마자 레이어가 튀어나오지 않게
				mix: 0,
				mixTarget: layerMixFor(index + 1, this.tension),
			});
		});
	}

	/** 전체 정지 (게임오버 등) */
	stop(fadeMs: number = BGM_FADE_MS): void {
		this.desired = null;
		for (const voice of this.voices) {
			voice.target = 0;
			voice.fadeMs = fadeMs;
		}
	}

	/** 설정 변경 시 호출 — 다음 STEP 에서 새 음량이 반영된다. */
	refreshVolume(): void {
		this.applyVolumes();
	}

	private applyVolumes(): void {
		const master = bgmVolume();
		for (const voice of this.voices) {
			// 레이어 음량도 사용자 BGM 설정과 곱이다 (음소거면 함께 사라진다)
			voice.sound.setVolume(master * voice.level * voice.mix);
		}
	}

	private step(_time: number, delta: number): void {
		if (this.destroyed || this.voices.length === 0) {
			return;
		}
		for (let i = this.voices.length - 1; i >= 0; i -= 1) {
			const voice = this.voices[i];
			const stepAmount = delta / Math.max(1, voice.fadeMs);
			if (voice.level < voice.target) {
				voice.level = Math.min(voice.target, voice.level + stepAmount);
			} else if (voice.level > voice.target) {
				voice.level = Math.max(voice.target, voice.level - stepAmount);
			}
			// 레이어 믹스 램프 (긴장도) — 크로스페이드와 독립된 축이다
			if (voice.mix !== voice.mixTarget) {
				const mixStep = delta / BGM_LAYER_RAMP_MS;
				voice.mix = voice.mix < voice.mixTarget
					? Math.min(voice.mixTarget, voice.mix + mixStep)
					: Math.max(voice.mixTarget, voice.mix - mixStep);
			}
			if (voice.target === 0 && voice.level <= 0.001) {
				voice.sound.stop();
				voice.sound.destroy();
				this.voices.splice(i, 1);
			}
		}
		this.applyVolumes();
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.game.events.off(Phaser.Core.Events.STEP, this.step, this);
		for (const voice of this.voices) {
			voice.sound.stop();
			voice.sound.destroy();
		}
		this.voices = [];
		if (BgmSystem.instance === this) {
			BgmSystem.instance = null;
		}
	}
}
