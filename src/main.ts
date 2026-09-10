import Phaser from 'phaser';
// 디스플레이 Jua · 본문 Gowun Dodum (index.html 에서 로드, 오프라인은 시스템 폰트 폴백).
import GameScene from './scenes/GameScene';
import TitleScene from './scenes/TitleScene';
import PowerUpScene from './scenes/PowerUpScene';
import CodexScene from './scenes/CodexScene';
import CharacterSelectScene from './scenes/CharacterSelectScene';
import SoundSystem from './systems/SoundSystem';
import { BGM_TRACKS, BGM_LAYER_NAMES, bgmKey } from './systems/BgmSystem';
import { ensureGlyphs, FLAT_UI_TEXTURES, SKILLBOOK_ICON_KEY, SKILLBOOK_TEXTURES, TITLE_UI_TEXTURES } from './ui/theme';
import { ensureDamageFont } from './ui/damageFont';
import { ENEMY_ATLAS, DECO_ATLAS } from './core/textures';
import { AURA_SHEETS } from './logic/auraSheets';
import { FX_SHEETS } from './logic/fxSheets';
import { MAP_THEMES } from './logic/mapThemes';
import playerCatalogRaw from './data/playerCatalog.json';
import enemyCatalogRaw from './data/enemyCatalog.json';
import type { PlayerDefinition, EnemyDefinition, EnemySpritesheetSpec } from './types/catalogs';

const playerCatalog = playerCatalogRaw as unknown as PlayerDefinition[];
const enemyCatalog = enemyCatalogRaw as unknown as EnemyDefinition[];

// 'separate'-type enemies keep per-animation frame data directly on each sheet
// entry; EnemySpritesheetSpec in types/catalogs.ts does not declare those
// fields, so extend it locally here.
interface SeparateSpritesheetSpec extends EnemySpritesheetSpec {
	frameStart: number;
	frameCount?: number;
	frameEnd?: number;
	frameRate: number;
	repeat: number;
}

const defaultPlayer = playerCatalog[0];

/** index.html 의 HTML 로딩 화면 — Phaser 부팅 전부터 보이고, BootScene 이 채우고 지운다. */
const htmlLoader = {
	progress(value: number, message?: string) {
		const bar = document.getElementById('loader-bar');
		if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
		const msg = document.getElementById('loader-msg');
		if (msg && message) msg.textContent = message;
	},
	dismiss() {
		const el = document.getElementById('loader');
		if (!el) return;
		el.classList.add('done');
		// transition(0.35s) 이 끝난 뒤 DOM 에서 제거 — 남겨 두면 투명해도 레이어가 하나 더 있다
		window.setTimeout(() => el.remove(), 450);
	},
};

class BootScene extends Phaser.Scene {
	constructor() {
		super('BootScene');
	}

