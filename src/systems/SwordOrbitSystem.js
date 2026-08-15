import Phaser from 'phaser';
import evolutionCatalog from '../data/evolutionCatalog.json';
import shopCatalog from '../data/shopCatalog.json';
import traitCatalog from '../data/traitCatalog.json';

const ELEMENT_COLORS = {
	fire: 0xf97316,
	electric: 0x60a5fa,
	poison: 0x4ade80,
	void: 0x7c3aed,
	gold: 0xfde047,
	ice: 0x93c5fd,
	blood: 0xef4444,
	wind: 0xa7f3d0,
};

export default class SwordOrbitSystem {
	constructor(scene = null, options = {}) {
		this.scene = scene;
		
		this.radius = options.radius ?? 140;
		this.orbitSpeed = options.orbitSpeed ?? 2;
		this.launchDuration = options.launchDuration ?? 420;
		this.returnSpeed = options.returnSpeed ?? 350;
		this.scanRadius = options.scanRadius ?? 300;
		this.closeScanRadius = options.closeScanRadius ?? 120;
		this.minSwords = options.minSwords ?? 1;
		this.maxSwords = options.maxSwords ?? 8;
		this.rotationOffset = options.rotationOffset ?? -5 * Math.PI / 4;
		this.returnLerp = options.returnLerp ?? 0.16;
		this.swordCatalog = Array.isArray(options.swordCatalog) ? options.swordCatalog : [];
		this.damageMultiplier = options.damageMultiplier ?? 1;
		this.cooldownMultiplier = options.cooldownMultiplier ?? 1;
		this.launchSpeedMultiplier = options.launchSpeedMultiplier ?? 1;
		this.bonusHits = options.bonusHits ?? 0;
		this.evolutionRecipes = Array.isArray(options.evolutionRecipes) ? options.evolutionRecipes : evolutionCatalog;
		this.noLaunch = options.noLaunch ?? false;
		this.orbitDamageMult = options.orbitDamageMult ?? 1;
		this.cleaveTargets = options.cleaveTargets ?? 0;
		this.cleaveRadius = options.cleaveRadius ?? 140;
		this.maxSwordLevel = options.maxSwordLevel ?? 5;
		this.levelDamageBonus = 0.15;   // +15% damage per sword level
		this.levelCooldownBonus = 0.06; // -6% cooldown per sword level

		// Slot economy: unlock -> enhance (+10 max, chance-based) -> trait sockets
		const slotConfig = shopCatalog.slots ?? {};
		this.slotConfig = slotConfig;
		this.unlockedSlots = Math.min(options.startUnlockedSlots ?? slotConfig.startUnlocked ?? 2, this.maxSwords);
		this.slotStates = Array.from({ length: 8 }, (_, index) => ({
			index,
			enhance: 0,
			traits: [],
		}));

		// 원소 세트: 2자루 = 공명(효과 1.5배), 둘 다 Lv3+ = 필살기
		this.setAnnounced = new Set();
		this.ultimateTimers = { fire: 0, electric: 0, void: 0 };
		this.ultimateIntervals = { fire: 8000, electric: 4000, void: 15000 };
		this.baseAngle = 0;
		this.swords = [];
		this.reserve = []; // 창고: 장착하지 않은 보유 검 [{definition, level}]
		this.enemyGroup = null;
		this.hudIcons = [];

		if (this.scene) {
			this.ensureMinimumSwords(this.scene);
		}
	}

	setEnemyGroup(enemyGroup) {
		if (!enemyGroup || this.enemyGroup === enemyGroup) {
			this.enemyGroup = enemyGroup ?? this.enemyGroup;
			return;
		}

		this.enemyGroup = enemyGroup;

		for (const sword of this.swords) {
			this.bindSwordOverlap(sword);
		}
	}

	ensureMinimumSwords(scene = this.scene) {
		if (!scene) {
			return;
		}

		while (this.swords.length < this.minSwords) {
			this.addSword(scene);
		}
	}

	getEffectiveMaxSwords() {
		return Math.min(this.maxSwords, this.unlockedSlots);
	}

	addSword(scene = this.scene, definitionOverride = null) {
		if (!scene || this.swords.length >= this.getEffectiveMaxSwords()) {
			return false;
		}

		const slot = this.swords.length;
		const definition = definitionOverride ?? this.getSwordDefinition(slot);
		const frame = definition.sheetOrder ?? slot % 30;
		const sword = scene.physics.add.sprite(0, 0, 'sword', frame);

		sword.setOrigin(0.5, 0.5);
		sword.setDepth(2);
		sword.setActive(true);
		sword.setVisible(true);
		sword.setDisplaySize(56, 56);

		if (sword.body) {
			sword.body.setAllowGravity(false);
			sword.body.setImmovable(true);
			const hitbox = definition.hitbox ?? {};
			const hitboxWidth = hitbox.width ?? 24;
			const hitboxHeight = hitbox.height ?? 24;
			const hitboxOffsetX = hitbox.offsetX ?? Math.max(0, Math.floor((sword.body.width - hitboxWidth) / 2));
			const hitboxOffsetY = hitbox.offsetY ?? Math.max(0, Math.floor((sword.body.height - hitboxHeight) / 2));
			sword.body.setSize(hitboxWidth, hitboxHeight, true);
			sword.body.setOffset(hitboxOffsetX, hitboxOffsetY);
		}

		sword.slot = slot;
		sword.definition = definition;
		sword.orbitSpeedMultiplier = definition.orbitSpeedMultiplier ?? 1;
		sword.level = 1;
		sword.launchSpeed = (definition.launchSpeed ?? 400) * this.launchSpeedMultiplier;
		sword.damage = definition.damage ?? 20;
		sword.scanInterval = (definition.cooldownMs ?? 1500) * this.cooldownMultiplier;
		sword.hitsPerLaunch = (definition.maxHits ?? 1) + this.bonusHits;
		sword.special = definition.special ?? null;
		sword.remainingHits = sword.hitsPerLaunch;
		sword.hitCooldownMs = definition.hitCooldownMs ?? 110;
		sword.hitCooldownUntil = 0;
		sword.hitTargets = new Set();
		sword.effect = definition.effect ?? null;
		sword.state = 'orbiting';
		sword.target = null;
		sword.scanTimer = 0;
		Object.defineProperty(sword, 'angle', {
			value: 0,
			writable: true,
			enumerable: true,
			configurable: true,
		});

		if (sword.effect?.tint && typeof sword.setTint === 'function') {
			sword.setTint(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color);
		}

		// Evolved swords render larger to feel special
		if (definition.evolved) {
			sword.setDisplaySize(70, 70);
		}

		this.swords.push(sword);
		this.bindSwordOverlap(sword);
		this.updateSwordPositions(this.scene?.player ?? null);
		this.refreshSwordHud();
		this.checkSetAnnouncements();

		return sword;
	}

	// ---------------------------------------------------------------
	// Sword levels (단계): duplicate shop purchases level the sword up
	// ---------------------------------------------------------------

	getSwordById(id) {
		return this.swords.find((sword) => sword.definition?.id === id) ?? null;
	}

