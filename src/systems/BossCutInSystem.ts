// 보스 등장 컷인 — 2026-09-01.
//
// 보스가 스폰되는 순간 화면 상단(보스 HP바 아래)에 경고 스트라이프 배너를 1.2초
// 띄운다. BossBarSystem 은 스폰 다음 틱(≤120ms)에 보스바를 만들고, BgmSystem 은
// bossBar.hasBoss 를 폴링해 보스 트랙으로 넘어간다 — 컷인은 그 둘보다 위(depth)에
// 뜨되 자리를 비켜서 겹치지 않는다.
//
// 성능 규약: 컨테이너 하나를 만들어 계속 재사용한다 (등장마다 오브젝트 생성 없음).
// 모션 줄이기 설정이면 트윈 없이 짧게(0.7초) 정적 표시한다.

import Phaser from 'phaser';
import { reduceMotion, screenShakeEnabled } from '../core/settings';
import { UI, FONT, style, hudScaleFor, TEXT_RESOLUTION } from '../ui/theme';
import type GameScene from '../scenes/GameScene';

const DEPTH = 1200;
/** 표시 시간 (모션 줄이기: 축소판) */
const HOLD_MS = 1200;
const HOLD_MS_REDUCED = 700;

export default class BossCutInSystem {
	scene: GameScene;
	private root: Phaser.GameObjects.Container | null = null;
	private stripes: Phaser.GameObjects.Graphics | null = null;
	private nameText: Phaser.GameObjects.Text | null = null;
	private tagText: Phaser.GameObjects.Text | null = null;
	private timer: Phaser.Time.TimerEvent | null = null;
	private destroyed = false;
	/** 마지막 컷인 시각 — 같은 프레임에 쌍보스가 스폰돼도 배너는 하나만 */
	private lastShownAt = -Infinity;
	private lastName = '';
	/** 회귀 테스트/디버그용: 지금 배너가 떠 있는가 */
	visible = false;
	/** 지금까지 띄운 컷인 횟수 */
	shownCount = 0;

