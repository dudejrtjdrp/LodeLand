// Tab 총람 — RPG 캐릭터 창 (2026-08-31 리뉴얼).
// 메이플식 창문형: 좌측 캐릭터 카드(초상·LV·HP 게이지·장착 검 미니 슬롯) +
// 우측 탭 콘텐츠(능력치 = 아이콘 스탯 카드 2열 / 검 = 검 카드 / 세트 = 단계 사다리).
// Flat UI 킷(uf-*) 전용 — 절차 드로잉 패널 금지.
// (2026-08-31 재염색: 킷이 LODELAND 강판 톤이 되어 패널 위 텍스트는 밝은 회백이 기본)
// Tab 토글, ← → (또는 탭 클릭)로 갈래 전환. 전투는 멈추지 않는다.
// depth 1600 — 인게임 HUD(1000~1002) 위, 레벨업(2000)/상점(2300~) 아래.

import Phaser from 'phaser';
import type GameScene from '../scenes/GameScene';
import {
	UI, FONT, style, panel, insetPanel, slot, iconImage, createGauge,
	hudScaleFor, ELEMENT_THEME, TEXT_RESOLUTION, expandHit, type UiGauge,
} from '../ui/theme';
import { STAT_CAPS, UNLOCK_CAPS, moveSpeedCap } from '../logic/statCaps';
import { formatPct } from '../logic/growth';
import { ELEMENT_SETS, SET_ELEMENTS, type SetElement } from '../logic/elementSets';
import { Tooltip, withKeywordFooter } from '../ui/tooltip';
import { awakeningById } from '../logic/swordInfo';

type TabId = 'stats' | 'swords' | 'sets';

const TABS: Array<{ id: TabId; label: string }> = [
	{ id: 'stats', label: '능력치' },
	{ id: 'swords', label: '검' },
	{ id: 'sets', label: '세트' },
];

const DEPTH = 1600;

/** 강판 패널 위 텍스트 팔레트 (구명 INK 유지 — 재염색 후 밝은 회백 기준) */
const INK = {
	base: '#dfe6ea',
	dim: '#8d9aa5',
	faint: '#5c6a75',
	gold: '#d9a83c',
	danger: '#e0654d',
	green: '#9bc25b',
};

/** 원소 라벨 — 어두운 강판 위에서 읽히는 밝은 톤 (ELEMENT_THEME.css 와 동일 계열) */
const ELEMENT_INK: Record<string, string> = {
	fire: '#d9702e', electric: '#63b3d9', poison: '#84b04a', void: '#8d7bb5',
	gold: '#d9a83c', ice: '#8fc3d8', blood: '#c9455a', wind: '#9fd8c0',
};

interface StatEntry {
	icon: string;
	label: string;
	value: string;
	capped?: boolean;
}

/**
 * 능력치 한 줄 설명 (호버 툴팁).
 * "이 숫자가 오르면 무엇이 좋아지는가"를 한 문장으로 — 상한이 있는 항목은 상한도 함께.
 * 용어 각주(공명·궤도 등)는 ui/keywords.ts 사전이 자동으로 붙인다.
 */
const STAT_HELP: Record<string, string> = {
	공격력: '모든 검의 기본 피해에 곱해지는 배율입니다. 검 레벨·자리 강화와 곱연산으로 쌓입니다.',
	'쿨다운 감소': '검이 다음 사냥을 나가기까지의 대기 시간을 줄입니다. 바닥(최소 대기)이 있어 무한히 줄지는 않습니다.',
	'출격 속도': '검이 목표까지 날아가는 속도입니다. 빠를수록 놓치는 적이 줄어듭니다.',
	'궤도 회전': '검이 플레이어 주위를 도는 속도입니다. 스치는 궤도 피해 빈도가 올라갑니다.',
	'궤도 반경': '검이 도는 고리의 크기입니다. 넓으면 더 멀리 훑지만 몸 근처가 비게 됩니다.',
	'치명타 확률': '치명타가 터질 확률입니다. 100%에 닿으면 레벨업 카드에서 빠지고, 대신 처형·관통이 등장합니다. 검·세트가 얹는 초과분은 치명타 피해로 바뀝니다.',
	'치명타 피해': '치명타가 터졌을 때의 피해 배율입니다.',
	'이동 속도': '플레이어의 이동 속도입니다. 이 게임의 유일한 조작이므로 생존과 직결됩니다.',
	'획득 범위': '경험치·골드가 자동으로 빨려 오는 반경입니다.',
	행운: '레벨업 카드의 상위 등급 확률과 전리품 품질을 올립니다.',
	'연속 타격': '검이 한 번 출격할 때 때리는 횟수입니다.',
	'검기 파동': '한 번 맞힐 때 주변 적에게 번지는 최대 적 수입니다.',
	방어: '받는 피해를 비율로 줄입니다 (최대 60%).',
	회피: '피해를 통째로 흘릴 확률입니다 (최대 40%).',
	재생: '초당 자동 회복량입니다. 피 7세트[혈계]는 회복량을 깎습니다.',
	'처치 회복': '적을 처치할 때마다 회복하는 양입니다.',
	가시: '접촉한 적에게 되돌려주는 피해입니다.',
	'물리 저항': '물리 피해를 추가로 줄입니다 (최대 50%).',
	'마법 저항': '마법 피해를 추가로 줄입니다 (최대 50%).',
	'피해 감소': '모든 피해를 마지막 단계에서 한 번 더 줄입니다 (최대 25%).',
	흡혈: '입힌 피해의 일부를 체력으로 회복합니다. 타격 회복은 모두 합쳐 초당 최대체력의 6%까지만 들어옵니다.',
	'경험치 획득': '얻는 경험치가 늘어 레벨업이 빨라집니다.',
	'골드 획득': '얻는 골드가 늘어 대장간에서 더 많이 살 수 있습니다.',
	처형: '체력이 30% 이하로 떨어진 적에게 주는 피해가 늘어납니다 (최대 +15%). 보스에게도 걸리는 대신 픽당 0.n%씩만 오릅니다.',
	관통: '적의 물리·마법 저항을 이 수치만큼 깎고 때립니다 (최대 20%p). 검·세트의 관통과 더해집니다.',
};