	levelUpSword(sword) {
		if (!sword || sword.level >= this.maxSwordLevel) {
			return false;
		}

		sword.level += 1;
		this.recalculateSwordStats(sword);

		// Milestone: at level 3 and 5 the sword gains an extra hit per launch
		if (sword.level === 3 || sword.level === 5) {
			sword.hitsPerLaunch += 1;
			sword.remainingHits += 1;
		}

		this.scene?.soundSystem?.play('evolve', { volume: 0.6 });
		this.playFusionEffect(sword.x, sword.y, false);
		this.refreshSwordHud();
		this.checkSetAnnouncements();

		return true;
	}

	recalculateSwordStats(sword) {
		const definition = sword.definition ?? {};
		const levelBonus = sword.level - 1;
		const slotMods = this.computeSlotModifiers(sword);

		sword.damage = Math.round(
			(definition.damage ?? 20)
			* (1 + this.levelDamageBonus * levelBonus)
			* (1 + slotMods.damageMult),
		);
		sword.scanInterval = (definition.cooldownMs ?? 1500)
			* this.cooldownMultiplier
			* Math.max(0.5, 1 - this.levelCooldownBonus * levelBonus)
			* Math.max(0.4, 1 + slotMods.cooldownMult);
		sword.launchSpeed = (definition.launchSpeed ?? 400)
			* this.launchSpeedMultiplier
			* (1 + slotMods.launchSpeedMult);
		sword.traitMods = slotMods;
	}

	// ---------------------------------------------------------------
	// Slot economy: unlock / enhance / trait sockets / synergy
	// ---------------------------------------------------------------

	getSlotState(index) {
		return this.slotStates[index] ?? null;
	}

	nextSlotUnlockCost() {
		const config = this.slotConfig;
		const bought = this.unlockedSlots - (config.startUnlocked ?? 2);
		return Math.round((config.unlockBaseCost ?? 80) * Math.pow(config.unlockGrowth ?? 2, Math.max(0, bought)));
	}

	unlockSlot() {
		if (this.unlockedSlots >= this.maxSwords) {
			return false;
		}
		this.unlockedSlots += 1;
		return true;
	}

	enhanceCost(slotIndex) {
		const state = this.getSlotState(slotIndex);
		return Math.round((this.slotConfig.enhanceBaseCost ?? 30) * (state.enhance + 1));
	}

	enhanceSuccessRate(slotIndex) {
		const state = this.getSlotState(slotIndex);
		const rates = this.slotConfig.enhanceSuccessRates ?? [];
		return rates[state.enhance] ?? 0.2;
	}

	// Chance-based +1 (guaranteed with a 💎). Returns 'success' | 'fail' | 'max'.
	tryEnhanceSlot(slotIndex, guaranteed = false) {
		const state = this.getSlotState(slotIndex);
		if (!state || state.enhance >= (this.slotConfig.enhanceMaxLevel ?? 10)) {
			return 'max';
		}

		const success = guaranteed || Math.random() < this.enhanceSuccessRate(slotIndex);
		if (!success) {
			return 'fail';
		}

		state.enhance += 1;
		const sword = this.swords[slotIndex];
		if (sword) {
			this.recalculateSwordStats(sword);
		}
		this.refreshSwordHud();
		return 'success';
	}

	canAddTrait(slotIndex) {
		const state = this.getSlotState(slotIndex);
		return Boolean(state
			&& state.enhance >= (this.slotConfig.enhanceMaxLevel ?? 10)
			&& state.traits.length < (this.slotConfig.traitSockets ?? 3));
	}

	// Legendary trait gacha: random trait into the slot's next socket
	pullTrait(slotIndex) {
		if (!this.canAddTrait(slotIndex)) {
			return null;
		}

		const trait = Phaser.Math.RND.pick(traitCatalog.traits);
		this.getSlotState(slotIndex).traits.push(trait.id);

		const sword = this.swords[slotIndex];
		if (sword) {
			this.recalculateSwordStats(sword);
			this.refreshAura(sword);
		}
		this.refreshSwordHud();
		return trait;
	}

	getTraitById(id) {
		return traitCatalog.traits.find((trait) => trait.id === id) ?? null;
	}

	// Aggregate a sword's slot bonuses. Element-matching traits are DOUBLED (synergy).
	computeSlotModifiers(sword) {
		const mods = {
			damageMult: 0,
			cooldownMult: 0,
			launchSpeedMult: 0,
			chainBonus: 0,
			dotDpsBonus: 0,
			dotDurationBonus: 0,
			executeBonus: 0,
			goldOnHitChance: 0,
			slowOnHit: 0,
			healOnHitChance: 0,
			bigGameDamage: 0,
			critDamageAdd: 0,
			cleaveBonus: 0,
			hasSynergy: false,
			synergyElement: null,
		};

		const slotIndex = this.swords.indexOf(sword);
		const state = this.getSlotState(slotIndex);
		if (!state) {
			return mods;
		}

		// Enhancement (+4% dmg / -1.5% cd per level)
		mods.damageMult += (this.slotConfig.enhanceDamagePerLevel ?? 0.04) * state.enhance;
		mods.cooldownMult -= (this.slotConfig.enhanceCooldownPerLevel ?? 0.015) * state.enhance;

		const swordElement = sword.definition?.element ?? null;

		for (const traitId of state.traits) {
			const trait = this.getTraitById(traitId);
			if (!trait) {
				continue;
			}

			// 원소 시너지: 검과 특성의 원소가 일치하면 효과 2배 + 오라
			const synergy = Boolean(swordElement && trait.element && trait.element === swordElement);
			const factor = synergy ? 2 : 1;

			if (synergy) {
				mods.hasSynergy = true;
				mods.synergyElement = swordElement;
			}

			for (const [key, value] of Object.entries(trait.effects ?? {})) {
				if (mods[key] !== undefined) {
					mods[key] += value * factor;
				}
			}
		}

		return mods;
	}

	refreshAura(sword) {
		if (!sword) {
			return;
		}

		const mods = sword.traitMods ?? this.computeSlotModifiers(sword);

		if (mods.hasSynergy && !sword.aura) {
			const color = ELEMENT_COLORS[mods.synergyElement] ?? 0xffffff;
			sword.aura = this.scene.add.circle(sword.x, sword.y, 34, color, 0.22)
				.setStrokeStyle(2, color, 0.7)
				.setDepth(1);
			this.scene.tweens.add({
				targets: sword.aura,
				scale: 1.2,
				alpha: 0.6,
				yoyo: true,
				repeat: -1,
				duration: 600,
			});
		} else if (!mods.hasSynergy && sword.aura) {
			sword.aura.destroy();
			sword.aura = null;
		}
	}

	// ---------------------------------------------------------------
	// Sword specials: burn / poison / midas / chain / execute
	// ---------------------------------------------------------------

	// 초희귀 검 전용: %체력 피해 / 고정(트루) 피해 - 저항 무시
	applyRareExtras(sword, enemy) {
		const definition = sword.definition ?? {};

		if ((definition.maxHpDamage ?? 0) > 0 && this.isValidEnemy(enemy)) {
			const bonus = Math.min(300, Math.max(1, Math.round(enemy.maxHp * definition.maxHpDamage)));
			this.applyDamage(enemy, bonus, false, { ignoreResist: true });
		}

		if ((definition.trueDamage ?? 0) > 0 && this.isValidEnemy(enemy)) {
			this.applyDamage(enemy, definition.trueDamage, false, { ignoreResist: true });
		}
	}

