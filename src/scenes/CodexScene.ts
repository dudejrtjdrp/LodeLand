// 도감 화면 (2026-09-01) — 타이틀에서 여는 메타 진행 열람 화면.
//
// 세 갈래:
//   1) 검 도감 — 186종을 등급·원소로 걸러 열람. 획득한 적 있는 검만 컬러로 보이고
//      미획득은 실루엣 + ???. 셀을 고르면 우측에 상세(스탯·로어·조합식)가 뜬다.
//   2) 도전과제 — 20종의 달성/미달성과 진행도 바.
//   3) 기록 — 최근 런 50개(로컬 텔레메트리)와 요약 통계. 밸런스 튜닝의 실측 근거다.
//
// 성능 규약: 186칸을 한 번에 만들지 않는다. 페이지당 최대 cols×rows(≈50)칸만
// 생성하고, 페이지·필터가 바뀔 때 그 칸들만 파괴·재생성한다.

import GamepadSystem from '../systems/GamepadSystem';
import Phaser from 'phaser';
import swordCatalogJson from '../data/swordCatalog.json';
import evolutionCatalogJson from '../data/evolutionCatalog.json';
import MetaProgression from '../systems/MetaProgression';
import AchievementSystem from '../systems/AchievementSystem';
import BgmSystem from '../systems/BgmSystem';
import { seenSwordIds, seenCount, isFreshSword, clearFreshSwords, freshCount } from '../core/codex';
import { reduceMotion, loadSettings, sfxVolume } from '../core/settings';
import { SFX_BASE } from '../systems/SoundSystem';
import {
	FONT, UI, style, panel, insetPanel, slot, button, divider, dimVignette, iconImage, createGauge,
	createUiRoot, RARITY_THEME, ELEMENT_THEME, TEXT_RESOLUTION, type UiRoot, type UiGauge,
} from '../ui/theme';
import type { SwordDefinition } from '../types/catalogs';
import { behaviorOf, behaviorSpec, type SwordBehavior } from '../logic/swordBehavior';
import playerCatalogJson from '../data/playerCatalog.json';
import { recentRuns, runStats, RUN_LOG_MAX, type RunRecord } from '../core/telemetry';
import { softSwordTintFlat } from '../logic/swordTint';

const swordCatalog = swordCatalogJson as unknown as SwordDefinition[];
const keeperNames = new Map<string, string>(
	(playerCatalogJson as unknown as Array<{ id: string; name?: string }>).map((p) => [p.id, p.name ?? p.id]),
);
const evolutionCatalog = evolutionCatalogJson as unknown as Array<{ ingredients: string[]; result: string; announcement?: string }>;

/** 결과 검 id → 레시피 (조합식 표시용) */
const RECIPE_BY_RESULT = new Map(evolutionCatalog.map((recipe) => [recipe.result, recipe]));

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
const ELEMENT_ORDER = ['fire', 'electric', 'poison', 'void', 'gold', 'ice', 'blood', 'wind'] as const;

type CodexTab = 'swords' | 'achievements' | 'runs';

const DAMAGE_TYPE_LABEL: Record<string, string> = { physical: '물리', magic: '마법', true: '고정' };

/** 기록 탭: 한 쪽에 보여 주는 런 수 */
const RUNS_PER_PAGE = 6;

/** ms → mm:ss */
function clock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function elementLabel(id: string): string {
	if (id === 'none' || id === '-') {
		return '무속성';
	}
	return ELEMENT_THEME[id]?.label ?? id;
}

function archetypeLabel(id: string): string {
	return behaviorSpec(id as SwordBehavior).label;
}

/** 검 구성 한 줄 — 원소 상위 2종 + 아키타입(기본 거동 제외) */
function loadoutSummary(run: RunRecord): string {
	const top = (counts: Record<string, number>, label: (id: string) => string, skip?: string) =>
		Object.entries(counts)
			.filter(([id]) => id !== skip)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 2)
			.map(([id, n]) => `${label(id)} ${n}`);
	const elements = top(run.swords.elements, elementLabel);
	const archetypes = top(run.swords.archetypes, archetypeLabel, 'orbit');
	const parts = [`검 ${run.swords.count}`, ...elements, ...archetypes];
	return parts.join(' · ');
}

export default class CodexScene extends Phaser.Scene {
	private ui!: UiRoot;
	private tab: CodexTab = 'swords';
	private rarityFilter = 'all';
	private elementFilter = 'all';
	private page = 0;
	private selectedId: string | null = null;

	/** 페이지 단위로 갈아 끼우는 오브젝트 (격자 칸 · 도전과제 행) */
	private pageObjects: Phaser.GameObjects.GameObject[] = [];
	/** 탭 단위로 갈아 끼우는 오브젝트 (필터 칩 · 페이지 표시 · 헤더 보조) */
	private tabObjects: Phaser.GameObjects.GameObject[] = [];
	/** 상세 패널 오브젝트 */
	private detailObjects: Phaser.GameObjects.GameObject[] = [];
	private gauges: UiGauge[] = [];

