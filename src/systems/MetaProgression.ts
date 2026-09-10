import rawMetaCatalog from '../data/metaCatalog.json';
import type { MetaUpgradeDefinition } from '../types/catalogs';

const metaCatalog = rawMetaCatalog as unknown as MetaUpgradeDefinition[];

const STORAGE_KEY = 'movesword-meta-v1';

export interface MetaState {
	gold: number;
	ranks: Record<string, number>;
	characters: string[];
	clearedDanger: number;
	lifetimeGold: number;
	guaranteeCoins: number;
	/** 한 번이라도 조합에 성공한 레시피의 결과 검 id — 조합 모달에서 ??? 대신 공개 */
	discoveredRecipes: string[];
}

export interface MetaBonuses {
	damageMult: number;
	maxHpFlat: number;
	cooldownRed: number;
	moveSpeedMult: number;
	luck: number;
	magnetMult: number;
	goldMult: number;
	extraSword: number;
	revival: number;
}

export type MetaBuyResult =
	| { ok: false; reason: 'unknown' | 'max' | 'gold' }
	| { ok: true; state: MetaState };

// Permanent, refundable meta progression stored in localStorage.
// Failed runs still bank their gold - "no run is wasted".
export default class MetaProgression {
	static load(): MetaState {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			const state = raw ? JSON.parse(raw) : null;
			const loaded: {
				gold: number;
				ranks: Record<string, number>;
				characters: string[];
				clearedDanger: number;
				lifetimeGold: number | null;
				guaranteeCoins: number;
				discoveredRecipes: string[];
			} = {
				gold: state?.gold ?? 0,
				ranks: state?.ranks ?? {},
				characters: state?.characters ?? [],
				clearedDanger: state?.clearedDanger ?? -1,
				lifetimeGold: state?.lifetimeGold ?? null,
				guaranteeCoins: state?.guaranteeCoins ?? 0,
				discoveredRecipes: Array.isArray(state?.discoveredRecipes) ? state.discoveredRecipes : [],
			};

			// Migration for older saves: approximate lifetime as current + spent
			if (loaded.lifetimeGold === null) {
				loaded.lifetimeGold = loaded.gold + this.totalSpent(loaded as MetaState);
			}

			return loaded as MetaState;
		} catch {
			return { gold: 0, ranks: {}, characters: [], clearedDanger: -1, lifetimeGold: 0, guaranteeCoins: 0, discoveredRecipes: [] };
		}
	}

	// 조합 도감: 한 번 성공한 레시피는 영구히 공개된다 (런 간 유지).
	static getDiscoveredRecipes(): string[] {
		return this.load().discoveredRecipes;
	}

	static isRecipeDiscovered(resultId: string): boolean {
		return this.load().discoveredRecipes.includes(resultId);
	}

	static recordRecipeDiscovered(resultId: string): void {
		const state = this.load();
		if (state.discoveredRecipes.includes(resultId)) {
			return;
		}
		state.discoveredRecipes.push(resultId);
		this.save(state);
	}

	// 특별 강화 코인 (💎): guarantees the next enhancement. Persists across runs.
	static getGuaranteeCoins(): number {
		return this.load().guaranteeCoins;
	}

	static addGuaranteeCoin(amount = 1): number {
		const state = this.load();
		state.guaranteeCoins += amount;
		this.save(state);
		return state.guaranteeCoins;
	}

	static useGuaranteeCoin(): boolean {
		const state = this.load();
		if (state.guaranteeCoins <= 0) {
			return false;
		}
		state.guaranteeCoins -= 1;
		this.save(state);
		return true;
	}

	static addLifetime(amount: number): number {
		const state = this.load();
		state.lifetimeGold += Math.max(0, Math.round(amount));
		this.save(state);
		return state.lifetimeGold;
	}

	static getLifetimeGold(): number {
		return this.load().lifetimeGold;
	}

	static save(state: MetaState): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			// Storage unavailable (private mode etc.) - play without persistence.
		}
	}

	static catalog(): MetaUpgradeDefinition[] {
		return metaCatalog;
	}

	static getEntry(id: string): MetaUpgradeDefinition | null {
		return metaCatalog.find((entry) => entry.id === id) ?? null;
	}

	static getRank(id: string, state: MetaState = this.load()): number {
		return state.ranks[id] ?? 0;
	}

	static costOf(entry: MetaUpgradeDefinition, rank: number): number {
		// Each rank costs more: base * (rank + 1)
		return Math.round(entry.baseCost * (rank + 1));
	}

	static totalSpent(state: MetaState = this.load()): number {
		let spent = 0;

		for (const entry of metaCatalog) {
			const rank = state.ranks[entry.id] ?? 0;
			for (let i = 0; i < rank; i += 1) {
				spent += this.costOf(entry, i);
			}
		}

		return spent;
	}

	static addGold(amount: number): number {
		const state = this.load();
		state.gold += Math.max(0, Math.round(amount));
		this.save(state);
		return state.gold;
	}

	static buy(id: string): MetaBuyResult {
		const state = this.load();
		const entry = this.getEntry(id);

		if (!entry) {
			return { ok: false, reason: 'unknown' };
		}

		const rank = state.ranks[id] ?? 0;
		if (rank >= entry.maxRank) {
			return { ok: false, reason: 'max' };
		}

		const cost = this.costOf(entry, rank);
		if (state.gold < cost) {
			return { ok: false, reason: 'gold' };
		}

		state.gold -= cost;
		state.ranks[id] = rank + 1;
		this.save(state);

		return { ok: true, state };
	}

	// Full refund, VS-style: encourages experimentation.
	static refundAll(): MetaState {
		const state = this.load();
		state.gold += this.totalSpent(state);
		state.ranks = {};
		this.save(state);
		return state;
	}

	// Characters unlock automatically by LIFETIME earned gold (누적 코인).
	// Old purchase-based unlocks are honored too.
	static isCharacterUnlocked(id: string, unlockGold = 0): boolean {
		if (!unlockGold) {
			return true;
		}

		const state = this.load();
		return state.characters.includes(id) || state.lifetimeGold >= unlockGold;
	}

	static getClearedDanger(): number {
		return this.load().clearedDanger;
	}

	static recordClear(danger: number): void {
		const state = this.load();
		if (danger > state.clearedDanger) {
			state.clearedDanger = danger;
			this.save(state);
		}
	}

	static getBonuses(): MetaBonuses {
		const state = this.load();
		const bonuses: Record<string, number> = {
			damageMult: 0,
			maxHpFlat: 0,
			cooldownRed: 0,
			moveSpeedMult: 0,
			luck: 0,
			magnetMult: 0,
			goldMult: 0,
			extraSword: 0,
			revival: 0,
		};

		for (const entry of metaCatalog) {
			const rank = state.ranks[entry.id] ?? 0;
			if (rank > 0 && bonuses[entry.type] !== undefined) {
				bonuses[entry.type] += entry.perRank * rank;
			}
		}

		return bonuses as unknown as MetaBonuses;
	}
}