	// Trait-driven on-hit procs (slot sockets)
	applyTraitProcs(sword, enemy) {
		const traitMods = sword.traitMods ?? {};
		const player = this.scene?.player;

		if ((traitMods.goldOnHitChance ?? 0) > 0 && Math.random() < traitMods.goldOnHitChance) {
			this.scene?.pickupSystem?.spawnItem?.(enemy.x, enemy.y, 'gold', 1);
		}

		if ((traitMods.slowOnHit ?? 0) > 0 && this.isValidEnemy(enemy) && !enemy.catalog?.isBoss && !enemy.catalog?.isReaper) {
			enemy.slowFactor = 1 - Math.min(0.7, traitMods.slowOnHit);
			enemy.slowUntil = (this.scene?.time?.now ?? 0) + 1200;
		}

		if ((traitMods.healOnHitChance ?? 0) > 0 && player && !player.isDead && Math.random() < traitMods.healOnHitChance) {
			player.hp = Math.min(player.maxHp, player.hp + 1);
		}
	}

	applySpecial(sword, enemy, damage) {
		const special = sword.special;
		if (!special || !this.isValidEnemy(enemy)) {
			return;
		}

		const enemyManager = this.scene?.enemyManager;
		const traitMods = sword.traitMods ?? {};
		// 세트 공명(같은 원소 2자루) 시 원소 효과 1.5배
		const setScale = this.hasSetResonance(sword.definition?.element) ? 1.5 : 1;
		const levelScale = (1 + 0.25 * ((sword.level ?? 1) - 1)) * setScale; // specials grow with sword level

		switch (special.type) {
			case 'burn':
				enemyManager?.applyDot?.(enemy, (special.dps ?? 6) * levelScale + (traitMods.dotDpsBonus ?? 0), (special.durationMs ?? 2000) + (traitMods.dotDurationBonus ?? 0), 0xf97316);
				break;
			case 'poison':
				enemyManager?.applyDot?.(enemy, (special.dps ?? 8) * levelScale + (traitMods.dotDpsBonus ?? 0), (special.durationMs ?? 2500) + (traitMods.dotDurationBonus ?? 0), 0x4ade80);
				break;
			case 'midas':
				if (Math.random() < (special.chance ?? 0.15)) {
					this.scene?.pickupSystem?.spawnItem?.(enemy.x, enemy.y, 'gold', Math.max(1, Math.round(levelScale)));
				}
				break;
			case 'chain': {
				const targets = (special.targets ?? 1) + (traitMods.chainBonus ?? 0);
				const chainDamage = Math.max(1, Math.round(damage * (special.damagePct ?? 0.6)));
				const nearby = [];

				for (const other of this.getEnemyChildren(this.enemyGroup)) {
					if (!this.isValidEnemy(other) || other === enemy) {
						continue;
					}
					const dx = other.x - enemy.x;
					const dy = other.y - enemy.y;
					const distanceSquared = dx * dx + dy * dy;
					if (distanceSquared <= 200 * 200) {
						nearby.push({ other, distanceSquared });
					}
				}

				nearby.sort((a, b) => a.distanceSquared - b.distanceSquared);
				for (const { other } of nearby.slice(0, targets)) {
					this.applyDamage(other, chainDamage, false, this.getDamageInfo(sword));
					this.playChainEffect(enemy, other);
				}
				break;
			}
			case 'execute': {
				const threshold = (special.threshold ?? 0.12) + (traitMods.executeBonus ?? 0);
				if (enemy.hp > 0 && enemy.hp / enemy.maxHp <= threshold
					&& !enemy.catalog?.isBoss && !enemy.catalog?.isReaper && !enemy.catalog?.isMiniboss) {
					this.applyDamage(enemy, enemy.hp + 1, true, { ignoreResist: true });
					this.scene?.visualEffects?.showDamageText?.(enemy.x, enemy.y - 40, '처형!', true);
				}
				break;
			}
			default:
				break;
		}
	}

	playChainEffect(from, to) {
		if (!this.scene) {
			return;
		}

		const line = this.scene.add.line(0, 0, from.x, from.y, to.x, to.y, 0xc084fc, 0.9)
			.setOrigin(0)
			.setLineWidth(2)
			.setDepth(56);

		this.scene.tweens.add({
			targets: line,
			alpha: 0,
			duration: 140,
			onComplete: () => line.destroy(),
		});
	}

	// ---------------------------------------------------------------
	// Fusion: hidden evolution recipes (different swords combine)
	// ---------------------------------------------------------------

	getBaseTierList() {
		return this.swordCatalog.filter((entry) => !entry.evolved);
	}

	getDefinitionById(id) {
		return this.swordCatalog.find((entry) => entry.id === id) ?? null;
	}

	getNextTierDefinition(id) {
		const tiers = this.getBaseTierList();
		const index = tiers.findIndex((entry) => entry.id === id);

		if (index < 0 || index >= tiers.length - 1) {
			return null;
		}

		return tiers[index + 1];
	}

	findPair(idA, idB) {
		if (idA === idB) {
			const matches = this.swords.filter((sword) => sword.definition?.id === idA);
			return matches.length >= 2 ? [matches[0], matches[1]] : null;
		}

		const first = this.swords.find((sword) => sword.definition?.id === idA);
		const second = this.swords.find((sword) => sword.definition?.id === idB);
		return first && second ? [first, second] : null;
	}

	checkFusions() {
		let fusedAny = false;
		let safety = 8;

		let fused = true;
		while (fused && safety > 0) {
			fused = false;
			safety -= 1;

			// Hidden evolution recipes (different swords combine into a unique one).
			// Duplicates level up in the shop instead of fusing.
			for (const recipe of this.evolutionRecipes) {
				const pair = this.findPair(recipe.ingredients[0], recipe.ingredients[1]);
				const resultDefinition = this.getDefinitionById(recipe.result);

				if (pair && resultDefinition) {
					const inheritedLevel = Math.max(pair[0].level ?? 1, pair[1].level ?? 1);
					const newSword = this.fuseSwords(pair, resultDefinition, recipe.announcement ?? `⚔ 진화! ${resultDefinition.name}`, true);
					if (newSword) {
						newSword.level = inheritedLevel;
						this.recalculateSwordStats(newSword);
						this.refreshSwordHud();
					}
					fused = true;
					fusedAny = true;
					break;
				}
			}
		}

		return fusedAny;
	}

	fuseSwords(pair, resultDefinition, announcement, isEvolution) {
		const [first, second] = pair;
		const effectX = first.x;
		const effectY = first.y;

		this.removeSword(first);
		this.removeSword(second);

		const newSword = this.addSword(this.scene, resultDefinition);

		if (this.scene) {
			this.scene.soundSystem?.play('evolve');
			this.playFusionEffect(effectX, effectY, isEvolution);
			this.scene.waveSystem?.announce?.(announcement, isEvolution ? '#fbbf24' : '#a7f3d0');

			if (isEvolution) {
				this.scene.cameras.main.flash(500, 251, 191, 36);
				this.scene.visualEffects?.hitStop?.(120);
			}

			this.scene.events.emit('sword-fused', {
				result: resultDefinition,
				isEvolution,
				sword: newSword,
			});
		}

		return newSword;
	}

