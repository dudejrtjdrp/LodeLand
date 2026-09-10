// 인게임 HUD (LODELAND): 좌상단 LV·XP·INGOT, 우상단 미니맵,
// 하단 중앙 EMBER 게이지(HP), BOSS/ALPHA 네임태그.
// (우하단 피해 로그 패널은 성능 문제로 제거됨 — 2026-08-28)
// 좌하단 PERCH 스트립(무리 상태)은 sword/hud.ts 가 담당한다.
// GameScene.update 에서 매 프레임 update() 호출.

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import type { EnemySprite } from '../types/actors';
import { FONT, UI, style, diamond, panel, slot, iconImage, hudScaleFor, TEXT_RESOLUTION,
} from '../ui/theme';

// Flat UI 팩 게이지 치수 (public/ui/flat/, BootScene에서 uf-* 키로 로드)
// bar_track 32×10: 잉크 외곽 1 + 크림 보더 2, 속이 빈 프레임 → 안쪽 (3,3)~(-3,-4)
// fill_* 32×3: 크롭 게이지용 스트립
const TRACK = { insetL: 3, insetR: 3, insetT: 3, insetB: 4 };
const FILL_TEX = { w: 32, h: 3 };

export default class HudSystem {
	scene: GameScene;

	// 미니맵: 고정 프레임(원·테두리·노치)은 **텍스처로 한 번 구워** 이미지 한 장으로 띄우고,
	// Graphics 에는 적 표식만 남긴다.
	//
	// Phaser 의 Graphics 는 커맨드 버퍼를 **매 프레임** 다시 삼각형으로 푼다 — 갱신을
	// 스로틀해도 렌더 비용은 줄지 않는다. 게다가 fillCircle 은 호출마다 점 배열을 새로
	// 할당한다(GC). 적 175마리 × 원 = 프레임마다 삼각형 수천 개 + 배열 수백 개였다.
	// (2026-09-01 교차 A/B: 미니맵만 숨겨도 20.0→24.4fps, work 4.07→1.45ms/frame —
	//  HUD 전체를 숨긴 것과 거의 같은 값이었다. 즉 HUD 비용 = 사실상 미니맵 하나.)
	minimapG: Phaser.GameObjects.Graphics; // 적 표식 전용 (사각형만 그린다)
	minimapFrame!: Phaser.GameObjects.Image; // 구워 둔 고정 프레임
	private minimapTexKey = '';
	hpBarG: Phaser.GameObjects.Graphics;

	// Flat 팩 게이지: 트랙 프레임(맨 위) + 색 fill(크롭) + 어두운 백킹
	hpBarBg: Phaser.GameObjects.NineSlice;
	hpBarBack: Phaser.GameObjects.Image;
	hpBarFill: Phaser.GameObjects.Image;
	xpBarBg: Phaser.GameObjects.NineSlice;
	xpBarBack: Phaser.GameObjects.Image;
	xpBarFill: Phaser.GameObjects.Image;

	// 좌상단 레벨 배지(파랑 슬롯) + 쇳밥/정철 패널
	levelBadge: Phaser.GameObjects.NineSlice;
	topPanel: Phaser.GameObjects.NineSlice;
	goldChip: Phaser.GameObjects.Image | Phaser.GameObjects.Text;

	levelText: Phaser.GameObjects.Text;
	levelLabel!: Phaser.GameObjects.Text;
	xpText: Phaser.GameObjects.Text;
	goldText: Phaser.GameObjects.Text;
	hpText: Phaser.GameObjects.Text;
	tabHintText!: Phaser.GameObjects.Text;
	furnaceIcon: Phaser.GameObjects.Image | Phaser.GameObjects.Text;

	enemyLabels: Map<EnemySprite, Phaser.GameObjects.Text> = new Map();

	hpBarRect: { x: number; y: number; w: number; h: number } | null = null;
	hs = 1;

	destroyed = false;