	private grid = { x: 0, y: 0, cols: 10, rows: 5, cell: 72, gap: 8 };
	private detailX = 0;
	private detailW = 330;
	/** 필터 칩 배치 (좁은 화면에서는 원소 칩이 두 줄) */
	private rarityChipW = 88;
	private elementChipW = 72;
	private elementPerRow = 10;
	private pageLabel: Phaser.GameObjects.Text | null = null;
	private headerCount: Phaser.GameObjects.Text | null = null;
	/** 3뷰포트 겹침 QA 용 계측 (탭 줄 오른쪽 끝 · 닫기 버튼 왼쪽 끝) */
	private tabsRight = 0;
	private closeLeft = 0;
	private seen: ReadonlySet<string> = new Set();

	constructor() {
		super('CodexScene');
	}

	init(data: { tab?: CodexTab } = {}) {
		// 탭 전환은 씬 재시작으로 처리한다 — 넘겨받은 갈래를 유지한다
		this.tab = data.tab === 'achievements' || data.tab === 'runs' ? data.tab : 'swords';
	}

	create() {
		this.rarityFilter = 'all';
		this.elementFilter = 'all';
		this.page = 0;
		this.selectedId = null;
		this.pageObjects = [];
		this.tabObjects = [];
		this.detailObjects = [];
		this.gauges = [];
		this.seen = seenSwordIds();
		// 안전망: 이벤트 훅을 타지 못한 진행분(예: 저장만 되고 판정 전에 종료된 런)을
		// 도감을 열 때 한 번 정산한다. 이미 달성한 항목은 다시 지급되지 않는다.
		AchievementSystem.evaluate();

		this.sound.mute = loadSettings().muted;
		BgmSystem.for(this).play('title');

		const { width: sw, height: sh } = this.scale;
		this.add.rectangle(sw / 2, sh / 2, sw, sh, UI.bg, 1).setDepth(0);
		dimVignette(this, 1, 0.35);

		const ui = createUiRoot(this, 10);
		this.ui = ui;
		const W = ui.width;
		const H = ui.height;

		// ── 헤더
		const title = this.add.text(48, 44, '도감', {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: '38px', fontStyle: '900', color: UI.white, letterSpacing: 4,
		}).setOrigin(0, 0.5);
		title.setShadow(0, 4, '#000000', 8, false, true);
		ui.add(title);
		this.headerCount = this.add.text(48, 76, '', style(13, UI.textDim)).setOrigin(0, 0.5);
		ui.add(this.headerCount);
		ui.add(divider(this, W / 2, 100, W - 96));

		// ── 탭 버튼 (1 / 2 / 3)
		// 폭 150·간격 158 로 좁혔다 — 탭이 3개가 되면서 180 폭으로는 닫기 버튼과 겹친다.
		// 마지막 탭의 오른쪽 끝(W-190)이 닫기 버튼 왼쪽 끝(W-185) 바로 앞에 온다.
		const tabs: Array<{ kind: CodexTab; label: string; key: string; icon: string }> = [
			{ kind: 'swords', label: '검 도감', key: '1', icon: 'g-blade' },
			{ kind: 'achievements', label: '도전과제', key: '2', icon: 'g-crown' },
			{ kind: 'runs', label: '기록', key: '3', icon: 'g-scroll' },
		];
		tabs.forEach((entry, index) => {
			const b = button(this, W - 265 - (tabs.length - 1 - index) * 158, 52, 150, 44, entry.label, {
				variant: this.tab === entry.kind ? 'gold' : 'dark', fontSize: 14, display: true,
				key: entry.key, icon: entry.icon,
				onClick: () => this.switchTab(entry.kind),
			});
			ui.add(b.container);
		});
		this.tabsRight = W - 265 + 75;

		this.closeLeft = W - 110 - 75;
		const close = button(this, W - 110, 52, 150, 44, '닫기', {
			variant: 'ghost', fontSize: 15, display: true, key: 'ESC',
			onClick: () => this.back(),
		});
		ui.add(close.container);

		// ── 격자 배치 (남는 폭에 맞춰 열 수를 정한다 — 3뷰포트 모두 상세 패널과 안 겹치게)
		const margin = 48;
		const gridW = W - margin * 2 - this.detailW - 24;
		this.grid.cell = 72;
		this.grid.gap = 8;
		this.grid.cols = Phaser.Math.Clamp(Math.floor(gridW / (this.grid.cell + this.grid.gap)), 7, 12);
		this.grid.rows = 5;
		this.grid.x = margin;
		const chipRowW = this.grid.cols * (this.grid.cell + this.grid.gap) - this.grid.gap;
		this.rarityChipW = Phaser.Math.Clamp((chipRowW - 6 * 6) / 7, 58, 92);
		this.elementPerRow = chipRowW >= 790 ? 10 : 5;
		this.elementChipW = Phaser.Math.Clamp((chipRowW - (this.elementPerRow - 1) * 6) / this.elementPerRow, 58, 92);
		// 원소 칩이 두 줄이면 격자를 그만큼 내린다
		this.grid.y = 232 + (this.elementPerRow === 10 ? 0 : 38);
		this.detailX = margin + this.grid.cols * (this.grid.cell + this.grid.gap) + 20;
		this.detailW = Math.min(360, W - margin - this.detailX);

		// 상세 패널 바탕 (탭과 무관하게 유지 — 도전과제 탭에서는 안내문을 띄운다)
		ui.add(panel(this, this.detailX, 160, this.detailW, H - 250, { alpha: 0.95 }));

		// ── 페이지 이동
		const pagerY = H - 66;
		const prev = button(this, margin + 70, pagerY, 140, 44, '이전', {
			variant: 'dark', fontSize: 14, display: true, key: '←', onClick: () => this.movePage(-1),
		});
		const next = button(this, margin + 230, pagerY, 140, 44, '다음', {
			variant: 'dark', fontSize: 14, display: true, key: '→', onClick: () => this.movePage(1),
		});
		this.pageLabel = this.add.text(margin + 330, pagerY, '', style(13, UI.textDim, { display: true }))
			.setOrigin(0, 0.5);
		ui.add(prev.container, next.container, this.pageLabel);

		// 조작 안내는 반드시 UI 루트 안에 — 밖에 두면 스케일이 안 먹어 격자와 겹친다
		ui.add(this.add.text(margin, H - 22, 'ESC 닫기 · ←/→ 페이지 · 1/2/3 탭 전환 · 휠 스크롤',
			style(12, UI.textFaint)).setOrigin(0, 0.5));

		this.input.keyboard!.on('keydown-ESC', () => this.back());
		// 게임패드 — 메뉴에서도 십자키/A/B 가 먹어야 한다 (미연결이면 비용 0)
		GamepadSystem.attach(this);
		this.input.keyboard!.on('keydown-LEFT', () => this.movePage(-1));
		this.input.keyboard!.on('keydown-RIGHT', () => this.movePage(1));
		this.input.keyboard!.on('keydown-ONE', () => this.switchTab('swords'));
		this.input.keyboard!.on('keydown-TWO', () => this.switchTab('achievements'));
		this.input.keyboard!.on('keydown-THREE', () => this.switchTab('runs'));
		this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.movePage(dy > 0 ? 1 : -1));

		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			// 도감을 한 번 열면 NEW 배지는 소진된다
			clearFreshSwords();
			for (const gauge of this.gauges) {
				gauge.destroy();
			}
			this.gauges = [];
		});

		this.buildTab();
		ui.sort();

		if (!reduceMotion()) {
			ui.root.setAlpha(0);
			this.tweens.add({ targets: ui.root, alpha: 1, duration: 260, ease: 'Quad.easeOut' });
		}

		if (import.meta.env.DEV) {
			window.__codexScene = this;
		}
	}

	// ---------------------------------------------------------------
	// 탭 · 페이지
	// ---------------------------------------------------------------

	private uiClick() {
		if (this.cache.audio.exists('click')) {
			this.sound.play('click', { volume: 0.5 * sfxVolume() * SFX_BASE });
		}
	}

	switchTab(tab: CodexTab) {
		if (this.tab === tab) {
			return;
		}
		this.uiClick();
		this.page = 0;
		this.selectedId = null;
		this.scene.restart({ tab });
	}

	movePage(delta: number) {
		const total = this.pageCount();
		const next = Phaser.Math.Clamp(this.page + delta, 0, Math.max(0, total - 1));
		if (next === this.page) {
			return;
		}
		this.page = next;
		this.buildPage();
	}

	private pageCount(): number {
		if (this.tab === 'runs') {
			return Math.max(1, Math.ceil(recentRuns().length / RUNS_PER_PAGE));
		}
		const perPage = this.tab === 'swords' ? this.grid.cols * this.grid.rows : 5;
		const total = this.tab === 'swords' ? this.filteredSwords().length : AchievementSystem.catalog().length;
		return Math.max(1, Math.ceil(total / perPage));
	}

	private clearObjects(list: Phaser.GameObjects.GameObject[]) {
		for (const object of list) {
			this.tweens.killTweensOf(object);
			object.destroy();
		}
		list.length = 0;
	}

	private buildTab() {
		this.clearObjects(this.tabObjects);
		if (this.tab === 'swords') {
			this.buildSwordFilters();
		} else if (this.tab === 'runs') {
			this.buildRunStats();
		} else {
			this.buildAchievementHeader();
		}
		this.buildPage();
	}

	private buildPage() {
		this.clearObjects(this.pageObjects);
		for (const gauge of this.gauges) {
			gauge.destroy();
		}
		this.gauges = [];

		if (this.tab === 'swords') {
			this.buildSwordGrid();
		} else if (this.tab === 'runs') {
			this.buildRunRows();
		} else {
			this.buildAchievementRows();
		}

		this.pageLabel?.setText(`${this.page + 1} / ${this.pageCount()} 쪽`);
		this.ui.sort();
	}

	// ---------------------------------------------------------------
	// 검 도감
	// ---------------------------------------------------------------

	/**
	 * 필터를 통과한 검 목록.
	 * 2026-09-02: 필터를 걸지 않아도 **등급별로 나뉘어 보이는 것이 기본**이라
	 * 항상 신화→일반 순으로 묶어 돌려준다 (상점 통합 화면과 같은 규칙).
	 */
	filteredSwords(): SwordDefinition[] {
		const list = swordCatalog.filter((definition) => {
			if (this.rarityFilter !== 'all' && (definition.rarity ?? 'common') !== this.rarityFilter) {
				return false;
			}
			if (this.elementFilter === 'all') {
				return true;
			}
			if (this.elementFilter === 'none') {
				return !definition.element;
			}
			return definition.element === this.elementFilter;
		});

		const rank = (definition: SwordDefinition) => {
			const index = RARITY_ORDER.indexOf((definition.rarity ?? 'common') as typeof RARITY_ORDER[number]);
			return index < 0 ? RARITY_ORDER.length : RARITY_ORDER.length - 1 - index;
		};
		return list
			.map((definition, index) => ({ definition, index }))
			.sort((a, b) => (rank(a.definition) - rank(b.definition)) || (a.index - b.index))
			.map(({ definition }) => definition);
	}

	private buildSwordFilters() {
		const ui = this.ui;
		const total = swordCatalog.length;
		const owned = seenCount();
		const pct = Math.round((owned / total) * 1000) / 10;
		this.headerCount?.setText(`획득 ${owned} / ${total}종 · 획득률 ${pct}%${freshCount() > 0 ? `  ·  신규 ${freshCount()}` : ''}`);

		const x0 = this.grid.x;
		const chipW = this.rarityChipW;
		const chipH = 32;

		const rarityChips: Array<{ id: string; label: string; color: string }> = [
			{ id: 'all', label: '전체', color: UI.text },
			...RARITY_ORDER.map((rarity) => ({ id: rarity, label: RARITY_THEME[rarity].name, color: RARITY_THEME[rarity].css })),
		];
		rarityChips.forEach((chip, index) => {
			const b = button(this, x0 + chipW / 2 + index * (chipW + 6), 138, chipW, chipH, chip.label, {
				variant: this.rarityFilter === chip.id ? 'gold' : 'dark', fontSize: 13, display: true,
				onClick: () => {
					this.rarityFilter = chip.id;
					this.page = 0;
					this.uiClick();
					this.buildTab();
				},
			});
			if (this.rarityFilter !== chip.id) {
				b.label.setColor(chip.color);
			}
			this.tabObjects.push(b.container);
			ui.add(b.container);
		});

		const elementChips: Array<{ id: string; label: string; color: string }> = [
			{ id: 'all', label: '전체', color: UI.text },
			{ id: 'none', label: '무속성', color: UI.textDim },
			...ELEMENT_ORDER.map((element) => ({ id: element, label: ELEMENT_THEME[element].label, color: ELEMENT_THEME[element].css })),
		];
		const eChipW = this.elementChipW;
		elementChips.forEach((chip, index) => {
			const col = index % this.elementPerRow;
			const row = Math.floor(index / this.elementPerRow);
			const b = button(this, x0 + eChipW / 2 + col * (eChipW + 6), 182 + row * 38, eChipW, chipH, chip.label, {
				variant: this.elementFilter === chip.id ? 'gold' : 'dark', fontSize: 12.5, display: true,
				onClick: () => {
					this.elementFilter = chip.id;
					this.page = 0;
					this.uiClick();
					this.buildTab();
				},
			});
			if (this.elementFilter !== chip.id) {
				b.label.setColor(chip.color);
			}
			this.tabObjects.push(b.container);
			ui.add(b.container);
		});

		this.showSwordDetail(this.selectedId);
	}

	private buildSwordGrid() {
		const ui = this.ui;
		const list = this.filteredSwords();
		const perPage = this.grid.cols * this.grid.rows;
		const start = this.page * perPage;
		const pageList = list.slice(start, start + perPage);
		const stride = this.grid.cell + this.grid.gap;

		if (pageList.length === 0) {
			const empty = this.add.text(this.grid.x + 20, this.grid.y + 40, '조건에 맞는 검이 없습니다.', style(14, UI.textDim));
			this.pageObjects.push(empty);
			ui.add(empty);
			return;
		}

		pageList.forEach((definition, index) => {
			const col = index % this.grid.cols;
			const row = Math.floor(index / this.grid.cols);
			const cx = this.grid.x + col * stride + this.grid.cell / 2;
			const cy = this.grid.y + row * stride + this.grid.cell / 2;
			const owned = this.seen.has(definition.id);
			const rarity = RARITY_THEME[definition.rarity ?? 'common'] ?? RARITY_THEME.common;

			const cell = slot(this, cx, cy, this.grid.cell, owned ? 'gray' : 'ghost');
			const icon = this.add.image(cx, cy - 4, 'sword', definition.sheetOrder ?? 0)
				.setDisplaySize(42, 42);
			if (owned) {
				if (definition.effect?.tint) {
					icon.setTint(softSwordTintFlat(Phaser.Display.Color.HexStringToColor(definition.effect.tint).color));
				}
			} else {
				icon.setTintFill(0x232a31);
			}
			const label = this.add.text(cx, cy + 24, owned ? definition.name : '???',
				{ ...style(9.5, owned ? rarity.css : UI.textFaint), align: 'center' })
				.setOrigin(0.5);
			// 이름이 칸을 넘지 않게 축소 (Flat 칸 폭 고정)
			if (label.width > this.grid.cell - 6) {
				label.setScale((this.grid.cell - 6) / label.width);
			}
			const hit = this.add.rectangle(cx, cy, this.grid.cell, this.grid.cell, 0x000000, 0.001)
				.setInteractive({ useHandCursor: true });
			hit.on('pointerover', () => cell.setTexture(owned ? 'uf-slot-cyan' : 'uf-slot-ghostblue'));
			hit.on('pointerout', () => cell.setTexture(owned ? 'uf-slot-gray' : 'uf-slot-ghost'));
			hit.on('pointerdown', () => {
				this.selectedId = definition.id;
				this.uiClick();
				this.showSwordDetail(definition.id);
			});

			this.pageObjects.push(cell, icon, label, hit);
			ui.add(cell, icon, label, hit);

			if (owned && isFreshSword(definition.id)) {
				const badge = this.add.text(cx + this.grid.cell / 2 - 4, cy - this.grid.cell / 2 + 6, 'NEW',
					style(9, UI.goldText, { display: true })).setOrigin(1, 0.5);
				badge.setShadow(0, 1, '#000000', 3, false, true);
				this.pageObjects.push(badge);
				ui.add(badge);
			}
		});

		if (!this.selectedId) {
			this.showSwordDetail(null);
		}
	}

	/** 조합식 한 줄 — 발견한 레시피만 재료를 공개한다 */
	recipeTextFor(definition: SwordDefinition): string | null {
		const recipe = RECIPE_BY_RESULT.get(definition.id);
		if (!recipe) {
			return null;
		}
		if (!MetaProgression.isRecipeDiscovered(definition.id)) {
			return '??? + ???  (아직 발견하지 못한 조합식)';
		}
		const nameOf = (id: string) => swordCatalog.find((entry) => entry.id === id)?.name ?? id;
		return `${nameOf(recipe.ingredients[0])} + ${nameOf(recipe.ingredients[1])}`;
	}

	showSwordDetail(id: string | null) {
		this.clearObjects(this.detailObjects);
		const ui = this.ui;
		const x = this.detailX + 22;
		const w = this.detailW - 44;
		let y = 190;
		const push = (object: Phaser.GameObjects.GameObject) => {
			this.detailObjects.push(object);
			ui.add(object);
		};

		const definition = id ? swordCatalog.find((entry) => entry.id === id) ?? null : null;
		if (!definition) {
			push(this.add.text(x, y, '검을 고르면 상세가 표시됩니다.', {
				...style(13, UI.textDim), wordWrap: { width: w },
			}));
			push(this.add.text(x, y + 34, '획득한 적 있는 검만 이름과 스탯이 열립니다.\n미획득 검은 실루엣으로 남습니다.', {
				...style(12, UI.textFaint), wordWrap: { width: w },
			}));
			return;
		}

		const owned = this.seen.has(definition.id);
		const rarity = RARITY_THEME[definition.rarity ?? 'common'] ?? RARITY_THEME.common;

		const iconBack = slot(this, x + 34, y + 20, 68, owned ? 'gray' : 'ghost');
		const icon = this.add.image(x + 34, y + 20, 'sword', definition.sheetOrder ?? 0).setDisplaySize(46, 46);
		if (owned) {
			if (definition.effect?.tint) {
				icon.setTint(softSwordTintFlat(Phaser.Display.Color.HexStringToColor(definition.effect.tint).color));
			}
		} else {
			icon.setTintFill(0x232a31);
		}
		push(iconBack);
		push(icon);

		const nameText = this.add.text(x + 78, y + 6, owned ? definition.name : '???',
			style(19, owned ? rarity.css : UI.textFaint, { display: true })).setOrigin(0, 0.5);
		push(nameText);

		const elementTheme = definition.element ? ELEMENT_THEME[definition.element] : null;
		const tagLine = `${rarity.name}${elementTheme ? ` · ${elementTheme.label}` : ' · 무속성'}`;
		push(this.add.text(x + 78, y + 32, tagLine,
			style(12, owned ? UI.textDim : UI.textFaint)).setOrigin(0, 0.5));

		y += 66;
		push(divider(this, this.detailX + this.detailW / 2, y, w));
		y += 14;

		if (!owned) {
			push(this.add.text(x, y + 8, '아직 획득하지 않은 검입니다.\n광맥에서 손에 넣으면 도감에 기록됩니다.', {
				...style(13, UI.textDim), wordWrap: { width: w },
			}));
			return;
		}

		const rows: Array<[string, string]> = [
			['피해', `${definition.damage}`],
			['대기시간', `${definition.cooldownMs}ms`],
			['연속 타격', `${definition.maxHits}회`],
			['치명타', `${Math.round((definition.critChance ?? 0) * 100)}% · ×${definition.critDamageMultiplier ?? 1}`],
			['비행 속도', `${definition.launchSpeed}`],
			['피해 유형', DAMAGE_TYPE_LABEL[definition.damageType] ?? String(definition.damageType)],
		];
		// 거동 아키타입 — 스탯이 아니라 "어떻게 싸우는가"라서 고유 효과보다 먼저 보여준다
		const codexBehavior = behaviorOf(definition);
		if (codexBehavior !== 'orbit') {
			rows.push(['거동', behaviorSpec(codexBehavior).label]);
		}
		if (definition.special?.label) {
			rows.push(['고유 효과', String(definition.special.label)]);
		}
		if (definition.magicPen || definition.physicalPen) {
			rows.push(['관통', `${Math.round(((definition.magicPen ?? 0) + (definition.physicalPen ?? 0)) * 100)}%`]);
		}
		if (definition.trueDamage) {
			rows.push(['고정 피해', `${definition.trueDamage}`]);
		}
		if (definition.maxHpDamage) {
			rows.push(['최대 체력 피해', `${Math.round(definition.maxHpDamage * 100)}%`]);
		}

		rows.forEach(([label, value], index) => {
			const ry = y + index * 22;
			push(this.add.text(x, ry, label, style(12, UI.textDim)).setOrigin(0, 0));
			push(this.add.text(x + w, ry, value, style(12.5, UI.text, { display: true })).setOrigin(1, 0));
		});
		y += rows.length * 22 + 10;

		const recipe = this.recipeTextFor(definition);
		if (recipe) {
			push(insetPanel(this, x, y, w, 46));
			push(this.add.text(x + 10, y + 12, '조합식', style(11, UI.goldText, { display: true })));
			push(this.add.text(x + 10, y + 28, recipe, { ...style(11.5, UI.textDim), wordWrap: { width: w - 20 } }));
			y += 58;
		}

		if (definition.lore) {
			push(this.add.text(x, y, `“${definition.lore}”`, {
				...style(12, UI.quenchText, { bold: false }), wordWrap: { width: w },
			}));
		}
	}

	// ---------------------------------------------------------------
	// 도전과제
	// ---------------------------------------------------------------

	private buildAchievementHeader() {
		const done = AchievementSystem.unlockedCount();
		const total = AchievementSystem.catalog().length;
		this.headerCount?.setText(`도전과제 ${done} / ${total} 달성 · 보상은 즉시 골드로 지급됩니다`);

		this.clearObjects(this.detailObjects);
		const x = this.detailX + 22;
		const w = this.detailW - 44;
		const info = this.add.text(x, 190, '도전과제', style(18, UI.text, { display: true }));
		const body = this.add.text(x, 224,
			'달성한 도전과제는 즉시 골드(잉걸)로 보상됩니다.\n보상은 한 번만 지급되며, 영구 강화에 그대로 쓸 수 있습니다.\n\n진행도는 런이 끝나거나 라운드를 클리어할 때 갱신됩니다.',
			{ ...style(12.5, UI.textDim), wordWrap: { width: w } });
		const rewardTotal = AchievementSystem.snapshot()
			.filter((row) => row.unlocked)
			.reduce((sum, row) => sum + row.entry.reward, 0);
		const earned = this.add.text(x, 340, `수령한 보상 합계 ${rewardTotal} 골드`, style(13, UI.goldText, { display: true }));
		this.detailObjects.push(info, body, earned);
		this.ui.add(info, body, earned);
	}

	private buildAchievementRows() {
		const ui = this.ui;
		const rows = AchievementSystem.snapshot();
		const perPage = 5;
		const pageRows = rows.slice(this.page * perPage, this.page * perPage + perPage);
		const x = this.grid.x;
		const w = this.grid.cols * (this.grid.cell + this.grid.gap) - this.grid.gap;
		const rowH = 88;
		let y = 150;

		for (const row of pageRows) {
			const bg = insetPanel(this, x, y, w, rowH, { alpha: row.unlocked ? 1 : 0.88 });
			if (!row.unlocked) {
				bg.setTint(0x8d97a2);
			}
			const icon = iconImage(this, row.entry.icon, x + 44, y + rowH / 2, 34,
				row.unlocked ? UI.straw : UI.steel);
			const name = this.add.text(x + 82, y + 22, row.entry.name,
				style(17, row.unlocked ? UI.text : UI.textDim, { display: true })).setOrigin(0, 0.5);
			const desc = this.add.text(x + 82, y + 46, row.entry.desc, style(12, UI.textDim)).setOrigin(0, 0.5);
			const state = this.add.text(x + w - 20, y + 22, row.unlocked ? '달성' : '미달성',
				style(14, row.unlocked ? UI.green : UI.textFaint, { display: true })).setOrigin(1, 0.5);
			const reward = this.add.text(x + w - 20, y + 46, `보상 ${row.entry.reward} 골드`,
				style(12, row.unlocked ? UI.goldText : UI.textFaint)).setOrigin(1, 0.5);
			const category = this.add.text(x + 82, y + 68, row.entry.category, style(10.5, UI.textFaint, { display: true }))
				.setOrigin(0, 0.5);

			// 진행도 바 (달성 시 가득)
			// 게이지 높이는 18 이상 — Flat 트랙(px=2)은 6px 이하면 fill 이 사라진다
			const barW = Math.min(320, w * 0.36);
			const gauge = createGauge(this, x + w - 20 - barW, y + 58, barW, 18,
				{ fill: row.unlocked ? 'green' : 'orange' });
			gauge.setRatio(row.ratio);
			const progressText = this.add.text(x + w - 24 - barW, y + 69,
				`${Math.min(row.value, row.entry.goal).toLocaleString()} / ${row.entry.goal.toLocaleString()}`,
				style(11, UI.textDim)).setOrigin(1, 0.5);

			// gauge.root 는 gauges 쪽에서 파괴한다 (pageObjects 에 넣으면 이중 파괴)
			this.pageObjects.push(bg, name, desc, state, reward, category, progressText, icon);
			this.gauges.push(gauge);
			ui.add(bg, icon, name, desc, state, reward, category, gauge.root, progressText);

			y += rowH + 10;
		}
	}

	// ---------------------------------------------------------------
	// 기록 (로컬 런 텔레메트리)
	// ---------------------------------------------------------------

	/** 우측 상세 패널: 요약 통계 (평균 사망 라운드 · 키퍼별 최고 · 최다 사용 원소) */
	private buildRunStats() {
		const stats = runStats();
		this.headerCount?.setText(
			`기록된 런 ${stats.total} / ${RUN_LOG_MAX} · 이 브라우저에만 저장됩니다 (전송 없음)`,
		);

		this.clearObjects(this.detailObjects);
		const x = this.detailX + 22;
		const w = this.detailW - 44;
		const push = (object: Phaser.GameObjects.GameObject) => {
			this.detailObjects.push(object);
			this.ui.add(object);
		};

		push(this.add.text(x, 190, '통계', style(18, UI.text, { display: true })));
		let y = 224;

		if (stats.total === 0) {
			push(this.add.text(x, y, '런을 한 번 끝내면 여기에 기록이 쌓입니다.\n최근 50런까지 보관합니다.', {
				...style(12.5, UI.textDim), wordWrap: { width: w },
			}));
			return;
		}

		const rows: Array<[string, string]> = [
			['총 런', `${stats.total}회 (귀환 ${stats.clears} · 사망 ${stats.deaths})`],
			['평균 사망 라운드', stats.avgDeathRound === null ? '—' : `${stats.avgDeathRound.toFixed(1)}`],
			['최고 라운드', `${stats.bestRound}`],
			['평균 런 길이', clock(stats.avgDurationMs)],
		];
		rows.forEach(([label, value], index) => {
			const ry = y + index * 22;
			push(this.add.text(x, ry, label, style(12, UI.textDim)));
			push(this.add.text(x + w, ry, value, style(12.5, UI.text, { display: true })).setOrigin(1, 0));
		});
		y += rows.length * 22 + 12;

		push(divider(this, this.detailX + this.detailW / 2, y, w));
		y += 14;

		push(this.add.text(x, y, '키퍼별 최고 라운드', style(12, UI.goldText, { display: true })));
		y += 20;
		for (const seat of stats.bestByKeeper.slice(0, 4)) {
			push(this.add.text(x, y, keeperNames.get(seat.keeper) ?? seat.keeper, style(12, UI.textDim)));
			push(this.add.text(x + w, y, `${seat.round} 라 (${seat.runs}회)`,
				style(12, UI.text, { display: true })).setOrigin(1, 0));
			y += 20;
		}
		y += 8;

		push(this.add.text(x, y, '최다 사용 원소', style(12, UI.goldText, { display: true })));
		y += 20;
		for (const row of stats.topElements.slice(0, 4)) {
			const theme = row.element !== 'none' ? ELEMENT_THEME[row.element] : null;
			push(this.add.text(x, y, elementLabel(row.element), style(12, theme?.css ?? UI.textDim)));
			push(this.add.text(x + w, y, `${row.count}자루`, style(12, UI.text, { display: true })).setOrigin(1, 0));
			y += 20;
		}

		const archetypes = stats.topArchetypes.filter((row) => row.archetype !== 'orbit');
		if (archetypes.length > 0) {
			y += 8;
			push(this.add.text(x, y, '거동 아키타입', style(12, UI.goldText, { display: true })));
			y += 20;
			for (const row of archetypes.slice(0, 3)) {
				push(this.add.text(x, y, archetypeLabel(row.archetype), style(12, UI.textDim)));
				push(this.add.text(x + w, y, `${row.count}자루`, style(12, UI.text, { display: true })).setOrigin(1, 0));
				y += 20;
			}
		}
	}

	/** 좌측: 최근 런 목록 (최신이 위) */
	private buildRunRows() {
		const ui = this.ui;
		const runs = recentRuns();
		const x = this.grid.x;
		const w = this.grid.cols * (this.grid.cell + this.grid.gap) - this.grid.gap;

		if (runs.length === 0) {
			const empty = this.add.text(x + 20, 200, '아직 기록된 런이 없습니다.', style(14, UI.textDim));
			const hint = this.add.text(x + 20, 228,
				'런이 끝날 때마다 사망 라운드·키퍼·검 구성·어픽스 수·소요 시간이 이 브라우저에 남습니다.',
				{ ...style(12, UI.textFaint), wordWrap: { width: w - 40 } });
			this.pageObjects.push(empty, hint);
			ui.add(empty, hint);
			return;
		}

		const pageRows = runs.slice(this.page * RUNS_PER_PAGE, this.page * RUNS_PER_PAGE + RUNS_PER_PAGE);
		const rowH = 72;
		let y = 150;
		const offset = this.page * RUNS_PER_PAGE;

		pageRows.forEach((run, index) => {
			const bg = insetPanel(this, x, y, w, rowH, { alpha: run.won ? 1 : 0.9 });
			if (!run.won) {
				bg.setTint(0x9aa4ae);
			}
			const order = this.add.text(x + 20, y + rowH / 2, `#${runs.length - offset - index}`,
				style(13, UI.textFaint, { display: true })).setOrigin(0, 0.5);
			const verdict = this.add.text(x + 74, y + 22, run.won ? '귀환' : '사망',
				style(16, run.won ? UI.quenchText : UI.emberText, { display: true })).setOrigin(0, 0.5);
			const round = this.add.text(x + 130, y + 22, `라운드 ${run.round}`,
				style(15, UI.text, { display: true })).setOrigin(0, 0.5);
			const keeper = this.add.text(x + 250, y + 22, keeperNames.get(run.keeper) ?? run.keeper,
				style(13, UI.textDim)).setOrigin(0, 0.5);
			const summary = this.add.text(x + 74, y + 48, loadoutSummary(run),
				style(11.5, UI.textDim)).setOrigin(0, 0.5);
			const right = this.add.text(x + w - 20, y + 22,
				`${clock(run.durationMs)} · Lv${run.level}`, style(13, UI.text, { display: true })).setOrigin(1, 0.5);
			const right2 = this.add.text(x + w - 20, y + 48,
				`처치 ${run.kills.toLocaleString()} · 어픽스 ${run.affixes}종`,
				style(11.5, UI.textFaint)).setOrigin(1, 0.5);

			this.pageObjects.push(bg, order, verdict, round, keeper, summary, right, right2);
			ui.add(bg, order, verdict, round, keeper, summary, right, right2);
			y += rowH + 8;
		});
	}

	back() {
		this.uiClick();
		this.scene.start('TitleScene');
	}

	// ---------------------------------------------------------------
	// 회귀 테스트용 계측 (meta-test.mjs) — 3뷰포트 겹침 QA와 오브젝트 예산 검사
	// ---------------------------------------------------------------

	layoutMetrics() {
		const stride = this.grid.cell + this.grid.gap;
		return {
			tab: this.tab,
			page: this.page,
			pageCount: this.pageCount(),
			cols: this.grid.cols,
			rows: this.grid.rows,
			gridX: this.grid.x,
			gridY: this.grid.y,
			gridRight: this.grid.x + this.grid.cols * stride - this.grid.gap,
			gridBottom: this.grid.y + this.grid.rows * stride - this.grid.gap,
			detailX: this.detailX,
			detailW: this.detailW,
			pagerY: this.ui.height - 66,
			uiWidth: this.ui.width,
			uiHeight: this.ui.height,
			uiScale: this.ui.scale,
			rarityChipRight: this.grid.x + 7 * (this.rarityChipW + 6) - 6,
			elementChipRight: this.grid.x + this.elementPerRow * (this.elementChipW + 6) - 6,
			elementChipBottom: 182 + (this.elementPerRow === 10 ? 0 : 1) * 38 + 16,
			pageObjects: this.pageObjects.length,
			tabObjects: this.tabObjects.length,
			detailObjects: this.detailObjects.length,
			filtered: this.filteredSwords().length,
			rarityFilter: this.rarityFilter,
			elementFilter: this.elementFilter,
			seen: seenCount(),
			total: swordCatalog.length,
			// 기록 탭 (3뷰포트 겹침 QA)
			tabsRight: this.tabsRight,
			closeLeft: this.closeLeft,
			runsPerPage: RUNS_PER_PAGE,
			runRows: this.tab === 'runs' ? recentRuns().length : 0,
			// 행 폭은 격자와 같다 — 상세 패널(detailX)과 겹치지 않아야 한다
			rowsRight: this.grid.x + this.grid.cols * stride - this.grid.gap,
			rowsBottom: this.tab === 'runs'
				? 150 + Math.min(RUNS_PER_PAGE, Math.max(0, recentRuns().length - this.page * RUNS_PER_PAGE)) * 80
				: 0,
		};
	}

	/** 현재 페이지에 그려진 텍스트 목록 (??? · NEW 배지 검사용) */
	pageTexts(): string[] {
		return this.pageObjects
			.filter((object): object is Phaser.GameObjects.Text => object instanceof Phaser.GameObjects.Text)
			.map((text) => text.text);
	}

	/** 상세 패널에 그려진 텍스트 목록 */
	detailTexts(): string[] {
		return this.detailObjects
			.filter((object): object is Phaser.GameObjects.Text => object instanceof Phaser.GameObjects.Text)
			.map((text) => text.text);
	}

	/** 테스트용 필터 설정 */
	applyFilter(rarity: string, element: string) {
		this.rarityFilter = rarity;
		this.elementFilter = element;
		this.page = 0;
		this.buildTab();
	}
}