	playFusionEffect(x, y, isEvolution) {
		if (!this.scene) {
			return;
		}

		const color = isEvolution ? 0xfbbf24 : 0xa7f3d0;
		const ring = this.scene.add.circle(x, y, 14, color, 0.85).setDepth(60);

		this.scene.tweens.add({
			targets: ring,
			scale: isEvolution ? 5 : 3,
			alpha: 0,
			duration: isEvolution ? 480 : 300,
			ease: 'Cubic.easeOut',
			onComplete: () => ring.destroy(),
		});
	}

	removeSword(sword) {
		const index = this.swords.indexOf(sword);
		if (index < 0) {
			return;
		}

		this.swords.splice(index, 1);
		sword.aura?.destroy();
		sword.destroy();
		this.reindexSlots();

		// Slot bonuses are positional: refresh stats for shifted swords
		for (const remaining of this.swords) {
			this.recalculateSwordStats(remaining);
			this.refreshAura(remaining);
		}
		this.refreshSwordHud();
	}

	reindexSlots() {
		this.swords.forEach((sword, index) => {
			sword.slot = index;
		});
	}

	// ---------------------------------------------------------------
	// 창고(Reserve): 장착 목록과 분리된 보유 검. 드래그로 장착/해제.
	// ---------------------------------------------------------------

	getLoadout() {
		return this.swords.map((sword) => ({ definition: sword.definition, level: sword.level }));
	}

	// Rebuild all equipped sword sprites from a data list (safe way to reorder)
	rebuildLoadout(loadout) {
		for (const sword of [...this.swords]) {
			sword.aura?.destroy();
			sword.destroy();
		}
		this.swords = [];

		for (const entry of loadout) {
			const sword = this.addSword(this.scene, entry.definition);
			if (sword) {
				sword.level = entry.level;
				this.recalculateSwordStats(sword);
				this.refreshAura(sword);
			}
		}

		this.reindexSlots();
		this.refreshSwordHud();
		this.updateSwordPositions(this.scene?.player ?? null);
	}

	addToReserve(definition, level = 1) {
		this.reserve.push({ definition, level });
	}

	findReserveIndexById(id) {
		return this.reserve.findIndex((entry) => entry.definition?.id === id);
	}

	// 창고 → 칸 장착. 대상 칸에 검이 있으면 맞교환(그 검은 창고로).
	equipFromReserve(reserveIndex, targetSlot) {
		const entry = this.reserve[reserveIndex];
		if (!entry || targetSlot >= this.unlockedSlots) {
			return false;
		}

		const loadout = this.getLoadout();

		if (targetSlot < loadout.length) {
			this.reserve[reserveIndex] = loadout[targetSlot];
			loadout[targetSlot] = entry;
		} else {
			if (loadout.length >= this.getEffectiveMaxSwords()) {
				return false;
			}
			this.reserve.splice(reserveIndex, 1);
			loadout.push(entry);
		}

		this.rebuildLoadout(loadout);
		this.checkFusions();
		this.checkSetAnnouncements();
		return true;
	}

	// 칸 → 창고 (장착 해제)
	unequipToReserve(slotIndex) {
		const sword = this.swords[slotIndex];
		if (!sword) {
			return false;
		}

		const loadout = this.getLoadout();
		const [removed] = loadout.splice(slotIndex, 1);
		this.reserve.push(removed);
		this.rebuildLoadout(loadout);
		return true;
	}

	// Move/swap swords between slots (slot bonuses are positional, so this matters)
	swapSlots(a, b) {
		const max = this.getEffectiveMaxSwords();
		if (a === b || a < 0 || b < 0 || a >= max || b >= max) {
			return false;
		}

		const swordA = this.swords[a] ?? null;
		const swordB = this.swords[b] ?? null;

		if (!swordA && !swordB) {
			return false;
		}

		if (swordA && swordB) {
			[this.swords[a], this.swords[b]] = [swordB, swordA];
		} else if (swordA && !swordB) {
			// Move into an empty slot: reorder to the last position (swords stay compact)
			this.swords.splice(a, 1);
			this.swords.push(swordA);
		} else {
			this.swords.splice(b, 1);
			this.swords.push(swordB);
		}

		this.reindexSlots();
		for (const sword of this.swords) {
			this.recalculateSwordStats(sword);
			this.refreshAura(sword);
		}
		this.refreshSwordHud();
		this.updateSwordPositions(this.scene?.player ?? null);
		return true;
	}

	// Compact one-line-per-stat description (HUD tooltip & shop share this)
	describeSword(sword) {
		const definition = sword.definition ?? {};
		const lines = [];
		const typeLabel = definition.damageType === 'magic' ? '🔮 마법' : '⚔️ 물리';
		const pen = definition.damageType === 'magic' ? definition.magicPen : definition.physicalPen;

		lines.push(`${typeLabel} 피해 ${sword.damage}${pen ? ` · 관통 ${Math.round(pen * 100)}%` : ''}`);
		lines.push(`쿨다운 ${Math.round(sword.scanInterval)}ms · 연속타 ${sword.hitsPerLaunch}`);

		if (definition.element) {
			lines.push(`원소: ${definition.element}${this.hasSetResonance(definition.element) ? ' (세트 공명!)' : ''}`);
		}
		if (definition.special) {
			lines.push(`✨ ${definition.special.label}`);
		}
		if (definition.trueDamage) {
			lines.push(`💛 고정 피해 +${definition.trueDamage}`);
		}
		if (definition.maxHpDamage) {
			lines.push(`💛 최대체력 ${Math.round(definition.maxHpDamage * 100)}% 추가`);
		}

		const state = this.getSlotState(this.swords.indexOf(sword));
		if (state?.enhance > 0) {
			lines.push(`강화 +${state.enhance}`);
		}
		if (state?.traits?.length > 0) {
			lines.push(state.traits.map((id) => this.getTraitById(id)?.icon ?? '❔').join(' '));
		}

		return lines.join('\n');
	}

	// In-game tooltip for the bottom-left sword HUD
	showHudTooltip(sword, x, y) {
		this.hideHudTooltip();

		const body = `${sword.definition?.name ?? '검'}  Lv${sword.level}\n${this.describeSword(sword)}`;
		const text = this.scene.add.text(x, y - 46, body, {
			fontFamily: 'Arial, sans-serif',
			fontSize: '12px',
			color: '#e5e7eb',
			backgroundColor: '#0d1322',
			padding: { x: 10, y: 8 },
			lineSpacing: 4,
		}).setOrigin(0, 1).setScrollFactor(0).setDepth(3500);

		// Keep on screen
		const overflow = text.x + text.width - this.scene.scale.width + 8;
		if (overflow > 0) {
			text.setX(text.x - overflow);
		}

		this.hudTooltip = text;
	}

	hideHudTooltip() {
		this.hudTooltip?.destroy();
		this.hudTooltip = null;
	}