	preload() {
		// HTML 로딩 바에 진행률 반영. 번들 다운로드 구간(0%)은 브라우저가 이미 보여줬고,
		// 여기서부터가 에셋 로드 구간이다.
		htmlLoader.progress(0, '검떼를 깨우는 중…');
		this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
			htmlLoader.progress(value);
		});
		this.load.once(Phaser.Loader.Events.COMPLETE, () => {
			htmlLoader.progress(1, '궤도에 올리는 중…');
		});

		// 6개 Swordtember 시트를 세로로 합친 통합 시트 (192×960, 32px 프레임 180개)
		this.load.spritesheet('sword', 'assets/swords.png', {
			frameWidth: 32,
			frameHeight: 32,
		});

		// UI 비트맵 (Complete UI Essential Pack Flat — public/ui/flat/, 원본 그대로)
		for (const [key, file] of FLAT_UI_TEXTURES) {
			this.load.image(key, `ui/flat/${file}`);
		}

		// 스킬 책(K 창) 전용 매끈한 UI — public/ui/skillbook/ (NEAREST 를 걸지 않는다)
		for (const [key, file] of SKILLBOOK_TEXTURES) {
			this.load.image(key, `ui/skillbook/${file}`);
		}
		this.load.spritesheet(SKILLBOOK_ICON_KEY, 'ui/skillbook/sb-icons.png', {
			frameWidth: 64,
			frameHeight: 64,
		});

		// 타이틀 배경 일러스트 (1672×941). webp 로 굽는 이유는 무게 —
		// 같은 그림이 png 면 0.9~1.7MB 라 첫 로딩을 눈에 띄게 늦춘다(webp 160KB).
		// 혹시 못 읽는 브라우저가 있어도 TitleScene 이 textures.exists 로 확인해
		// 예전 절차적 배경으로 조용히 내려가므로 화면이 깨지지 않는다.
		this.load.image('title-bg', 'ui/title-bg.webp');

		// 타이틀 UI — 목업에서 직접 오려 낸 텍스처 (scripts/slice-title-ui.py)
		for (const [key, file] of TITLE_UI_TEXTURES) {
			this.load.image(key, `ui/title/${file}`);
		}

		const queuedPlayerKeys = new Set<string>();
		for (const player of playerCatalog) {
			for (const sheet of Object.values(player.spritesheets)) {
				if (queuedPlayerKeys.has(sheet.textureKey)) {
					continue;
				}
				queuedPlayerKeys.add(sheet.textureKey);
				this.load.spritesheet(sheet.textureKey, sheet.filePath, {
					frameWidth: sheet.frameWidth,
					frameHeight: sheet.frameHeight,
				});
			}
		}

		// 적 스프라이트: 시트 25장을 아틀라스 한 장으로 (scripts/build-atlas.mjs 산출물).
		// 적은 전부 depth 1이라 화면에서 종류가 섞이는데, 텍스처가 흩어져 있으면
		// 스프라이트마다 WebGL 배치가 flush되어 draw call이 폭증한다. 한 장이면 1~2회로 끝난다.
		// 프레임 이름은 `${textureKey}/${index}` — 기존 프레임 번호와 1:1 대응.
		this.load.atlas(ENEMY_ATLAS, 'atlas/enemies.png', 'atlas/enemies.json');
		// 지형 장식(나무/덤불/바위/금덩이) 18장도 같은 이유로 한 장에 담는다.
		this.load.atlas(DECO_ATLAS, 'atlas/deco.png', 'atlas/deco.json');

		this.load.image('mapTileset', 'map/mapTileset.png');

		// Tiny Swords 지형 타일셋 (64px, 색상 5종 — 바닥 패치 변주용)
		for (let i = 1; i <= 5; i += 1) {
			this.load.image(`ts-tiles${i}`, `map/tinysword_tiles${i}.png`);
		}

		// 맵 테마 바닥 스트립 (테마당 타일 1종, scripts/generate-theme-assets.py 산출물)
		this.load.image('ts-themes', 'map/themes64.png');
		// 테마 전용 장식 (deco2/<theme>-<n>.png → 키 deco2-<theme>-<n>)
		for (const theme of MAP_THEMES) {
			for (const deco of theme.decos ?? []) {
				this.load.image(deco.key, `deco2/${deco.key.replace('deco2-', '')}.png`);
			}
		}

		// 대기마을 프롭·게이트·NPC (assets-src 라이브러리 → generate-theme-assets.py)
		for (const name of ['fountain', 'pillar', 'block', 'slab', 'altar', 'chalice', 'campfire', 'sign', 'sign2', 'torch', 'gate']) {
			this.load.image(`vlg-${name}`, `village/${name}.png`);
		}
		this.load.spritesheet('vlg-edda', 'village/npc-edda-idle.png', {
			frameWidth: 110,
			frameHeight: 110,
		});

		// 보물상자 시트 (48×32 × 5프레임 · 4등급 × [닫힘/열림] 2줄)
		this.load.spritesheet('chests', 'deco/chests.png', {
			frameWidth: 48,
			frameHeight: 32,
		});

		// Tiny Swords FX: 적 화살 투사체 + 폭발 시트
		this.load.image('enemy_arrow', 'fx/arrow.png');
		this.load.spritesheet('fx-explosion-sheet', 'fx/explosion.png', {
			frameWidth: 192,
			frameHeight: 192,
		});

		// 스킬 이펙트 시트 (scripts/generate-fx-sheets.py 산출물, 규격은 fxSheets.ts 매니페스트).
		// 회색조로 뽑혀 있고 원소 색은 런타임 setTint 로 입힌다 — 시트 1장이 8원소를 커버한다.
		// 파일이 없으면 로드가 실패해도 게임은 돈다: VisualEffectsSystem.fxSprite 가
		// 텍스처 부재를 확인하고 null 을 돌려주면 호출부가 기존 도형 연출로 떨어진다.
		for (const [key, spec] of Object.entries(FX_SHEETS)) {
			this.load.spritesheet(key, `fx/${key}.png`, {
				frameWidth: spec.frameWidth,
				frameHeight: spec.frameHeight,
			});
		}

		// 원소 세트 오라 마법진 8장 (사용자 제공 4 + 동일 문법 생성 4 —
		// scripts/generate-aura-sheets.py 산출물, 규격은 auraSheets.ts 매니페스트)
		for (const [element, spec] of Object.entries(AURA_SHEETS)) {
			this.load.spritesheet(`aura-${element}`, `assets/auras/${element}.png`, {
				frameWidth: spec.frameSize,
				frameHeight: spec.frameSize,
			});
		}

		// Tiny Swords 지형 장식(나무 흔들림 시트·덤불·바위·금덩이)은 위의 DECO_ATLAS 한 장에 들어 있다.
		// 나무는 전부 8프레임·폭 192 — tree1·2만 높이가 256이다 (프레임은 정사각형이 아님!).

		for (const key of SoundSystem.keys()) {
			this.load.audio(key, `sfx/${key}.wav`);
		}

		// 배경음 4트랙 (scripts/generate-bgm.py 절차 생성 · 30~60초 심리스 루프).
		//
		// 포맷 2종을 나열한다 — Phaser 가 브라우저 canPlayType 으로 첫 지원 포맷을 고른다.
		// ogg 를 못 읽는 환경(Safari 등)은 자동으로 22050Hz 모노 AAC(m4a) 로 내려간다.
		// 그래도 실패하는 경우(404 · 파일 손상)는 아래 FILE_LOAD_ERROR 가 m4a 를 다시 건다.
		// (2026-09-07: 폴백을 wav → m4a 로 교체. wav 6개 = 11MB 가 배포본의 절반이었다.
		//  m4a 는 트랙당 ~400KB. 대가는 AAC 인코더 패딩 때문에 폴백 경로에서만 루프 이음매에
		//  아주 짧은 틈이 생길 수 있다는 것 — 주 경로(ogg)는 영향 없다.)
		for (const track of BGM_TRACKS) {
			this.load.audio(bgmKey(track), [`bgm/${track}.ogg`, `bgm/${track}.m4a`]);
		}
		// 전투 긴장도 레이어 — base 와 같은 길이·BPM 으로 동시 재생된다 (BgmSystem 주석 참고).
		// 로드에 실패해도 base 는 그대로 돌고 레이어만 조용히 빠진다.
		for (const layer of BGM_LAYER_NAMES) {
			this.load.audio(bgmKey(layer), [`bgm/${layer}.ogg`, `bgm/${layer}.m4a`]);
		}

		this.installAudioFallback();

		this.createPlaceholderTextures();
	}

	/**
	 * 오디오 폴백: ogg 로드가 실패하면 같은 키를 m4a 로 한 번 더 건다.
	 *
	 * 포맷 협상(canPlayType)으로 못 잡는 경우가 남아 있다 — 파일이 없거나(배포 누락),
	 * 손상됐거나, 서버가 잘못된 MIME 을 줄 때. 그때 음악이 통째로 사라지는 대신 m4a 로 산다.
	 * **소리가 끝내 안 되더라도 게임 진행은 막지 않는다** — BgmSystem·SoundSystem 모두
	 * 재생 전에 cache.audio.exists 로 확인하므로, 캐시가 비어 있으면 조용히 넘어간다.
	 */
	installAudioFallback() {
		const retried = new Set<string>();
		this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
			if (file.type !== 'audio' || retried.has(file.key)) {
				return;
			}
			const src = String(file.url ?? '');
			if (!src.endsWith('.ogg')) {
				return;
			}
			retried.add(file.key);
			const m4a = src.replace(/\.ogg$/, '.m4a');
			console.warn(`[moveSword] ${src} 로드 실패 — ${m4a} 로 폴백합니다`);
			this.load.audio(file.key, m4a);
		});
	}

	createPlaceholderTextures() {
		if (!this.textures.exists('enemy')) {
			this.createCircleTexture('enemy', 28, 28, 14, 0xef4444);
		}
		if (!this.textures.exists('bg')) {
			this.createBackgroundTexture('bg', 32, 32);
		}
		if (!this.textures.exists('xp_orb')) {
			this.createCircleTexture('xp_orb', 14, 14, 7, 0xfbbf24);
		}
		if (!this.textures.exists('enemy_bullet')) {
			this.createCircleTexture('enemy_bullet', 12, 12, 5, 0xff5555);
		}
	}

	createPlayerAnimations() {
		for (const player of playerCatalog) {
			for (const [animationName, sheet] of Object.entries(player.spritesheets)) {
				const animationKey =
					player.animations?.[animationName as keyof typeof player.animations] ?? `${player.id}-${animationName}`;

				if (this.anims.exists(animationKey)) {
					continue;
				}

				this.anims.create({
					key: animationKey,
					frames: this.anims.generateFrameNumbers(sheet.textureKey, {
						start: sheet.frameStart,
						end: sheet.frameEnd,
					}),
					frameRate: sheet.frameRate,
					repeat: sheet.repeat,
				});
			}
		}

		if (!this.anims.exists('player-idle')) {
			this.anims.create({
				key: 'player-idle',
				frames: this.anims.generateFrameNumbers(defaultPlayer.spritesheets.idle.textureKey, {
					start: defaultPlayer.spritesheets.idle.frameStart,
					end: defaultPlayer.spritesheets.idle.frameEnd,
				}),
				frameRate: 8,
				repeat: -1,
			});
		}

		if (!this.anims.exists('player-hurt')) {
			this.anims.create({
				key: 'player-hurt',
				frames: this.anims.generateFrameNumbers(defaultPlayer.spritesheets.hurt.textureKey, {
					start: defaultPlayer.spritesheets.hurt.frameStart,
					end: defaultPlayer.spritesheets.hurt.frameEnd,
				}),
				frameRate: 10,
				repeat: 0,
			});
		}

		if (!this.anims.exists('player-death')) {
			this.anims.create({
				key: 'player-death',
				frames: this.anims.generateFrameNumbers(defaultPlayer.spritesheets.death.textureKey, {
					start: defaultPlayer.spritesheets.death.frameStart,
					end: defaultPlayer.spritesheets.death.frameEnd,
				}),
				frameRate: 10,
				repeat: 0,
			});
		}
	}

	createEnemyAnimations() {
		for (const enemy of enemyCatalog) {
			if (enemy.spriteType === 'aseprite') {
				// Aseprite type: row-based animations from single spritesheet
				const { frameWidth, frameHeight, animations: animDefs } = enemy.spritesheet!;
				const textureKey = enemy.spritesheet!.textureKey;

				// Get texture to calculate frames per row.
				// NOTE: Phaser Texture 객체에는 width 가 없다 — 소스 이미지에서 읽어야 한다.
				// (기존 코드는 undefined/frameWidth = NaN 이 되어 적 애니메이션이 전부 실패했다.)
				// NOTE: 현재 카탈로그에 aseprite 타입 적은 없다(전부 'separate'). 아틀라스 전환 후
				// 이 경로를 되살리려면 시트의 열 개수를 카탈로그에 명시해야 한다 — 아틀라스
				// 안에서는 프레임이 이미 잘려 있어 원본 시트 폭을 읽을 수 없기 때문이다.
				const framesPerRow = Math.max(1, Math.floor((enemy.spritesheet!.framesPerRow ?? 1)));
				void frameWidth;

				for (const animDef of animDefs!) {
					const animationKey = `${enemy.id}-${animDef.name}`;
					if (this.anims.exists(animationKey)) {
						continue;
					}

					// Calculate frame indices based on row
					const rowStartFrame = animDef.row! * framesPerRow;
					const frameStart = rowStartFrame + animDef.frameStart;
					const frameEnd = frameStart + animDef.frameCount! - 1;

					try {
						this.anims.create({
							key: animationKey,
							// 아틀라스 프레임 이름 = `${원본 textureKey}/${원본 프레임 번호}`
							frames: this.anims.generateFrameNames(ENEMY_ATLAS, {
								prefix: `${textureKey}/`,
								start: frameStart,
								end: frameEnd,
							}),
							frameRate: animDef.frameRate,
							repeat: animDef.repeat,
						});
					} catch (err) {
						console.warn(`✗ Failed to create animation ${animationKey}:`, (err as Error).message);
					}
				}
			} else if (enemy.spriteType === 'separate') {
				// Separate type: different file per animation
				for (const [animationName, sheet] of Object.entries(enemy.spritesheets!) as Array<
					[string, SeparateSpritesheetSpec]
				>) {
					const animationKey = `${enemy.id}-${animationName}`;
					if (this.anims.exists(animationKey)) continue;

					const frameEnd = sheet.frameEnd !== undefined ? sheet.frameEnd : sheet.frameStart + sheet.frameCount! - 1;

					this.anims.create({
						key: animationKey,
						// 아틀라스 프레임 이름 = `${원본 textureKey}/${원본 프레임 번호}`
						frames: this.anims.generateFrameNames(ENEMY_ATLAS, {
							prefix: `${sheet.textureKey}/`,
							start: sheet.frameStart,
							end: frameEnd,
						}),
						frameRate: sheet.frameRate,
						repeat: sheet.repeat,
					});
				}
			}
		}
	}

	createAuraAnimations() {
		// 원소 세트 오라 idle 루프 (12fps — 원본 시트의 은은한 맥동 속도)
		for (const [element, spec] of Object.entries(AURA_SHEETS)) {
			const key = `aura-${element}`;
			if (!this.textures.exists(key) || this.anims.exists(`${key}-idle`)) {
				continue;
			}
			this.anims.create({
				key: `${key}-idle`,
				frames: this.anims.generateFrameNumbers(key, { start: 0, end: spec.frames - 1 }),
				frameRate: 12,
				repeat: -1,
			});
		}
	}

	createFxAnimations() {
		// 스킬 이펙트 시트 → `<키>-play` 애니메이션.
		// 프레임 수는 매니페스트에서만 온다 (손으로 적으면 반드시 어긋난다).
		for (const [key, spec] of Object.entries(FX_SHEETS)) {
			if (!this.textures.exists(key) || this.anims.exists(`${key}-play`)) {
				continue;
			}
			this.anims.create({
				key: `${key}-play`,
				frames: this.anims.generateFrameNumbers(key, { start: 0, end: spec.frames - 1 }),
				frameRate: spec.fps,
				repeat: spec.loop ? -1 : 0,
			});
		}

		// 폭발 (봄버 자폭·explosive 어픽스)
		if (this.textures.exists('fx-explosion-sheet') && !this.anims.exists('fx-explosion')) {
			this.anims.create({
				key: 'fx-explosion',
				frames: this.anims.generateFrameNumbers('fx-explosion-sheet', { start: 0, end: 7 }),
				frameRate: 26,
				repeat: 0,
			});
		}

		// 보물상자: 등급(0나무/1흑단/2적금/3서리)별 닫힘 idle 루프 + 열림 1회
		// 시트 구조: 5프레임/줄, 짝수줄(0-index)=닫힘, 홀수줄=열림
		if (this.textures.exists('chests')) {
			for (let tier = 0; tier < 4; tier += 1) {
				const closedStart = tier * 10;
				if (!this.anims.exists(`chest${tier}-idle`)) {
					this.anims.create({
						key: `chest${tier}-idle`,
						frames: this.anims.generateFrameNumbers('chests', { start: closedStart, end: closedStart + 4 }),
						frameRate: 6,
						repeat: -1,
					});
				}
				if (!this.anims.exists(`chest${tier}-open`)) {
					this.anims.create({
						key: `chest${tier}-open`,
						frames: this.anims.generateFrameNumbers('chests', { start: closedStart + 5, end: closedStart + 9 }),
						frameRate: 12,
						repeat: 0,
					});
				}
			}
		}

		// 대기마을 에다 NPC 대기 애니 (8프레임 110px)
		if (!this.anims.exists('vlg-edda-idle') && this.textures.exists('vlg-edda')) {
			this.anims.create({
				key: 'vlg-edda-idle',
				frames: this.anims.generateFrameNumbers('vlg-edda', { start: 0, end: 7 }),
				frameRate: 6,
				repeat: -1,
			});
		}

		// 장식 흔들림 루프 (나무·덤불 모두 8프레임) — 프레임은 DECO_ATLAS 안에 있다
		for (let i = 1; i <= 4; i += 1) {
			for (const kind of ['tree', 'bush'] as const) {
				const key = `deco-${kind}${i}`;
				if (this.anims.exists(`${key}-sway`)) {
					continue;
				}
				if (!this.textures.getFrame(DECO_ATLAS, `${key}/0`)) {
					continue;
				}
				this.anims.create({
					key: `${key}-sway`,
					frames: this.anims.generateFrameNames(DECO_ATLAS, { prefix: `${key}/`, start: 0, end: 7 }),
					frameRate: 5,
					repeat: -1,
				});
			}
		}
	}

	createCircleTexture(key: string, width: number, height: number, radius: number, color: number) {
		const graphics = this.make.graphics({ x: 0, y: 0, add: false } as Phaser.Types.GameObjects.Graphics.Options);
		graphics.fillStyle(color, 1);
		graphics.fillCircle(width / 2, height / 2, radius);

		const texture = this.add.renderTexture(0, 0, width, height);
		texture.draw(graphics);
		texture.saveTexture(key);
		texture.destroy();
		graphics.destroy();
	}

	createRectangleTexture(key: string, width: number, height: number, color: number) {
		const graphics = this.make.graphics({ x: 0, y: 0, add: false } as Phaser.Types.GameObjects.Graphics.Options);
		graphics.fillStyle(color, 1);
		graphics.fillRect(0, 0, width, height);

		const texture = this.add.renderTexture(0, 0, width, height);
		texture.draw(graphics);
		texture.saveTexture(key);
		texture.destroy();
		graphics.destroy();
	}

	createBackgroundTexture(key: string, width: number, height: number) {
		const graphics = this.make.graphics({ x: 0, y: 0, add: false } as Phaser.Types.GameObjects.Graphics.Options);
		graphics.fillStyle(0x1f1f1f, 1);
		graphics.fillRect(0, 0, width, height);

		graphics.lineStyle(1, 0x2f2f2f, 0.8);
		graphics.lineBetween(0, 0, width, 0);
		graphics.lineBetween(0, 0, 0, height);
		graphics.lineBetween(width - 1, 0, width - 1, height);
		graphics.lineBetween(0, height - 1, width, height - 1);
		graphics.lineBetween(0, height / 2, width, height / 2);
		graphics.lineBetween(width / 2, 0, width / 2, height);

		const texture = this.add.renderTexture(0, 0, width, height);
		texture.draw(graphics);
		texture.saveTexture(key);
		texture.destroy();
		graphics.destroy();
	}

	create() {
		this.createPlaceholderTextures();
		ensureGlyphs(this);
		// 부유 데미지 숫자용 비트맵 폰트 (Text 객체당 캔버스 텍스처가 생기는 것을 막는다)
		ensureDamageFont(this);
		// 픽셀아트 텍스처는 NEAREST 필터 — 확대 시 뭉개지지 않고 또렷한 픽셀로 그려진다.
		// (텍스트·글리프는 LINEAR 유지 — 부드러운 윤곽이 유리)
		const pixelKeys = new Set<string>(['sword', 'mapTileset', 'ts-tiles1', 'ts-tiles2', 'ts-tiles3', 'ts-tiles4', 'ts-tiles5']);
		// 스킬 이펙트 시트도 픽셀아트 — 부드러운 필터가 걸리면 가장자리가 뭉개진다
		for (const key of Object.keys(FX_SHEETS)) {
			pixelKeys.add(key);
		}
		for (const player of playerCatalog) {
			for (const sheet of Object.values(player.spritesheets)) {
				pixelKeys.add(sheet.textureKey);
			}
		}
		for (const enemy of enemyCatalog) {
			if (enemy.spritesheet?.textureKey) {
				pixelKeys.add(enemy.spritesheet.textureKey);
			}
			for (const sheet of Object.values(enemy.spritesheets ?? {})) {
				pixelKeys.add(sheet.textureKey);
			}
		}
		for (const key of pixelKeys) {
			if (this.textures.exists(key)) {
				this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
			}
		}
		// Flat UI 팩도 픽셀아트 — NEAREST 필터 (확대해도 또렷한 픽셀)
		for (const [key] of FLAT_UI_TEXTURES) {
			if (this.textures.exists(key)) {
				this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
			}
		}
		// 테마 바닥·전용 장식·마을 에셋도 픽셀아트 — NEAREST 필터
		// (pixelKeys 적용 루프는 이미 지나갔으므로 여기서 직접 필터를 건다)
		const themePixelKeys = ['ts-themes', 'vlg-edda'];
		for (const theme of MAP_THEMES) {
			for (const deco of theme.decos ?? []) {
				themePixelKeys.push(deco.key);
			}
		}
		for (const name of ['fountain', 'pillar', 'block', 'slab', 'altar', 'chalice', 'campfire', 'sign', 'sign2', 'torch', 'gate']) {
			themePixelKeys.push(`vlg-${name}`);
		}
		for (const key of themePixelKeys) {
			if (this.textures.exists(key)) {
				this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
			}
		}
		// FX·장식·적 텍스처도 픽셀아트 — NEAREST 필터
		// (아틀라스는 한 장이므로 키 하나만 지정하면 안의 모든 프레임에 적용된다)
		const fxDecoKeys = ['enemy_arrow', 'fx-explosion-sheet', ENEMY_ATLAS, DECO_ATLAS];
		for (const key of fxDecoKeys) {
			if (this.textures.exists(key)) {
				this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
			}
		}

		this.createPlayerAnimations();
		this.createEnemyAnimations();
		this.createFxAnimations();
		this.createAuraAnimations();
		htmlLoader.dismiss();
		this.scene.start('TitleScene');
	}
}

