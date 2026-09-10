// 런(회차) 세이브: 매 라운드 종료·상점 종료 시 자동 저장, 타이틀에서 이어하기.
// MetaProgression(영구 강화)과 별개로, 진행 중인 한 판의 상태만 담는다.
// 필드의 적/오브 등 전투 중 상태는 저장하지 않는다 — 이어하기는 항상
// "라운드와 라운드 사이" 시점(다음 라운드 시작 직전)으로 복원된다.

import type GameScene from '../scenes/GameScene';
import type { ReserveSword } from '../types/actors';
import type { AugmentSaveState } from '../systems/AugmentSystem';

const STORAGE_KEY = 'movesword-run-v1';
// v2 (2026-08-28): 각인(traits)이 슬롯 귀속 → 검 귀속으로 이전.
// v1 세이브는 peek() 에서 슬롯 각인을 해당 슬롯의 장착 검으로 옮겨 마이그레이션한다.
const SAVE_VERSION = 2;

interface SavedSword {
	id: string;
	level: number;
	/** 검에 새겨진 각인 id 목록 (v2+) */
	traits?: string[];
}

interface SavedSlotState {
	enhance: number;
	traits: string[];
}

export interface RunSaveData {
	version: number;
	savedAt: number;

	// 런 메타
	characterId: string;
	dangerLevel: number;

	// 라운드 진행 (round = 마지막으로 완료한 라운드, 이어하기 시 round+1부터)
	round: number;
	elapsedMs: number;
	killCount: number;

	// 플레이어 최종 스탯 스냅샷 (레벨업/상점 구매가 즉시 반영되는 구조라 최종값을 저장)
	player: {
		hp: number;
		maxHp: number;
		attackDamage: number;
		defense: number;
		moveSpeed: number;
		critChance: number;
		critDamageMultiplier: number;
		luck: number;
		dodgeChance: number;
		hpRegen: number;
		killHeal: number;
		thorns: number;
		physicalResist: number;
		magicResist: number;
		// 해금 스탯 (2026-08-29 추가 — 구세이브는 apply에서 ?? 0 처리)
		damageReduction?: number;
		lifesteal?: number;
		goldBonus?: number;
		// 치명타 100% 해금 스탯 (2026-09-04 추가)
		executeDamage?: number;
		pen?: number;
	};

	// XP 진행
	progression: {
		level: number;
		xp: number;
		xpToNext: number;
		xpMultiplier: number;
		magnetRadius: number;
	};

	// 검 궤도 시스템 (검 목록 + 칸 경제 + 전역 배율)
	orbit: {
		damageMultiplier: number;
		cooldownMultiplier: number;
		launchSpeedMultiplier: number;
		bonusHits: number;
		radius: number;
		orbitSpeed: number;
		cleaveTargets: number;
		cleaveRadius: number;
		unlockedSlots: number;
		slotStates: SavedSlotState[];
		loadout: SavedSword[];
		reserve: SavedSword[];
		setAnnounced: string[];
	};

	// 경제
	runGold: number;
	purchaseCounts: Record<string, number>;
	revivalsLeft: number;

	// 능동 스킬 (2026-09-04) — 필살기 게이지 · 스킬 레벨 (옵션, 구세이브는 0)
	skills?: { ultCharge: number; levels?: Record<string, number>; tree?: { learned: string[]; bonusPoints: number; nodeLevels?: Record<string, number> } };

	// 증강 (v2 세이브에 옵션 — 없는 구세이브는 증강 없이 복원)
	augment?: AugmentSaveState;

	// 원소 세트 (옵션 — 구세이브는 누적 골드 0 / 안내 미출력 상태로 복원)
	elementSets?: { goldEarned: number; announced: string[] };
}

export default class RunSave {
	static has(): boolean {
		return RunSave.peek() !== null;
	}