	constructor(scene: GameScene) {
		this.scene = scene;

		this.minimapFrame = scene.add.image(0, 0, '__DEFAULT')
			.setOrigin(0.5).setScrollFactor(0).setDepth(1001).setVisible(false);
		this.minimapG = scene.add.graphics().setScrollFactor(0).setDepth(1002);

		// 게이지: 백킹 → fill(크롭) → 트랙 프레임 순서로 겹친다. 잔불 명멸은 hpBarG가 덧그림
		this.hpBarBack = scene.add.image(0, 0, 'uf-fill-dark')
			.setOrigin(0, 0).setScrollFactor(0).setDepth(999).setAlpha(0.9);
		this.hpBarFill = scene.add.image(0, 0, 'uf-fill-orange')
			.setOrigin(0, 0).setScrollFactor(0).setDepth(1000);
		this.hpBarBg = scene.add.nineslice(0, 0, 'uf-bar-track', 0, 32, 10, 4, 4, 4, 4)
			.setOrigin(0, 0).setScrollFactor(0).setDepth(1001);
		this.xpBarBack = scene.add.image(0, 0, 'uf-fill-dark')
			.setOrigin(0, 0).setScrollFactor(0).setDepth(1000).setAlpha(0.9);
		this.xpBarFill = scene.add.image(0, 0, 'uf-fill-cream')
			.setOrigin(0, 0).setScrollFactor(0).setDepth(1001);
		this.xpBarBg = scene.add.nineslice(0, 0, 'uf-bar-track', 0, 32, 10, 4, 4, 4, 4)
			.setOrigin(0, 0).setScrollFactor(0).setDepth(1002);
		this.hpBarG = scene.add.graphics().setScrollFactor(0).setDepth(1002);

		this.levelBadge = slot(scene, 0, 0, 64, 'blue').setScrollFactor(0).setDepth(1000);
		this.topPanel = panel(scene, 0, 0, 268, 66, { alpha: 0.96 }).setScrollFactor(0).setDepth(999);
		this.goldChip = iconImage(scene, 'g-chip', 0, 0, 16, 0xd9a83c);
		(this.goldChip as Phaser.GameObjects.Image).setScrollFactor?.(0);
		this.goldChip.setDepth(1002);

		this.levelText = scene.add.text(0, 0, '1', style(26, UI.white, { display: true }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(1002);
		this.levelText.setShadow(0, 2, '#000000', 4, false, true);
		this.levelLabel = scene.add.text(0, 0, 'LV', style(10, '#dff0ff', { display: true }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(1002);
		// 강판 패널 위 밝은 텍스트
		this.xpText = scene.add.text(0, 0, '', style(13, UI.text)).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1002);
		this.goldText = scene.add.text(0, 0, '', style(16, UI.goldText, { display: true }))
			.setOrigin(0, 0.5).setScrollFactor(0).setDepth(1002);

		this.hpText = scene.add.text(0, 0, '', style(15, UI.white)).setOrigin(0.5).setScrollFactor(0).setDepth(1002);
		this.hpText.setShadow(0, 2, '#000000', 4, false, true);
		this.tabHintText = scene.add.text(0, 0, 'TAB — 능력치', style(11, '#c3ccd3', { display: true }))
			.setOrigin(0.5).setScrollFactor(0).setDepth(1002);
		this.tabHintText.setShadow(0, 2, '#000000', 3, false, true);
		// 좌측 화로 인디케이터 (게임 자체 글리프)
		this.furnaceIcon = iconImage(scene, 'g-furnace', 0, 0, 22, 0xff8a3d);
		(this.furnaceIcon as Phaser.GameObjects.Image).setScrollFactor?.(0);
		this.furnaceIcon.setDepth(1002);

		this.buildStatic();
		this.scene.scale.on('resize', this.buildStatic, this);
	}

	// ---------------------------------------------------------------
	// 고정 요소 (리사이즈 시에만 다시 그림)
	// ---------------------------------------------------------------

	buildStatic() {
		if (this.destroyed) {
			return;
		}
		const { width, height } = this.scene.scale;
		// 화면이 작을수록 HUD 도 함께 줄여 게임 화면을 덜 가린다
		const hs = hudScaleFor(this.scene);
		this.hs = hs;
		// 트랙 코너가 함께 커지도록 픽셀 배율도 hs 를 따른다
		const px = 2 * hs;

		// 폰트도 배율에 맞춰 재설정
		this.levelText.setFontSize(24 * hs);
		this.levelLabel.setFontSize(10 * hs);
		this.xpText.setFontSize(13 * hs);
		this.goldText.setFontSize(16 * hs);
		this.hpText.setFontSize(15 * hs);
		if ('setDisplaySize' in this.furnaceIcon) {
			(this.furnaceIcon as Phaser.GameObjects.Image).setDisplaySize(22 * hs, 22 * hs);
		}
		this.tabHintText.setFontSize(11 * hs);
		this.tabHintText.setPosition(width - 86 * hs, 160 * hs);

		// ── 좌상단: 레벨 배지 (Flat 파랑 슬롯)
		const bx = 52 * hs;
		const by = 52 * hs;
		this.levelBadge.setPosition(bx, by);
		this.levelBadge.setScale(px).setSize(68 / 2, 68 / 2);
		this.levelText.setPosition(bx, by + 5 * hs);
		this.levelLabel.setPosition(bx, by - 16 * hs);

		// 쇳밥(XP) 라인 + 정철 패널 (Flat 회색 프레임)
		this.topPanel.setPosition(94 * hs, 18 * hs);
		this.topPanel.setScale(px).setSize(268 * hs / px, 66 * hs / px);
		this.xpText.setPosition(104 * hs, 34 * hs);
		this.goldText.setPosition(126 * hs, 68 * hs);
		(this.goldChip as Phaser.GameObjects.Image).setPosition?.(110 * hs, 68 * hs);
		if ('setDisplaySize' in (this.goldChip as Phaser.GameObjects.Image)) {
			(this.goldChip as Phaser.GameObjects.Image).setDisplaySize(15 * hs, 15 * hs);
		}

		// XP 바 (트랙 프레임 + 크림 fill) — 얇은 바라 보더가 두꺼워 보이지 않게 픽셀 배율을 낮춘다
		const xpPx = 1.4 * hs;
		const xpX = 104 * hs;
		const xpY = 42 * hs;
		const xpW = 224 * hs;
		const xpH = 18 * hs;
		this.xpBarBg.setPosition(xpX, xpY).setScale(xpPx).setSize(xpW / xpPx, xpH / xpPx);
		const xpInX = xpX + TRACK.insetL * xpPx;
		const xpInY = xpY + TRACK.insetT * xpPx;
		const xpInW = xpW - (TRACK.insetL + TRACK.insetR) * xpPx;
		const xpInH = xpH - (TRACK.insetT + TRACK.insetB) * xpPx;
		this.xpBarBack.setPosition(xpInX, xpInY).setDisplaySize(xpInW, xpInH);
		this.xpBarFill.setPosition(xpInX, xpInY).setDisplaySize(xpInW, xpInH);

		// ── 하단 화로 게이지 (Flat 트랙 + 잉걸 fill)
		const hpW = Math.min(430 * hs, width * 0.36);
		const hpH = 32 * hs;
		const hpX = width / 2 - hpW / 2;
		const hpY = height - hpH - 14 * hs;
		this.hpBarBg.setPosition(hpX, hpY).setScale(px).setSize(hpW / px, hpH / px);
		const fillX = hpX + TRACK.insetL * px;
		const fillY = hpY + TRACK.insetT * px;
		const fillW = hpW - (TRACK.insetL + TRACK.insetR) * px;
		const fillH = hpH - (TRACK.insetT + TRACK.insetB) * px;
		this.hpBarBack.setPosition(fillX, fillY).setDisplaySize(fillW, fillH);
		this.hpBarFill.setPosition(fillX, fillY).setDisplaySize(fillW, fillH);
		this.hpBarRect = { x: fillX, y: fillY, w: fillW, h: fillH };
		this.hpText.setPosition(fillX + fillW / 2, fillY + fillH / 2);
		this.furnaceIcon.setPosition(hpX - 16 * hs, hpY + hpH / 2);

		this.buildMinimapFrame();
		this.lastMinimapAt = 0; // 다음 프레임에 표식을 즉시 다시 그린다
	}

	/**
	 * 미니맵 고정 프레임(그림자·원판·테두리 2겹·북쪽 노치)을 텍스처로 굽는다.
	 * 리사이즈 때만 다시 굽는다 — 매 프레임 원 4개를 삼각형으로 푸는 비용이 사라진다.
	 */
	private buildMinimapFrame(): void {
		const hs = this.hs;
		const { width } = this.scene.scale;
		const r = 62 * hs;
		const pad = Math.ceil(r + 12 * hs); // 노치(원 밖 위쪽)까지 들어갈 여유
		const size = pad * 2;
		const cx = pad;
		const cy = pad;

		const g = this.scene.make.graphics();
		g.fillStyle(0x000000, 0.5);
		g.fillCircle(cx + 2, cy + 3, r + 4);
		g.fillStyle(0x151a1f, 0.92);
		g.fillCircle(cx, cy, r);
		g.lineStyle(2, UI.steel, 1);
		g.strokeCircle(cx, cy, r + 2);
		g.lineStyle(1, UI.steelDark, 0.9);
		g.strokeCircle(cx, cy, r - 3);
		// 자맥 눈금 (북쪽 노치)
		diamond(g, cx, cy - r - 5, 4 * hs, UI.quench);

		const key = `hud-minimap-${Math.round(size)}`;
		// 이전 크기의 텍스처는 버린다 (리사이즈를 반복해도 쌓이지 않게)
		if (this.minimapTexKey && this.minimapTexKey !== key && this.scene.textures.exists(this.minimapTexKey)) {
			this.scene.textures.remove(this.minimapTexKey);
		}
		if (this.scene.textures.exists(key)) {
			this.scene.textures.remove(key);
		}
		g.generateTexture(key, size, size);
		g.destroy();
		this.minimapTexKey = key;
		this.minimapFrame.setTexture(key);
		this.minimapFrame.setPosition(width - 86 * hs, 86 * hs);
		this.minimapFrame.setVisible(this.minimapG.visible);
	}

	// ---------------------------------------------------------------
	// 매 프레임 갱신
	// ---------------------------------------------------------------

	/** 텍스트 재생성 가드 — 값이 바뀔 때만 문자열 생성/재렌더 (매 프레임 toLocaleString 방지) */
	private lastXpShown = -1;
	private lastLevelShown = -1;
	private lastGoldShown = -1;
	private lastHpShown = -1;

	update() {
		if (this.destroyed) {
			return;
		}
		const scene = this.scene;
		const player = scene.player;
		const progression = scene.progression;
		const hs = this.hs;

		// 털갈이 / 쇳밥 / 정철
		if (progression) {
			if (progression.level !== this.lastLevelShown) {
				this.lastLevelShown = progression.level;
				this.levelText.setText(`${progression.level}`);
			}
			const xpFloor = Math.floor(progression.xp);
			if (xpFloor !== this.lastXpShown) {
				this.lastXpShown = xpFloor;
				this.xpText.setText(progression.level >= progression.maxLevel
					? '최대 레벨'
					: `경험치 ${xpFloor.toLocaleString()} / ${progression.xpToNext.toLocaleString()}`);
			}
			const xpRatio = Phaser.Math.Clamp(
				progression.xpToNext > 0 ? progression.xp / progression.xpToNext : 1, 0, 1);
			this.xpBarFill.setCrop(0, 0, FILL_TEX.w * xpRatio, FILL_TEX.h);
			this.xpBarFill.setVisible(xpRatio > 0.005 && this.xpBarBg.visible);
		}
		const gold = scene.pickupSystem?.runGold ?? 0;
		if (gold !== this.lastGoldShown) {
			this.lastGoldShown = gold;
			this.goldText.setText(gold.toLocaleString());
		}

		// 하단 화로 게이지 — 25% 이하일 때 명멸(잔불 경고)
		if (player && this.hpBarRect) {
			const bar = this.hpBarRect;
			const ratio = Phaser.Math.Clamp((player.hp ?? 0) / Math.max(1, player.maxHp ?? 1), 0, 1);
			this.hpBarFill.setCrop(0, 0, FILL_TEX.w * ratio, FILL_TEX.h);
			this.hpBarFill.setVisible(ratio > 0.004 && this.hpBarBg.visible);
			// 잔불 경고는 25% 이하일 때만 그린다. 그 밖에서는 clear()도 필요 없다 —
			// 경고 구간을 벗어나는 프레임에 한 번만 지우면 된다.
			const warning = ratio <= 0.25 && ratio > 0;
			if (warning) {
				// 잔불 경고 명멸 (fill 위 잉걸 오버레이)
				const pulse = 0.25 + 0.2 * Math.sin(this.scene.time.now / 180);
				this.hpBarG.clear();
				this.hpBarG.fillStyle(UI.ember, Math.max(0, pulse));
				this.hpBarG.fillRect(bar.x, bar.y + 2, bar.w * ratio, bar.h - 4);
			} else if (this.hpWarningDrawn) {
				this.hpBarG.clear();
			}
			this.hpWarningDrawn = warning;
			const hpCeil = Math.max(0, Math.ceil(player.hp ?? 0));
			const hpKey = hpCeil * 100000 + (player.maxHp ?? 0); // hp+maxHp 둘 다 감지
			if (hpKey !== this.lastHpShown) {
				this.lastHpShown = hpKey;
				this.hpText.setText(`${hpCeil} / ${player.maxHp ?? 0}`);
			}
		}

		this.updateMinimap();
		this.updateEnemyLabels();
	}

	/** 미니맵 재렌더 스로틀 — 적 수백 마리를 매 프레임 Graphics로 다시 그리는 비용 절감.
	 *  프레임이 처질수록 갱신 주기를 늘린다 (60fps→11Hz, 저사양→6Hz). */
	private lastMinimapAt = 0;
	/** 적 네임태그 갱신 스로틀 (미니맵과 같은 이유 — 매 프레임 176슬롯 순회였다) */
	private lastLabelsAt = 0;
	/** 화로 게이지 경고 오버레이가 현재 그려져 있는지 (불필요한 clear 방지) */
	private hpWarningDrawn = false;
	/** updateEnemyLabels 재사용 Set (매 호출 new Set 방지) */
	private readonly labelSeen = new Set<EnemySprite>();

	updateMinimap() {
		const now = this.scene.time.now;
		const fps = this.scene.game.loop.actualFps;
		const interval = fps < 40 ? 160 : 90;
		if (now - this.lastMinimapAt < interval) {
			return;
		}
		this.lastMinimapAt = now;
		const scene = this.scene;
		const { width } = scene.scale;
		const hs = this.hs;
		const cx = width - 86 * hs;
		const cy = 86 * hs;
		const r = 62 * hs;
		const g = this.minimapG;
		const player = scene.player;

		// 원판·테두리·노치는 minimapFrame(구운 텍스처)이 담당한다 — 여기선 표식만
		g.clear();

		if (!player) {
			return;
		}

		const mapScale = 0.055 * hs;
		const enemies = scene.enemyManager?.enemies?.getChildren() as EnemySprite[] | undefined;
		if (enemies) {
			for (const enemy of enemies) {
				if (!enemy.active) {
					continue;
				}
				const dx = (enemy.x - player.x) * mapScale;
				const dy = (enemy.y - player.y) * mapScale;
				if (dx * dx + dy * dy > (r - 8) * (r - 8)) {
					continue;
				}
				// 문자열 검사 3회 대신 카탈로그 불리언 (적 176 × 미니맵 갱신마다)
				const isBig = enemy.catalog?.isBoss === true || enemy.catalog?.isMiniboss === true;
				const isElite = enemy.catalog?.isElite === true;
				g.fillStyle(isBig ? 0xe8874a : isElite ? 0xd9a83c : 0xa8543a, 0.95);
				// 점 하나를 원으로 그리면 삼각형 30여 개가 생긴다 — 4px 짜리 표식은
				// 사각형으로 충분하다 (적 175마리면 굽는 비용이 10배 이상 차이난다).
				const dot = isBig ? 3.4 : 2.2;
				g.fillRect(cx + dx - dot, cy + dy - dot, dot * 2, dot * 2);
			}
		}

		// 플레이어 (중앙 담금 청 다이아)
		diamond(g, cx, cy, 4, 0xd8ecf5);
	}

	// 우두머리/두목 네임태그
	//
	// 예전엔 매 프레임 적 176슬롯을 돌며 문자열 3회 검사(includes/startsWith)를 했다
	// (초당 3만 회) — 바로 위 미니맵은 이미 스로틀돼 있는데 여기만 뚫려 있었다.
	// 이제는 (1) 미니맵과 같은 주기로 스로틀하고 (2) 문자열 대신 카탈로그 불리언을 보고
	// (3) 화면 밖 라벨은 감춘다 (Phaser는 임의 GameObject를 프러스텀 컬링하지 않는다).
	updateEnemyLabels() {
		const now = this.scene.time.now;
		const fps = this.scene.game.loop.actualFps;
		if (now - this.lastLabelsAt < (fps < 40 ? 160 : 90)) {
			return;
		}
		this.lastLabelsAt = now;

		const scene = this.scene;
		const enemies = (scene.enemyManager?.enemies?.getChildren() ?? []) as EnemySprite[];
		const seen = this.labelSeen;
		seen.clear();

		const camera = scene.cameras.main;
		const left = camera.scrollX - 60;
		const right = camera.scrollX + camera.width + 60;
		const top = camera.scrollY - 60;
		const bottom = camera.scrollY + camera.height + 60;

		for (const enemy of enemies) {
			if (!enemy.active) {
				continue;
			}
			const isBoss = enemy.catalog?.isBoss === true;
			const isMini = enemy.catalog?.isMiniboss === true;
			const isElite = enemy.catalog?.isElite === true;
			if (!isBoss && !isMini && !isElite) {
				continue;
			}
			seen.add(enemy);
			// 진짜 보스는 '보스', 중간보스는 '중간보스' — 예전엔 둘 다 '보스'라 붙어
			// 상단 보스바의 주인과 헷갈렸다.
			const want = isBoss ? '보스' : isMini ? '중간보스' : '우두머리';
			let label = this.enemyLabels.get(enemy);
			if (!label) {
				label = scene.add.text(0, 0, want, {
					fontFamily: FONT.display,
					resolution: TEXT_RESOLUTION,
					fontSize: '14px',
					fontStyle: '900',
					color: isBoss ? UI.emberText : isMini ? UI.goldText : '#cfd8e0',
				}).setOrigin(0.5).setDepth(90);
				label.setShadow(0, 2, '#000000', 4, false, true);
				this.enemyLabels.set(enemy, label);
			} else if (label.text !== want) {
				// 풀 재활용으로 같은 스프라이트가 다른 등급으로 다시 나온 경우
				label.setText(want);
				label.setColor(isBoss ? UI.emberText : isMini ? UI.goldText : '#cfd8e0');
			}
			const onScreen = enemy.x >= left && enemy.x <= right && enemy.y >= top && enemy.y <= bottom;
			label.setVisible(onScreen);
			if (onScreen) {
				// 대형 보스(몸 100px+)는 고정 오프셋이면 명찰이 몸통에 파묻힌다 —
				// 실제 표시 높이 기준으로 머리 위에 띄운다.
				const headY = enemy.y - Math.max(35, enemy.displayHeight * 0.55) - 16;
				label.setPosition(enemy.x, headY);
			}
		}

		for (const [enemy, label] of this.enemyLabels) {
			if (!seen.has(enemy)) {
				label.destroy();
				this.enemyLabels.delete(enemy);
			}
		}
	}

	/** 털갈이·상점·결과 오버레이가 열릴 때 HUD 전체를 숨긴다 */
	setVisible(visible: boolean) {
		const objects: Array<{ setVisible: (v: boolean) => unknown }> = [
			this.minimapG, this.minimapFrame, this.hpBarG,
			this.hpBarBg, this.hpBarBack, this.hpBarFill, this.xpBarBg, this.xpBarBack, this.xpBarFill,
			this.levelBadge, this.topPanel, this.goldChip,
			this.levelText, this.levelLabel, this.xpText, this.goldText, this.hpText, this.furnaceIcon,
			this.tabHintText,
		];
		for (const object of objects) {
			object.setVisible(visible);
		}
		for (const [, label] of this.enemyLabels) {
			label.setVisible(visible);
		}
	}

	destroy() {
		this.destroyed = true;
		this.scene.scale.off('resize', this.buildStatic, this);
		for (const [, label] of this.enemyLabels) {
			label.destroy();
		}
		this.enemyLabels.clear();
		this.minimapG.destroy();
		this.minimapFrame.destroy();
		if (this.minimapTexKey && this.scene.textures.exists(this.minimapTexKey)) {
			this.scene.textures.remove(this.minimapTexKey);
		}
		this.hpBarG.destroy();
		this.hpBarBg.destroy();
		this.hpBarBack.destroy();
		this.hpBarFill.destroy();
		this.xpBarBg.destroy();
		this.xpBarBack.destroy();
		this.xpBarFill.destroy();
		this.levelBadge.destroy();
		this.topPanel.destroy();
		this.goldChip.destroy();
		this.levelText.destroy();
		this.levelLabel.destroy();
		this.xpText.destroy();
		this.goldText.destroy();
		this.hpText.destroy();
		this.tabHintText.destroy();
		this.furnaceIcon.destroy();
	}
}
