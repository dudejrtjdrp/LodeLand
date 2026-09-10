import Phaser from 'phaser';
import GamepadSystem from '../systems/GamepadSystem';
import MetaProgression from '../systems/MetaProgression';
import RunSave from '../core/RunSave';
import BgmSystem from '../systems/BgmSystem';
import { reduceMotion, loadSettings, saveSettings, sfxVolume } from '../core/settings';
import { SFX_BASE } from '../systems/SoundSystem';
import { createAudioSettings, type AudioSettingsUi } from '../ui/audioSettings';
import { createControlsPanel, allControlRows } from '../ui/controlsPanel';
import { createKeybindPanel, type KeybindPanelUi } from '../ui/keybindPanel';
import * as keybindsApi from '../core/keybinds';
import { requestTutorialReplay, isReplayRequested, isTutorialDone } from '../core/onboarding';
import AchievementSystem from '../systems/AchievementSystem';
import * as codexApi from '../core/codex';
import * as statsApi from '../core/stats';
import * as telemetryApi from '../core/telemetry';
import { UI, style, panel, button, divider, dimVignette, createUiRoot, TITLE_PX,
	type UiRoot, type UiButton,
} from '../ui/theme';

/** 강조 줄의 잉걸빛 — 목업 '출격'에서 뽑은 값 (아이콘 틴트 / 글자색) */
const HI_TINT = 0xffa23c;
const HI_TEXT = '#ffb04a';

/** 설정 창 갈래 */
type SettingsTab = 'general' | 'controls';

// ---------------------------------------------------------------
// 목업 좌표 (1672×941). 전부 TITLE_PX 를 곱해 디자인 좌표로 쓴다.
// 숫자를 목업 픽셀 그대로 두는 이유: 시안과 대조할 때 눈으로 바로 확인된다.
// ---------------------------------------------------------------

const LOGO_CY = 130;          // 워드마크 세로 중심

const RAIL_CY = 87;           // 재화 줄 세로 중심
const RAIL_MARGIN = 22;       // 톱니 오른쪽 여백
const RAIL_GAP = 12;          // 알약 ↔ 톱니 사이
const GEAR_W = 78;
const PILL_W = 183;           // 알약 전체 폭 (목업 1385..1568)
const PILL_H = 54;
const PILL_CAP_L = 55;        // 왼쪽 마구리 = 프레임 + 금화 (자른 그대로)
const PILL_CAP_R = 17;
const PILL_TEXT_X = 60;       // 금화 오른쪽, 숫자가 시작하는 자리

const BTN_X = 51;             // 버튼 왼쪽 변
const BTN_W = 426;
const BTN_H = 94;
const BTN_CAP = 48;           // btn.png 좌우 마구리 폭
const BTN_CY0 = 316;          // 첫 줄 세로 중심
const BTN_STEP = 100.25;      // 줄 간격
const BTN_ICON_CX = 86;       // 버튼 왼쪽 변 기준 아이콘 중심
const BTN_LABEL_X = 134;      // 버튼 왼쪽 변 기준 글자 시작 (좌측 정렬)
const BTN_LABEL_SIZE = 32;

// 강조 줄: 목업에서 주황 프레임이 사방으로 커진다 (446×102 + 바깥 발광)
const HI_W = 452;
const HI_H = 118;
const HI_CAP = 51;
const MARK_GAP = 24;          // 버튼 변 ↔ 지시자 중심 (목업: 왼쪽 지시자가 x 15~39)

/** 메뉴 한 줄 — 세로 목록 + 키보드/패드 선택 대상 */
interface MenuEntry {
	root: Phaser.GameObjects.Container;
	setHighlighted: (on: boolean) => void;
	activate: () => void;
}

export default class TitleScene extends Phaser.Scene {
	private emberTimer?: Phaser.Time.TimerEvent;
	/** 좌측 메뉴 (위→아래 순서 = ↑↓ 이동 순서) */
	private menu: MenuEntry[] = [];
	private selected = 0;
	/** 설정 창 (열려 있으면 배경 메뉴 입력을 막는다) */
	private settingsRoot: UiRoot | null = null;
	private settingsObjects: Phaser.GameObjects.GameObject[] = [];
	private audioUi: AudioSettingsUi | null = null;
	private keybindUi: KeybindPanelUi | null = null;
	/** 설정 창 껍데기(패널·제목·갈래 버튼·닫기) — 갈래를 바꿔도 유지된다 */
	private settingsShell: Phaser.GameObjects.GameObject[] = [];
	/** 갈래 내용 — 갈래 전환마다 통째로 다시 그린다 */
	private settingsBody: Phaser.GameObjects.GameObject[] = [];
	private settingsTab: SettingsTab = 'general';