const gameConfig: Phaser.Types.Core.GameConfig = {
	type: Phaser.AUTO,
	parent: 'game',
	width: window.innerWidth,
	height: window.innerHeight,
	backgroundColor: '#101317',
	// 선명도: 서브픽셀 스미어 방지 (텍스트·스프라이트가 정수 좌표에 스냅)
	roundPixels: true,
	input: {
		// 게임패드는 명시적으로 켜야 Phaser 가 폴링을 시작한다.
		// 패드가 없으면 플러그인이 total 0 을 돌려줄 뿐이라 비용이 사실상 없다.
		gamepad: true,
	},
	physics: {
		default: 'arcade',
		arcade: {
			gravity: { y: 0 } as Phaser.Types.Math.Vector2Like,
			debug: false,
		},
	},
	scene: [BootScene, TitleScene, CharacterSelectScene, GameScene, PowerUpScene, CodexScene],
	scale: {
		mode: Phaser.Scale.RESIZE,
		autoCenter: Phaser.Scale.CENTER_BOTH,
		autoRound: true,
	},
};

// UI 폰트가 로드된 뒤 게임을 시작해야 Phaser 텍스트 메트릭이 어긋나지 않는다.
const fontLoads = [
	document.fonts.load('400 32px "Jua"'),
	document.fonts.load('400 16px "Gowun Dodum"'),
];

