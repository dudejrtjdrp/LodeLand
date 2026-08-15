import metaCatalog from '../data/metaCatalog.json';

const STORAGE_KEY = 'movesword-meta-v1';

// Permanent, refundable meta progression stored in localStorage.
// Failed runs still bank their gold - "no run is wasted".
export default class MetaProgression {
	static load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			const state = raw ? JSON.parse(raw) : null;
			const loaded = {
				gold: state?.gold ?? 0,
				ranks: state?.ranks ?? {},
				characters: state?.characters ?? [],
				clearedDanger: state?.clearedDanger ?? -1,
				lifetimeGold: state?.lifetimeGold ?? null,
				guaranteeCoins: state?.guaranteeCoins ?? 0,
			};

			// Migration for older saves: approximate lifetime as current + spent
			if (loaded.lifetimeGold === null) {
				loaded.lifetimeGold = loaded.gold + this.totalSpent(loaded);
			}

			return loaded;
		} catch {
			return { gold: 0, ranks: {}, characters: [], clearedDanger: -1, lifetimeGold: 0, guaranteeCoins: 0 };
		}
	}

	// 특별 강화 코인 (💎): guarantees the next enhancement. Persists across runs.
	static getGuaranteeCoins() {
		return this.load().guaranteeCoins;
	}

	static addGuaranteeCoin(amount = 1) {
		const state = this.load();
		state.guaranteeCoins += amount;
		this.save(state);
		return state.guaranteeCoins;
	}

	static useGuaranteeCoin() {
		const state = this.load();
		if (state.guaranteeCoins <= 0) {
			return false;
		}
		state.guaranteeCoins -= 1;
		this.save(state);
		return true;
	}

	static addLifetime(amount) {
		const state = this.load();
		state.lifetimeGold += Math.max(0, Math.round(amount));
		this.save(state);
		return state.lifetimeGold;
	}

	static getLifetimeGold() {
		return this.load().lifetimeGold;
	}

	static save(state) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			// Storage unavailable (private mode etc.) - play without persistence.
		}
	}

	static catalog() {
		return metaCatalog;
	}

	static getEntry(id) {
		return metaCatalog.find((entry) => entry.id === id) ?? null;
	}

	static getRank(id, state = this.load()) {
		return state.ranks[id] ?? 0;
	}

	static costOf(entry, rank) {
		// Each rank costs more: base * (rank + 1)
		return Math.round(entry.baseCost * (rank + 1));
	}

	static totalSpent(state = this.load()) {
		let spent = 0;

		for (const entry of metaCatalog) {
			const rank = state.ranks[entry.id] ?? 0;
			for (let i = 0; i < rank; i += 1) {
				spent += this.costOf(entry, i);
			}
		}

		return spent;
	}

	static addGold(amount) {
		const state = this.load();
		state.gold += Math.max(0, Math.round(amount));
		this.save(state);
		return state.gold;
	}

	static buy(id) {
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
	static refundAll() {
		const state = this.load();
		state.gold += this.totalSpent(state);
		state.ranks = {};
		this.save(state);
		return state;
	}

	// Characters unlock automatically by LIFETIME earned gold (누적 코인).
	// Old purchase-based unlocks are honored too.
	static isCharacterUnlocked(id, unlockGold = 0) {
		if (!unlockGold) {
			return true;
		}

		const state = this.load();
		return state.characters.includes(id) || state.lifetimeGold >= unlockGold;
	}

	static getClearedDanger() {
		return this.load().clearedDanger;
	}

	static recordClear(danger) {
		const state = this.load();
		if (danger > state.clearedDanger) {
			state.clearedDanger = danger;
			this.save(state);
		}
	}

	static getBonuses() {
		const state = this.load();
		const bonuses = {
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

		return bonuses;
	}
}