	constructor() {
		super('TitleScene');
	}

	create() {
		this.menu = [];
		this.selected = 0;
		this.settingsRoot = null;
		this.settingsObjects = [];
		this.settingsShell = [];
		this.settingsBody = [];
		this.audioUi = null;
		this.keybindUi = null;
		const sw = this.scale.width;
		const sh = this.scale.height;

		// 타이틀·캐릭터 선택·영구 강화는 같은 곡을 공유한다 (BgmSystem 은 게임당 싱글턴이라
		// 씬을 오가도 곡이 처음부터 다시 시작되지 않는다).
		this.sound.mute = loadSettings().muted;
		BgmSystem.for(this).play('title');

		this.drawBackdrop(sw, sh);

		// ── 살아있는 불티: 광맥에서 떠오르는 잉걸 (reduceMotion 시 생략)
		if (!reduceMotion()) {
			this.emberTimer = this.time.addEvent({
				delay: 420,
				loop: true,
				callback: () => this.spawnEmber(sw, sh),
			});
			for (let i = 0; i < 6; i += 1) {
				this.spawnEmber(sw, sh, true);
			}
		}

		const backdropCount = this.children.list.length;
		const ui = createUiRoot(this, 10);
		const width = ui.width;
		const height = ui.height;
		const cx = width / 2;

		// ── 화면 테두리 (목업에서 오려 낸 귀퉁이 + 이어 주는 헤어라인)
		this.drawScreenFrame(width, height);

		// ── 로고: 상단 중앙. 목업의 금속 워드마크를 통째로 쓴다
		// (장식선 · LODELAND · KEEPER OF THE CORE 가 한 장에 들어 있다)
		this.add.image(cx, LOGO_CY * TITLE_PX, 't-logo').setScale(TITLE_PX);

		// ── 우상단: 보유 골드 알약 + 설정 톱니 (목업의 재화 줄).
		// 목업의 붉은 보석과 '+' 구매 버튼은 게임에 없는 기능이라 뺐다.
		const meta = MetaProgression.load();
		const railY = RAIL_CY * TITLE_PX;
		const railRight = width - RAIL_MARGIN * TITLE_PX;

		const gear = this.add.image(railRight - (GEAR_W / 2) * TITLE_PX, railY, 't-gear')
			.setScale(TITLE_PX)
			.setInteractive({ useHandCursor: true });
		gear.on('pointerover', () => gear.setTint(0xffc98a));
		gear.on('pointerout', () => gear.clearTint());
		gear.on('pointerdown', () => this.openSettings());

		const pillW = PILL_W * TITLE_PX;
		const pillRight = railRight - (GEAR_W + RAIL_GAP) * TITLE_PX;
		const pillLeft = pillRight - pillW;
		this.add.nineslice(pillLeft, railY, 't-pill', 0, PILL_W, PILL_H, PILL_CAP_L, PILL_CAP_R, 0, 0)
			.setScale(TITLE_PX).setOrigin(0, 0.5);
		this.add.text(pillLeft + PILL_TEXT_X * TITLE_PX, railY, meta.gold.toLocaleString(),
			style(26 * TITLE_PX, UI.white, { display: true })).setOrigin(0, 0.5);

		if ((meta.clearedDanger ?? -1) >= 0) {
			const depthMark = ['Ⅰ', 'Ⅱ', 'Ⅲ'][meta.clearedDanger] ?? 'Ⅰ';
			this.add.text(railRight, railY + 40, `위험도 ${depthMark} 클리어`, style(12, UI.textFaint, { display: true }))
				.setOrigin(1, 0.5);
		}

		// ── 좌측 메뉴 기둥 (목업 좌표 그대로: 왼쪽 변 x 51, 첫 줄 중심 316, 간격 100.25).
		// 컨테이너는 가운데 정렬이라 왼쪽 변이 아니라 **중심**을 넘겨야 한다.
		const savedRun = RunSave.peek();
		const btnX = (BTN_X + BTN_W / 2) * TITLE_PX;
		const step = BTN_STEP * TITLE_PX;
		let menuY = BTN_CY0 * TITLE_PX;

		if (savedRun) {
			const depthLabel = savedRun.dangerLevel > 0 ? ` · 위험도 ${['', 'Ⅱ', 'Ⅲ'][savedRun.dangerLevel] ?? ''}` : '';
			this.addMenuEntry(btnX, menuY, '이어하기', 't-icon-continue', {
				sub: `라운드 ${savedRun.round + 1}부터 계속${depthLabel}`,
				activate: () => this.continueRun(),
			});
			this.input.keyboard!.once('keydown-C', () => this.continueRun());
			menuY += step;
		}

		this.addMenuEntry(btnX, menuY, '출격', 't-icon-sortie', {
			sub: savedRun ? '새로 시작 (기존 세이브 삭제)' : undefined,
			activate: () => this.startGame(),
		});
		this.addMenuEntry(btnX, menuY + step, '영구 강화', 't-icon-upgrade', { activate: () => this.openPowerUp() });
		this.addMenuEntry(btnX, menuY + step * 2, '설정', 't-icon-settings', { activate: () => this.openSettings() });
		this.addMenuEntry(btnX, menuY + step * 3, '도감', 't-icon-codex', { activate: () => this.openCodex() });

		// 세이브가 있으면 '이어하기', 없으면 '출격'이 첫 강조 — 목업의 타오르는 줄
		this.applySelection();

		// 하단: 조작 안내 + 버전
		this.add.text(cx, height - 38, '이동 방향키 · 나머지 키는 스킬(K) · 검은 스스로 사냥한다',
			style(13, UI.textDim, { bold: false })).setOrigin(0.5).setShadow(0, 2, '#000000', 6, false, true);
		// 버전 표기는 프레임 귀퉁이 장식(좌하단)을 피해 안쪽으로
		this.add.text(64, height - 26, 'LODELAND v0.3', style(12, UI.textFaint, { bold: false })).setOrigin(0, 0.5);

		this.input.keyboard!.once('keydown-SPACE', () => this.startGame());
		// ↑↓ = 메뉴 이동, ENTER = 확정 (게임패드 십자키/A 가 이 키들을 합성한다)
		this.input.keyboard!.on('keydown-UP', () => this.moveSelection(-1));
		this.input.keyboard!.on('keydown-DOWN', () => this.moveSelection(1));
		this.input.keyboard!.on('keydown-ENTER', () => this.activateSelection());
		this.input.keyboard!.once('keydown-U', () => this.openPowerUp());
		this.input.keyboard!.once('keydown-D', () => this.openCodex());
		this.input.keyboard!.on('keydown-O', () => this.openSettings());
		this.input.keyboard!.on('keydown-ESC', () => this.closeSettings());
		// 게임패드 — 메뉴에서도 십자키/A/B 가 먹어야 한다 (미연결이면 비용 0)
		GamepadSystem.attach(this);
		this.input.keyboard!.on('keydown-M', () => {
			const muted = !loadSettings().muted;
			saveSettings({ muted });
			this.sound.mute = muted;
			BgmSystem.peek()?.refreshVolume();
			this.audioUi?.refresh();
		});
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.closeSettings());

