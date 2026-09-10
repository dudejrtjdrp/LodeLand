import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import { FONT, TEXT_RESOLUTION,
} from '../ui/theme';
import { hitStopEnabled, reduceMotion, screenShakeEnabled } from '../core/settings';
import skillCatalogJson from '../data/skillCatalog.json';
import type { SkillCatalog } from '../types/catalogs';

const HIT_STOP = (skillCatalogJson as unknown as SkillCatalog).hitStop;
import type { EnemySprite, PlayerSprite } from '../types/actors';
import type { OrbitSword, UltimateElement } from './sword/types';
import {
	DAMAGE_FONT_GLYPH_PX, damageFontKey, hasDamageFontColor, isDamageFontText,
	damageFontCellWidth,
} from '../ui/damageFont';
import { formatBigNumber } from '../logic/growth';
import { STATUS_STYLE, type StatusKind } from '../logic/statusEffects';

/** Phaser sets no public `destroyed` flag; the game checks it defensively. */
type Rect = Phaser.GameObjects.Rectangle & { destroyed?: boolean };

type HealthBarEntity = PlayerSprite | EnemySprite;

export interface HealthBar {
	background: Rect;
	bar: Rect;
	entity: HealthBarEntity;
	/** 변경 감지용 — 값이 그대로면 크기/색 갱신을 건너뛴다. */
	lastPercent?: number;
	lastWidth?: number;
	lastColor?: number;
}

/** 동시 표시 데미지 텍스트 상한 (성능 예산) — 초과 시 일반 타격 텍스트는 생략 */
const DAMAGE_TEXT_BUDGET = 28;
const DAMAGE_TEXT_POOL_MAX = 40;
/**
 * 부유 데미지 텍스트 전용 해상도. UI 패널(TEXT_RESOLUTION 2~3)과 달리 큰 볼드 숫자라
 * 2로 낮춰도 육안 차이가 없고, 캔버스 재굽기·GPU 업로드 비용이 최대 절반 이하로 줄어든다.
 */
const DAMAGE_TEXT_RESOLUTION = Math.min(2, TEXT_RESOLUTION);
/** 부유 데미지 숫자 표시 크기(px) — 일반 / 치명타. 2026-09-04 24·44 → 32·56 (더 크게). */
const DAMAGE_TEXT_PX = 32;
const DAMAGE_TEXT_CRIT_PX = 58;
/** 자간: 셀 폭 대비 음수 비율 — 스킨 C 셀에는 글로우 여백(17px)이 들어 있어 0.42 가 시안의 -18% 에 해당 */
const DAMAGE_TEXT_LETTER_SPACING = 0.42;
/** 지속 피해(DoT) 틱 숫자 — 타격 숫자보다 작게 떠서 본 피해와 섞이지 않는다 */
const STATUS_TEXT_PX = 20;
/** DoT 숫자 전용 상한 (일반 타격 예산과 별도로 더 빡빡하게 잡는다) */
const STATUS_TEXT_BUDGET = 14;

/** 부유 데미지 숫자(BitmapText) 엔트리 — 트윈 없이 수동 보간한다. */
interface FloatingBitmapEntry {
	/**
	 * 글리프 묶음. 일반 타격은 1개(문자열 통째), 치명타는 자리수마다 1개(캐스케이드 팝).
	 * 모두 같은 폰트 키(색)라 회수도 같은 풀로 간다.
	 */
	parts: Phaser.GameObjects.BitmapText[];
	/** 회수될 풀 (색상별 폰트 키) */
	fontKey: string;
	t0: number;
	dur: number;
	x0: number;
	y0: number;
	/** 표시 기준 스케일 (팝 애니메이션은 이 값에 곱한다) */
	scale: number;
	/** 좌우 표류(px) — 같은 자리에 겹쳐 뜨는 숫자를 흩어 준다 */
	drift: number;
	/** 자리수 간 등장 지연(ms) — 0 이면 캐스케이드 없음 */
	stagger: number;
	/** 자리수별 x 오프셋 (parts 와 같은 길이, 스케일 전 좌표) */
	offsets: number[];
	isCrit: boolean;
}

/** 부유 데미지 텍스트 엔트리 — 트윈 없이 수동 보간한다 (FxEntry와 같은 방식). */
interface FloatingTextEntry {
	text: Phaser.GameObjects.Text;
	/** 회수될 풀 (크기+색 조합) */
	poolKey: string;
	t0: number;
	dur: number;
	x: number;
	y0: number;
}

/**
 * 공유 FX 레이어 엔트리: 일회용 GameObject(circle/graphics)+트윈 대신
 * 데이터 객체 하나로 표현하고, 매 프레임 단일 Graphics에 일괄 렌더한다.
 * (30라+ 렉의 주범이던 초당 ~100개 오브젝트 생성/파괴 + 트윈 ~47개를 제거)
 */
interface FxEntry {
	kind: 'ring' | 'dot' | 'burst' | 'poly' | 'diamond' | 'cross' | 'arc';
	x: number;
	y: number;
	t0: number;
	dur: number;
	color: number;
	alpha: number;
	ease: 'out' | 'in' | 'lin';
	/** ring: 시작/끝 반지름, 스트로크 폭 */
	r0?: number;
	r1?: number;
	w?: number;
	/** dot/diamond/cross: 반지름(또는 반폭)과 끝 배율, 표류 */
	r?: number;
	scale1?: number;
	dx?: number;
	dy?: number;
	fill?: boolean;
	/** burst: 미리 계산한 방사선 */
	rays?: Array<{ a: number; len: number }>;
	/** poly: 꼭짓점 x,y 쌍 + 레이어(폭,색,알파) */
	pts?: number[];
	layers?: Array<readonly [number, number, number]>;
	/** arc: 각도 범위 */
	a0?: number;
	a1?: number;
	/** arc: 지속시간 동안 a0/a1이 함께 회전하는 각도 (스윕 연출용) */
	spin?: number;
	/** ring: 점선 분할 수 (0/미지정이면 실선) */
	dash?: number;
	/** 알파를 유지하다가 마지막 구간에서만 페이드하는 비율 (0~1, 기본 0=처음부터 페이드) */
	hold?: number;
	color2?: number;
}

/** FX 레이어 동시 엔트리 상한 (성능 예산) — 초과 시 가장 오래된 것부터 버린다 */
const FX_POOL_MAX = 160;
const GHOST_POOL_MAX = 36;
/** 스프라이트 FX 풀 상한 — 초과하면 가장 오래된 슬롯을 재사용한다 */
const FX_SPRITE_POOL_MAX = 24;
/** 스프라이트 FX 기본 뎁스 — 공유 FX 레이어(56)와 같은 층 */
export const FX_SPRITE_DEPTH = 56;

/** fxSpriteFollow 가 따라갈 수 있는 대상 (플레이어·적 등 좌표를 가진 것) */
export interface FollowTarget {
	x: number;
	y: number;
	active?: boolean;
	visible?: boolean;
}

interface AttachedFx {
	sprite: Phaser.GameObjects.Sprite;
	/** null 이면 좌표 고정 */
	target: FollowTarget | null;
	until: number;
	offsetY: number;
	x: number;
	y: number;
}

/** 고스트(잔상 이미지) 엔트리 — 풀에서 재사용하는 Image를 수동 보간 */
interface GhostEntry {
	img: Phaser.GameObjects.Image;
	t0: number;
	dur: number;
	alpha0: number;
	scale0: number;
	scale1: number;
	x0: number;
	y0: number;
	dx: number;
	dy: number;
}

export default class VisualEffectsSystem {
	scene: GameScene;
	healthBars: Map<HealthBarEntity, HealthBar>;
	damageTexts: Phaser.GameObjects.Text[];
	hitStopActive: boolean;
	/** 현재 히트스톱이 끝나는 시각 (감시자용) */
	hitStopUntil = 0;
	/** 마지막 히트스톱 시각 — 연속 발동 간격 제한 */
	private lastHitStopAt = -Infinity;
	/** 적 체력바 일괄 렌더 (적마다 Rectangle 2개 대신 Graphics 1개) */
	enemyBarsG: Phaser.GameObjects.Graphics | null = null;
	/** 잦은 연출의 전역 속도 제한 타임스탬프 */
	private lastFeatherAt = 0;
	private lastSparkAt = 0;
	/** 지속 피해 숫자의 전역 간격 제한 (적 다수 × 초당 2틱 폭주 방지) */
	private lastStatusTextAt = 0;

	/**
	 * 적응형 연출 감축: 프레임이 처지면 장식성 연출의 속도 제한을 넓히고
	 * 데미지 텍스트 예산을 줄인다 (1=정상, 2=혼잡, 3=심각). 30라+ 렉 대응.
	 */
	fxThrottle(): number {
		const fps = this.scene.game.loop.actualFps;
		return fps < 38 ? 3 : fps < 50 ? 2 : 1;
	}
	/**
	 * 데미지 텍스트 오브젝트 풀 — "폰트 크기 + 색" 조합별로 분리한다.
	 *
	 * 하나의 풀을 여러 크기·색이 돌려 쓰면 재사용할 때마다 setFontSize가 MeasureText를
	 * (새 캔버스 + getImageData 전체 스캔) 유발하고 setColor가 캔버스 재굽기 + GPU
	 * 업로드를 강제해서 풀링 이득이 사라진다. 실제 조합은 6가지뿐이라 분리해도
	 * 총 객체 수는 그대로다.
	 */
	private textPools = new Map<string, Phaser.GameObjects.Text[]>();
	private floatingTexts: FloatingTextEntry[] = [];
	/**
	 * 숫자 데미지용 BitmapText 풀 (폰트 키 = 색). 색상별 폰트가 텍스처 한 장을
	 * 공유하므로, 풀이 나뉘어도 실제 텍스처 유닛 사용은 1개다.
	 */
	private bitmapPools = new Map<string, Phaser.GameObjects.BitmapText[]>();
	private floatingBitmaps: FloatingBitmapEntry[] = [];
	private activeTextCount = 0;

	// ---------------------------------------------------------------
	// 공유 FX 레이어: 모든 순간 연출(링/스파크/볼트/방울)을 Graphics 한 장에
	// 매 프레임 다시 그린다. GameObject 생성·트윈이 전혀 없다.
	// ---------------------------------------------------------------
	private fxEntries: FxEntry[] = [];
	private fxG: Phaser.GameObjects.Graphics | null = null;
	private ghosts: GhostEntry[] = [];
	private ghostPool: Phaser.GameObjects.Image[] = [];

