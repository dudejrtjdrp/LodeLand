// 공용 툴팁 컴포넌트 (2026-09-01 온보딩 정보 계층)
//
// 게임 전체가 이 하나의 구현을 쓴다 — 상점(ShopUi), 레벨업 카드, 증강 카드,
// TAB 캐릭터창 스탯 항목. 이전에는 화면마다 자체 구현이 있어 여백·색·클램프
// 규칙이 제각각이었다.
//
// 규약
//  - Flat 팩 panel() 만 쓴다 (절차 드로잉 금지).
//  - 화면(또는 소속 UiRoot) 안쪽으로 클램프한다.
//  - 호버로만 뜨고, pointerout / 파괴 / 씬 셧다운에 반드시 사라진다.
//  - 텍스트는 호버 때만 만들어진다 — 전투 핫패스에 부담이 없다.

import Phaser from 'phaser';
import { UI, style, panel, divider, type UiRoot } from './theme';
import { findKeyword, keywordFooter } from './keywords';

export interface TooltipContent {
	title: string;
	body: string;
	/** 제목 색 (기본 담금 청) */
	accent?: string;
	/** 하단 각주 (용어 사전 등). 비우면 그리지 않는다. */
	footer?: string;
}

export interface TooltipOptions {
	/** 렌더 depth (기본 3600 — 상점 모달·HUD 위) */
	depth?: number;
	/** 본문 줄바꿈 폭 */
	wrapWidth?: number;
	/**
	 * 소속 UiRoot. 지정하면 툴팁이 그 컨테이너 안에서(디자인 좌표계로) 그려지고
	 * 클램프도 루트 크기를 기준으로 한다.
	 */
	root?: UiRoot | null;
}

export class Tooltip {
	private scene: Phaser.Scene;
	private container: Phaser.GameObjects.Container | null = null;
	private depth: number;
	private wrapWidth: number;
	private root: UiRoot | null;
	private destroyed = false;

	constructor(scene: Phaser.Scene, options: TooltipOptions = {}) {
		this.scene = scene;
		this.depth = options.depth ?? 3600;
		this.wrapWidth = options.wrapWidth ?? 264;
		this.root = options.root ?? null;
	}

	/** 소속 UiRoot 를 나중에 바꾼다 (상점처럼 창을 여닫으며 루트가 재생성되는 경우) */
	setRoot(root: UiRoot | null): void {
		this.hide();
		this.root = root;
	}

	get isVisible(): boolean {
		return Boolean(this.container);
	}

	/** 현재 툴팁의 제목 (테스트·디버그용) */
	get currentTitle(): string | null {
		if (!this.container) {
			return null;
		}
		const first = this.container.list.find((child) => child instanceof Phaser.GameObjects.Text);
		return first ? (first as Phaser.GameObjects.Text).text : null;
	}

	show(anchorX: number, anchorY: number, content: TooltipContent): void {
		if (this.destroyed || !this.scene.sys?.displayList) {
			return;
		}
		this.hide();

		const scene = this.scene;
		const titleText = scene.add.text(0, 0, content.title, style(13.5, content.accent ?? UI.quenchText, { display: true }));
		const bodyText = scene.add.text(0, 0, content.body, {
			...style(12, UI.text, { bold: false }),
			lineSpacing: 4,
			wordWrap: { width: this.wrapWidth },
		});

		const parts: Phaser.GameObjects.GameObject[] = [];
		let footerText: Phaser.GameObjects.Text | null = null;
		if (content.footer) {
			footerText = scene.add.text(0, 0, content.footer, {
				...style(11, UI.textFaint, { bold: false }),
				lineSpacing: 3,
				wordWrap: { width: this.wrapWidth },
			});
		}

		const contentW = Math.max(titleText.width, bodyText.width, footerText?.width ?? 0);
		const w = contentW + 26;
		let cursorY = 9;
		titleText.setPosition(13, cursorY);
		cursorY += titleText.height + 6;
		bodyText.setPosition(13, cursorY);
		cursorY += bodyText.height;

		let separator: Phaser.GameObjects.Image | null = null;
		if (footerText) {
			cursorY += 8;
			separator = divider(scene, w / 2, cursorY, w - 26);
			cursorY += 8;
			footerText.setPosition(13, cursorY);
			cursorY += footerText.height;
		}
		const h = cursorY + 12;

		const bg = panel(scene, 0, 0, w, h);
		parts.push(bg, titleText, bodyText);
		if (separator) {
			parts.push(separator);
		}
		if (footerText) {
			parts.push(footerText);
		}

		const container = scene.add.container(anchorX - w / 2, anchorY - h - 12, parts)
			.setScrollFactor(0).setDepth(this.depth);

		const boundsW = this.root?.width ?? scene.scale.width;
		const boundsH = this.root?.height ?? scene.scale.height;
		container.x = Phaser.Math.Clamp(container.x, 8, Math.max(8, boundsW - w - 8));
		if (container.y < 8) {
			container.y = anchorY + 26;
		}
		container.y = Phaser.Math.Clamp(container.y, 8, Math.max(8, boundsH - h - 8));

		if (this.root) {
			this.root.add(container);
			this.root.sort();
		}

		this.container = container;
	}