	/** 저장 데이터를 읽되 없거나 깨졌으면 null. */
	static peek(): RunSaveData | null {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) {
				return null;
			}
			const data = JSON.parse(raw) as RunSaveData;
			if (typeof data?.round !== 'number' || data.round < 1) {
				return null;
			}
			// v1 → v2 마이그레이션: 슬롯 각인을 그 슬롯에 앉아 있던 검으로 옮긴다
			if (data.version === 1) {
				data.orbit?.slotStates?.forEach((slot, index) => {
					const sword = data.orbit.loadout?.[index];
					if (sword && slot.traits?.length) {
						sword.traits = [...slot.traits];
					}
					if (slot) {
						slot.traits = [];
					}
				});
				data.version = SAVE_VERSION;
			}
			if (data.version !== SAVE_VERSION) {
				return null;
			}
			return data;
		} catch {
			return null;
		}
	}

	static save(data: RunSaveData): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch {
			// 저장 공간 부족 등 — 세이브 실패가 게임을 멈추게 하지 않는다
		}
	}

	static clear(): void {
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			// ignore
		}
	}

	// ---------------------------------------------------------------
	// Capture: 현재 씬 상태 → 스냅샷
	// ---------------------------------------------------------------

	static capture(scene: GameScene): RunSaveData {
		const player = scene.player;
		const orbit = scene.swordOrbit;
		const progression = scene.progression;
		const wave = scene.waveSystem;

		// 원소 세트·스킬 트리 보정을 잠시 벗겨 "보정 없는 순수 스탯"을 저장한다.
		// 복원 시 장착/트리를 재구성하며 다시 계산돼 얹히므로, 보정이 섞인 값을
		// 저장하면 저장/복원을 반복할 때마다 이중으로 불어난다.
		scene.elementSets?.revertStats();
		scene.skillTree?.revertForCapture?.();
		try {
			return RunSave.captureRaw(scene, player, orbit, progression, wave);
		} finally {
			scene.skillTree?.reapplyAfterCapture?.();
			scene.elementSets?.applyStats();
		}
	}

	private static captureRaw(
		scene: GameScene,
		player: GameScene['player'],
		orbit: GameScene['swordOrbit'],
		progression: GameScene['progression'],
		wave: GameScene['waveSystem'],
	): RunSaveData {
		return {
			version: SAVE_VERSION,
			savedAt: Date.now(),

			characterId: scene.characterId,
			dangerLevel: scene.dangerLevel,

			round: wave.round,
			elapsedMs: wave.elapsedMs,
			killCount: wave.killCount,

			player: {
				hp: player.hp,
				maxHp: player.maxHp,
				attackDamage: player.attackDamage,
				defense: player.defense,
				moveSpeed: player.moveSpeed,
				critChance: player.critChance,
				critDamageMultiplier: player.critDamageMultiplier,
				luck: player.luck,
				dodgeChance: player.dodgeChance,
				hpRegen: player.hpRegen,
				killHeal: player.killHeal,
				thorns: player.thorns,
				physicalResist: player.physicalResist,
				magicResist: player.magicResist,
				damageReduction: player.damageReduction ?? 0,
				lifesteal: player.lifesteal ?? 0,
				goldBonus: player.goldBonus ?? 0,
				executeDamage: player.executeDamage ?? 0,
				pen: player.pen ?? 0,
			},

			progression: {
				level: progression.level,
				xp: progression.xp,
				xpToNext: progression.xpToNext,
				xpMultiplier: progression.xpMultiplier ?? 1,
				magnetRadius: progression.magnetRadius,
			},

			orbit: {
				damageMultiplier: orbit.damageMultiplier,
				cooldownMultiplier: orbit.cooldownMultiplier,
				launchSpeedMultiplier: orbit.launchSpeedMultiplier,
				bonusHits: orbit.bonusHits,
				radius: orbit.radius,
				orbitSpeed: orbit.orbitSpeed,
				cleaveTargets: orbit.cleaveTargets,
				cleaveRadius: orbit.cleaveRadius,
				unlockedSlots: orbit.unlockedSlots,
				slotStates: orbit.slotStates.map((state) => ({
					enhance: state.enhance,
					traits: [...state.traits],
				})),
				loadout: orbit.getLoadout().map((entry) => ({
					id: entry.definition.id,
					level: entry.level,
					traits: [...(entry.traits ?? [])],
				})),
				reserve: orbit.reserve.map((entry) => ({
					id: entry.definition.id,
					level: entry.level,
					traits: [...(entry.traits ?? [])],
				})),
				setAnnounced: [...orbit.setAnnounced],
			},

			runGold: scene.pickupSystem?.runGold ?? 0,
			skills: {
				ultCharge: scene.activeSkills?.ultCharge ?? 0,
				levels: scene.activeSkills?.levels ? { ...scene.activeSkills.levels } : undefined,
				tree: scene.skillTree
					? { learned: [...scene.skillTree.learned], bonusPoints: scene.skillTree.bonusPoints, nodeLevels: { ...scene.skillTree.levels } }
					: undefined,
			},
			purchaseCounts: { ...scene.shopSystem?.purchaseCounts },
			revivalsLeft: scene.revivalsLeft,

			augment: scene.augmentSystem?.captureState(),
			elementSets: scene.elementSets?.snapshot(),
		};
	}

	// ---------------------------------------------------------------
	// Apply: 스냅샷 → 새로 만들어진 씬 (GameScene.create 말미에서 호출)
	// ---------------------------------------------------------------

	static apply(scene: GameScene, data: RunSaveData): void {
		const orbit = scene.swordOrbit;
		const player = scene.player;
		const progression = scene.progression;
		const wave = scene.waveSystem;

		// 아래에서 스탯 값을 통째로 덮어쓴다. 씬 생성 시점의 초기 검으로 이미
		// 반영해 둔 세트 보정 기록을 지워야, 나중에 사라진 값을 빼려다 스탯이
		// 어긋나는 일이 없다 (되돌리지 않고 기록만 폐기).
		scene.elementSets?.resetApplied();

		// 1) 오빗 전역 배율/설정 — 검 재구성 전에 세팅해야 스탯 재계산에 반영된다
		orbit.damageMultiplier = data.orbit.damageMultiplier;
		orbit.cooldownMultiplier = data.orbit.cooldownMultiplier;
		orbit.launchSpeedMultiplier = data.orbit.launchSpeedMultiplier;
		orbit.bonusHits = data.orbit.bonusHits;
		orbit.radius = data.orbit.radius;
		orbit.orbitSpeed = data.orbit.orbitSpeed;
		orbit.cleaveTargets = data.orbit.cleaveTargets;
		orbit.cleaveRadius = data.orbit.cleaveRadius;
		orbit.unlockedSlots = Math.min(data.orbit.unlockedSlots, orbit.maxSwords);
		data.orbit.slotStates.forEach((saved, index) => {
			const state = orbit.slotStates[index];
			if (state) {
				state.enhance = saved.enhance;
				state.traits = [...saved.traits];
			}
		});
		orbit.setAnnounced = new Set(data.orbit.setAnnounced ?? []);

		// 1.5) 증강 복원 — 각성(awakenings)이 recalculateSwordStats에 반영되도록
		// 반드시 rebuildLoadout 전에 되돌린다
		if (data.augment && scene.augmentSystem) {
			scene.augmentSystem.restoreState(data.augment);
		}

		// 2) 창고 복원 → 장착 재구성 (카탈로그에서 사라진 검은 조용히 건너뛴다)
		orbit.reserve = data.orbit.reserve
			.map((entry) => {
				const definition = orbit.getDefinitionById(entry.id);
				return definition ? ({ definition, level: entry.level, traits: [...(entry.traits ?? [])] } as ReserveSword) : null;
			})
			.filter((entry): entry is ReserveSword => entry !== null);

		const loadoutEntries = data.orbit.loadout
			.map((entry): ReserveSword | null => {
				const definition = orbit.getDefinitionById(entry.id);
				return definition ? { definition, level: entry.level, traits: [...(entry.traits ?? [])] } : null;
			})
			.filter((entry): entry is ReserveSword => entry !== null);
		orbit.rebuildLoadout(loadoutEntries);

		// 레벨 3/5 마일스톤(+1타)은 levelUpSword에서만 붙으므로 복원 시 직접 재적용
		for (const sword of orbit.swords) {
			const milestones = (sword.level >= 3 ? 1 : 0) + (sword.level >= 5 ? 1 : 0);
			// 질풍 각성: 연속 타격 +1
			const gale = orbit.awakenings?.[sword.definition.id] === 'gale' ? 1 : 0;
			sword.hitsPerLaunch = (sword.definition.maxHits ?? 1) + orbit.bonusHits + milestones + gale;
			sword.remainingHits = sword.hitsPerLaunch;
			orbit.refreshAura(sword);
		}

		// 3) 플레이어 스탯
		player.maxHp = data.player.maxHp;
		player.hp = Math.min(data.player.hp, data.player.maxHp);
		player.attackDamage = data.player.attackDamage;
		player.defense = data.player.defense;
		player.moveSpeed = data.player.moveSpeed;
		player.critChance = data.player.critChance;
		player.critDamageMultiplier = data.player.critDamageMultiplier;
		player.luck = data.player.luck;
		player.dodgeChance = data.player.dodgeChance;
		player.hpRegen = data.player.hpRegen;
		player.killHeal = data.player.killHeal;
		player.thorns = data.player.thorns;
		player.physicalResist = data.player.physicalResist;
		player.magicResist = data.player.magicResist;
		player.damageReduction = data.player.damageReduction ?? 0;
		player.lifesteal = data.player.lifesteal ?? 0;
		player.goldBonus = data.player.goldBonus ?? 0;
		player.executeDamage = data.player.executeDamage ?? 0;
		player.pen = data.player.pen ?? 0;

		// 4) XP 진행
		progression.level = data.progression.level;
		progression.xp = data.progression.xp;
		progression.xpToNext = data.progression.xpToNext;
		progression.xpMultiplier = data.progression.xpMultiplier;
		progression.magnetRadius = data.progression.magnetRadius;
		progression.refreshPlayerStats();
		progression.drawHud();
		// 키퍼 레벨 성장 배율은 레벨에서 재계산 (maxHp 는 위에서 저장값 그대로 복원됨)
		scene.swordOrbit?.setGrowthLevel?.(progression.level);

		// 4.5) 원소 세트 — 순수 스탯이 모두 복원된 지금 보정을 새로 얹는다.
		// (rebuildLoadout 중의 recompute 는 아직 덮어쓰기 전 값 위에서 돌았다)
		if (scene.elementSets) {
			scene.elementSets.restore(data.elementSets);
			scene.elementSets.resetApplied();
			scene.elementSets.recompute();
		}

		// 5) 골드 — addGold는 goldMult/lifetime 집계를 타므로 직접 세팅 후 HUD만 갱신
		if (scene.pickupSystem) {
			scene.pickupSystem.runGold = data.runGold;
		}
		if (data.skills && scene.activeSkills) {
			scene.activeSkills.ultCharge = Math.max(0, Math.min(1, data.skills.ultCharge ?? 0));
			if (data.skills.levels) {
				scene.activeSkills.setLevels(data.skills.levels);
			}
			// 스킬 트리: 순수 스탯이 모두 복원된 뒤 패시브를 새로 얹는다 (revert 없이)
			scene.skillTree?.restoreAfterLoad?.(data.skills.tree?.learned, data.skills.tree?.bonusPoints ?? 0, data.skills.tree?.nodeLevels);
			scene.pickupSystem.spendGold(0); // 잔액 텍스트 갱신용 (0원 차감)
		}

		// 6) 라운드 — 이어하기/재도전은 대기마을에서 시작한다 (정비 후 게이트로 입장).
		// pendingIntermission 걸쇠가 next round 자동 시작을 막고, 게이트 출발이 푼다.
		wave.round = data.round;
		wave.roundActive = false;
		wave.elapsedMs = data.elapsedMs;
		wave.killCount = data.killCount;
		wave.pendingIntermission = true;
		wave.updateHud();
		scene.villageSystem?.enter?.(data.round);

		// 7) 기타
		scene.revivalsLeft = data.revivalsLeft;
		if (scene.shopSystem) {
			scene.shopSystem.purchaseCounts = { ...data.purchaseCounts };
		}
	}
}