Promise.race([
	Promise.all(fontLoads),
	new Promise((resolve) => { setTimeout(resolve, 2500); }), // 폰트가 늦어도 게임은 뜬다
]).then(() => {
	const game = new Phaser.Game(gameConfig);

	if (import.meta.env.DEV) {
		// UI 히트 영역 회귀 테스트용 (ui-hit-test.mjs) — 씬 전체를 훑어야 해서
		// 개별 씬 훅이 아니라 게임 인스턴스가 필요하다.
		window.__game = game;
	}

	// 부팅 진단: 렌더러가 소프트웨어(SwiftShader/llvmpipe)로 폴백하면 게임 전체가
	// CPU 래스터라이즈로 돌아 전면적인 프레임 저하가 생긴다. 렉 제보의 1순위 확인 항목.
	game.events.once(Phaser.Core.Events.READY, () => {
		const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
		const gl = renderer?.gl;
		if (gl) {
			const dbg = gl.getExtension('WEBGL_debug_renderer_info');
			const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
			console.info(`[moveSword] WebGL 렌더러: ${name}`);
			if (/swiftshader|software|llvmpipe/i.test(name)) {
				console.warn('[moveSword] 소프트웨어 렌더링 감지 — 브라우저 하드웨어 가속이 꺼져 있을 수 있습니다 (chrome://gpu 확인)');
			}
		} else {
			console.warn('[moveSword] Canvas 렌더러 폴백 — WebGL 불가 환경이라 성능 저하가 예상됩니다');
		}
	});
});