export default class StatsPanel {
	scene: GameScene;
	isOpen = false;
	tab: TabId = 'stats';
	destroyed = false;

	private objects: Phaser.GameObjects.GameObject[] = [];
	private gauges: UiGauge[] = [];
	private statValueTexts: Phaser.GameObjects.Text[] = [];
	private hpGauge: UiGauge | null = null;
	private hpText: Phaser.GameObjects.Text | null = null;
	private signature = '';
	private refreshEvent: Phaser.Time.TimerEvent | null = null;
	/** 능력치 항목 호버 툴팁 (공용 ui/tooltip.ts) */
	private tooltip: Tooltip | null = null;

	constructor(scene: GameScene) {
		this.scene = scene;
	}

	toggle(): void {
		if (this.isOpen) {
			this.close();
			return;
		}
		if (this.scene.levelUpSystem?.isOpen || this.scene.shopSystem?.isOpen || this.scene.isPaused) {
			return;
		}
		this.open();
	}

	open(): void {
		if (this.isOpen || this.destroyed) {
			return;
		}
		this.isOpen = true;
		this.build();
		this.refreshEvent = this.scene.time.addEvent({
			delay: 300,
			loop: true,
			callback: () => this.refreshValues(),
		});
	}

	close(): void {
		if (!this.isOpen) {
			return;
		}
		this.isOpen = false;
		this.refreshEvent?.remove();
		this.refreshEvent = null;
		this.teardown();
	}

	private teardown(): void {
		this.tooltip?.destroy();
		this.tooltip = null;
		for (const gauge of this.gauges) {
			gauge.destroy();
		}
		this.gauges = [];
		this.hpGauge = null;
		this.hpText = null;
		for (const object of this.objects) {
			object.destroy();
		}
		this.objects = [];
		this.statValueTexts = [];
		this.signature = '';
	}

	cycleTab(dir: 1 | -1): void {
		if (!this.isOpen) {
			return;
		}
		const index = TABS.findIndex((tab) => tab.id === this.tab);
		this.selectTab(TABS[(index + dir + TABS.length) % TABS.length].id);
	}

	selectTab(id: TabId): void {
		if (!this.isOpen || this.tab === id) {
			return;
		}
		this.tab = id;
		this.rebuild();
	}

	private rebuild(): void {
		this.teardown();
		this.build();
	}

	// ---------------------------------------------------------------
	// 데이터 수집 (능력치)
	// ---------------------------------------------------------------