	// Small icon strip (bottom-left) showing the current loadout
	refreshSwordHud() {
		if (!this.scene?.add) {
			return;
		}

		for (const icon of this.hudIcons) {
			icon.destroy();
		}
		this.hudIcons = [];

		const baseX = 24;
		const iconSize = 30;
		const gap = 36;
		const y = this.scene.scale.height - 28;

		this.hideHudTooltip();

		this.swords.forEach((sword, index) => {
			const frame = sword.definition?.sheetOrder ?? 0;
			const icon = this.scene.add.image(baseX + index * gap, y, 'sword', frame)
				.setScrollFactor(0)
				.setDepth(1002)
				.setDisplaySize(iconSize, iconSize);

			if (sword.definition?.evolved) {
				icon.setDisplaySize(iconSize + 6, iconSize + 6);
			}

			if (sword.effect?.tint) {
				icon.setTint(Phaser.Display.Color.HexStringToColor(sword.effect.tint).color);
			}

			// In-game hover: sword details tooltip
			icon.setInteractive({ useHandCursor: true });
			icon.on('pointerover', () => this.showHudTooltip(sword, icon.x - 14, icon.y - 8));
			icon.on('pointerout', () => this.hideHudTooltip());

			this.hudIcons.push(icon);

			// 단계 표시 (Lv2+)
			if ((sword.level ?? 1) > 1) {
				const levelBadge = this.scene.add.text(baseX + index * gap + 10, y + 6, `${sword.level}`, {
					fontFamily: 'Arial Black, Arial, sans-serif',
					fontSize: '12px',
					color: '#fbbf24',
				}).setOrigin(0.5).setScrollFactor(0).setDepth(1003);
				levelBadge.setShadow(0, 1, '#000000', 2, false, true);
				this.hudIcons.push(levelBadge);
			}
		});
	}

	applyCooldownMultiplier(multiplier) {
		this.cooldownMultiplier *= multiplier;

		for (const sword of this.swords) {
			sword.scanInterval = (sword.scanInterval ?? 1500) * multiplier;
		}
	}

	applyLaunchSpeedMultiplier(multiplier) {
		this.launchSpeedMultiplier *= multiplier;

		for (const sword of this.swords) {
			sword.launchSpeed = (sword.launchSpeed ?? 400) * multiplier;
		}
	}

	addCleave(amount = 1) {
		this.cleaveTargets += amount;
	}

	// 검기 파동: a landed hit also strikes up to N other enemies near the target
	applyCleave(struckEnemy, damage, isCrit, sword = null) {
		const totalCleave = this.cleaveTargets + (sword?.traitMods?.cleaveBonus ?? 0);
		if (totalCleave <= 0 || !this.enemyGroup) {
			return;
		}

		const radiusSquared = this.cleaveRadius * this.cleaveRadius;
		const candidates = [];

		for (const enemy of this.getEnemyChildren(this.enemyGroup)) {
			if (!this.isValidEnemy(enemy) || enemy === struckEnemy) {
				continue;
			}

			const dx = enemy.x - struckEnemy.x;
			const dy = enemy.y - struckEnemy.y;
			const distanceSquared = dx * dx + dy * dy;

			if (distanceSquared <= radiusSquared) {
				candidates.push({ enemy, distanceSquared });
			}
		}

		candidates.sort((a, b) => a.distanceSquared - b.distanceSquared);

		const damageInfo = sword ? this.getDamageInfo(sword) : null;
		for (const { enemy } of candidates.slice(0, totalCleave)) {
			this.applyDamage(enemy, damage, isCrit, damageInfo);
			this.playCleaveEffect(struckEnemy, enemy);
		}
	}

	playCleaveEffect(from, to) {
		if (!this.scene) {
			return;
		}

		const line = this.scene.add.line(0, 0, from.x, from.y, to.x, to.y, 0xbae6fd, 0.75)
			.setOrigin(0)
			.setLineWidth(2)
			.setDepth(55);

		this.scene.tweens.add({
			targets: line,
			alpha: 0,
			duration: 160,
			onComplete: () => line.destroy(),
		});
	}

	addBonusHits(amount = 1) {
		this.bonusHits += amount;

		for (const sword of this.swords) {
			sword.hitsPerLaunch = (sword.hitsPerLaunch ?? 1) + amount;
			sword.remainingHits = (sword.remainingHits ?? 0) + amount;
		}
	}

	bindSwordOverlap(sword) {
		if (!this.scene || !this.enemyGroup || !sword?.body || sword._orbitEnemyGroup === this.enemyGroup) {
			return;
		}

		this.scene.physics.add.overlap(sword, this.enemyGroup, this.handleSwordEnemyOverlap, null, this);
		sword._orbitEnemyGroup = this.enemyGroup;
	}

	update(player, delta, enemiesGroup = this.enemyGroup) {
		if (!player) {
			return;
		}

		if (enemiesGroup) {
			this.setEnemyGroup(enemiesGroup);
		}

		this.ensureMinimumSwords();

		const deltaSeconds = delta / 1000;
		this.baseAngle = Phaser.Math.Wrap(this.baseAngle + this.orbitSpeed * deltaSeconds, 0, Phaser.Math.PI2);

		const claimedTargets = new Set();
		for (const sword of this.swords) {
			if (sword.state === 'launched' && this.isValidEnemy(sword.target)) {
				claimedTargets.add(sword.target);
			}
		}

		for (const sword of this.swords) {
			this.updateSword(player, sword, delta, this.enemyGroup, claimedTargets);
		}

		this.updateSwordPositions(player);

		// Synergy auras follow their swords everywhere
		for (const sword of this.swords) {
			if (sword.aura) {
				sword.aura.setPosition(sword.x, sword.y);
			}
		}

		this.updateUltimates(player, delta);
	}

	// ---------------------------------------------------------------
	// 원소 세트: 공명(1.5배) + 필살기
	// ---------------------------------------------------------------

	getElementCounts() {
		const counts = {};
		for (const sword of this.swords) {
			const element = sword.definition?.element;
			if (element) {
				counts[element] = (counts[element] ?? 0) + 1;
			}
		}
		return counts;
	}

	hasSetResonance(element) {
		return element ? (this.getElementCounts()[element] ?? 0) >= 2 : false;
	}

	isUltimateUnlocked(element) {
		const members = this.swords.filter((sword) => sword.definition?.element === element);
		return members.length >= 2 && members.every((sword) => (sword.level ?? 1) >= 3);
	}

	checkSetAnnouncements() {
		const names = { fire: '🔥 화염', electric: '⚡ 전기', void: '🕳️ 공허' };

		for (const element of Object.keys(names)) {
			if (this.hasSetResonance(element) && !this.setAnnounced.has(element)) {
				this.setAnnounced.add(element);
				this.scene?.waveSystem?.announce?.(`${names[element]} 세트 공명! (원소 효과 1.5배)`, '#fbbf24');
				this.scene?.soundSystem?.play('evolve');
			}
			const ultKey = `${element}-ult`;
			if (this.isUltimateUnlocked(element) && !this.setAnnounced.has(ultKey)) {
				this.setAnnounced.add(ultKey);
				this.scene?.waveSystem?.announce?.(`${names[element]} 필살기 해금!`, '#ef4444');
				this.scene?.soundSystem?.play('chest');
			}
		}
	}