	constructor(scene: GameScene) {
		this.scene = scene;
		this.healthBars = new Map(); // track health bars by owner (player/enemy)
		this.damageTexts = [];
		this.hitStopActive = false;
		// 씬 update가 UI로 조기 반환해도 FX는 항상 페이드되도록 씬 이벤트에 연결
		scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.updateFxLayer, this);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.updateFxLayer, this);
		});
	}

	/** FX 엔트리 추가 (상한 초과 시 오래된 것부터 교체) */
	private fxPush(entry: FxEntry): void {
		if (this.fxEntries.length >= FX_POOL_MAX) {
			this.fxEntries.shift();
		}
		this.fxEntries.push(entry);
	}

	fxRing(x: number, y: number, opts: { r0?: number; r1?: number; w?: number; color?: number; alpha?: number; dur?: number; ease?: 'out' | 'in' | 'lin'; color2?: number; dash?: number; hold?: number }): void {
		this.fxPush({
			kind: 'ring', x, y, t0: this.scene.time.now, dur: opts.dur ?? 240,
			color: opts.color ?? 0xe8c07a, color2: opts.color2, alpha: opts.alpha ?? 0.9, ease: opts.ease ?? 'out',
			r0: opts.r0 ?? 8, r1: opts.r1 ?? 24, w: opts.w ?? 2, dash: opts.dash, hold: opts.hold,
		});
	}

	fxDot(x: number, y: number, opts: { r?: number; color?: number; alpha?: number; dur?: number; scale1?: number; dx?: number; dy?: number; ease?: 'out' | 'in' | 'lin' }): void {
		this.fxPush({
			kind: 'dot', x, y, t0: this.scene.time.now, dur: opts.dur ?? 300,
			color: opts.color ?? 0xffffff, alpha: opts.alpha ?? 0.9, ease: opts.ease ?? 'out',
			r: opts.r ?? 4, scale1: opts.scale1 ?? 0.4, dx: opts.dx ?? 0, dy: opts.dy ?? 0,
		});
	}

	fxBurst(x: number, y: number, opts: { count?: number; reach?: number; color?: number; w?: number; alpha?: number; dur?: number }): void {
		const count = opts.count ?? 5;
		const reach = opts.reach ?? 15;
		const base = Math.random() * Math.PI * 2;
		const rays: Array<{ a: number; len: number }> = [];
		for (let i = 0; i < count; i += 1) {
			rays.push({ a: base + (i / count) * Math.PI * 2, len: reach + Math.random() * 7 });
		}
		this.fxPush({
			kind: 'burst', x, y, t0: this.scene.time.now, dur: opts.dur ?? 150,
			color: opts.color ?? 0xe8c07a, alpha: opts.alpha ?? 0.95, ease: 'out',
			w: opts.w ?? 2, rays,
		});
	}

	fxPoly(pts: number[], opts: { layers: Array<readonly [number, number, number]>; dur?: number }): void {
		this.fxPush({
			kind: 'poly', x: 0, y: 0, t0: this.scene.time.now, dur: opts.dur ?? 190,
			color: 0xffffff, alpha: 1, ease: 'lin', pts, layers: opts.layers,
		});
	}

	fxDiamond(x: number, y: number, opts: { r?: number; color?: number; alpha?: number; dur?: number; dy?: number; fill?: boolean }): void {
		this.fxPush({
			kind: 'diamond', x, y, t0: this.scene.time.now, dur: opts.dur ?? 260,
			color: opts.color ?? 0xd9a83c, alpha: opts.alpha ?? 0.95, ease: 'out',
			r: opts.r ?? 8, dy: opts.dy ?? 0, dx: 0, fill: opts.fill ?? true, scale1: 1,
		});
	}

	fxCross(x: number, y: number, opts: { r?: number; color?: number; w?: number; alpha?: number; dur?: number; scale1?: number }): void {
		this.fxPush({
			kind: 'cross', x, y, t0: this.scene.time.now, dur: opts.dur ?? 260,
			color: opts.color ?? 0xd95f4d, alpha: opts.alpha ?? 0.95, ease: 'out',
			r: opts.r ?? 16, w: opts.w ?? 3.5, scale1: opts.scale1 ?? 1.25,
		});
	}

	fxArc(x: number, y: number, opts: { r?: number; a0: number; a1: number; color?: number; w?: number; alpha?: number; dur?: number; spin?: number; ease?: 'out' | 'in' | 'lin'; hold?: number }): void {
		this.fxPush({
			kind: 'arc', x, y, t0: this.scene.time.now, dur: opts.dur ?? 200,
			color: opts.color ?? 0xbae6fd, alpha: opts.alpha ?? 0.9, ease: opts.ease ?? 'lin',
			r: opts.r ?? 16, w: opts.w ?? 3, a0: opts.a0, a1: opts.a1, spin: opts.spin, hold: opts.hold,
		});
	}

	/** 잔상 이미지 (검 궤적·깃털): 풀에서 Image를 재사용, 트윈 없이 수동 보간 */
	fxGhost(texture: string, frame: string | number | undefined, x: number, y: number, opts: {
		displayW: number; displayH: number; rotation?: number; tint?: number; alpha?: number;
		dur?: number; scale1?: number; dx?: number; dy?: number; depth?: number;
	}): void {
		if (this.ghosts.length >= GHOST_POOL_MAX) {
			return; // 예산 초과 — 잔상은 장식이므로 생략
		}
		let img = this.ghostPool.pop();
		if (!img) {
			img = this.scene.add.image(0, 0, texture, frame);
		} else {
			img.setTexture(texture, frame as string | undefined);
		}
		img.setActive(true).setVisible(true)
			.setPosition(x, y)
			.setDisplaySize(opts.displayW, opts.displayH)
			.setRotation(opts.rotation ?? 0)
			.setAlpha(opts.alpha ?? 0.45)
			.setDepth(opts.depth ?? 1);
		if (opts.tint !== undefined) {
			img.setTint(opts.tint);
		} else {
			img.clearTint();
		}
		this.ghosts.push({
			img, t0: this.scene.time.now, dur: opts.dur ?? 190,
			alpha0: opts.alpha ?? 0.45, scale0: img.scale, scale1: (opts.scale1 ?? 0.72) * img.scale,
			x0: x, y0: y, dx: opts.dx ?? 0, dy: opts.dy ?? 0,
		});
	}

	// ---------------------------------------------------------------
	// 스프라이트 FX (2026-09-05)
	//
	// 도형(fx*)으로 흉내내던 연출을 실제 이펙트 시트로 재생한다.
	// 규약 3가지 — 이걸 어기면 렉·누수·연출 실종이 난다.
	//   1. 풀 재사용. 매 호출 add.sprite 금지 (fxGhost 와 같은 이유).
	//   2. 에셋이 없으면 null 을 돌려준다. 호출부는 기존 도형 연출로 폴백한다
	//      → 시트를 한 장씩 늘려가며 교체할 수 있고, 롤백은 파일만 빼면 된다.
	//   3. 성능/접근성 게이트(fxThrottle·reduceMotion)를 fx* 와 동일하게 통과한다.
	// ---------------------------------------------------------------

	/** 스프라이트 FX 동시 표시 상한 */
	private fxSprites: Phaser.GameObjects.Sprite[] = [];
	private fxSpriteCursor = 0;
	/** 대상을 따라다니는 지속 루프 (fxSpriteFollow) */
	private attached: AttachedFx[] = [];

	/**
	 * 이펙트 시트 재생. 재생 성공 시 Sprite(루프 이펙트를 직접 끄기 위한 핸들)를,
	 * 에셋이 없거나 예산 초과면 null 을 반환한다.
	 *
	 * 반환값을 반드시 확인할 것:
	 *   if (!this.fxSprite('fx-nova-fire', x, y, { size: r * 2.2 })) { ...기존 도형 연출... }
	 */
	fxSprite(key: string, x: number, y: number, opts: {
		/** 화면상 지름(px). 판정 반경이 아니라 시각 크기 — 보통 반경 × 2.2 */
		size?: number;
		height?: number;
		rotation?: number;
		tint?: number;
		alpha?: number;
		depth?: number;
		/** 발광 이펙트는 true (검정이 투명해진다) */
		additive?: boolean;
		flipX?: boolean;
		flipY?: boolean;
		/** 왼쪽 중앙 기준 (방향성 이펙트: 검기·광선·원뿔) */
		anchorLeft?: boolean;
		/** 재생 배속 (1 = 시트 기본 fps) */
		timeScale?: number;
	} = {}): Phaser.GameObjects.Sprite | null {
		if (reduceMotion() || this.fxThrottle() >= 3) {
			return null;
		}
		const anim = `${key}-play`;
		// 시트가 아직 없으면 조용히 실패 → 호출부가 기존 도형 연출로 떨어진다
		if (!this.scene.textures.exists(key) || !this.scene.anims.exists(anim)) {
			return null;
		}

		let s: Phaser.GameObjects.Sprite;
		if (this.fxSprites.length < FX_SPRITE_POOL_MAX) {
			s = this.scene.add.sprite(x, y, key);
			// 정리 리스너는 풀 생성 시 1회만 — 호출마다 once 를 붙이면 리스너가 샌다
			s.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
				s.setVisible(false).setActive(false);
			});
			this.fxSprites.push(s);
		} else {
			s = this.fxSprites[this.fxSpriteCursor];
			this.fxSpriteCursor = (this.fxSpriteCursor + 1) % FX_SPRITE_POOL_MAX;
			s.setTexture(key);
		}

		s.setActive(true).setVisible(true)
			.setPosition(x, y)
			.setDepth(opts.depth ?? FX_SPRITE_DEPTH)
			.setRotation(opts.rotation ?? 0)
			.setAlpha(opts.alpha ?? 1)
			.setOrigin(opts.anchorLeft ? 0 : 0.5, 0.5)
			.setFlip(!!opts.flipX, !!opts.flipY)
			.setBlendMode(opts.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
		if (opts.tint !== undefined) {
			s.setTint(opts.tint);
		} else {
			s.clearTint();
		}
		if (opts.size) {
			s.setDisplaySize(opts.size, opts.height ?? opts.size);
		} else {
			s.setScale(1);
		}
		s.play(anim);
		s.anims.timeScale = opts.timeScale ?? 1;
		return s;
	}

	/** 루프 이펙트 정리 — 지속 스킬이 끝날 때 소유자가 직접 부른다 */
	fxSpriteStop(s: Phaser.GameObjects.Sprite | null): void {
		if (!s) {
			return;
		}
		s.anims.stop();
		s.setVisible(false).setActive(false);
		for (let i = this.attached.length - 1; i >= 0; i -= 1) {
			if (this.attached[i].sprite === s) {
				this.attached.splice(i, 1);
			}
		}
	}

	/**
	 * 대상을 따라다니는 지속 루프 이펙트 (보호막·빙결 감옥·상태이상 오버레이).
	 *
	 * `until` 시각이 지나거나 대상이 사라지면 스스로 꺼진다 — 소유자가 종료를 잊어도
	 * 화면에 남지 않는다. 대상 없이 좌표만 주면 그 자리에 고정된다.
	 */
	fxSpriteFollow(key: string, target: FollowTarget | null, x: number, y: number, until: number, opts: {
		size?: number; height?: number; tint?: number; alpha?: number; depth?: number;
		additive?: boolean; offsetY?: number; timeScale?: number;
	} = {}): Phaser.GameObjects.Sprite | null {
		const sprite = this.fxSprite(key, x, y, opts);
		if (!sprite) {
			return null;
		}
		this.attached.push({ sprite, target, until, offsetY: opts.offsetY ?? 0, x, y });
		return sprite;
	}

	/** 매 프레임: 공유 Graphics를 지우고 살아있는 FX만 다시 그린다 */
	private updateFxLayer(): void {
		const now = this.scene.time.now;

		// 부유 데미지 텍스트 보간/회수 (트윈 없음)
		this.updateFloatingTexts(now);

		// 부착 루프 이펙트: 대상을 따라가고, 만료·대상 소멸 시 스스로 꺼진다.
		// (소유자가 종료를 잊어도 화면에 남지 않게 하는 안전망)
		for (let i = this.attached.length - 1; i >= 0; i -= 1) {
			const a = this.attached[i];
			const gone = a.target ? (a.target.active === false || a.target.visible === false) : false;
			if (now >= a.until || gone || !a.sprite.active) {
				a.sprite.anims.stop();
				a.sprite.setVisible(false).setActive(false);
				this.attached.splice(i, 1);
				continue;
			}
			if (a.target) {
				a.sprite.setPosition(a.target.x, a.target.y + a.offsetY);
			}
		}

		// 고스트 이미지 보간/회수
		for (let i = this.ghosts.length - 1; i >= 0; i -= 1) {
			const gh = this.ghosts[i];
			const p = (now - gh.t0) / gh.dur;
			if (p >= 1) {
				gh.img.setActive(false).setVisible(false);
				if (this.ghostPool.length < GHOST_POOL_MAX) {
					this.ghostPool.push(gh.img);
				} else {
					gh.img.destroy();
				}
				this.ghosts.splice(i, 1);
				continue;
			}
			const q = 1 - (1 - p) * (1 - p); // easeOut
			gh.img.setAlpha(gh.alpha0 * (1 - p));
			gh.img.setScale(gh.scale0 + (gh.scale1 - gh.scale0) * q);
			gh.img.setPosition(gh.x0 + gh.dx * q, gh.y0 + gh.dy * q);
		}

		if (!this.fxG) {
			if (this.fxEntries.length === 0) {
				return;
			}
			this.fxG = this.scene.add.graphics().setDepth(56);
		}
		const g = this.fxG;
		g.clear();
		if (this.fxEntries.length === 0) {
			return;
		}

		for (let i = this.fxEntries.length - 1; i >= 0; i -= 1) {
			const e = this.fxEntries[i];
			const raw = (now - e.t0) / e.dur;
			if (raw >= 1) {
				this.fxEntries.splice(i, 1);
				continue;
			}
			const p = raw < 0 ? 0 : raw;
			const q = e.ease === 'out' ? 1 - (1 - p) * (1 - p) : e.ease === 'in' ? p * p : p;
			// hold: 지속시간의 앞 h 구간은 알파를 유지하고 남은 구간에서만 페이드한다.
			// (링이 잠깐 머물렀다 사라지는 기존 2단 트윈 연출을 재현)
			const h = e.hold ?? 0;
			const fade = h > 0
				? e.alpha * (p <= h ? 1 : 1 - (p - h) / (1 - h))
				: e.alpha * (1 - p);

			switch (e.kind) {
				case 'ring': {
					const r = (e.r0 ?? 8) + ((e.r1 ?? 24) - (e.r0 ?? 8)) * q;
					g.lineStyle(e.w ?? 2, e.color, fade);
					if (e.dash) {
						// 점선 링: 짝수 구간만 그린다 (획득 범위 표시용)
						const segments = e.dash;
						for (let s = 0; s < segments; s += 2) {
							g.beginPath();
							g.arc(e.x, e.y, r, (s / segments) * Math.PI * 2, ((s + 1) / segments) * Math.PI * 2);
							g.strokePath();
						}
					} else {
						g.strokeCircle(e.x, e.y, r);
					}
					break;
				}
				case 'dot': {
					const scale = 1 + ((e.scale1 ?? 0.4) - 1) * q;
					g.fillStyle(e.color, fade);
					g.fillCircle(e.x + (e.dx ?? 0) * q, e.y + (e.dy ?? 0) * q, Math.max(0.5, (e.r ?? 4) * scale));
					break;
				}
				case 'burst': {
					g.lineStyle(e.w ?? 2, e.color, fade);
					for (const ray of e.rays!) {
						const inner = 4 + ray.len * q * 0.4;
						const outer = 4 + ray.len * q;
						g.beginPath();
						g.moveTo(e.x + Math.cos(ray.a) * inner, e.y + Math.sin(ray.a) * inner);
						g.lineTo(e.x + Math.cos(ray.a) * outer, e.y + Math.sin(ray.a) * outer);
						g.strokePath();
					}
					break;
				}
				case 'poly': {
					const pts = e.pts!;
					for (const [w, color, alpha] of e.layers!) {
						g.lineStyle(w, color, alpha * (1 - p));
						g.beginPath();
						g.moveTo(pts[0], pts[1]);
						for (let j = 2; j < pts.length; j += 2) {
							g.lineTo(pts[j], pts[j + 1]);
						}
						g.strokePath();
					}
					break;
				}
				case 'diamond': {
					const r = e.r ?? 8;
					const dy = (e.dy ?? 0) * q;
					g.fillStyle(e.color, fade);
					g.beginPath();
					g.moveTo(e.x, e.y + dy - r);
					g.lineTo(e.x + r, e.y + dy);
					g.lineTo(e.x, e.y + dy + r);
					g.lineTo(e.x - r, e.y + dy);
					g.closePath();
					g.fillPath();
					break;
				}
				case 'cross': {
					const r = (e.r ?? 16) * (1 + ((e.scale1 ?? 1.25) - 1) * q);
					g.lineStyle(e.w ?? 3.5, e.color, fade);
					g.beginPath(); g.moveTo(e.x - r, e.y - r); g.lineTo(e.x + r, e.y + r); g.strokePath();
					g.beginPath(); g.moveTo(e.x + r, e.y - r); g.lineTo(e.x - r, e.y + r); g.strokePath();
					break;
				}
				case 'arc': {
					// spin이 있으면 각도 범위 전체가 회전한다 (궤도 스윕 연출).
					const offset = (e.spin ?? 0) * q;
					g.lineStyle(e.w ?? 3, e.color, fade);
					g.beginPath();
					g.arc(e.x, e.y, e.r ?? 16, (e.a0 ?? 0) + offset, (e.a1 ?? Math.PI) + offset);
					g.strokePath();
					break;
				}
				default:
					break;
			}
		}
	}

	// ---------------------------------------------------------------
	// 검떼 연출 — "쇠는 무겁고 새는 가볍다"
	// 전부 장식성이므로 모션 줄이기 설정 시 생략, 전역 속도 제한으로 성능 보호.
	// ---------------------------------------------------------------

	/** 출격: 발사 버스트 링 + 깃털 잔상 + 방향 섬광 (혈통색) */
	swordLaunchFX(sword: OrbitSword): void {
		if (reduceMotion() || !sword?.active) {
			return;
		}
		const now = this.scene.time.now;
		if (now - this.lastFeatherAt < 60 * this.fxThrottle()) {
			return;
		}
		this.lastFeatherAt = now;

		const tint = sword.effect?.tint
			? Phaser.Display.Color.HexStringToColor(sword.effect.tint).color
			: 0x8fc3d8;
		const forward = sword.launchAngle ?? 0;
		const back = forward + Math.PI;

		// 발사 지점 버스트 링 — 출격을 명확히 알린다
		this.fxRing(sword.x, sword.y, { r0: 9, r1: 23, w: 2.5, color: tint, alpha: 0.9, dur: 240 });

		// 진행 방향 섬광 줄기 3가닥 (공유 FX 레이어)
		this.fxPoly([sword.x, sword.y, sword.x + Math.cos(forward) * 34, sword.y + Math.sin(forward) * 34],
			{ layers: [[3, 0xffffff, 0.85]], dur: 160 });
		for (const offset of [-0.22, 0.22]) {
			this.fxPoly([sword.x, sword.y, sword.x + Math.cos(forward + offset) * 24, sword.y + Math.sin(forward + offset) * 24],
				{ layers: [[2, tint, 0.7]], dur: 160 });
		}

		// 깃털 잔상 3장이 뒤로 흩어진다 (풀 재사용 고스트)
		for (let i = 0; i < 3; i += 1) {
			const spread = (i - 1) * 0.55;
			this.fxGhost('g-feather', undefined, sword.x, sword.y, {
				displayW: 15, displayH: 15, tint, alpha: 0.9, rotation: back + spread,
				dx: Math.cos(back + spread) * 34, dy: Math.sin(back + spread) * 34,
				scale1: 0.4, dur: 260, depth: 54,
			});
		}
	}

	/** 비행 잔상: launched/returning 검의 궤적 (검별 속도 제한은 호출부의 _lastTrailAt) */
	swordTrailFX(sword: OrbitSword, alpha = 0.45): void {
		if (reduceMotion() || !sword?.active || this.fxThrottle() >= 3) {
			return;
		}
		const tint = sword.effect?.tint
			? Phaser.Display.Color.HexStringToColor(sword.effect.tint).color
			: 0xbfd9e8;
		this.fxGhost(sword.texture.key, sword.frame.name, sword.x, sword.y, {
			displayW: sword.displayWidth, displayH: sword.displayHeight,
			rotation: sword.rotation, tint, alpha, scale1: 0.72, dur: 190, depth: 1,
		});
	}

	/** 대시 잔상: 플레이어 스프라이트 고스트 (풀 재사용 — 새 오브젝트 없음) */
	dashGhostFX(player: PlayerSprite): void {
		if (reduceMotion() || !player?.active) {
			return;
		}
		this.fxGhost(player.texture.key, player.frame.name, player.x, player.y, {
			displayW: player.displayWidth, displayH: player.displayHeight,
			tint: 0x8fc3d8, alpha: 0.42, scale1: 0.92, dur: 220, depth: 9,
		});
	}

	/** 활공 사냥 시전: 커서 방향으로 벌어지는 쐐기 + 소집 링 */
	diveHuntFX(x: number, y: number, angle: number): void {
		if (screenShakeEnabled()) {
			this.scene.cameras.main.shake(120, 0.004);
		}
		if (reduceMotion()) {
			return;
		}
		this.fxRing(x, y, { r0: 20, r1: 132, w: 4, color: 0xe8874a, alpha: 0.9, dur: 340 });
		this.fxRing(x, y, { r0: 150, r1: 44, w: 2, color: 0xfffdf5, alpha: 0.55, dash: 14, dur: 300 });
		for (const spread of [-0.34, 0, 0.34]) {
			const a = angle + spread;
			this.fxPoly(
				[x + Math.cos(a) * 34, y + Math.sin(a) * 34, x + Math.cos(a) * 152, y + Math.sin(a) * 152],
				{ layers: [[4, 0xe8874a, 0.75], [1.5, 0xffffff, 0.9]], dur: 300 },
			);
		}
	}

	/** 귀소 시전: 플레이어를 감싸는 보호 파문 (무적 창을 눈으로 알 수 있게) */
	recallFX(x: number, y: number, radius: number): void {
		if (screenShakeEnabled()) {
			this.scene.cameras.main.shake(140, 0.005);
		}
		if (reduceMotion()) {
			return;
		}
		this.fxRing(x, y, { r0: radius * 1.35, r1: 26, w: 5, color: 0x8fc3d8, alpha: 0.95, dur: 420 });
		this.fxRing(x, y, { r0: 18, r1: radius * 1.1, w: 2.5, color: 0xfffdf5, alpha: 0.6, dur: 380 });
		this.fxArc(x, y, { r: radius * 0.7, a0: 0, a1: Math.PI * 2, color: 0x8fc3d8, w: 3, alpha: 0.75, dur: 520, spin: 3 });
	}

	/** 귀소 완료: 홰 글린트 (작은 담금 청 다이아 반짝) */
	swordPerchFX(sword: OrbitSword): void {
		if (reduceMotion() || !sword?.active) {
			return;
		}
		this.fxDiamond(sword.x, sword.y, { r: 7, color: 0x8fc3d8, alpha: 0.9, dur: 200 });
	}

	/** 명중: 스파크 + 임팩트 링. 크리티컬은 더 크고 하얗게 터진다 — 전역 40ms 속도 제한 */
	hitSparkFX(x: number, y: number, tintNum = 0xe8c07a, isCrit = false): void {
		if (reduceMotion()) {
			return;
		}
		const now = this.scene.time.now;
		if (now - this.lastSparkAt < 40 * this.fxThrottle()) {
			return;
		}
		this.lastSparkAt = now;

		this.fxBurst(x, y, {
			count: isCrit ? 7 : 5, reach: isCrit ? 24 : 15,
			color: tintNum, w: isCrit ? 2.5 : 2, alpha: 0.95, dur: isCrit ? 190 : 150,
		});

		// 임팩트 링 — 타격 지점이 또렷하게 보인다
		this.fxRing(x, y, {
			r0: isCrit ? 8 : 6, r1: isCrit ? 27 : 13, w: isCrit ? 3 : 2,
			color: isCrit ? 0xffffff : tintNum, alpha: 0.9, dur: isCrit ? 240 : 170,
		});

		if (isCrit) {
			// 크리티컬 플래시 코어
			this.fxDot(x, y, { r: 10, color: 0xffffff, alpha: 0.85, scale1: 0.2, dur: 140 });
		}
	}

	// ---------------------------------------------------------------
	// 스페셜/필살기 발동 연출
	// ---------------------------------------------------------------

	private lastProcAt: Record<string, number> = {};

	/** 검 스페셜 발동 표시 (burn/poison/midas/execute/slow/blast) — 종류별 90ms 속도 제한 */
	specialProcFX(x: number, y: number, kind: 'burn' | 'poison' | 'midas' | 'execute' | 'slow' | 'blast' | 'leech'): void {
		if (reduceMotion()) {
			return;
		}
		const now = this.scene.time.now;
		if (now - (this.lastProcAt[kind] ?? 0) < 90 * this.fxThrottle()) {
			return;
		}
		this.lastProcAt[kind] = now;

		if (kind === 'burn' || kind === 'poison') {
			// 원소 입자가 피어오른다 (화염 주황 / 맹독 초록) + 발밑에 번지는 흔적
			const color = kind === 'burn' ? 0xf97316 : 0x4ade80;
			const bright = kind === 'burn' ? 0xffd27a : 0xbef264;
			for (let i = 0; i < 4; i += 1) {
				const px = x + (Math.random() - 0.5) * 22;
				this.fxDot(px, y + 6, {
					r: 2.5 + Math.random() * 2, color: i % 2 ? bright : color, alpha: 0.9, scale1: 0.4,
					dy: -32 - Math.random() * 16, dur: 380 + Math.random() * 160,
				});
			}
			this.fxRing(x, y + 8, { r0: 6, r1: 20, w: 1.5, color, alpha: 0.5, dur: 340 });
			return;
		}

		if (kind === 'midas') {
			// 금빛 반짝 다이아 + 십자 광채 + 튀어오르는 동전
			this.fxDiamond(x, y, { r: 9, color: 0xd9a83c, alpha: 0.95, dy: -14, dur: 320 });
			this.fxPoly([x - 15, y, x + 15, y], { layers: [[2, 0xffe9b3, 0.9]], dur: 320 });
			this.fxPoly([x, y - 15, x, y + 15], { layers: [[2, 0xffe9b3, 0.9]], dur: 320 });
			this.fxRing(x, y, { r0: 4, r1: 30, w: 2, color: 0xffe9b3, alpha: 0.8, dur: 300 });
			return;
		}

		if (kind === 'slow') {
			// 서리가 들러붙는다 — 수축 링 + 결정 조각 3개
			this.fxRing(x, y, { r0: 20, r1: 7, w: 2.5, color: 0x9fd8e8, alpha: 0.9, dur: 340 });
			for (let i = 0; i < 3; i += 1) {
				const a = (i / 3) * Math.PI * 2 + Math.random();
				this.fxDiamond(x + Math.cos(a) * 13, y + Math.sin(a) * 13, {
					r: 4.5, color: 0xdff3fa, alpha: 0.9, dur: 360,
				});
			}
			return;
		}

		if (kind === 'blast') {
			// 이중 충격파 + 사방 파편 (폭발 스프라이트는 EnemyManager가 재생)
			this.fxRing(x, y, { r0: 12, r1: 56, w: 3.5, color: 0xef6c33, alpha: 0.95, dur: 300 });
			this.fxRing(x, y, { r0: 30, r1: 74, w: 1.5, color: 0xffd27a, alpha: 0.6, dur: 380 });
			for (let i = 0; i < 6; i += 1) {
				const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
				this.fxDot(x, y, {
					r: 3, color: 0xffb066, alpha: 0.9, scale1: 0.2,
					dx: Math.cos(a) * 56, dy: Math.sin(a) * 56, dur: 320,
				});
			}
			return;
		}

		if (kind === 'leech') {
			// 흡혈: 붉은 방울이 위로 빨려 올라간다
			for (let i = 0; i < 4; i += 1) {
				const px = x + (Math.random() - 0.5) * 18;
				this.fxDot(px, y, {
					r: 2.5 + Math.random() * 1.5, color: 0xc9455a, alpha: 0.95, scale1: 0.5,
					dy: -37 - Math.random() * 14, dur: 340 + Math.random() * 140, ease: 'in',
				});
			}
			this.fxArc(x, y, { r: 16, a0: -0.4, a1: 1.4, color: 0xe0798a, w: 2, alpha: 0.8, dur: 300, spin: 4 });
			return;
		}

		// execute: 붉은 X 참격 (겹층) + 처형 링
		this.fxCross(x, y, { r: 18, w: 4, color: 0xd95f4d, alpha: 0.95, dur: 260 });
		this.fxCross(x, y, { r: 13, w: 1.5, color: 0xffffff, alpha: 0.95, dur: 260 });
		this.fxRing(x, y, { r0: 34, r1: 10, w: 2, color: 0xd95f4d, alpha: 0.8, dur: 280 });
	}

	// ---------------------------------------------------------------
	// 처치 연출 — 등급 3단 (2026-09-01 마감 품질 패스)
	//
	//   0 일반  기존 그대로. 초당 20~50회 터지므로 여기에 뭘 더 얹으면 안 된다.
	//   1 정예  등급색 파편 버스트 — "이건 좀 단단한 놈이었다"가 한눈에 읽힌다.
	//   2 보스  단계적 붕괴: 플래시 → 파편 → 충격 링.
	//           단계 경계는 히트스톱(bigKillMs = 50ms ≒ 3프레임)에 맞춰 둔다 —
	//           정지가 풀리는 순간 파편이 터져야 "끊고 나서 무너진다"로 읽힌다.
	//
	// 전부 공유 FX 레이어(fx*)만 쓴다. add.circle + 트윈 금지(핫패스 할당 금지).
	// 모션 줄이기에서는 등급 연출을 접고 일반 처치와 같은 점 하나만 남긴다.
	// ---------------------------------------------------------------

	/** 처치 등급 — 0 일반 · 1 정예(어픽스·정예·중간보스) · 2 보스 */
	enemyDeathFX(x: number, y: number, tier: 0 | 1 | 2, color = 0xffd166): void {
		const sizeMult = tier === 0 ? 1 : 3;

		// 공통 코어 — 기존 playDeathEffect 와 같은 점 (일반 처치의 유일한 연출)
		this.fxDot(x, y, {
			r: 10 * sizeMult, color: 0xffd166, alpha: 0.9, scale1: 2.5,
			dur: 180 + 80 * (sizeMult - 1),
		});

		if (tier === 0 || reduceMotion()) {
			return;
		}
		// 렉 중에는 등급 연출을 접는다 (프레임이 처진 위에 파편을 더 뿌리지 않는다)
		if (this.fxThrottle() >= 3) {
			return;
		}

		if (tier === 1) {
			// 어픽스 몹은 후반 라운드에 무더기로 죽는다 — 버스트가 겹쳐 화면이 타지 않게
			// 간격을 둔다 (막힌 프레임에서는 점 하나만 남고 조용히 넘어간다).
			const now = this.scene.time?.now ?? 0;
			if (now - this.lastEliteDeathAt < 90 * this.fxThrottle()) {
				return;
			}
			this.lastEliteDeathAt = now;
			this.eliteShardBurst(x, y, color);
			return;
		}
		this.bossCollapse(x, y, color);
	}

	/** 정예 처치 연출 간격 제한 */
	private lastEliteDeathAt = 0;

	/** 정예: 등급색 파편 버스트 (한 프레임 안에 전부 예약 — 타이머 없음) */
	private eliteShardBurst(x: number, y: number, color: number): void {
		this.fxBurst(x, y, { count: 10, reach: 54, color, w: 2.5, alpha: 0.9, dur: 320 });
		this.fxRing(x, y, { r0: 10, r1: 62, w: 3, color, alpha: 0.85, dur: 300 });
		this.fxRing(x, y, { r0: 78, r1: 26, w: 1.5, color: 0xfffdf5, alpha: 0.5, dash: 10, dur: 260 });
		// 등급색 파편 4조각 — 바깥으로 튀어 나가는 짧은 선분
		for (let i = 0; i < 4; i += 1) {
			const a = (i / 4) * Math.PI * 2 + 0.4;
			this.fxPoly(
				[x + Math.cos(a) * 16, y + Math.sin(a) * 16, x + Math.cos(a) * 52, y + Math.sin(a) * 52],
				{ layers: [[3, color, 0.75], [1, 0xffffff, 0.85]], dur: 300 },
			);
		}
	}

	/**
	 * 보스: 단계적 붕괴.
	 *   0ms   플래시 (히트스톱 3프레임 구간 — 화면이 멎은 채로 하얗게 뜬다)
	 *   50ms  파편 (정지가 풀리는 순간 — 조각이 사방으로)
	 *   210ms 충격 링 (여파가 바깥으로 번진다)
	 * 보스 처치는 런당 몇 번뿐이라 delayedCall 2개는 비용이 아니다.
	 */
	private bossCollapse(x: number, y: number, color: number): void {
		// ① 플래시
		this.fxDot(x, y, { r: 88, color: 0xfffdf5, alpha: 0.85, scale1: 0.2, dur: 130, ease: 'in' });
		this.fxRing(x, y, { r0: 6, r1: 96, w: 6, color: 0xfffdf5, alpha: 0.9, dur: 150 });

		const scene = this.scene;
		// ② 파편 — 히트스톱이 풀리는 순간
		scene.time.delayedCall(50, () => {
			if (!scene?.sys?.isActive?.()) {
				return;
			}
			this.fxBurst(x, y, { count: 18, reach: 150, color, w: 3.5, alpha: 0.9, dur: 460 });
			for (let i = 0; i < 8; i += 1) {
				const a = (i / 8) * Math.PI * 2 + 0.2;
				this.fxPoly(
					[x + Math.cos(a) * 34, y + Math.sin(a) * 34, x + Math.cos(a) * 132, y + Math.sin(a) * 132],
					{ layers: [[5, color, 0.7], [1.5, 0xffffff, 0.9]], dur: 420 },
				);
			}
		});

		// ③ 충격 링
		scene.time.delayedCall(210, () => {
			if (!scene?.sys?.isActive?.()) {
				return;
			}
			this.fxRing(x, y, { r0: 40, r1: 300, w: 7, color, alpha: 0.8, dur: 520 });
			this.fxRing(x, y, { r0: 20, r1: 220, w: 2, color: 0xfffdf5, alpha: 0.5, dash: 16, dur: 480 });
			this.fxArc(x, y, {
				r: 120, a0: 0, a1: Math.PI * 2, color, w: 3, alpha: 0.55, dur: 560, spin: 2,
			});
		});
	}

	// ---------------------------------------------------------------
	// 화면 가장자리 원소 비네트 — 필살기(SURGE) 발동 순간의 "화면이 물든다" 연출.
	// Graphics 한 장을 재사용하고, 알파 트윈 하나만 돈다 (오브젝트 생성 없음).
	// 히트스톱 설정과는 독립이고, 모션 줄이기에서는 생략한다.
	// ---------------------------------------------------------------

	/** 재사용 비네트 레이어 (필살기 발동 때만 만들어진다) */
	private vignetteG: Phaser.GameObjects.Graphics | null = null;
	private vignetteColor = -1;
	private vignetteW = 0;
	private vignetteH = 0;

	edgeVignettePulse(color: number, durationMs = 400, peakAlpha = 0.34): void {
		if (reduceMotion()) {
			return;
		}
		const camera = this.scene.cameras.main;
		const w = camera.width;
		const h = camera.height;

		if (!this.vignetteG) {
			this.vignetteG = this.scene.add.graphics().setScrollFactor(0).setDepth(92);
		}
		const g = this.vignetteG;
		// 색이나 화면 크기가 그대로면 다시 그리지 않는다
		if (this.vignetteColor !== color || this.vignetteW !== w || this.vignetteH !== h) {
			this.vignetteColor = color;
			this.vignetteW = w;
			this.vignetteH = h;
			const band = Math.round(Math.min(w, h) * 0.17);
			g.clear();
			// 위 · 아래 · 좌 · 우 네 방향에서 안쪽으로 사라지는 그라데이션 띠
			g.fillGradientStyle(color, color, color, color, 1, 1, 0, 0);
			g.fillRect(0, 0, w, band);
			g.fillGradientStyle(color, color, color, color, 0, 0, 1, 1);
			g.fillRect(0, h - band, w, band);
			g.fillGradientStyle(color, color, color, color, 1, 0, 1, 0);
			g.fillRect(0, 0, band, h);
			g.fillGradientStyle(color, color, color, color, 0, 1, 0, 1);
			g.fillRect(w - band, 0, band, h);
		}

		this.scene.tweens.killTweensOf(g);
		g.setVisible(true).setAlpha(0);
		this.scene.tweens.add({
			targets: g,
			alpha: { from: 0, to: peakAlpha },
			duration: Math.round(durationMs * 0.3),
			ease: 'Quad.easeOut',
			yoyo: true,
			hold: Math.round(durationMs * 0.1),
			onComplete: () => {
				g.setAlpha(0).setVisible(false);
			},
		});
	}

	/** 필살기 발동 콜아웃: 원소색 텍스트 + 화면 흔들림 */
	ultimateCalloutFX(element: UltimateElement, x: number, y: number): void {
		const names: Record<UltimateElement, [string, string, number]> = {
			fire: ['불꽃 필살기', '#f97316', 0.006],
			electric: ['번개 필살기', '#93c5fd', 0.004],
			void: ['공허 필살기', '#a78bda', 0.008],
			ice: ['서리 필살기', '#8fc3d8', 0.005],
			poison: ['독 필살기', '#84b04a', 0.004],
			gold: ['황금 필살기', '#d9a83c', 0.004],
			blood: ['핏빛 필살기', '#c9455a', 0.006],
			wind: ['바람 필살기', '#9fd8c0', 0.005],
		};
		const [label, color, shake] = names[element];
		this.skillCastFX(x, y, label, color, { shake, big: true });
	}

	/**
	 * 스킬 시전 연출 (2026-09-04 공용): 이름 콜아웃 + 시전 순간 정지 + 색 파문/수축 룬 링/방사 쐐기 +
	 * 화면 가장자리 물들기. 필살기·트리 능동 스킬이 같은 문법을 쓰되 big 으로 체급을 나눈다.
	 */
	skillCastFX(x: number, y: number, label: string, color: string, opts: { shake?: number; big?: boolean; spokes?: number } = {}): void {
		const tintNum = parseInt(color.replace('#', ''), 16);
		const big = opts.big ?? false;
		if (screenShakeEnabled() && (opts.shake ?? 0) > 0) {
			this.scene.cameras.main.shake(big ? 180 : 120, opts.shake!);
		}
		this.edgeVignettePulse(tintNum, big ? 400 : 260, big ? 0.34 : 0.18);
		if (reduceMotion()) {
			return;
		}
		const tint = tintNum;
		this.hitStop(big ? 60 : 35);
		// 시전 마법진 시트가 있으면 그것으로, 없으면 아래 도형 문법으로 (2026-09-05).
		// 이 한 갈래가 필살기 8종 + 트리 능동 21종의 시전 연출을 동시에 갈아끼운다.
		const circle = this.fxSprite('fx-cast-circle', x, y, {
			size: big ? 320 : 210, tint, additive: true, alpha: 0.95,
		});
		if (!circle) {
			this.fxDot(x, y, { r: big ? 34 : 22, color: tint, alpha: 0.5, scale1: 0.15, dur: 260, ease: 'in' });
			this.fxRing(x, y, { r0: 14, r1: big ? 150 : 96, w: big ? 5 : 4, color: tint, alpha: 0.95, dur: 420 });
			this.fxRing(x, y, { r0: big ? 210 : 140, r1: big ? 60 : 40, w: 2, color: 0xffffff, alpha: 0.65, dash: 12, dur: 380 });
			const spokes = opts.spokes ?? (big ? 10 : 8);
			for (let i = 0; i < spokes; i += 1) {
				const a = (i / spokes) * Math.PI * 2;
				const r0 = big ? 44 : 30;
				const r1 = big ? 104 : 72;
				this.fxPoly(
					[x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1],
					{ layers: [[big ? 4 : 3, tint, 0.7], [1.5, 0xffffff, 0.9]], dur: 300 },
				);
			}
		}

		const text = this.scene.add.text(x, y - 64, label, {
			fontFamily: FONT.display,
			resolution: TEXT_RESOLUTION,
			fontSize: big ? '20px' : '17px',
			fontStyle: '900',
			color,
			stroke: '#000000',
			strokeThickness: 4,
		}).setOrigin(0.5).setDepth(101).setAlpha(0);
		this.scene.tweens.add({
			targets: text,
			alpha: { from: 0, to: 1 },
			y: y - 84,
			scale: { from: 0.7, to: 1 },
			duration: 160,
			ease: 'Back.easeOut',
			onComplete: () => {
				this.scene.tweens.add({
					targets: text,
					alpha: 0,
					y: text.y - 18,
					delay: big ? 420 : 300,
					duration: 260,
					onComplete: () => text.destroy(),
				});
			},
		});
	}

	/** 낙뢰 한 줄기 — 하늘에서 내리꽂는 지그재그 + 착탄 플래시 (필살기 낙뢰와 같은 문법) */
	lightningFX(x: number, y: number, color = 0x93c5fd): void {
		if (reduceMotion()) {
			return;
		}
		// 낙뢰 기둥 시트 (필살기 낙뢰 · 트리 낙뢰 · 폭풍우 · 감전 연쇄가 전부 이 함수를 공유한다).
		// 시트는 하단 중앙에 착탄점이 있으므로 y 를 기둥 높이의 절반만큼 올려 배치한다.
		const BOLT_H = 300;
		if (!this.fxSprite('fx-bolt', x, y - BOLT_H / 2, {
			size: 120, height: BOLT_H, tint: color, additive: true,
		})) {
			const points: number[] = [];
			const steps = 6;
			for (let i = 0; i <= steps; i += 1) {
				const t = i / steps;
				points.push(x + (i === 0 || i === steps ? 0 : (Math.random() - 0.5) * 44), y - 300 + 300 * t);
			}
			this.fxPoly(points, { layers: [[7, 0x3b5f8f, 0.45], [3, color, 0.95], [1.2, 0xffffff, 0.95]], dur: 240 });
		}
		this.fxDot(x, y, { r: 16, color: 0xffffff, alpha: 0.9, scale1: 0.2, dur: 180 });
		this.fxRing(x, y, { r0: 12, r1: 40, w: 2.5, color, alpha: 0.9, dur: 300 });
		this.fxBurst(x, y, { count: 6, reach: 34, color, w: 2, alpha: 0.9, dur: 220 });
	}

	// ---------------------------------------------------------------
	// 업그레이드 선택 피드백 — "방금 뭐가 좋아졌는지" 눈에 보이게
	// ---------------------------------------------------------------

	/** 업그레이드 선택 직후: 플레이어 위 부스트 텍스트 + 스탯별 즉석 연출 */
	upgradeFeedbackFX(feedback: { type: string; name: string; rarityColor: string; desc: string }): void {
		const player = this.scene.player;
		if (!player) {
			return;
		}

		// 부스트 텍스트 (등급색 이름 + 효과 요약)
		const label = this.scene.add.text(player.x, player.y - 74, feedback.name, {
			fontFamily: FONT.display,
			resolution: TEXT_RESOLUTION,
			fontSize: '22px',
			fontStyle: '900',
			color: feedback.rarityColor,
			stroke: '#000000',
			strokeThickness: 4,
		}).setOrigin(0.5).setDepth(101);
		const sub = this.scene.add.text(player.x, player.y - 52, feedback.desc, {
			fontFamily: FONT.body,
			resolution: TEXT_RESOLUTION,
			fontSize: '14px',
			fontStyle: 'bold',
			color: '#e8eef2',
			stroke: '#000000',
			strokeThickness: 3,
		}).setOrigin(0.5).setDepth(101);
		this.scene.tweens.add({
			targets: [label, sub],
			y: '-=34',
			alpha: { from: 1, to: 0 },
			delay: 500,
			duration: 700,
			ease: 'Quad.easeOut',
			onComplete: () => { label.destroy(); sub.destroy(); },
		});

		if (reduceMotion()) {
			return;
		}

		const orbit = this.scene.swordOrbit;
		switch (feedback.type) {
			case 'damageMultiplier': {
				// 모든 검이 하얗게 번쩍
				for (const sword of orbit?.swords ?? []) {
					sword.setTintFill(0xffffff);
					this.fxRing(sword.x, sword.y, { r0: 10, r1: 20, w: 2, color: 0xd95f4d, alpha: 0.9, dur: 320 });
					this.scene.time.delayedCall(140, () => {
						if (!sword.active) return;
						sword.clearTint();
						if (sword.effect?.tint) {
							sword.setTint(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color);
						}
					});
				}
				break;
			}
			case 'cooldownReduction':
			case 'launchSpeedMultiplier': {
				// 검마다 파란 글린트 + 바깥 방향 스피드 라인
				for (const sword of orbit?.swords ?? []) {
					this.swordPerchFX(sword);
				}
				this.burstLines(player.x, player.y, 0x8fc3d8, 8, 46);
				break;
			}
			case 'orbitRadiusMultiplier': {
				// 궤도 링이 새 반경까지 펄스 확장 — 내부/외부 두 링 모두
				if (orbit) {
					this.orbitRingPulse(player.x, player.y, orbit.getInnerRingRadius(), 0x6fa7bd);
					if (orbit.hasOuterRingSwords()) {
						this.orbitRingPulse(player.x, player.y, orbit.getOuterRingRadius(), 0x6fa7bd);
					}
				}
				break;
			}
			case 'orbitSpeedMultiplier': {
				// 궤도 위를 도는 회전 아크 스윕 (외부 링이 차 있으면 그 링에서)
				if (orbit) {
					const sweepRadius = orbit.hasOuterRingSwords()
						? orbit.getOuterRingRadius()
						: orbit.getInnerRingRadius();
					this.orbitSweep(player, sweepRadius, 0x8fc3d8);
				}
				break;
			}
			case 'moveSpeedMultiplier': {
				this.burstLines(player.x, player.y, 0x9bc25b, 6, 40, Math.PI);
				break;
			}
			case 'magnetMultiplier': {
				const radius = this.scene.progression?.magnetRadius ?? 220;
				this.orbitRingPulse(player.x, player.y, radius, 0xd9a83c, true);
				break;
			}
			case 'critChanceAdd':
			case 'critDamageAdd': {
				this.hitSparkFX(player.x, player.y - 20, 0xd9a83c, true);
				break;
			}
			case 'maxHpFlat':
			case 'healPercent': {
				this.fxRing(player.x, player.y, { r0: 26, r1: 62, w: 2.5, color: 0x84b04a, alpha: 0.85, dur: 420 });
				// 십자 아이콘은 고스트 풀(Image 재사용)로 — 새 Image + 트윈을 만들지 않는다
				this.fxGhost('g-cross', undefined, player.x, player.y - 30, {
					displayW: 26, displayH: 26, tint: 0x84b04a, alpha: 1, depth: 101, dur: 520, scale1: 1, dy: -28,
				});
				break;
			}
			case 'luckAdd': {
				// graphics 5개 + 트윈 5개 → 마름모 FX 5개 (오브젝트 0)
				for (let i = 0; i < 5; i += 1) {
					const px = player.x + (Math.random() - 0.5) * 70;
					const py = player.y - 10 - Math.random() * 40;
					this.fxDiamond(px, py, { r: 5, color: 0xd9a83c, alpha: 0.95, dur: 420 + i * 60, dy: -18 });
				}
				break;
			}
			case 'bonusHits':
			case 'cleaveAdd': {
				// 참격 아크 2줄
				this.fxArc(player.x, player.y, { r: 44, a0: -0.6, a1: 1.2, color: 0xbae6fd, w: 3, alpha: 0.9, dur: 380 });
				this.fxArc(player.x, player.y, {
					r: 34, a0: Math.PI - 0.6, a1: Math.PI + 1.2, color: 0xffffff, w: 2, alpha: 0.8, dur: 380,
				});
				break;
			}
			default:
				break;
		}
	}

	/** 반경 시각화: 현재 반경까지 퍼지는 링 (dashed=획득 범위용 점선) */
	private orbitRingPulse(x: number, y: number, radius: number, color: number, dashed = false): void {
		// 예전엔 graphics + container + 중첩 트윈 2단이었다 → 공유 FX 레이어 링 하나로.
		// hold 0.42는 원본의 "300ms 확장 → 380ms 유지 → 320ms 페이드"를 근사한다.
		this.fxRing(x, y, {
			r0: radius * 0.35, r1: radius, w: dashed ? 2.5 : 3, color, alpha: 0.85,
			dur: 1000, ease: 'out', hold: 0.42, dash: dashed ? 28 : undefined,
		});
	}

	/** 궤도 위 회전 아크 — 회전 속도 업 체감용 */
	private orbitSweep(player: PlayerSprite, radius: number, color: number): void {
		// 예전엔 트윈 onUpdate에서 620ms 동안 매 프레임 g.clear() + arc 2회를 다시 그렸다.
		// FX 레이어의 spin 지원으로 엔트리 2개면 끝난다.
		this.fxArc(player.x, player.y, {
			r: radius, a0: 0, a1: 0.9, color, w: 4, alpha: 0.9, dur: 620, spin: Math.PI * 2.5, ease: 'out',
		});
		this.fxArc(player.x, player.y, {
			r: radius, a0: 0.55, a1: 0.9, color: 0xffffff, w: 2, alpha: 0.7, dur: 620, spin: Math.PI * 2.5, ease: 'out',
		});
	}

	/** 방사형 스피드 라인 (baseAngle 지정 시 그 방향 반원만) */
	private burstLines(x: number, y: number, color: number, count: number, reach: number, baseAngle?: number): void {
		for (let i = 0; i < count; i += 1) {
			const a = baseAngle !== undefined
				? baseAngle + (i / (count - 1) - 0.5) * 1.6
				: (i / count) * Math.PI * 2;
			this.fxPoly(
				[x + Math.cos(a) * 14, y + Math.sin(a) * 14, x + Math.cos(a) * reach, y + Math.sin(a) * reach],
				{ layers: [[2.5, color, 0.9]], dur: 340 },
			);
		}
	}

	/**
	 * 타격 순간의 짧은 정지 (히트스톱) — 처치·치명타·보스 피격의 무게를 만든다.
	 *
	 * physics.pause() 는 쓰지 않는다. 과거 "재시작 프리즈"의 원인이 pause/resume 레이스였다
	 * (복구 타이머가 씬 전환에 먹히면 월드가 영원히 멈춘 채로 남는다). 대신 **시간 배율만**
	 * 늦추므로 최악의 경우에도 게임은 느리게나마 계속 돌고, GameScene.update 의 감시자가
	 * 다음 프레임에 배율을 되돌린다.
	 *
	 * 연속 발동은 minGapMs 로 막는다 — 30라 이후 초당 수십 처치에서 화면이 계속 끊기면
	 * 타격감이 아니라 렉으로 읽힌다. force 는 대형 처치/조합처럼 드문 사건 전용.
	 */
	hitStop(durationMs = 50, opts: { force?: boolean } = {}): void {
		const scene = this.scene;

		if (!hitStopEnabled()) {
			return;
		}
		if (this.hitStopActive || scene.isGameOver || scene.levelUpSystem?.isOpen || scene.player?.isDead || scene.isPaused || scene.shopSystem?.isOpen) {
			return;
		}

		const now = scene.time.now;
		if (!opts.force) {
			if (now - this.lastHitStopAt < HIT_STOP.minGapMs) {
				return;
			}
			// 프레임이 이미 처져 있으면 연출을 접는다 (렉 위에 정지를 얹지 않는다)
			if (this.fxThrottle() >= 3) {
				return;
			}
		}

		const duration = Math.min(HIT_STOP.maxMs, Math.max(8, durationMs));
		this.lastHitStopAt = now;
		this.hitStopActive = true;
		this.hitStopUntil = now + duration;
		// Arcade 는 timeScale 이 클수록 스텝 간격이 길어진다(= 느려진다).
		// 트윈·스프라이트 애니메이션은 반대로 배율이 작을수록 느리다.
		scene.physics.world.timeScale = HIT_STOP.slowFactor;
		scene.tweens.timeScale = 1 / HIT_STOP.slowFactor;
		scene.anims.globalTimeScale = 1 / HIT_STOP.slowFactor;
		// scene.time 은 건드리지 않는다 — 이 복구 타이머 자신이 느려지면 안 된다.
		scene.time.delayedCall(duration, () => this.releaseHitStop());
	}

	/** 히트스톱 해제 — 어떤 상황에서 불려도 시간 배율을 1로 되돌린다 (조건 없음). */
	releaseHitStop(): void {
		const scene = this.scene;
		this.hitStopActive = false;
		this.hitStopUntil = 0;
		if (!scene?.physics?.world) {
			return;
		}
		scene.physics.world.timeScale = 1;
		scene.tweens.timeScale = 1;
		scene.anims.globalTimeScale = 1;
		// 정지 동안 쌓인 누적 delta 를 버린다 — 안 버리면 복구 프레임에 밀린 스텝이
		// 한꺼번에 돌아 적이 순간이동한다 (Arcade World._elapsed 의 catch-up).
		(scene.physics.world as unknown as { _elapsed: number })._elapsed = 0;
	}

	/**
	 * 프레임마다 도는 감시자 (GameScene.update).
	 * 복구 타이머를 놓쳤거나(씬 전환·일시정지) 배율이 남아 있으면 즉시 되돌린다.
	 */
	syncHitStop(now: number): void {
		if (this.hitStopActive) {
			if (now >= this.hitStopUntil) {
				this.releaseHitStop();
			}
			return;
		}
		if (this.scene?.physics?.world && this.scene.physics.world.timeScale !== 1) {
			this.releaseHitStop();
		}
	}

	// White flash on hit, restoring the sprite's variant tint afterwards.
	// 이미 플래시 중이면 스킵 → 다중 타격 시 delayedCall 누적 방지 (성능)
	flashSprite(sprite: EnemySprite, durationMs = 70): void {
		if (!sprite || sprite.destroyed) {
			return;
		}

		const now = this.scene.time.now;
		if (now < (sprite.flashUntil ?? 0)) {
			return;
		}
		sprite.flashUntil = now + durationMs;

		sprite.setTintFill(0xffffff);

		this.scene.time.delayedCall(durationMs, () => {
			if (!sprite || sprite.destroyed || !sprite.active) {
				return;
			}

			// 색 복구는 StatusEffectSystem 이 단일 진실원이다.
			// (예전에는 여기서 catalog.tint 만 되살려서, `color` 만 있는 적과 어픽스 몹이
			//  화상 한 번 맞으면 원래 색을 잃고 무채색으로 남았다. 상태이상 틴트도 날아갔다.)
			const status = this.scene.statusEffects;
			if (status) {
				status.refreshTint(sprite);
				return;
			}
			sprite.clearTint();
			const tint = sprite.catalog?.tint;
			if (tint) {
				sprite.setTint(Phaser.Display.Color.HexStringToColor(tint).color);
			}
		});
	}

	/**
	 * 적 체력바 일괄 렌더: 적마다 Rectangle 2개(생성/갱신/파괴) 대신
	 * Graphics 하나에 매 프레임 전부 다시 그린다. 체력이 가득한 적과
	 * 화면 밖 적은 건너뛴다. (30라+ 렉 해소 핵심)
	 */
	drawEnemyHealthBars(enemies: Phaser.Physics.Arcade.Group | null | undefined): void {
		if (!this.enemyBarsG) {
			this.enemyBarsG = this.scene.add.graphics().setDepth(59);
		}
		const g = this.enemyBarsG;
		g.clear();
		if (!enemies) {
			return;
		}

		const camera = this.scene.cameras.main;
		const left = camera.scrollX - 40;
		const right = camera.scrollX + camera.width + 40;
		const top = camera.scrollY - 40;
		const bottom = camera.scrollY + camera.height + 40;

		for (const child of enemies.getChildren() as EnemySprite[]) {
			if (!child || !child.active || !child.visible || child.isDying) {
				continue;
			}
			// 보스는 화면 상단 대형 바(BossBarSystem)가 담당 — 머리 위 소형 바는 생략
			if (child.catalog?.isBoss) {
				continue;
			}
			const maxHp = child.maxHp ?? 0;
			const hp = Math.max(0, child.hp ?? 0);
			// 무피해(풀피) 잡몹은 바를 그리지 않는다 — 중간보스/정예는 항상 표시
			const isBig = Boolean(child.catalog?.isMiniboss || child.catalog?.isElite);
			if (maxHp <= 0 || (!isBig && hp >= maxHp)) {
				continue;
			}
			if (child.x < left || child.x > right || child.y < top || child.y > bottom) {
				continue;
			}

			const width = child.healthBarWidth ?? 40;
			const ratio = Math.max(0, Math.min(1, hp / maxHp));
			const barX = child.x - width / 2;
			const barY = child.y - 35;

			g.fillStyle(0x000000, 0.85);
			g.fillRect(barX - 1, barY - 1, width + 2, 8);
			const color = ratio > 0.5 ? 0x84b04a : ratio > 0.25 ? 0xd9a83c : 0xd95f4d;
			g.fillStyle(color, 1);
			g.fillRect(barX, barY, width * ratio, 6);

			// 실드(어픽스) 잔여 표시: 바 위 청색 점
			if ((child.shieldHits ?? 0) > 0) {
				g.fillStyle(0x38bdf8, 1);
				for (let i = 0; i < Math.min(child.shieldHits!, 6); i += 1) {
					g.fillRect(barX + i * 7, barY - 5, 5, 3);
				}
			}
		}
	}

	// Create or update health bar above an entity
	updateHealthBar(entity: HealthBarEntity, maxHp: number, currentHp: number, width = 40, height = 6): HealthBar | null {
		if (!entity || maxHp <= 0) {
			return null;
		}

		let barContainer = this.healthBars.get(entity);

		if (!barContainer) {
			// Create new health bar
			barContainer = {
				background: this.scene.add.rectangle(entity.x, entity.y - 35, width + 2, height + 2, 0x000000),
				bar: this.scene.add.rectangle(entity.x, entity.y - 35, width, height, 0x00ff00),
				entity: entity,
			};
			barContainer.background.setOrigin(0.5, 0.5);
			barContainer.bar.setOrigin(0.5, 0.5);
			barContainer.background.setDepth(entity.depth + 1);
			barContainer.bar.setDepth(entity.depth + 1);
			this.healthBars.set(entity, barContainer);
		}

		// 위치는 매 프레임 따라가야 하지만, 크기/색은 체력이 변할 때만 건드린다.
		// (setDisplaySize/setFillStyle은 값이 같아도 지오메트리를 dirty로 만든다 —
		//  이 함수는 GameScene.update에서 프레임마다 호출된다.)
		barContainer.background.setPosition(entity.x, entity.y - 35);
		barContainer.bar.setPosition(entity.x, entity.y - 35);

		const hpPercent = Math.max(0, Math.min(1, currentHp / maxHp));
		if (barContainer.lastPercent !== hpPercent || barContainer.lastWidth !== width) {
			barContainer.lastPercent = hpPercent;
			barContainer.lastWidth = width;
			barContainer.bar.setDisplaySize(width * hpPercent, height);

			// Change color based on HP (팔레트: 삭임 그린 → 짚쇠 → 잉걸 레드)
			const color = hpPercent > 0.5 ? 0x84b04a : hpPercent > 0.25 ? 0xd9a83c : 0xd95f4d;
			if (barContainer.lastColor !== color) {
				barContainer.lastColor = color;
				barContainer.bar.setFillStyle(color);
			}
		}

		return barContainer;
	}

	// Remove health bar
	removeHealthBar(entity: HealthBarEntity): void {
		if (!entity) return;
		const bar = this.healthBars.get(entity);
		if (bar) {
			if (bar.background && !bar.background.destroyed) {
				bar.background.destroy();
			}
			if (bar.bar && !bar.bar.destroyed) {
				bar.bar.destroy();
			}
			this.healthBars.delete(entity);
		}
	}

	// Show floating damage text — pooled + budgeted.
	// Text 객체는 개당 캔버스 텍스처를 갖는 고비용 오브젝트라, 후반(30라+)의
	// 초당 수백 타격이 렉의 최대 원인이었다. 풀 재사용 + 동시 상한으로 해결.
	showDamageText(x: number, y: number, damage: number | string, isCrit = false, colorOverride: string | null = null): void {
		// 화면 밖 피해는 표시하지 않는다 (오프스크린 타격 다수)
		const camera = this.scene.cameras.main;
		if (x < camera.scrollX - 60 || x > camera.scrollX + camera.width + 60
			|| y < camera.scrollY - 60 || y > camera.scrollY + camera.height + 60) {
			return;
		}

		// 예산 초과 시: 치명타/특수 텍스트만 통과, 일반 타격 텍스트는 생략
		// (프레임이 처질수록 예산 축소 — 적응형)
		const throttle = this.fxThrottle();
		const budget = throttle === 1 ? DAMAGE_TEXT_BUDGET : throttle === 2 ? 16 : 8;
		if (this.activeTextCount >= budget && !isCrit && !colorOverride) {
			return;
		}
		if (this.activeTextCount >= DAMAGE_TEXT_POOL_MAX) {
			return;
		}

		// 색 규칙: 물리=회백, 마법=담금 청(override), 고정=짚쇠(override), 치명타=짚쇠+크게
		//
		// 예전에는 풀에서 꺼낸 텍스트마다 setFontSize + setColor를 불렀는데, Phaser의
		// setColor는 값이 같아도 캔버스를 다시 굽고(canvasToTexture GPU 업로드),
		// setFontSize는 값이 바뀌면 MeasureText(getImageData 전체 스캔)까지 돌린다.
		// → 크기별로 풀을 나눠 폰트는 생성 시 1회만 정하고, 색은 텍스처 재생성이 없는
		//   setTint로 바꾼다. 재사용 시 남는 비용은 setText(값 변경 시에만 재굽기)뿐.
		const color = colorOverride ?? (isCrit ? '#d9a83c' : '#e8eef2');
		// 큰 수는 M/B 로 축약 (logic/growth.formatBigNumber) — 글리프에 K/M/B/. 가 있다
		const label = `${typeof damage === 'number' ? formatBigNumber(damage) : damage}${isCrit ? '!' : ''}`;

		// 숫자·기호는 비트맵 폰트로 그린다.
		// Phaser의 Text는 객체마다 캔버스 텍스처를 갖는데, 라운드 35 화면에서 고유 텍스처
		// 33개 중 17개가 Text 였다 (Phaser 동시 바인딩 한도는 16). BitmapText는 폰트
		// 텍스처 한 장에서 글리프 쿼드만 뽑으므로 텍스처가 1개로 줄고 재굽기도 없다.
		// 한글 라벨(회피/방어/처형!)만 아래의 기존 Text 경로로 떨어진다.
		if (isDamageFontText(label) && hasDamageFontColor(color)) {
			this.showDamageBitmapText(label, x, y, isCrit, color);
			return;
		}

		// 풀 키 = 폰트 크기 + 색. (setTint를 쓰지 않는 이유: Phaser.AUTO가 Canvas로
		// 폴백하면 Text의 tint가 무시돼 색이 전부 흰색이 된다.)
		const poolKey = isCrit ? `c${color}` : `n${color}`;
		let pool = this.textPools.get(poolKey);
		if (!pool) {
			pool = [];
			this.textPools.set(poolKey, pool);
		}

		let text = pool.pop();
		if (!text) {
			text = this.scene.add.text(0, 0, '', {
				fontFamily: FONT.display,
				// 부유 전투 텍스트는 큰 볼드체라 해상도를 낮춰도 티가 나지 않는다.
				// resolution 3이면 캔버스 픽셀이 9배 → 재굽기/업로드 비용도 9배였다.
				resolution: DAMAGE_TEXT_RESOLUTION,
				fontSize: isCrit ? '34px' : '24px',
				fontStyle: '700',
				color,
				stroke: '#000000',
				strokeThickness: 3,
				align: 'center',
			});
			text.setOrigin(0.5, 0.5);
			text.setDepth(100);
			text.setScale(isCrit ? 1.3 : 1.0);
		}

		text.setActive(true).setVisible(true);
		text.setPosition(x, y);
		text.setAlpha(1);
		// 재사용 시 남는 비용은 setText뿐 — 값이 같으면 Phaser가 재굽기를 건너뛴다.
		text.setText(label);
		this.activeTextCount += 1;

		// 트윈 대신 FX 레이어와 같은 방식의 수동 보간 (동시 28개 트윈 → 0)
		this.floatingTexts.push({
			text, poolKey, t0: this.scene.time.now, dur: isCrit ? 1000 : 700, x, y0: y,
		});
	}

	/**
	 * 지속 피해(화상·중독·출혈·역병) 틱 숫자 — 작게, 상태이상 색으로.
	 *
	 * 일반 타격 텍스트와 **예산을 나눠 쓴다**. 예전에는 DoT 틱이 통째로 silent 라
	 * 숫자가 아예 안 떠서 "지금 타고 있는지"가 화면에서 읽히지 않았는데, 그렇다고
	 * 일반 경로로 보내면 적 150마리 × 초당 2틱이 텍스트 예산을 포화시킨다.
	 * → 자체 상한 + 전역 간격 제한을 걸고, 프레임이 처지면 먼저 사라진다.
	 */
	showStatusDamageText(x: number, y: number, amount: number, kind: StatusKind): void {
		const color = STATUS_STYLE[kind].text;
		if (!color || amount <= 0) {
			return;
		}
		const throttle = this.fxThrottle();
		if (throttle >= 3) {
			return; // 프레임이 심각하게 처지면 지속 피해 숫자부터 버린다
		}
		if (this.activeTextCount >= (throttle === 1 ? STATUS_TEXT_BUDGET : 6)) {
			return;
		}
		const now = this.scene.time.now;
		if (now - this.lastStatusTextAt < 45 * throttle) {
			return;
		}
		const camera = this.scene.cameras.main;
		if (x < camera.scrollX - 40 || x > camera.scrollX + camera.width + 40
			|| y < camera.scrollY - 40 || y > camera.scrollY + camera.height + 40) {
			return;
		}
		this.lastStatusTextAt = now;
		// 같은 자리에 겹쳐 뜨지 않도록 좌우로 흩는다
		this.showDamageBitmapText(formatBigNumber(amount), x + (Math.random() - 0.5) * 18, y,
			false, color, STATUS_TEXT_PX);
	}

	/**
	 * 숫자 데미지를 비트맵 폰트로 띄운다. 색상별 폰트가 텍스처 한 장을 공유하므로
	 * 화면에 몇 개가 떠 있든 텍스처 유닛은 1개만 쓴다.
	 * 치명타는 별도 폰트 없이 setScale 로 키운다 — 비트맵이라 확대에 비용이 없다.
	 */
	private showDamageBitmapText(label: string, x: number, y: number, isCrit: boolean, color: string,
		pxOverride?: number): void {
		const fontKey = damageFontKey(color);
		let pool = this.bitmapPools.get(fontKey);
		if (!pool) {
			pool = [];
			this.bitmapPools.set(fontKey, pool);
		}

		// 메이플식 연출 (2026-09-04):
		//  - 일반: 문자열 하나가 1.45배에서 튀어나와 제자리로 "팝" + 위로 뜨며 사라짐
		//  - 치명타: 자리수마다 글리프를 따로 띄워 40ms 간격으로 통통 튀며 나타남(캐스케이드),
		//    더 크고(48px) 주황 그라데이션, 착탄 링
		// 크기·자간 (2026-09-04 사용자 피드백: 숫자는 더 크게, 숫자 사이는 더 좁게)
		const targetPx = pxOverride ?? (isCrit ? DAMAGE_TEXT_CRIT_PX : DAMAGE_TEXT_PX);
		const scale = targetPx / DAMAGE_FONT_GLYPH_PX;
		// 캐스케이드는 예산에 여유가 있을 때만 (자리수만큼 BitmapText 를 쓴다)
		const cascade = isCrit && label.length > 1 && label.length <= 9 && !reduceMotion()
			&& this.activeTextCount < 20 && this.fxThrottle() <= 2;
		const pieces = cascade ? [...label] : [label];
		// 자간: 셀 폭의 일부를 음수로 — 외곽선이 살짝 겹치는 메이플식 밀착 (폰트 원 픽셀 단위)
		const spacing = -Math.round(damageFontCellWidth() * DAMAGE_TEXT_LETTER_SPACING);
		const cell = damageFontCellWidth() + spacing;
		const totalW = cascade ? cell * pieces.length : 0;
		const parts: Phaser.GameObjects.BitmapText[] = [];
		const offsets: number[] = [];

		for (let i = 0; i < pieces.length; i += 1) {
			let bmp = pool.pop();
			if (!bmp) {
				bmp = this.scene.add.bitmapText(0, 0, fontKey, '');
				bmp.setOrigin(0.5, 0.5);
				bmp.setDepth(100);
			}
			bmp.setScale(scale);
			bmp.setLetterSpacing(spacing);
			bmp.setActive(true).setVisible(true);
			bmp.setAlpha(cascade ? 0 : 1);
			bmp.setText(pieces[i]);
			// 캐스케이드: 자리수를 가로로 나란히 (스케일 전 좌표 — 업데이트에서 scale 을 곱한다)
			const off = cascade ? (i + 0.5) * cell - totalW / 2 : 0;
			offsets.push(off);
			bmp.setPosition(x + off * scale, y);
			parts.push(bmp);
		}
		this.activeTextCount += 1;

		this.floatingBitmaps.push({
			parts, fontKey, t0: this.scene.time.now, dur: isCrit ? 1100 : 750,
			x0: x, y0: y, scale, drift: (Math.random() - 0.5) * 28,
			stagger: cascade ? 40 : 0, offsets, isCrit,
		});

		if (isCrit && !reduceMotion()) {
			// 착탄 링 — 치명타 숫자 뒤에서 번쩍 (FX 레이어, 객체 생성 없음)
			this.fxRing(x, y + 6, { r0: 10, r1: 34, w: 3, color: 0xffb04a, alpha: 0.9, dur: 240 });
		}
	}

	/** 부유 텍스트 보간/회수 — updateFxLayer에서 매 프레임 호출 */
	private updateFloatingTexts(now: number): void {
		for (let i = this.floatingTexts.length - 1; i >= 0; i -= 1) {
			const entry = this.floatingTexts[i];
			const p = (now - entry.t0) / entry.dur;
			if (p >= 1) {
				this.releaseDamageText(entry.text, entry.poolKey);
				this.floatingTexts.splice(i, 1);
				continue;
			}
			const q = 1 - (1 - p) * (1 - p); // Quad.easeOut — 기존 트윈과 동일
			entry.text.setY(entry.y0 - 60 * q);
			entry.text.setAlpha(1 - q);
		}

		for (let i = this.floatingBitmaps.length - 1; i >= 0; i -= 1) {
			const entry = this.floatingBitmaps[i];
			const elapsed = now - entry.t0;
			const totalDur = entry.dur + entry.stagger * (entry.parts.length - 1);
			const p = elapsed / totalDur;
			if (p >= 1) {
				this.activeTextCount = Math.max(0, this.activeTextCount - 1);
				const pool = this.bitmapPools.get(entry.fontKey);
				for (const bmp of entry.parts) {
					bmp.setActive(false).setVisible(false);
					if (pool && pool.length < DAMAGE_TEXT_POOL_MAX) {
						pool.push(bmp);
					} else {
						bmp.destroy();
					}
				}
				this.floatingBitmaps.splice(i, 1);
				continue;
			}
			// 전체 상승/페이드: Quad.easeOut 으로 뜨고, 뒤 45% 구간에서 사라진다
			const q = 1 - (1 - p) * (1 - p);
			const rise = (entry.isCrit ? 84 : 66) * q;
			const alpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
			const drift = entry.drift * q;
			const popMs = entry.isCrit ? 200 : 150;
			for (let k = 0; k < entry.parts.length; k += 1) {
				const bmp = entry.parts[k];
				const local = elapsed - entry.stagger * k;
				if (local < 0) {
					continue; // 아직 등장 전 (alpha 0 으로 숨겨 둠)
				}
				// 등장 팝: 1.5배 → 1.0 (Back.easeOut 근사), 캐스케이드는 위로 한 번 통통
				const t = Math.min(1, local / popMs);
				const back = 1 + 2.2 * (t - 1) * (t - 1) * (t - 1) + 1.2 * (t - 1) * (t - 1); // 오버슈트 후 안착
				const pop = entry.isCrit ? 1.55 : 1.4;
				const sc = entry.scale * (1 + (pop - 1) * (1 - back));
				const hop = entry.stagger > 0 ? -16 * Math.sin(Math.PI * t) : 0;
				bmp.setScale(sc);
				bmp.setPosition(entry.x0 + drift + entry.offsets[k] * entry.scale, entry.y0 - rise + hop);
				bmp.setAlpha(alpha);
			}
		}
	}

	private releaseDamageText(text: Phaser.GameObjects.Text, poolKey: string): void {
		this.activeTextCount = Math.max(0, this.activeTextCount - 1);
		const pool = this.textPools.get(poolKey);
		if (!pool || pool.length >= DAMAGE_TEXT_POOL_MAX) {
			text.destroy();
			return;
		}
		text.setActive(false).setVisible(false);
		pool.push(text);
	}

	// Clean up all health bars
	destroy(): void {
		for (const [entity, bar] of this.healthBars) {
			bar.background.destroy();
			bar.bar.destroy();
		}
		this.healthBars.clear();
		this.enemyBarsG?.destroy();
		this.enemyBarsG = null;
		for (const entry of this.floatingTexts) {
			entry.text.destroy();
		}
		this.floatingTexts = [];
		for (const pool of this.textPools.values()) {
			for (const text of pool) {
				text.destroy();
			}
		}
		this.textPools.clear();
		for (const entry of this.floatingBitmaps) {
			for (const bmp of entry.parts) {
				bmp.destroy();
			}
		}
		this.floatingBitmaps = [];
		for (const pool of this.bitmapPools.values()) {
			for (const bmp of pool) {
				bmp.destroy();
			}
		}
		this.bitmapPools.clear();
		this.activeTextCount = 0;
		this.fxG?.destroy();
		this.fxG = null;
		this.fxEntries = [];
		if (this.vignetteG) {
			this.scene.tweens.killTweensOf(this.vignetteG);
			this.vignetteG.destroy();
			this.vignetteG = null;
		}
		for (const gh of this.ghosts) {
			gh.img.destroy();
		}
		this.ghosts = [];
		for (const img of this.ghostPool) {
			img.destroy();
		}
		this.ghostPool = [];
		this.attached = [];
		for (const s of this.fxSprites) {
			s.removeAllListeners();
			s.destroy();
		}
		this.fxSprites = [];
		this.fxSpriteCursor = 0;
	}
}
