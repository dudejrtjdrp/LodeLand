import Phaser from 'phaser';

const SFX_KEYS = [
	'hit', 'crit', 'kill', 'bigkill', 'hurt',
	'pickup', 'gold', 'levelup', 'chest', 'evolve', 'click',
	'warning', 'revive', 'gameover',
];

const MUTE_KEY = 'movesword-muted';

// Thin wrapper over Phaser sound: throttling for spammy SFX,
// slight pitch variation so repeated hits don't sound robotic.
export default class SoundSystem {
	static keys() {
		return SFX_KEYS;
	}

	constructor(scene) {
		this.scene = scene;
		this.lastPlayed = new Map();
		this.throttleMs = {
			hit: 45,
			kill: 60,
			pickup: 50,
			gold: 60,
			crit: 80,
		};

		try {
			scene.sound.mute = localStorage.getItem(MUTE_KEY) === '1';
		} catch { /* storage unavailable */ }

		scene.sound.volume = 0.5;
	}

	play(key, options = {}) {
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
			volume: options.volume ?? 1,
			detune: detunable ? Phaser.Math.Between(-120, 120) : 0,
		});
	}

	toggleMute() {
		const muted = !this.scene.sound.mute;
		this.scene.sound.mute = muted;

		try {
			localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
		} catch { /* ignore */ }

		return muted;
	}

	isMuted() {
		return this.scene.sound.mute;
	}
}