	updateUltimates(player, delta) {
		if (!player || player.isDead) {
			return;
		}

		for (const element of ['fire', 'electric', 'void']) {
			if (!this.isUltimateUnlocked(element)) {
				continue;
			}

			this.ultimateTimers[element] += delta;
			if (this.ultimateTimers[element] >= this.ultimateIntervals[element]) {
				this.ultimateTimers[element] = 0;
				this.castUltimate(element, player);
			}
		}
	}

	castUltimate(element, player) {
		const enemyManager = this.scene?.enemyManager;
		if (!enemyManager) {
			return;
		}

		const damageBase = Math.round(40 * this.damageMultiplier);

		if (element === 'fire') {
			// 화염 노바: 주변 220px 전체 화상 + 피해
			const ring = this.scene.add.circle(player.x, player.y, 220, 0xf97316, 0.25)
				.setStrokeStyle(3, 0xf97316, 0.9).setDepth(58);
			this.scene.tweens.add({ targets: ring, scale: { from: 0.3, to: 1 }, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
			this.scene.soundSystem?.play('bigkill', { volume: 0.5 });

			for (const enemy of enemyManager.enemies.getChildren()) {
				if (enemyManager.isAliveEnemy(enemy)
					&& Phaser.Math.Distance.Between(player.x, player.y, enemy.x, enemy.y) <= 220) {
					this.applyDamage(enemy, damageBase, false, { damageType: 'magic', pen: 0.2 });
					enemyManager.applyDot(enemy, 8, 2000, 0xf97316);
				}
			}
			return;
		}

		if (element === 'electric') {
			// 낙뢰: 가장 가까운 적 1기 강타 + 연쇄 1
			const target = this.findNearestEnemy(player.x, player.y, this.enemyGroup, 500);
			if (!target) {
				return;
			}
			const bolt = this.scene.add.line(0, 0, target.x, target.y - 300, target.x, target.y, 0x93c5fd, 0.95)
				.setOrigin(0).setLineWidth(3).setDepth(59);
			this.scene.tweens.add({ targets: bolt, alpha: 0, duration: 200, onComplete: () => bolt.destroy() });
			this.scene.soundSystem?.play('crit', { volume: 0.7 });
			this.applyDamage(target, Math.round(damageBase * 1.5), true, { damageType: 'magic', pen: 0.3 });

			const next = this.findNearestEnemy(target.x, target.y, this.enemyGroup, 200, new Set([target]));
			if (next) {
				this.applyDamage(next, damageBase, false, { damageType: 'magic', pen: 0.3 });
				this.playChainEffect(target, next);
			}
			return;
		}

		if (element === 'void') {
			// 특이점: 근처 적들을 끌어당기고 피해
			const anchor = this.findNearestEnemy(player.x, player.y, this.enemyGroup, 450);
			const cx = anchor?.x ?? player.x + 200;
			const cy = anchor?.y ?? player.y;
			const hole = this.scene.add.circle(cx, cy, 26, 0x7c3aed, 0.8).setDepth(58);
			this.scene.tweens.add({ targets: hole, scale: 3, alpha: 0, duration: 700, onComplete: () => hole.destroy() });
			this.scene.soundSystem?.play('warning', { volume: 0.5 });

			for (const enemy of enemyManager.enemies.getChildren()) {
				if (!enemyManager.isAliveEnemy(enemy) || enemy.catalog?.isBoss || enemy.catalog?.isReaper) {
					continue;
				}
				const distance = Phaser.Math.Distance.Between(cx, cy, enemy.x, enemy.y);
				if (distance <= 260) {
					const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, cx, cy);
					enemy.setVelocity(Math.cos(angle) * 400, Math.sin(angle) * 400);
					enemy.knockbackUntil = (this.scene.time?.now ?? 0) + 250;
					this.applyDamage(enemy, damageBase, false, { damageType: 'magic', pen: 0.4 });
				}
			}
		}
	}

	updateSwordPositions(player) {
		if (!player || this.swords.length === 0) {
			return;
		}

		const count = this.swords.length;
		const step = Phaser.Math.PI2 / count;

		for (const sword of this.swords) {
			if (sword.state !== 'orbiting') {
				continue;
			}

			const angle = Phaser.Math.Wrap(this.baseAngle * (sword.orbitSpeedMultiplier ?? 1) + step * sword.slot, 0, Phaser.Math.PI2);
			const x = player.x + Math.cos(angle) * this.radius;
			const y = player.y + Math.sin(angle) * this.radius;

			sword.angle = angle;
			sword.setPosition(x, y);
			sword.rotation = angle + this.rotationOffset;
			sword.setVelocity(0, 0);
		}
	}

	updateSword(player, sword, delta, enemiesGroup, claimedTargets) {
		switch (sword.state) {
			case 'orbiting':
				this.updateOrbitingSword(player, sword, delta, enemiesGroup, claimedTargets);
				break;
			case 'launched':
				this.updateLaunchedSword(player, sword, delta, enemiesGroup);
				break;
			case 'returning':
				this.updateReturningSword(player, sword, delta, enemiesGroup, claimedTargets);
				break;
			default:
				sword.state = 'orbiting';
				sword.scanTimer = 0;
				break;
		}
	}

	updateOrbitingSword(player, sword, delta, enemiesGroup, claimedTargets) {
		// Berserker trait: swords never leave orbit (contact damage instead)
		if (this.noLaunch) {
			return;
		}

		const closeTarget = this.findNearestEnemy(sword.x, sword.y, enemiesGroup, this.closeScanRadius, claimedTargets);
			if (closeTarget) {
				sword.scanTimer = 0;
				this.startLaunchedSword(sword, closeTarget, claimedTargets);
				return;
			}

		sword.scanTimer = (sword.scanTimer ?? 0) + delta;

		if (sword.scanTimer < (sword.scanInterval ?? this.scanRadius)) {
			return;
		}

		sword.scanTimer = 0;

		const target = this.findNearestEnemy(sword.x, sword.y, enemiesGroup, this.scanRadius, claimedTargets);

		if (target) {
			this.startLaunchedSword(sword, target, claimedTargets);
		}
	}

	updateLaunchedSword(player, sword, delta, enemiesGroup) {
		if (!this.isValidEnemy(sword.target)) {
			if ((sword.remainingHits ?? 0) > 0) {
				const nextTarget = this.findNearestEnemy(
					sword.x,
					sword.y,
					enemiesGroup,
					this.closeScanRadius,
					sword.hitTargets,
				);

				if (nextTarget) {
					this.setSwordTarget(sword, nextTarget);
					return;
				}
			}

			this.startReturningSword(sword);
			return;
		}

		sword.launchElapsed = (sword.launchElapsed ?? 0) + delta;
		if (sword.launchElapsed >= this.launchDuration) {
			this.startReturningSword(sword);
			return;
		}

		const target = sword.target;
		const hitDistance = 22;
		if (this.isValidEnemy(target) && Phaser.Math.Distance.Between(sword.x, sword.y, target.x, target.y) <= hitDistance) {
			this.registerSwordHit(sword, target);
			return;
		}

		const velocityX = Math.cos(sword.launchAngle) * (sword.launchSpeed ?? 400);
		const velocityY = Math.sin(sword.launchAngle) * (sword.launchSpeed ?? 400);

		sword.setVelocity(velocityX, velocityY);
		sword.rotation = sword.launchAngle + this.rotationOffset;

		if (enemiesGroup) {
			this.setEnemyGroup(enemiesGroup);
		}
	}

	updateReturningSword(player, sword, delta, enemiesGroup, claimedTargets) {
		if ((sword.remainingHits ?? 0) > 0) {
			const closeTarget = this.findNearestEnemy(sword.x, sword.y, enemiesGroup, this.closeScanRadius, claimedTargets);
			if (closeTarget) {
				this.startLaunchedSword(sword, closeTarget, claimedTargets);
				return;
			}
		}



		const orbitPosition = this.getOrbitPosition(player, sword);
		const returnFactor = Phaser.Math.Clamp((delta / 16.6667) * this.returnLerp, 0, 1);
		const nextX = Phaser.Math.Linear(sword.x, orbitPosition.x, returnFactor);
		const nextY = Phaser.Math.Linear(sword.y, orbitPosition.y, returnFactor);
		const dx = orbitPosition.x - nextX;
		const dy = orbitPosition.y - nextY;
		const distanceToTarget = Math.sqrt(dx * dx + dy * dy);

		// Finish return when close enough, or when progress stalls (distance change negligible).
		const CLOSE_THRESHOLD = 6; // pixels, allows visual return to complete but avoids tiny threshold hang
		const STALL_DELTA = 0.2; // pixels change considered stalled

		const prevDist = sword._lastReturnDistance;
		if (distanceToTarget < CLOSE_THRESHOLD || (typeof prevDist === 'number' && Math.abs(prevDist - distanceToTarget) < STALL_DELTA)) {
			this.finishReturningSword(player, sword);
			delete sword._lastReturnDistance;
			return;
		}

		// store last observed distance for stall detection
		sword._lastReturnDistance = distanceToTarget;

		sword.setPosition(nextX, nextY);
		sword.setVelocity(0, 0);

		const startRotation = sword.returnStartRotation ?? sword.rotation;
		const targetRotation = orbitPosition.angle + this.rotationOffset;
		const turnProgress = Math.min(1, (sword.returnTurnProgress ?? 0) + returnFactor * 0.8);
		sword.returnTurnProgress = turnProgress;
		sword.rotation = Phaser.Math.Linear(startRotation, targetRotation, turnProgress);
	}

	startLaunchedSword(sword, target, claimedTargets = null) {
		if (!sword || !this.isValidEnemy(target)) {
			return;
		}

		sword.state = 'launched';
		sword.target = target;
		sword.returnTurnProgress = 0;
		sword.returnStartRotation = sword.rotation;
		sword.launchElapsed = 0;
		const launchAngle = Math.atan2(target.y - sword.y, target.x - sword.x);
		sword.launchAngle = launchAngle;
		sword.rotation = launchAngle + this.rotationOffset;

		if (claimedTargets) {
			claimedTargets.add(target);
		}
	}

	findNearestEnemy(sourceX, sourceY, enemiesGroup, radius = this.scanRadius, excludeTargets = null) {
		if (!enemiesGroup) {
			return null;
		}

		const enemies = this.getEnemyChildren(enemiesGroup);
		const maxDistanceSquared = radius * radius;
		let nearestEnemy = null;
		let nearestDistanceSquared = maxDistanceSquared;

		for (const enemy of enemies) {
			if (!this.isValidEnemy(enemy)) {
				continue;
			}

			if (excludeTargets?.has(enemy)) {
				continue;
			}

			const dx = enemy.x - sourceX;
			const dy = enemy.y - sourceY;
			const distanceSquared = dx * dx + dy * dy;

			if (distanceSquared <= nearestDistanceSquared) {
				nearestDistanceSquared = distanceSquared;
				nearestEnemy = enemy;
			}
		}

		return nearestEnemy;
	}

	registerSwordHit(sword, enemy) {
		if (!sword || !this.isValidEnemy(enemy)) {
			return;
		}

		const now = this.scene?.time?.now ?? 0;
		if (now < (sword.hitCooldownUntil ?? 0)) {
			return;
		}

		// Calculate critical hit: combine sword + player crit chance
		const player = this.scene?.player;
		const swordCritChance = sword.definition?.critChance ?? 0;
		const playerCritChance = player?.critChance ?? 0;
		const totalCritChance = swordCritChance + playerCritChance;
		const traitMods = sword.traitMods ?? {};

		let isCrit = false;
		let finalDamage = Math.round((sword.damage ?? 20) * (this.damageMultiplier ?? 1));

		// 거인 사냥꾼: bonus vs elites / minibosses / bosses
		if ((traitMods.bigGameDamage ?? 0) > 0
			&& (enemy.catalog?.isElite || enemy.catalog?.isMiniboss || enemy.catalog?.isBoss)) {
			finalDamage = Math.round(finalDamage * (1 + traitMods.bigGameDamage));
		}

		// Roll for critical hit
		if (totalCritChance > 0) {
			const rollChance = Math.random();
			if (rollChance < totalCritChance) {
				isCrit = true;
				// Calculate critical damage multiplier
				let swordCritMult = sword.definition?.critDamageMultiplier ?? 1.0;
				let playerCritMult = player?.critDamageMultiplier ?? 1.0;

				// If crit chance exceeds 100%, overflow adds to damage multiplier
				const critOverflow = Math.max(0, totalCritChance - 1);
				const baseCritMult = (swordCritMult + playerCritMult) / 2 + (traitMods.critDamageAdd ?? 0);
				finalDamage = Math.round(finalDamage * (baseCritMult + critOverflow));
			}
		}

		const damageInfo = this.getDamageInfo(sword);
		this.scene?.soundSystem?.play(isCrit ? 'crit' : 'hit');
		this.applyDamage(enemy, finalDamage, isCrit, damageInfo);
		this.applyRareExtras(sword, enemy);
		this.applyTraitProcs(sword, enemy);
		this.applySpecial(sword, enemy, finalDamage);
		this.applyCleave(enemy, finalDamage, isCrit, sword);
		sword.hitTargets ??= new Set();
		sword.hitTargets.add(enemy);
		sword.remainingHits = Math.max(0, (sword.remainingHits ?? 1) - 1);
		
		sword.hitCooldownUntil = now + (sword.hitCooldownMs ?? 110);

		if ((sword.remainingHits ?? 0) <= 0) {
			this.startReturningSword(sword);
			return;
		}

		const nextTarget = this.findNearestEnemy(
			sword.x,
			sword.y,
			this.enemyGroup,
			this.closeScanRadius,
			sword.hitTargets,
		);

		if (nextTarget) {
			this.setSwordTarget(sword, nextTarget);
			return;
		}

		// If no new target found, try to find any nearest enemy (even if already hit)
		const retargetEnemy = this.findNearestEnemy(
			sword.x,
			sword.y,
			this.enemyGroup,
			this.closeScanRadius,
			null, // don't exclude hitTargets
		);

		if (retargetEnemy) {
			this.setSwordTarget(sword, retargetEnemy);
			return;
		}
		
		sword.target = null;
		sword.scanTimer = 0;
		this.startReturningSword(sword);
	}

	handleSwordEnemyOverlap(sword, enemy) {
		if (!sword) {
			return;
		}

		// Orbit contact damage (Berserker trait)
		if (this.noLaunch && sword.state === 'orbiting') {
			this.registerOrbitHit(sword, enemy);
			return;
		}

		if (sword.state !== 'launched') {
			return;
		}

		this.registerSwordHit(sword, enemy);
	}

	registerOrbitHit(sword, enemy) {
		if (!sword || !this.isValidEnemy(enemy)) {
			return;
		}

		const now = this.scene?.time?.now ?? 0;
		if (now < (sword.hitCooldownUntil ?? 0)) {
			return;
		}

		const player = this.scene?.player;
		const totalCritChance = (sword.definition?.critChance ?? 0) + (player?.critChance ?? 0);
		let finalDamage = Math.round((sword.damage ?? 20) * (this.damageMultiplier ?? 1) * this.orbitDamageMult);
		let isCrit = false;

		if (totalCritChance > 0 && Math.random() < totalCritChance) {
			isCrit = true;
			const baseCritMult = ((sword.definition?.critDamageMultiplier ?? 1) + (player?.critDamageMultiplier ?? 1)) / 2;
			finalDamage = Math.round(finalDamage * (baseCritMult + Math.max(0, totalCritChance - 1)));
		}

		const damageInfo = this.getDamageInfo(sword);
		this.scene?.soundSystem?.play(isCrit ? 'crit' : 'hit');
		this.applyDamage(enemy, finalDamage, isCrit, damageInfo);
		this.applyRareExtras(sword, enemy);
		this.applyTraitProcs(sword, enemy);
		this.applySpecial(sword, enemy, finalDamage);
		this.applyCleave(enemy, finalDamage, isCrit, sword);
		sword.hitCooldownUntil = now + Math.max(180, sword.hitCooldownMs ?? 180);
	}

	startReturningSword(sword) {
		if (!sword) {
			return;
		}

		sword.state = 'returning';
		sword.target = null;
		sword.returnCurveSide = sword.slot % 2 === 0 ? 1 : -1;
		sword.returnTurnProgress = 0;
		sword.returnStartRotation = sword.rotation;
		sword.returnStartX = sword.x;
		sword.returnStartY = sword.y;
		sword.launchElapsed = 0;
		sword.launchAngle = undefined;
		sword.hitTargets = new Set();
		sword.setVelocity(0, 0);
		// clear any previous return distance tracking
		delete sword._lastReturnDistance;
	}

	finishReturningSword(player, sword) {
		if (!player || !sword) {
			return;
		}

		const orbitPosition = this.getOrbitPosition(player, sword);

		sword.state = 'orbiting';
		sword.target = null;
		sword.scanTimer = 0;
		sword.remainingHits = sword.hitsPerLaunch ?? 1;
		sword.hitCooldownUntil = 0;
		sword.hitTargets = new Set();
		sword.returnCurveSide = 0;
		sword.returnTurnProgress = 0;
		sword.returnStartRotation = undefined;
		sword.returnStartX = undefined;
		sword.returnStartY = undefined;
		sword.setVelocity(0, 0);
		sword.setPosition(orbitPosition.x, orbitPosition.y);
		sword.rotation = orbitPosition.angle + this.rotationOffset;
		// clear return distance tracking
		delete sword._lastReturnDistance;

		// Prepare scanTimer so the normal update loop can scan immediately while
		// preserving the visual return animation (no snapping).
		sword.scanTimer = sword.scanInterval ?? this.scanRadius ?? 0;
		// Ensure position updated for visuals
		this.updateSwordPositions(player);
	}

	setSwordTarget(sword, target) {
		if (!sword || !this.isValidEnemy(target)) {
			return;
		}

		sword.target = target;
		sword.launchElapsed = 0;
		sword.launchAngle = Math.atan2(target.y - sword.y, target.x - sword.x);
		sword.rotation = sword.launchAngle + this.rotationOffset;
		sword.hitCooldownUntil = 0;
	}

	// Build a sword's typed-damage payload (physical/magic + penetration)
	getDamageInfo(sword) {
		const definition = sword?.definition ?? {};
		return {
			damageType: definition.damageType ?? 'physical',
			pen: definition.damageType === 'magic' ? (definition.magicPen ?? 0) : (definition.physicalPen ?? 0),
		};
	}

	applyDamage(enemy, amount, isCrit = false, damageInfo = null) {
		if (!this.isValidEnemy(enemy)) {
			return;
		}

		// Store crit flag on enemy for damage text visualization
		enemy.lastDamageWasCrit = isCrit;

		const enemyManager = this.scene?.enemyManager;
		if (enemyManager && typeof enemyManager.takeDamage === 'function') {
			enemyManager.takeDamage(enemy, amount, this.scene?.player, damageInfo ?? {});
			return;
		}

		if (typeof enemy.takeDamage === 'function') {
			enemy.takeDamage(amount);
			return;
		}

		if (typeof enemy.damage === 'function') {
			enemy.damage(amount);
			return;
		}

		if (typeof enemy.health === 'number') {
			enemy.health -= amount;
			if (enemy.health <= 0) {
				enemy.destroy?.();
			}
			return;
		}

		if (typeof enemy.hp === 'number') {
			enemy.hp -= amount;
			if (enemy.hp <= 0) {
				enemy.destroy?.();
			}
		}
	}

	snapSwordToOrbit(player, sword) {
		const orbitPosition = this.getOrbitPosition(player, sword);
		sword.angle = orbitPosition.angle;
		sword.setPosition(orbitPosition.x, orbitPosition.y);
		sword.rotation = orbitPosition.angle + this.rotationOffset;
		sword.remainingHits = sword.hitsPerLaunch ?? 1;
		sword.hitCooldownUntil = 0;
		sword.hitTargets = new Set();
		sword.scanTimer = 0;
	}

	getSwordDefinition(slot) {
		if (!this.swordCatalog.length) {
			return {};
		}

		return this.swordCatalog[Math.min(slot, this.swordCatalog.length - 1)] ?? {};
	}

	getOrbitPosition(player, sword) {
		const count = this.swords.length;
		if (!count) {
			return { x: player.x, y: player.y, angle: 0 };
		}

		const angle = Phaser.Math.Wrap(this.baseAngle + (Phaser.Math.PI2 / count) * sword.slot, 0, Phaser.Math.PI2);
		return {
			x: player.x + Math.cos(angle) * this.radius,
			y: player.y + Math.sin(angle) * this.radius,
			angle,
		};
	}

	getEnemyChildren(enemiesGroup) {
		if (!enemiesGroup) {
			return [];
		}

		if (typeof enemiesGroup.getChildren === 'function') {
			return enemiesGroup.getChildren();
		}

		if (Array.isArray(enemiesGroup.children?.entries)) {
			return enemiesGroup.children.entries;
		}

		return [];
	}

	isValidEnemy(enemy) {
		return Boolean(enemy && enemy.active !== false && enemy.visible !== false && !enemy.destroyed);
	}
}
