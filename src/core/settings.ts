// 사용자 설정 (localStorage 영속): 화면 흔들림 · 모션 줄이기 · 음량.
//
// 음량은 BGM/SFX 를 분리해 0~1 로 저장하고, 마스터 음소거는 muted 하나로 묶는다.
// SoundSystem 이 sfxVolume 을, BgmSystem 이 bgmVolume 을 따른다.
// (구버전 'movesword-muted' 키는 최초 로드 때 1회 흡수한다)

const KEY = 'movesword-settings-v1';
const LEGACY_MUTE_KEY = 'movesword-muted';

export interface GameSettings {
	/** 카메라 흔들림·플래시 허용 */
	screenShake: boolean;
	/** 장식성 트윈(펄스·잔상 등) 생략 */
	reduceMotion: boolean;
	/** 타격 순간의 짧은 시간 정지(히트스톱) — 모션 줄이기와 별개 축 */
	hitStop: boolean;
	/** 배경음 음량 0~1 */
	bgmVolume: number;
	/** 효과음 음량 0~1 */
	sfxVolume: number;
	/** 마스터 음소거 (BGM·SFX 전부) */
	muted: boolean;
}

const DEFAULTS: GameSettings = {
	screenShake: true,
	reduceMotion: false,
	hitStop: true,
	bgmVolume: 0.55,
	sfxVolume: 0.8,
	muted: false,
};

let cached: GameSettings | null = null;

function clamp01(value: unknown, fallback: number): number {
	const num = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(num)) {
		return fallback;
	}
	return Math.min(1, Math.max(0, num));
}

export function loadSettings(): GameSettings {
	if (cached) {
		return cached;
	}
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as Partial<GameSettings>) : {};
		cached = { ...DEFAULTS, ...parsed };
		cached.bgmVolume = clamp01(cached.bgmVolume, DEFAULTS.bgmVolume);
		cached.sfxVolume = clamp01(cached.sfxVolume, DEFAULTS.sfxVolume);
		if (parsed.muted === undefined) {
			// 구버전 음소거 키 흡수 (한 번만 — 이후에는 통합 설정에 저장된다)
			cached.muted = localStorage.getItem(LEGACY_MUTE_KEY) === '1';
		}
	} catch {
		cached = { ...DEFAULTS };
	}
	return cached;
}

export function saveSettings(patch: Partial<GameSettings>): GameSettings {
	const next = { ...loadSettings(), ...patch };
	cached = next;
	try {
		localStorage.setItem(KEY, JSON.stringify(next));
	} catch {
		// 저장 불가 환경(시크릿 모드 등)에서는 세션 메모리만 유지
	}
	return next;
}

export function screenShakeEnabled(): boolean {
	return loadSettings().screenShake;
}

export function reduceMotion(): boolean {
	return loadSettings().reduceMotion;
}

/**
 * 히트스톱(타격 순간 정지) 허용 여부.
 * 모션 줄이기와 분리해 둔다 — 잔상·펄스는 괜찮지만 화면이 멈추는 건 싫은 사람이 있다.
 */
export function hitStopEnabled(): boolean {
	return loadSettings().hitStop;
}

/** 배경음 음량 (0~1) — 음소거 중이면 0 */
export function bgmVolume(): number {
	const settings = loadSettings();
	return settings.muted ? 0 : settings.bgmVolume;
}

/** 효과음 음량 (0~1) — 음소거 중이면 0 */
export function sfxVolume(): number {
	const settings = loadSettings();
	return settings.muted ? 0 : settings.sfxVolume;
}

export function isMuted(): boolean {
	return loadSettings().muted;
}