		for (const child of this.children.list.slice(backdropCount)) {
			if (child !== ui.root) {
				ui.root.add(child);
			}
		}
		ui.sort();

		if (import.meta.env.DEV) {
			// 도감·도전과제 회귀 테스트 훅 (meta-test.mjs) — 런을 시작하지 않고도 검사 가능
			window.__codex = codexApi;
			window.__stats = statsApi;
			window.__telemetry = telemetryApi; // 도감 "기록" 탭 회귀 테스트용
			window.__achievements = AchievementSystem;
			window.__titleScene = this; // 설정 창 갈래(조작) 레이아웃 QA (polish-test.mjs)
			window.__keybinds = keybindsApi; // 키 리맵 회귀 테스트용
		}

		// 입장 연출 1회: UI 전체가 짧게 떠오른다 (반복 없음)
		if (!reduceMotion()) {
			ui.root.setAlpha(0);
			ui.root.y = 10;
			this.tweens.add({ targets: ui.root, alpha: 1, y: 0, duration: 420, ease: 'Quad.easeOut' });
		}
	}

	/**
	 * 배경 — 픽셀아트 일러스트 한 장(public/ui/title-bg.webp)을 화면에 꽉 채운다.
	 *
	 * cover 방식(가로·세로 배율 중 큰 쪽)이라 화면비가 달라도 여백이 생기지 않고
	 * 넘치는 쪽만 잘린다. 그림 자체가 좌측을 어둡게 깔아 두었지만, 아주 넓은
	 * 화면에서는 그 어두운 기둥이 잘려 나갈 수 있으므로 좌측 스크림을 한 겹 덧댄다
	 * (메뉴 글자의 대비를 그림 비율에 맡기지 않는다).
	 *
	 * 텍스처가 없으면(구형 브라우저의 webp 미지원 등) 예전 절차적 밤하늘로 내려간다.
	 */
	private drawBackdrop(sw: number, sh: number) {
		this.add.rectangle(sw / 2, sh / 2, sw, sh, UI.bg, 1);

		if (this.textures.exists('title-bg')) {
			const source = this.textures.get('title-bg').getSourceImage();
			const scale = Math.max(sw / source.width, sh / source.height);
			this.add.image(sw / 2, sh / 2, 'title-bg')
				.setScale(scale)
				.setScrollFactor(0);

			// 좌측 스크림 — 메뉴가 앉는 폭만큼 어둠을 보강한다
			const scrim = this.add.graphics();
			scrim.fillGradientStyle(0x080b10, 0x080b10, 0x080b10, 0x080b10, 0.72, 0, 0.72, 0);
			scrim.fillRect(0, 0, sw * 0.46, sh);
			// 상하 비네트 — 로고와 하단 안내가 그림 위에서 뜨게
			scrim.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0.7, 0.7, 0, 0);
			scrim.fillRect(0, 0, sw, sh * 0.26);
			scrim.fillGradientStyle(0x05070a, 0x05070a, 0x05070a, 0x05070a, 0, 0, 0.62, 0.62);
			scrim.fillRect(0, sh * 0.76, sw, sh * 0.24);
			return;
		}

		// ── 폴백: 식은 쇠의 밤 (일러스트를 못 읽을 때만 그린다)
		const bgG = this.add.graphics();
		bgG.fillGradientStyle(0x1a2129, 0x1a2129, UI.bg, UI.bg, 1);
		bgG.fillRect(0, 0, sw, sh * 0.55);
		for (let i = 0; i < 46; i += 1) {
			bgG.fillStyle(0xaeb9c2, Phaser.Math.FloatBetween(0.04, 0.2));
			bgG.fillCircle(Phaser.Math.Between(0, sw), Phaser.Math.Between(0, Math.floor(sh * 0.7)), Phaser.Math.FloatBetween(0.6, 1.5));
		}
		for (let i = 8; i >= 1; i -= 1) {
			bgG.fillStyle(UI.emberDeep, 0.016 * i);
			bgG.fillEllipse(sw / 2, sh * 0.76, sw * (0.9 - i * 0.07), 60 + i * 22);
		}
		const ground = this.add.graphics();
		const drawRidge = (baseY: number, amp: number, color: number, alpha: number, spires: number) => {
			ground.fillStyle(color, alpha);
			ground.beginPath();
			ground.moveTo(0, sh);
			ground.lineTo(0, baseY);
			const seg = Math.max(6, spires);
			for (let i = 0; i <= seg; i += 1) {
				const x = (sw / seg) * i;
				const jag = (i % 2 === 0 ? 1 : -0.4) * Phaser.Math.FloatBetween(0.4, 1) * amp;
				ground.lineTo(x, baseY - jag);
			}
			ground.lineTo(sw, sh);
			ground.closePath();
			ground.fillPath();
		};
		drawRidge(sh * 0.68, 42, 0x0d1014, 0.9, 9);
		drawRidge(sh * 0.76, 58, 0x080a0d, 0.97, 7);
		ground.fillStyle(0x000000, 0.62);
		ground.fillRect(0, sh * 0.88, sw, sh * 0.12);
	}

	/**
	 * 화면 테두리 — 목업에서 오려 낸 귀퉁이 4개 + 그 사이를 잇는 헤어라인.
	 *
	 * 귀퉁이 그림 안에서 가로선은 위에서 6px, 세로선은 왼쪽에서 4px 자리에 있다
	 * (corner.png 는 목업 (4,4)~(50,50) 을 오린 것). 이어 그리는 선을 그 자리에
	 * 맞춰야 이음매가 보이지 않는다.
	 */
	private drawScreenFrame(width: number, height: number) {
		const S = TITLE_PX;
		const inset = 10;
		const size = 46 * S;
		for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
			const x = sx > 0 ? inset : width - inset - size;
			const y = sy > 0 ? inset : height - inset - size;
			this.add.image(x + size / 2, y + size / 2, 't-corner')
				.setScale(sx * S, sy * S);
		}
		const g = this.add.graphics();
		g.lineStyle(1, 0x6b7a86, 0.5);
		const lx = inset + 4 * S;
		const rx = width - inset - 4 * S;
		const ty = inset + 6 * S;
		const by = height - inset - 6 * S;
		g.strokeLineShape(new Phaser.Geom.Line(inset + size, ty, width - inset - size, ty));
		g.strokeLineShape(new Phaser.Geom.Line(inset + size, by, width - inset - size, by));
		g.strokeLineShape(new Phaser.Geom.Line(lx, inset + size, lx, height - inset - size));
		g.strokeLineShape(new Phaser.Geom.Line(rx, inset + size, rx, height - inset - size));
	}

	/**
	 * 좌측 메뉴 한 줄.
	 *
	 * 목업 두 장(기본 / 강조)에서 오려 낸 텍스처를 겹쳐 두고 알파만 맞바꾼다 —
	 * 강조 그림 자체가 이미 "주황 프레임 + 노란 귀꺾쇠 + 잉걸 몸통"이라, 코드로
	 * 발광을 흉내 낼 필요가 없다. 강조 그림은 목업대로 기본보다 사방이 크므로
	 * 컨테이너를 키우지 않아도 커 보인다(자리는 그대로라 줄이 흔들리지 않는다).
	 */
	private addMenuEntry(
		x: number, y: number, label: string, iconKey: string,
		opts: { sub?: string; activate: () => void },
	) {
		const index = this.menu.length;
		const S = TITLE_PX;
		const left = -(BTN_W / 2) * S;

		const base = this.add.nineslice(0, 0, 't-btn', 0, BTN_W, BTN_H, BTN_CAP, BTN_CAP, 0, 0).setScale(S);
		const hi = this.add.nineslice(0, 0, 't-btn-hi', 0, HI_W, HI_H, HI_CAP, HI_CAP, 0, 0)
			.setScale(S).setAlpha(0);

		const icon = this.add.image(left + BTN_ICON_CX * S, 0, iconKey).setScale(S);
		// 강조 시 아이콘이 타오르는 느낌 — 같은 아이콘을 ADD 로 한 겹 더 얹는다.
		// 틴트만으로는 은색이 "주황으로 칠해질" 뿐 목업처럼 빛나지 않는다.
		const iconGlow = this.add.image(icon.x, 0, iconKey)
			.setScale(S).setTint(HI_TINT).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);

		const text = this.add.text(left + BTN_LABEL_X * S, opts.sub ? -9 : 0, label,
			style(BTN_LABEL_SIZE * S, UI.white, { display: true })).setOrigin(0, 0.5);
		text.setShadow(0, 2, '#000000', 5, false, true);

		let sub: Phaser.GameObjects.Text | null = null;
		if (opts.sub) {
			sub = this.add.text(left + BTN_LABEL_X * S, 15, opts.sub, style(13, UI.textDim))
				.setOrigin(0, 0.5);
		}

		// 좌우 지시자 — 강조 줄에만 나타난다. 목업에서 왼쪽은 꽉 찬 ◀, 오른쪽은 빈 ❯ 로
		// 모양이 다르므로 각각의 텍스처를 쓴다 (뒤집어 쓰면 목업과 달라진다).
		const marks: Phaser.GameObjects.Image[] = [
			this.add.image(-(BTN_W / 2 + MARK_GAP) * S, 0, 't-mark-l').setScale(S).setAlpha(0),
			this.add.image((BTN_W / 2 + MARK_GAP) * S, 0, 't-mark-r').setScale(S).setAlpha(0),
		];

		const parts = [base, hi, icon, iconGlow, text, ...marks];
		if (sub) parts.push(sub);
		const root = this.add.container(x, y, parts);
		// 판정 영역은 **강조 그림이 아니라 기본 버튼 크기 × 줄 간격**으로 잡는다.
		// 강조 그림(118)이 줄 간격(100)보다 커서, 그대로 쓰면 위아래 줄의 판정이
		// 겹쳐 경계에서 어느 줄이 잡힐지 모르게 된다.
		const hitW = BTN_W * S;
		const hitH = BTN_STEP * S;
		root.setSize(hitW, hitH);
		root.setInteractive({
			hitArea: new Phaser.Geom.Rectangle(0, 0, hitW, hitH),
			hitAreaCallback: Phaser.Geom.Rectangle.Contains,
			useHandCursor: true,
		});
		root.on('pointerover', () => { this.selected = index; this.applySelection(); });
		// 마우스를 치웠다고 선택이 사라지면 안 된다 — 키보드로 골라 둔 줄을 되살린다
		root.on('pointerout', () => this.applySelection());
		root.on('pointerdown', () => opts.activate());

		// iconGlow 만 정점이 낮다 — ADD 를 1.0 으로 얹으면 주황이 아니라 흰색으로 타 버린다
		const fade: Array<[Phaser.GameObjects.NineSlice | Phaser.GameObjects.Image, number]> = [
			[hi, 1], [iconGlow, 0.45], [marks[0], 1], [marks[1], 1],
		];
		const setHighlighted = (on: boolean) => {
			if (!root.scene || !root.active) return;
			for (const [obj, peak] of fade) {
				this.tweens.killTweensOf(obj);
				if (reduceMotion()) {
					obj.setAlpha(on ? peak : 0);
				} else {
					this.tweens.add({ targets: obj, alpha: on ? peak : 0, duration: 130, ease: 'Quad.easeOut' });
				}
			}
			// 아이콘·글자도 목업처럼 잉걸빛으로 물든다 (틴트는 곱연산이라 은색이 주황이 된다)
			icon.setTint(on ? HI_TINT : 0xffffff);
			text.setColor(on ? HI_TEXT : UI.white);
			text.setShadow(0, 2, on ? '#7a2c05' : '#000000', on ? 8 : 5, false, true);
			sub?.setColor(on ? HI_TEXT : UI.textDim);
		};

		root.once(Phaser.GameObjects.Events.DESTROY, () => {
			for (const [obj] of fade) this.tweens.killTweensOf(obj);
		});
		this.menu.push({ root, setHighlighted, activate: opts.activate });
	}

	private applySelection() {
		this.menu.forEach((entry, i) => entry.setHighlighted(i === this.selected));
	}

	private moveSelection(delta: number) {
		if (this.settingsRoot || this.menu.length === 0) {
			return;
		}
		this.selected = (this.selected + delta + this.menu.length) % this.menu.length;
		this.applySelection();
		this.uiClick();
	}

	private activateSelection() {
		if (this.settingsRoot) {
			return;
		}
		this.menu[this.selected]?.activate();
	}

	/** 균열에서 떠오르는 잉걸 불티 하나 (풀 없이 소량 생성·자멸) */
	private spawnEmber(sw: number, sh: number, midair = false) {
		const x = Phaser.Math.Between(Math.floor(sw * 0.06), Math.floor(sw * 0.94));
		const startY = midair ? Phaser.Math.Between(Math.floor(sh * 0.4), sh) : sh + 4;
		const r = Phaser.Math.FloatBetween(0.8, 2);
		const warm = Math.random() < 0.25 ? UI.straw : UI.ember;
		const dot = this.add.circle(x, startY, r, warm, Phaser.Math.FloatBetween(0.35, 0.8)).setDepth(2);
		this.tweens.add({
			targets: dot,
			y: startY - Phaser.Math.Between(Math.floor(sh * 0.35), Math.floor(sh * 0.7)),
			x: x + Phaser.Math.Between(-40, 40),
			alpha: 0,
			duration: Phaser.Math.Between(5200, 8600),
			ease: 'Sine.easeOut',
			onComplete: () => dot.destroy(),
		});
	}

	/** UI 클릭음 — 설정의 효과음 음량을 따른다 */
	private uiClick() {
		if (this.cache.audio.exists('click')) {
			this.sound.play('click', { volume: 0.55 * sfxVolume() * SFX_BASE });
		}
	}

	/**
	 * 설정 창 — 갈래 2개.
	 *   [소리·화면] 음량 슬라이더 · 음소거 · 접근성 토글 + 조작 안내 + 튜토리얼 다시 보기
	 *   [조작]      키 리맵 목록 (core/keybinds)
	 * 갈래로 나눈 이유: 조작 목록 9줄이 기존 2단 구성에 들어가면 830px 디자인 높이를 넘는다.
	 */
	openSettings() {
		if (this.settingsRoot) {
			return;
		}
		this.uiClick();

		const overlay = dimVignette(this, 3000, 0.8);
		const root = createUiRoot(this, 3001);
		this.settingsRoot = root;
		this.settingsObjects = overlay;
		const cx = root.width / 2;
		const cy = root.height / 2;
		const panelW = Math.min(900, root.width - 80);
		// 600 — '조작' 갈래의 9줄 목록 + 상태줄 + 되돌리기 버튼이 닫기 버튼과 겹치지 않는 최소 높이
		const panelH = 600;

		const shell: Phaser.GameObjects.GameObject[] = [
			panel(this, cx, cy, panelW, panelH, { origin: 0.5 }),
			this.add.text(cx, cy - panelH / 2 + 34, '설정', style(26, UI.text, { display: true })).setOrigin(0.5),
			divider(this, cx, cy - panelH / 2 + 58, panelW - 160),
		];

		const close = button(this, cx, cy + panelH / 2 - 42, 200, 44, '닫기', {
			variant: 'gold', fontSize: 16, display: true, key: 'ESC',
			onClick: () => this.closeSettings(),
		});
		shell.push(close.container);

		// ── 갈래 버튼
		const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
			{ id: 'general', label: '소리 · 화면', icon: 'g-bird' },
			{ id: 'controls', label: '조작', icon: 'g-anvil' },
		];
		const tabW = 190;
		const tabButtons: UiButton[] = [];
		tabs.forEach((tab, index) => {
			const b = button(this, cx + (index - (tabs.length - 1) / 2) * (tabW + 12), cy - panelH / 2 + 92,
				tabW, 40, tab.label, {
					variant: this.settingsTab === tab.id ? 'gold' : 'dark', fontSize: 15, display: true, icon: tab.icon,
					onClick: () => {
						if (this.settingsTab === tab.id) return;
						this.settingsTab = tab.id;
						this.uiClick();
						this.buildSettingsBody();
						tabButtons.forEach((btn, i) => btn.redraw(tabs[i].id === this.settingsTab ? 'gold' : 'dark'));
					},
				});
			tabButtons.push(b);
			shell.push(b.container);
		});

		this.settingsShell = shell;
		for (const object of shell) {
			root.root.add(object);
		}
		this.buildSettingsBody();
	}

	/** 갈래 내용만 다시 그린다 (껍데기·갈래 버튼은 유지) */
	private buildSettingsBody() {
		const root = this.settingsRoot;
		if (!root) {
			return;
		}
		this.audioUi?.destroy();
		this.audioUi = null;
		this.keybindUi?.destroy();
		this.keybindUi = null;
		for (const object of this.settingsBody) {
			object.destroy();
		}
		this.settingsBody = [];

		const cx = root.width / 2;
		const cy = root.height / 2;
		const panelW = Math.min(900, root.width - 80);
		// 600 — '조작' 갈래의 9줄 목록 + 상태줄 + 되돌리기 버튼이 닫기 버튼과 겹치지 않는 최소 높이
		const panelH = 600;
		const bodyTop = cy - panelH / 2 + 124;

		if (this.settingsTab === 'controls') {
			const listW = panelW - 96;
			this.keybindUi = createKeybindPanel(this, cx - listW / 2, bodyTop, listW, {
				scale: 0.88,
				onClickSound: () => this.uiClick(),
				// 키가 바뀌면 이 창 밖의 안내(튜토리얼·마을 프롬프트)도 다음 그리기부터 반영된다
				onChange: () => {},
			});
			for (const object of this.keybindUi.objects) {
				root.root.add(object);
			}
			const note = this.add.text(cx, bodyTop + this.keybindUi.height + 16,
				'방향키 이동 · ESC · M · R · T · 1~4 는 고정입니다 (되돌리지 못하는 사고 방지)',
				style(11.5, UI.textFaint, { bold: false })).setOrigin(0.5);
			this.settingsBody.push(note);
			root.root.add(note);
			root.sort();
			return;
		}

		// ── 소리 · 화면
		const colW = (panelW - 100) / 2;
		const leftX = cx - colW - 20;
		const rightX = cx + 20;

		this.audioUi = createAudioSettings(this, leftX, bodyTop, colW);
		for (const object of this.audioUi.objects) {
			root.root.add(object);
		}

		const toggles: Array<{ label: () => string; onClick: () => void }> = [
			{
				label: () => (loadSettings().screenShake ? '화면 흔들림: 켬' : '화면 흔들림: 끔'),
				onClick: () => { saveSettings({ screenShake: !loadSettings().screenShake }); },
			},
			{
				label: () => (loadSettings().reduceMotion ? '모션 줄이기: 켬' : '모션 줄이기: 끔'),
				onClick: () => { saveSettings({ reduceMotion: !loadSettings().reduceMotion }); },
			},
			{
				// 타격 순간의 짧은 정지 — 모션 줄이기와 별개 축
				label: () => (loadSettings().hitStop ? '히트스톱: 켬' : '히트스톱: 끔'),
				onClick: () => { saveSettings({ hitStop: !loadSettings().hitStop }); },
			},
		];
		toggles.forEach((toggle, index) => {
			const b = button(this, leftX + colW / 2, bodyTop + 190 + index * 50, colW, 44, toggle.label(), {
				variant: 'dark', fontSize: 15, display: true,
				onClick: () => { toggle.onClick(); b.setLabel(toggle.label()); },
			});
			this.settingsBody.push(b.container);
		});

		// ── 우측 단: 조작 안내 + 튜토리얼 다시 보기 (리맵을 반영해 매번 계산)
		const controls = createControlsPanel(this, rightX, bodyTop - 10, colW, {
			rows: allControlRows(),
			title: '조작',
			scale: 0.86,
		});
		this.settingsBody.push(...controls.objects);

		const replayLabel = () => (isReplayRequested()
			? '튜토리얼 예약됨 — 다음 출격에 재생'
			: '튜토리얼 다시 보기');
		const replaySub = () => (isTutorialDone() || isReplayRequested()
			? '다음 출격에서 첫 런 안내를 다시 봅니다'
			: '첫 출격에 자동으로 재생됩니다');
		const replay = button(this, rightX + colW / 2, bodyTop - 10 + controls.height + 34, colW, 48, replayLabel(), {
			variant: 'dark', fontSize: 14, display: true, icon: 'g-scroll',
			sub: replaySub(),
			onClick: () => {
				requestTutorialReplay();
				replay.setLabel(replayLabel());
				replay.sub?.setText(replaySub());
				this.uiClick();
			},
		});
		this.settingsBody.push(replay.container);

		for (const object of this.settingsBody) {
			root.root.add(object);
		}
		root.sort();
	}

	closeSettings() {
		if (!this.settingsRoot) {
			return;
		}
		this.audioUi?.destroy();
		this.audioUi = null;
		this.keybindUi?.destroy();
		this.keybindUi = null;
		for (const object of this.settingsBody) {
			object.destroy();
		}
		this.settingsBody = [];
		for (const object of this.settingsShell) {
			object.destroy();
		}
		this.settingsShell = [];
		this.settingsRoot.destroy();
		this.settingsRoot = null;
		for (const object of this.settingsObjects) {
			object.destroy();
		}
		this.settingsObjects = [];
	}

	startGame() {
		if (this.settingsRoot) {
			this.input.keyboard!.once('keydown-SPACE', () => this.startGame());
			return;
		}
		this.uiClick();
		this.scene.start('CharacterSelectScene');
	}

	continueRun() {
		if (this.settingsRoot) {
			this.input.keyboard!.once('keydown-C', () => this.continueRun());
			return;
		}
		this.uiClick();
		this.scene.start('GameScene', { resume: true });
	}

	openPowerUp() {
		if (this.settingsRoot) {
			this.input.keyboard!.once('keydown-U', () => this.openPowerUp());
			return;
		}
		this.uiClick();
		this.scene.start('PowerUpScene');
	}

	/** 도감 (검 도감 + 도전과제) */
	openCodex() {
		if (this.settingsRoot) {
			this.input.keyboard!.once('keydown-D', () => this.openCodex());
			return;
		}
		this.uiClick();
		this.scene.start('CodexScene');
	}
}
