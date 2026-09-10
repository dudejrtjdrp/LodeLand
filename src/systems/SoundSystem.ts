import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import { loadSettings, saveSettings, sfxVolume } from '../core/settings';
import BgmSystem from './BgmSystem';

const SFX_KEYS = [
	'hit', 'crit', 'kill', 'bigkill', 'hurt',
	'pickup', 'gold', 'levelup', 'chest', 'evolve', 'click',
	'warning', 'revive', 'gameover',
	// 정보 전달음 (scripts/generate-bgm.py 산출물)
	'lowhp',      // 체력 25% 이하 진입 경고
	'telegraph',  // 보스 즉살기(처형 광선) 전조음
];

/**
 * 기본 SFX 게인. 예전에는 sound.volume = 0.5 로 전역을 눌렀지만, 전역 볼륨은
 * BGM 까지 같이 깎아버리므로 SFX 는 재생 시점에 곱한다.
 * (기본 sfxVolume 0.8 × 0.62 ≒ 0.5 — 기존 체감 음량과 같다)
 */
export const SFX_BASE = 0.62;

export interface SoundPlayOptions {
	volume?: number;
}

// Thin wrapper over Phaser sound: throttling for spammy SFX,
// slight pitch variation so repeated hits don't sound robotic.
export default class SoundSystem {
	scene: GameScene;
	lastPlayed: Map<string, number>;
	throttleMs: Record<string, number>;

	static keys(): string[] {
		return SFX_KEYS;
	}

	constructor(scene: GameScene) {
		this.scene = scene;
		this.lastPlayed = new Map();
		this.throttleMs = {
			hit: 45,
			kill: 60,
			pickup: 50,
			gold: 60,
			crit: 80,
		};

		// 마스터 음소거는 설정(core/settings)에 통합 — BGM 도 같은 플래그를 따른다.
		scene.sound.mute = loadSettings().muted;
		// 전역 볼륨은 1로 두고, SFX 는 재생 시점에·BGM 은 BgmSystem 이 각자 곱한다.
		scene.sound.volume = 1;
	}

	play(key: string, options: SoundPlayOptions = {}): void {
		if (!this.scene.cache.audio.exists(key)) {
			return;
		}

		const now = this.scene.time.now;
		const throttle = this.throttleMs[key] ?? 0;
		if (throttle && now - (this.lastPlayed.get(key) ?? -Infinity) < throttle) {
			return;
		}
		this.lastPlayed.set(key, now);

		const detunable = key === 'hit' || key === 'kill' || key === 'pickup' || key === 'gold';
		this.scene.sound.play(key, {
			volume: (options.volume ?? 1) * sfxVolume() * SFX_BASE,
			detune: detunable ? Phaser.Math.Between(-120, 120) : 0,
		});
	}

	toggleMute(): boolean {
		const muted = !loadSettings().muted;
		this.setMuted(muted);
		return muted;
	}

	setMuted(muted: boolean): void {
		saveSettings({ muted });
		this.scene.sound.mute = muted;
		BgmSystem.peek()?.refreshVolume();
	}

	/** 효과음 음량 0~1 (설정에 영속) */
	setSfxVolume(value: number): void {
		saveSettings({ sfxVolume: Math.min(1, Math.max(0, value)) });
	}

	/** 배경음 음량 0~1 (설정에 영속 + 재생 중인 트랙에 즉시 반영) */
	setBgmVolume(value: number): void {
		saveSettings({ bgmVolume: Math.min(1, Math.max(0, value)) });
		BgmSystem.peek()?.refreshVolume();
	}

	isMuted(): boolean {
		return loadSettings().muted;
	}
}