	constructor(scene: GameScene) {
		this.scene = scene;
		// 창 크기가 바뀌면 캐시된 배너(폭·HUD 배율 고정)를 버리고 다음 등장 때 다시 만든다
		scene.scale.on('resize', this.onResize, this);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			scene.scale.off('resize', this.onResize, this);
		});
	}

	private onResize(): void {
		if (!this.root) {
			return;
		}
		this.hide();
		this.scene.tweens.killTweensOf(this.root);
		this.root.destroy();
		this.root = null;
		this.stripes = null;
		this.nameText = null;
		this.tagText = null;
	}

	private build(): Phaser.GameObjects.Container {
		if (this.root) {
			return this.root;
		}
		const scene = this.scene;
		const hs = hudScaleFor(scene);
		const w = Math.min(scene.scale.width * 0.86, 720 * hs);
		const h = 84 * hs;

		// 배경 판 + 경고 스트라이프 (Graphics 한 장 — 컨테이너 로컬 좌표)
		const g = scene.add.graphics();
		g.fillStyle(0x0a0d10, 0.9);
		g.fillRect(-w / 2, -h / 2, w, h);
		// 위·아래 경고 띠 (잉걸 사선 스트라이프)
		const bandH = 9 * hs;
		g.fillStyle(UI.emberDeep, 0.55);
		g.fillRect(-w / 2, -h / 2, w, bandH);
		g.fillRect(-w / 2, h / 2 - bandH, w, bandH);
		const stripeW = 13 * hs;
		for (let x = -w / 2; x < w / 2; x += stripeW * 2) {
			g.fillStyle(UI.ember, 0.85);
			// 위 띠: ◺ / 아래 띠: ◹ — 서로 반대 방향으로 흘러 "경고 테이프"처럼 읽힌다
			g.fillTriangle(x, -h / 2, x + stripeW, -h / 2, x, -h / 2 + bandH);
			g.fillTriangle(x + stripeW, -h / 2 + bandH, x + stripeW * 2, -h / 2 + bandH, x + stripeW * 2, -h / 2);
			g.fillTriangle(x, h / 2, x + stripeW, h / 2, x + stripeW, h / 2 - bandH);
			g.fillTriangle(x + stripeW, h / 2 - bandH, x + stripeW * 2, h / 2 - bandH, x + stripeW * 2, h / 2);
		}
		g.lineStyle(1.5 * hs, UI.rust, 0.95);
		g.strokeRect(-w / 2, -h / 2, w, h);
		this.stripes = g;

		this.tagText = scene.add.text(0, -h / 2 + 20 * hs, '보스 출현', style(12 * hs, UI.emberText, { display: true }))
			.setOrigin(0.5);
		this.nameText = scene.add.text(0, 8 * hs, '', {
			fontFamily: FONT.display,
			resolution: TEXT_RESOLUTION,
			fontSize: `${30 * hs}px`,
			fontStyle: '900',
			color: UI.white,
			letterSpacing: 3,
		}).setOrigin(0.5);
		this.nameText.setShadow(0, 3, '#000000', 8, false, true);

		this.root = scene.add.container(0, 0, [g, this.tagText, this.nameText])
			.setScrollFactor(0)
			.setDepth(DEPTH)
			.setVisible(false);
		return this.root;
	}

	/**
	 * 보스 등장 배너를 띄운다. 같은 라운드에 보스가 연달아 스폰되면(쌍보스)
	 * 0.6초 안의 중복 호출은 무시한다 — 배너가 겹쳐 깜빡이는 것을 막는다.
	 */
	show(bossName: string): void {
		if (this.destroyed || !this.scene?.scene?.isActive?.()) {
			return;
		}
		const now = this.scene.time.now;
		if (now - this.lastShownAt < 600 && bossName === this.lastName) {
			return;
		}
		this.lastShownAt = now;
		this.lastName = bossName;
		this.shownCount += 1;

		const scene = this.scene;
		const hs = hudScaleFor(scene);
		const root = this.build();
		if (this.nameText) {
			this.nameText.setScale(1);
			this.nameText.setText(bossName);
			// 어픽스 접두어가 붙은 긴 이름(예: "Regenerating Needle Queen")도 배너 밖으로
			// 넘치지 않게 가로로만 줄인다
			const maxW = Math.min(scene.scale.width * 0.86, 720 * hs) - 48 * hs;
			if (this.nameText.width > maxW) {
				this.nameText.setScale(maxW / this.nameText.width, 1);
			}
		}

		// 보스 HP바(상단 122~290 * hs)를 피해 그 아래에 자리 잡는다
		const x = scene.scale.width / 2;
		const y = Math.max(scene.scale.height * 0.34, 330 * hs);
		root.setPosition(x, y).setVisible(true).setAlpha(1).setScale(1);
		this.visible = true;

		scene.tweens.killTweensOf(root);
		this.timer?.remove();

		const reduced = reduceMotion();
		if (!reduced) {
			root.setAlpha(0);
			root.setScale(1.14, 0.6);
			scene.tweens.add({
				targets: root,
				alpha: 1,
				scaleX: 1,
				scaleY: 1,
				duration: 200,
				ease: 'Back.easeOut',
			});
			if (screenShakeEnabled()) {
				scene.cameras.main.shake(160, 0.004);
			}
		}

		this.timer = scene.time.delayedCall(reduced ? HOLD_MS_REDUCED : HOLD_MS, () => {
			this.timer = null;
			if (this.destroyed || !this.root) {
				return;
			}
			if (reduced) {
				this.root.setVisible(false);
				this.visible = false;
				return;
			}
			scene.tweens.add({
				targets: this.root,
				alpha: 0,
				duration: 260,
				ease: 'Quad.easeIn',
				onComplete: () => {
					this.root?.setVisible(false);
					this.visible = false;
				},
			});
		});
	}

	/** 즉시 감춘다 (일시정지·결과 화면 등) */
	hide(): void {
		this.timer?.remove();
		this.timer = null;
		if (this.root) {
			this.scene.tweens.killTweensOf(this.root);
			this.root.setVisible(false);
		}
		this.visible = false;
	}

	setVisible(flag: boolean): void {
		if (!flag) {
			this.hide();
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.scene.scale.off('resize', this.onResize, this);
		this.timer?.remove();
		this.timer = null;
		if (this.root) {
			this.scene.tweens.killTweensOf(this.root);
			this.root.destroy();
			this.root = null;
		}
		this.stripes = null;
		this.nameText = null;
		this.tagText = null;
		this.visible = false;
	}
}