	private collectStats(): StatEntry[] {
		const scene = this.scene;
		const player = scene.player;
		const orbit = scene.swordOrbit;
		const progression = scene.progression;
		// 1% 미만(처형 등)도 소수 첫째 자리까지 — 반올림하면 "0%"로 뭉개진다
		const pct = formatPct;
		const EPS = 1e-9;
		const rows: StatEntry[] = [];

		const damageMult = (orbit?.damageMultiplier ?? 1) * (scene.elementSets?.dynamicDamageMult?.() ?? 1);
		rows.push({ icon: 'g-blade', label: '공격력', value: `×${damageMult.toFixed(2)}` });

		const cooldown = orbit?.cooldownMultiplier ?? 1;
		rows.push({
			icon: 'g-hourglass', label: '쿨다운 감소', value: `-${pct(1 - cooldown)}`,
			capped: cooldown <= STAT_CAPS.cooldownFloor + EPS,
		});

		const launch = orbit?.launchSpeedMultiplier ?? 1;
		rows.push({
			icon: 'g-feather', label: '출격 속도', value: `×${launch.toFixed(2)}`,
			capped: launch >= STAT_CAPS.launchSpeedMultiplier - EPS,
		});

		const orbitSpeed = orbit?.orbitSpeed ?? 2;
		const orbitSpeedCap = (orbit?.baseOrbitSpeed ?? 2) * STAT_CAPS.orbitSpeedMult;
		rows.push({
			icon: 'g-ring', label: '궤도 회전', value: orbitSpeed.toFixed(2),
			capped: orbitSpeed >= orbitSpeedCap - EPS,
		});

		const radius = orbit?.radius ?? 140;
		const radiusCap = (orbit?.baseRadius ?? 140) * STAT_CAPS.orbitRadiusMult;
		rows.push({
			icon: 'g-ring', label: '궤도 반경', value: `${Math.round(radius)}`,
			capped: radius >= radiusCap - EPS,
		});

		const critChance = player?.critChance ?? 0;
		rows.push({
			icon: 'g-eye', label: '치명타 확률',
			value: critChance > 1 ? `100%+${pct(critChance - 1)}` : pct(critChance),
			capped: critChance >= STAT_CAPS.critChance - EPS,
		});
		// 치명타 피해는 소프트캡(statCaps.critDamageSoftCap)이 있다 — 초과분은 30%만 반영된다.
		// 판정에 쓰이는 값은 (검 + 플레이어)/2 이므로 여기서는 "이 스탯이 캡 구간에 들어갔는지"만 알린다.
		const critMult = player?.critDamageMultiplier ?? 1;
		rows.push({
			icon: 'g-spark',
			label: '치명타 피해',
			value: critMult > STAT_CAPS.critDamageSoftCap
				? `×${critMult.toFixed(2)} (감소 적용)`
				: `×${critMult.toFixed(2)}`,
			capped: critMult > STAT_CAPS.critDamageSoftCap,
		});

		const moveSpeed = player?.moveSpeed ?? 0;
		const moveCap = moveSpeedCap(player?.baseMoveSpeed);
		rows.push({
			icon: 'g-boot', label: '이동 속도', value: `${Math.round(moveSpeed)}`,
			capped: Number.isFinite(moveCap) && moveSpeed >= moveCap - EPS,
		});

		const magnet = progression?.magnetRadius ?? 220;
		const magnetCap = progression?.baseMagnetRadius ? progression.baseMagnetRadius * STAT_CAPS.magnetMult : 0;
		rows.push({
			icon: 'g-magnet', label: '획득 범위', value: `${Math.round(magnet)}`,
			capped: Boolean(magnetCap) && magnet >= magnetCap - EPS,
		});

		rows.push({ icon: 'g-bird', label: '행운', value: (player?.luck ?? 0).toFixed(2) });
		rows.push({ icon: 'g-fang', label: '연속 타격', value: `+${orbit?.bonusHits ?? 0}` });
		rows.push({ icon: 'g-vein', label: '검기 파동', value: `${orbit?.cleaveTargets ?? 0}명` });

		if ((player?.defense ?? 0) > 0) {
			rows.push({ icon: 'g-shield', label: '방어', value: `${player!.defense}`, capped: player!.defense >= 60 });
		}
		if ((player?.dodgeChance ?? 0) > 0) {
			rows.push({ icon: 'g-feather', label: '회피', value: pct(player!.dodgeChance), capped: player!.dodgeChance >= 0.4 - EPS });
		}
		if ((player?.hpRegen ?? 0) > 0) {
			rows.push({ icon: 'g-rekindle', label: '재생', value: `${Number(player!.hpRegen.toFixed(1))}/s` });
		}
		if ((player?.killHeal ?? 0) > 0) {
			rows.push({ icon: 'g-drop', label: '처치 회복', value: `${player!.killHeal}` });
		}
		if ((player?.thorns ?? 0) > 0) {
			rows.push({ icon: 'g-anvil', label: '가시', value: `${player!.thorns}` });
		}
		if ((player?.physicalResist ?? 0) > 0) {
			rows.push({ icon: 'g-shield', label: '물리 저항', value: `${player!.physicalResist}%`, capped: player!.physicalResist >= 50 });
		}
		if ((player?.magicResist ?? 0) > 0) {
			rows.push({ icon: 'g-shield', label: '마법 저항', value: `${player!.magicResist}%`, capped: player!.magicResist >= 50 });
		}
		if ((player?.damageReduction ?? 0) > 0) {
			rows.push({
				icon: 'g-anvil', label: '피해 감소', value: `-${pct(player!.damageReduction)}`,
				capped: player!.damageReduction >= UNLOCK_CAPS.damageReduction - EPS,
			});
		}
		if ((player?.lifesteal ?? 0) > 0) {
			rows.push({
				icon: 'g-drop', label: '흡혈', value: pct(player!.lifesteal),
				capped: player!.lifesteal >= UNLOCK_CAPS.lifesteal - EPS,
			});
		}
		const xpMult = progression?.xpMultiplier ?? 1;
		if (xpMult > 1 + EPS) {
			rows.push({
				icon: 'g-eye', label: '경험치 획득', value: `+${pct(xpMult - 1)}`,
				capped: xpMult >= UNLOCK_CAPS.xpMultiplier - EPS,
			});
		}
		if ((player?.goldBonus ?? 0) > 0) {
			rows.push({
				icon: 'g-chip', label: '골드 획득', value: `+${pct(player!.goldBonus)}`,
				capped: player!.goldBonus >= UNLOCK_CAPS.goldBonus - EPS,
			});
		}
		if ((player?.executeDamage ?? 0) > 0) {
			rows.push({
				icon: 'g-blade', label: '처형', value: `+${pct(player!.executeDamage)}`,
				capped: player!.executeDamage >= UNLOCK_CAPS.executeDamage - EPS,
			});
		}
		if ((player?.pen ?? 0) > 0) {
			rows.push({
				icon: 'g-spark', label: '관통', value: pct(player!.pen),
				capped: player!.pen >= UNLOCK_CAPS.pen - EPS,
			});
		}

		return rows;
	}