	hide(): void {
		this.container?.destroy();
		this.container = null;
	}

	destroy(): void {
		this.hide();
		this.destroyed = true;
	}
}

/** 호버 대상에 붙일 수 있는 최소 인터페이스 */
type HoverTarget = Phaser.GameObjects.GameObject & {
	on(event: string, fn: (...args: unknown[]) => void): unknown;
	setInteractive(config?: unknown): unknown;
};

export interface AttachOptions {
	/** 툴팁이 뜰 화면 좌표 (미지정 시 대상의 월드 좌표 위) */
	anchor?: () => { x: number; y: number };
	/** 이미 setInteractive 된 대상이면 false */
	makeInteractive?: boolean;
	/** 손 커서 표시 */
	useHandCursor?: boolean;
}

/**
 * 대상에 호버 툴팁을 붙인다.
 * provider 가 null 을 돌려주면 그 호버는 무시된다 (조건부 툴팁).
 */
export function attachTooltip(
	tooltip: Tooltip,
	target: HoverTarget,
	provider: () => TooltipContent | null,
	options: AttachOptions = {},
): void {
	const { anchor, makeInteractive = true, useHandCursor = false } = options;

	if (makeInteractive) {
		target.setInteractive({ useHandCursor });
	}

	target.on('pointerover', () => {
		const content = provider();
		if (!content) {
			return;
		}
		const point = anchor?.() ?? defaultAnchor(target);
		tooltip.show(point.x, point.y, content);
	});
	target.on('pointerout', () => tooltip.hide());
	target.on('destroy', () => tooltip.hide());
}

function defaultAnchor(target: HoverTarget): { x: number; y: number } {
	const obj = target as unknown as {
		x?: number; y?: number; displayHeight?: number; height?: number;
		parentContainer?: Phaser.GameObjects.Container | null;
	};
	let x = obj.x ?? 0;
	let y = obj.y ?? 0;
	// 컨테이너 안에 있으면 부모 오프셋을 더해 화면(또는 루트) 좌표로 올린다
	let parent = obj.parentContainer ?? null;
	while (parent) {
		x += parent.x;
		y += parent.y;
		parent = parent.parentContainer ?? null;
	}
	const half = (obj.displayHeight ?? obj.height ?? 0) / 2;
	return { x, y: y - half };
}

/**
 * 카드/상품 설명에 용어 각주를 자동으로 붙인 툴팁 내용을 만든다.
 * (`용어` 블록은 keywords.ts 사전에서 뽑는다)
 */
export function withKeywordFooter(title: string, body: string, accent?: string): TooltipContent {
	// 제목 자체가 사전 항목이면 사전 설명을 본문 뒤에 이어 붙인다
	const direct = findKeyword(title);
	const merged = direct && !body.includes(direct.body.split('\n')[0])
		? `${body}\n\n${direct.body}`
		: body;
	return {
		title,
		body: merged,
		accent,
		footer: keywordFooter(`${title} ${body}`),
	};
}