	// ---------------------------------------------------------------
	// 빌드
	// ---------------------------------------------------------------

	private build(): void {
		const scene = this.scene;
		const hs = hudScaleFor(scene);
		const panelW = 560 * hs;
		const x = scene.scale.width - panelW - 14 * hs;
		const headerH = 138 * hs;
		const footerH = 30 * hs;
		const maxPanelH = scene.scale.height - 28 * hs;

		// 항목 설명 툴팁 — 캐릭터창(1600) 위에 뜬다
		this.tooltip = new Tooltip(scene, { depth: DEPTH + 40, wrapWidth: 260 });

		// 배경(NineSlice)을 먼저 만들고 콘텐츠 배치 후 실제 높이로 조정한다
		const bg = panel(scene, 0, 0, panelW, 400, { alpha: 0.97 });
		bg.setScrollFactor(0).setDepth(DEPTH);
		this.objects.push(bg);

		const track = (object: Phaser.GameObjects.GameObject) => {
			(object as Phaser.GameObjects.Image).setScrollFactor?.(0);
			(object as Phaser.GameObjects.Image).setDepth?.(DEPTH + 1);
			this.objects.push(object);
			return object;
		};

		// ── 헤더: 타이틀 + 닫기
		const title = scene.add.text(x + 20 * hs, 12 * hs, '총 람', {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: `${17 * hs}px`, fontStyle: '900', color: INK.base,
		}).setOrigin(0, 0);
		track(title);

		// ✕ 글자 자체는 15px 남짓이라 그대로 두면 사실상 안 눌린다 — 최소 터치 타깃까지 넓힌다
		const closeText = expandHit(scene.add.text(x + panelW - 20 * hs, 20 * hs, '✕', style(15 * hs, INK.dim, { display: true }))
			.setOrigin(0.5).setInteractive({ useHandCursor: true }));
		closeText.on('pointerdown', () => this.close());
		closeText.on('pointerover', () => closeText.setColor(INK.danger));
		closeText.on('pointerout', () => closeText.setColor(INK.dim));
		track(closeText);

		// ── 캐릭터 카드: 초상 + 이름/LV + HP 게이지 + 장착 검 미니 슬롯
		const portraitSize = 74 * hs;
		const portraitX = x + 20 * hs + portraitSize / 2;
		const portraitY = 40 * hs + portraitSize / 2;
		track(slot(scene, portraitX, portraitY, portraitSize, 'blue'));
		const idleSheet = scene.playerConfig?.spritesheets?.idle;
		if (idleSheet && scene.textures.exists(idleSheet.textureKey)) {
			const portrait = scene.add.image(portraitX, portraitY + 2 * hs, idleSheet.textureKey, idleSheet.frameStart ?? 0);
			portrait.setDisplaySize(portraitSize - 12 * hs, portraitSize - 12 * hs);
			track(portrait);
		}

		const infoX = x + 20 * hs + portraitSize + 14 * hs;
		const keeperName = scene.playerConfig?.name ?? 'KEEPER';
		const level = scene.progression?.level ?? 1;
		const nameText = scene.add.text(infoX, 40 * hs, keeperName, {
			fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
			fontSize: `${16 * hs}px`, fontStyle: '900', color: INK.base,
		}).setOrigin(0, 0);
		track(nameText);
		track(scene.add.text(infoX + nameText.width + 8 * hs, 41.5 * hs, `Lv ${level}`,
			style(13 * hs, INK.gold, { display: true })).setOrigin(0, 0));
		const round = Math.max(1, scene.waveSystem?.round ?? 1);
		track(scene.add.text(x + panelW - 20 * hs, 42 * hs,
			`라운드 ${round} · 처치 ${scene.waveSystem?.killCount ?? 0}`,
			style(11 * hs, INK.dim)).setOrigin(1, 0));

		const gaugeW = panelW - (infoX - x) - 20 * hs;
		const hpGauge = createGauge(scene, infoX, 64 * hs, gaugeW, 20 * hs, {
			fill: 'orange', px: Math.max(1.2, 2 * hs),
		});
		hpGauge.root.setScrollFactor(0).setDepth(DEPTH + 1);
		this.gauges.push(hpGauge);
		this.hpGauge = hpGauge;
		const hpText = scene.add.text(infoX + gaugeW / 2, 74 * hs, '', style(11 * hs, UI.white, { display: true }))
			.setOrigin(0.5);
		hpText.setShadow(0, 1, '#000000', 2, false, true);
		track(hpText);
		this.hpText = hpText;
		this.updateHpGauge();

		// 장착 검 미니 슬롯 (최대 7)
		const orbit = scene.swordOrbit;
		const miniSize = 30 * hs;
		const miniY = 96 * hs + miniSize / 2;
		const maxSlots = orbit?.maxSwords ?? 7;
		for (let i = 0; i < maxSlots; i += 1) {
			const sword = orbit?.swords?.[i];
			const unlocked = i < (orbit?.unlockedSlots ?? 0);
			const mx = infoX + i * (miniSize + 6 * hs) + miniSize / 2;
			track(slot(scene, mx, miniY, miniSize, sword ? 'gray' : unlocked ? 'slate' : 'ghost'));
			if (sword) {
				const icon = scene.add.image(mx, miniY, 'sword', sword.definition?.sheetOrder ?? 0);
				icon.setDisplaySize(miniSize - 8 * hs, miniSize - 8 * hs);
				track(icon);
			}
		}

		// ── 탭 줄
		const tabY = headerH;
		const tabW = 84 * hs;
		TABS.forEach((tab, index) => {
			const active = tab.id === this.tab;
			const tx = x + 20 * hs + index * (tabW + 8 * hs);
			track(insetPanel(scene, tx, tabY, tabW, 28 * hs, { alpha: active ? 1 : 0.5 }));
			const label = scene.add.text(tx + tabW / 2, tabY + 14 * hs, tab.label, {
				fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
				fontSize: `${12.5 * hs}px`, fontStyle: active ? '900' : '700',
				color: active ? INK.gold : INK.dim,
			}).setOrigin(0.5).setInteractive({ useHandCursor: true });
			// 탭 라벨은 글자 폭만큼만 눌리던 것을 탭 칸(tabW × 28) 전체로 넓힌다
			expandHit(label, { minW: tabW, minH: 28 * hs });
			label.on('pointerdown', () => this.selectTab(tab.id));
			track(label);
		});
		track(scene.add.text(x + panelW - 20 * hs, tabY + 14 * hs, '← →', style(11 * hs, INK.faint))
			.setOrigin(1, 0.5));

		// ── 탭 콘텐츠
		const contentY = tabY + 38 * hs;
		let cursorY: number;
		switch (this.tab) {
			case 'swords':
				cursorY = this.buildSwordTab(x, contentY, panelW, hs, track);
				break;
			case 'sets':
				cursorY = this.buildSetTab(x, contentY, panelW, hs, track);
				break;
			default:
				cursorY = this.buildStatTab(x, contentY, panelW, hs, track);
				break;
		}

		// ── 배경 크기 확정 + 수직 배치
		let panelH = Math.min(maxPanelH, cursorY + footerH);
		const y = Math.max(14 * hs, Math.min(120 * hs, (scene.scale.height - panelH) / 2));
		panelH = Math.min(panelH, scene.scale.height - y - 10 * hs);
		bg.setPosition(x, y);
		bg.setSize(panelW / 2, panelH / 2); // panel() 은 px=2 스케일 — setSize 는 절반 단위

		for (const object of this.objects) {
			if (object === bg) {
				continue;
			}
			const positioned = object as Phaser.GameObjects.Image;
			if (typeof positioned.y === 'number') {
				positioned.y += y;
			}
		}
		for (const gauge of this.gauges) {
			gauge.root.y += y;
		}

		const hint = scene.add.text(x + panelW / 2, y + panelH - 15 * hs, 'TAB 닫기 · ← → 갈래 전환',
			style(9.5 * hs, INK.faint)).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH + 1);
		this.objects.push(hint);
	}

	/** 능력치 탭: 아이콘 스탯 카드 2열 그리드 */
	private buildStatTab(
		x: number, contentY: number, panelW: number, hs: number,
		track: (o: Phaser.GameObjects.GameObject) => Phaser.GameObjects.GameObject,
	): number {
		const scene = this.scene;
		const entries = this.collectStats();
		this.signature = `stats|${entries.map((entry) => entry.label).join(',')}`;
		this.statValueTexts = [];

		const cols = 2;
		const gap = 8 * hs;
		const cardW = (panelW - 40 * hs - gap) / cols;
		const cardH = 33 * hs;

		entries.forEach((entry, index) => {
			const cx = x + 20 * hs + (index % cols) * (cardW + gap);
			const cy = contentY + Math.floor(index / cols) * (cardH + 5 * hs);
			track(insetPanel(scene, cx, cy, cardW, cardH, { alpha: 0.85 }));
			track(iconImage(scene, entry.icon, cx + 16 * hs, cy + cardH / 2, 15 * hs, entry.capped ? INK.gold : INK.dim));
			track(scene.add.text(cx + 30 * hs, cy + cardH / 2, entry.label, style(11 * hs, INK.dim))
				.setOrigin(0, 0.5));
			const value = scene.add.text(cx + cardW - 11 * hs, cy + cardH / 2, this.formatStat(entry), {
				fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
				fontSize: `${12.5 * hs}px`, fontStyle: '800',
				color: entry.capped ? INK.gold : INK.base,
			}).setOrigin(1, 0.5);
			track(value);
			this.statValueTexts.push(value);

			// 호버 설명 — 투명 히트 사각형 (인셋 패널은 나인슬라이스라 히트 영역이 어긋난다).
			// track() 의 y 보정을 함께 받으므로 호버 시점에 실제 좌표를 읽는다.
			const hit = scene.add.rectangle(cx + cardW / 2, cy + cardH / 2, cardW, cardH, 0x000000, 0.001)
				.setInteractive({ useHandCursor: false });
			hit.on('pointerover', () => {
				this.tooltip?.show(hit.x, hit.y - cardH / 2, withKeywordFooter(
					entry.label,
					`${STAT_HELP[entry.label] ?? '현재 값입니다.'}\n현재 ${entry.value}${entry.capped ? ' (최대치 도달)' : ''}`,
					entry.capped ? INK.gold : UI.quenchText,
				));
			});
			hit.on('pointerout', () => this.tooltip?.hide());
			track(hit);
		});

		const rows = Math.ceil(entries.length / cols);
		return contentY + rows * (cardH + 5 * hs) + 5 * hs;
	}

	private formatStat(entry: StatEntry): string {
		return entry.capped ? `${entry.value} MAX` : entry.value;
	}

	/** 검 탭: 장착 검 카드 (스프라이트·레벨 핍·수치·각인) */
	private buildSwordTab(
		x: number, contentY: number, panelW: number, hs: number,
		track: (o: Phaser.GameObjects.GameObject) => Phaser.GameObjects.GameObject,
	): number {
		const scene = this.scene;
		const orbit = scene.swordOrbit;
		const swords = orbit?.swords ?? [];
		this.signature = `swords|${swords.map((sword) => `${sword.definition?.id}:${sword.level}`).join(',')}`;

		let cursorY = contentY;
		if (swords.length === 0) {
			track(scene.add.text(x + panelW / 2, cursorY + 20 * hs, '장착한 검이 없다.', style(12 * hs, INK.faint))
				.setOrigin(0.5));
			return cursorY + 46 * hs;
		}

		const cardW = panelW - 40 * hs;
		for (const sword of swords) {
			const definition = sword.definition ?? {};
			const element = definition.element as SetElement | undefined;
			const elementInk = element ? ELEMENT_INK[element] ?? INK.base : INK.base;
			const traits: string[] = (sword.traits ?? []) as string[];
			const awakening = orbit?.awakenings?.[definition.id ?? ''];
			const hasExtra = traits.length > 0 || Boolean(awakening);
			const cardH = (hasExtra ? 58 : 46) * hs;
			const cx = x + 20 * hs;
			track(insetPanel(scene, cx, cursorY, cardW, cardH, { alpha: 0.85 }));

			track(slot(scene, cx + 26 * hs, cursorY + cardH / 2, 36 * hs, 'gray'));
			const icon = scene.add.image(cx + 26 * hs, cursorY + cardH / 2, 'sword', definition.sheetOrder ?? 0);
			icon.setDisplaySize(28 * hs, 28 * hs);
			track(icon);

			const name = scene.add.text(cx + 50 * hs, cursorY + 13 * hs,
				definition.name ?? definition.id ?? '이름 없는 검', {
					fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
					fontSize: `${13 * hs}px`, fontStyle: '900', color: elementInk,
				}).setOrigin(0, 0.5);
			track(name);
			if (element && ELEMENT_THEME[element]) {
				track(iconImage(scene, ELEMENT_THEME[element].tex, cx + 56 * hs + name.width, cursorY + 13 * hs, 13 * hs, ELEMENT_THEME[element].num));
			}
			const maxLevel = orbit?.maxSwordLevel ?? 5;
			const clampedLevel = Math.min(sword.level ?? 1, maxLevel);
			const pips = '◆'.repeat(clampedLevel) + '◇'.repeat(Math.max(0, maxLevel - clampedLevel));
			track(scene.add.text(cx + cardW - 12 * hs, cursorY + 13 * hs, pips, style(11 * hs, INK.gold))
				.setOrigin(1, 0.5));

			const cooldownSec = ((sword.scanInterval ?? 1500) / 1000).toFixed(2);
			const crit = Math.round(((definition.critChance ?? 0) + (scene.player?.critChance ?? 0)) * 100);
			const specialLabel = sword.special?.type ? ` · ${this.specialLabel(sword.special.type)}` : '';
			track(scene.add.text(cx + 50 * hs, cursorY + 31 * hs,
				`피해 ${Math.round(sword.damage ?? 0)} · 쿨 ${cooldownSec}s · 치명 ${crit}% · 연타 ${sword.hitsPerLaunch ?? 1}${specialLabel}`,
				style(11 * hs, INK.dim)).setOrigin(0, 0.5));

			if (hasExtra) {
				const bits: string[] = [];
				if (traits.length > 0) {
					bits.push(`각인 ${traits.length}`);
				}
				if (awakening) {
					// 내부 id('ruin')가 아니라 사람이 읽는 이름으로 (2026-09-02)
					bits.push(`★ ${awakeningById(awakening)?.name ?? awakening}`);
				}
				track(scene.add.text(cx + 50 * hs, cursorY + 46 * hs, bits.join(' · '),
					style(10.5 * hs, awakening ? INK.gold : INK.faint)).setOrigin(0, 0.5));
			}

			cursorY += cardH + 6 * hs;
		}

		return cursorY + 2 * hs;
	}

	private specialLabel(type: string): string {
		const names: Record<string, string> = {
			burn: '화상', poison: '중독', chain: '연쇄', midas: '금화',
			slow: '감속', blast: '폭발', leech: '흡혈', pierce: '관통',
		};
		return names[type] ?? type;
	}

	/** 세트 탭: 원소 세트 사다리 + 실시간 보정 + 증강 목록 */
	private buildSetTab(
		x: number, contentY: number, panelW: number, hs: number,
		track: (o: Phaser.GameObjects.GameObject) => Phaser.GameObjects.GameObject,
	): number {
		const scene = this.scene;
		const orbit = scene.swordOrbit;
		const sets = scene.elementSets;
		const counts = orbit?.getElementCounts?.() ?? {};
		const augments = scene.augmentSystem?.takenAugments?.() ?? [];
		this.signature = `sets|${SET_ELEMENTS.map((element) => counts[element] ?? 0).join(',')}|${augments.length}`;

		let cursorY = contentY;
		const cardW = panelW - 40 * hs;
		let anyActive = false;

		for (const element of SET_ELEMENTS) {
			const count = counts[element] ?? 0;
			if (count < 2) {
				continue;
			}
			anyActive = true;
			const spec = ELEMENT_SETS[element];
			const tier = Math.min(7, count);
			const elementInk = ELEMENT_INK[element] ?? INK.base;

			const visibleTiers = spec.tiers.filter((step) => step.count <= tier + 1);
			const cx = x + 20 * hs;
			const headH = 28 * hs;
			// 줄바꿈 높이는 텍스트를 만들고 나서 정확해진다 — 우선 배치 후 카드 배경 크기를 정한다
			const inset = insetPanel(scene, cx, cursorY, cardW, headH, { alpha: 0.85 });
			track(inset);

			track(iconImage(scene, ELEMENT_THEME[element].tex, cx + 16 * hs, cursorY + 14 * hs, 15 * hs, ELEMENT_THEME[element].num));
			track(scene.add.text(cx + 30 * hs, cursorY + 14 * hs, `${spec.label} ${tier}세트`, {
				fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
				fontSize: `${13 * hs}px`, fontStyle: '900', color: elementInk,
			}).setOrigin(0, 0.5));
			track(scene.add.text(cx + cardW - 12 * hs, cursorY + 14 * hs,
				`${count}자루${orbit?.isUltimateUnlocked?.(element) ? ' · ★필살기' : ''}`,
				style(11 * hs, INK.gold)).setOrigin(1, 0.5));

			let rowY = cursorY + headH;
			for (const step of visibleTiers) {
				const unlocked = step.count <= tier;
				const mark = unlocked ? '◆' : '◇';
				const text = step.skill ? `[${step.skill.name}] ${step.skill.desc}` : step.desc;
				const line = scene.add.text(cx + 16 * hs, rowY, `${mark} ${step.count}  ${text}`,
					style(10.5 * hs, unlocked ? INK.dim : INK.faint));
				line.setWordWrapWidth(cardW - 32 * hs);
				track(line);
				rowY += Math.max(16 * hs, line.height + 2 * hs);
			}
			inset.setSize(cardW / 2, (rowY - cursorY + 6 * hs) / 2);
			cursorY = rowY + 12 * hs;
		}

		if (!anyActive) {
			track(scene.add.text(x + panelW / 2, cursorY + 16 * hs, '같은 원소를 2자루 이상 장착하면 세트가 열린다.',
				style(11.5 * hs, INK.faint)).setOrigin(0.5));
			cursorY += 40 * hs;
		}

		if (sets) {
			const dyn = sets.dynamicDamageMult();
			if (Math.abs(dyn - 1) > 0.001 || sets.blessingReady) {
				const lines: Array<{ text: string; color: string }> = [];
				if (sets.has('gold.greed')) {
					lines.push({ text: `탐욕: 누적 ${sets.goldEarned} 골드 → 피해 +${Math.min(30, Math.floor(sets.goldEarned / 100))}%`, color: INK.dim });
				}
				if (sets.galeActive) {
					lines.push({ text: '질풍: 이동 +25% · 피해 +20%', color: INK.green });
				}
				if (sets.thirstStacks > 0) {
					lines.push({ text: `피의 갈증 ${sets.thirstStacks}중첩`, color: INK.danger });
				}
				if (sets.has('blood.bloodline')) {
					const player = scene.player;
					const missing = player && player.maxHp > 0 ? 1 - player.hp / player.maxHp : 0;
					lines.push({ text: `혈계: 피해 +${Math.round(missing * 80)}% (회복 -30%)`, color: INK.danger });
				}
				if (sets.blessingReady) {
					lines.push({ text: '금빛 축복 대기 — 다음 타격 확정 치명타', color: INK.gold });
				}
				lines.push({ text: `지금 검 피해 합계 ×${dyn.toFixed(2)}`, color: INK.gold });

				const cx = x + 20 * hs;
				const cardH = (10 + lines.length * 16 + 6) * hs;
				track(insetPanel(scene, cx, cursorY, cardW, cardH, { alpha: 0.85 }));
				let rowY = cursorY + 10 * hs;
				for (const line of lines) {
					track(scene.add.text(cx + 16 * hs, rowY, line.text, style(10.5 * hs, line.color)));
					rowY += 16 * hs;
				}
				cursorY += cardH + 8 * hs;
			}
		}

		if (augments.length > 0) {
			const cx = x + 20 * hs;
			track(scene.add.text(cx, cursorY + 8 * hs, `증강 ${augments.length}`, {
				fontFamily: FONT.display, resolution: TEXT_RESOLUTION,
				fontSize: `${12.5 * hs}px`, fontStyle: '900', color: INK.base,
			}).setOrigin(0, 0.5));
			cursorY += 20 * hs;
			for (const augment of augments) {
				const line = scene.add.text(cx, cursorY, `· ${augment.name} — ${augment.desc}`, style(10.5 * hs, INK.dim));
				line.setWordWrapWidth(cardW);
				track(line);
				cursorY += Math.max(15 * hs, line.height + 2 * hs);
			}
			cursorY += 4 * hs;
		}

		return cursorY;
	}

	// ---------------------------------------------------------------
	// 실시간 갱신
	// ---------------------------------------------------------------

	private updateHpGauge(): void {
		const player = this.scene.player;
		if (!player || !this.hpGauge) {
			return;
		}
		const ratio = Phaser.Math.Clamp((player.hp ?? 0) / Math.max(1, player.maxHp ?? 1), 0, 1);
		this.hpGauge.setRatio(ratio);
		const label = `${Math.max(0, Math.ceil(player.hp ?? 0))} / ${player.maxHp ?? 0}`;
		if (this.hpText && this.hpText.text !== label) {
			this.hpText.setText(label);
		}
	}

	private refreshValues(): void {
		if (!this.isOpen || this.destroyed) {
			return;
		}
		this.updateHpGauge();

		if (this.tab === 'stats') {
			const entries = this.collectStats();
			const signature = `stats|${entries.map((entry) => entry.label).join(',')}`;
			if (signature !== this.signature) {
				this.rebuild();
				return;
			}
			entries.forEach((entry, index) => {
				const text = this.statValueTexts[index];
				if (!text || !text.active) {
					return;
				}
				const next = this.formatStat(entry);
				if (text.text !== next) {
					text.setText(next);
				}
				const nextColor = entry.capped ? INK.gold : INK.base;
				if (text.style.color !== nextColor) {
					text.setColor(nextColor);
				}
			});
			return;
		}

		// 검/세트 탭: 구성 시그니처가 바뀌면 통째로 재구축
		const orbit = this.scene.swordOrbit;
		const nextSignature = this.tab === 'swords'
			? `swords|${(orbit?.swords ?? []).map((sword) => `${sword.definition?.id}:${sword.level}`).join(',')}`
			: `sets|${SET_ELEMENTS.map((element) => (orbit?.getElementCounts?.() ?? {})[element] ?? 0).join(',')}|${this.scene.augmentSystem?.takenAugments?.().length ?? 0}`;
		if (nextSignature !== this.signature) {
			this.rebuild();
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.close();
	}
}
