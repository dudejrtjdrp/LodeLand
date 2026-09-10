// 일회성 카탈로그 확장 스크립트: 신규 적/보스 + 웨이브 풀 확장 + 스케일링 블록.
// 실행: node scripts/extend-catalogs.mjs  (멱등: 이미 있으면 갱신)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const enemyPath = join(root, 'src/data/enemyCatalog.json');
const wavePath = join(root, 'src/data/waveTable.json');

const sheet = (frameRate = 8) => ({
	filePath: 'enemy/Skullwolf/Massacre.png',
	textureKey: 'skullwolf-sheet',
	frameWidth: 64,
	frameHeight: 64,
	animations: [
		{ name: 'idle', row: 0, frameStart: 0, frameCount: 6, frameRate, repeat: -1 },
		{ name: 'attack', row: 1, frameStart: 0, frameCount: 5, frameRate: frameRate + 2, repeat: 0 },
		{ name: 'hit', row: 2, frameStart: 0, frameCount: 4, frameRate: frameRate + 2, repeat: 0 },
		{ name: 'death', row: 3, frameStart: 0, frameCount: 7, frameRate: frameRate + 2, repeat: 0 },
	],
});

const base = (over) => ({
	critChance: 0.1,
	critDamageMultiplier: 1.5,
	spriteType: 'aseprite',
	spritesheet: sheet(),
	...over,
	size: { width: over.size, height: over.size },
});

const newEnemies = [
	base({
		id: 'swarmling', name: 'Rustmite', hp: 16, speed: 190, damage: 6, size: 26,
		tint: '#fdba74', xpValue: 10, goldValue: 1, goldChance: 0.15,
		lore: '떼로만 의미가 있는 부스러기. 그러나 떼는 언제나 온다.',
	}),
	base({
		id: 'charger', name: 'Gorehound', hp: 120, speed: 75, damage: 30, size: 54,
		tint: '#dc2626', xpValue: 150, goldValue: 4, goldChance: 0.4, knockbackResist: 0.4,
		behavior: { type: 'charger', windupMs: 650, dashSpeed: 430, dashDurationMs: 480, dashCooldownMs: 2100 },
		lore: '숨을 고르다 검벽을 뚫고 들이받는다. 조준선을 읽어라.',
	}),
	base({
		id: 'broodcaller', name: 'Broodcaller', hp: 130, speed: 78, damage: 10, size: 50,
		tint: '#facc15', xpValue: 160, goldValue: 5, goldChance: 0.5,
		behavior: { type: 'summoner', summonId: 'swarmling', summonCount: 2, summonIntervalMs: 4200, keepDistance: 360 },
		lore: '제 몸을 뜯어 부스러기를 낳는다. 어미를 먼저 끊어라.',
	}),
	base({
		id: 'banneret', name: 'Banneret', hp: 240, speed: 62, damage: 22, size: 60,
		tint: '#d9a83c', xpValue: 220, goldValue: 6, goldChance: 0.6, knockbackResist: 0.6,
		behavior: { type: 'aura', auraRadius: 260, auraDamageMult: 1.35, auraSpeedMult: 1.2 },
		lore: '녹의 깃발. 곁의 무리가 더 빠르고 더 아프게 문다.',
	}),
	base({
		id: 'sniper', name: 'Longspine', hp: 70, speed: 70, damage: 10, size: 46,
		tint: '#5eead4', xpValue: 130, goldValue: 4, goldChance: 0.4,
		behavior: { type: 'ranged', range: 640, fireIntervalMs: 3400, projectileSpeed: 470, projectileDamage: 36, damageType: 'magic' },
		lore: '화면 끝에서 척추침을 쏘아 보낸다. 가만히 서 있으면 과녁이 된다.',
	}),
	base({
		id: 'blinker', name: 'Rustwisp', hp: 60, speed: 90, damage: 20, size: 42,
		tint: '#c084fc', xpValue: 120, goldValue: 4, goldChance: 0.4,
		behavior: { type: 'blinker', blinkIntervalMs: 2600, blinkRange: 190 },
		lore: '녹 안개가 뭉친 것. 검벽 안쪽으로 스며든다.',
	}),
	base({
		id: 'cindermaul', name: 'Cindermaul', hp: 750, speed: 45, damage: 55, size: 80,
		tint: '#78350f', xpValue: 480, goldValue: 12, goldChance: 0.8,
		knockbackResist: 1, physicalResist: 0.3, magicResist: 0.3,
		lore: '걸어오는 재의 망치. 느리지만 멈추지 않는다.',
	}),
	// --- 신규 중간보스 4 ---
	base({
		id: 'mb-gorehorn', name: 'Gorehorn', hp: 950, speed: 70, damage: 48, size: 88,
		tint: '#b91c1c', xpValue: 700, goldValue: 45, goldChance: 1.0,
		isMiniboss: true, knockbackResist: 0.85, healthBarWidth: 60,
		behavior: { type: 'charger', windupMs: 600, dashSpeed: 540, dashDurationMs: 520, dashCooldownMs: 1800 },
		physicalResist: 0.25, magicResist: 0.15,
		lore: '뿔이 먼저 도착하고, 몸통이 뒤따른다.',
	}),
	base({
		id: 'mb-broodmother', name: 'Broodmother', hp: 1000, speed: 66, damage: 30, size: 92,
		tint: '#f59e0b', xpValue: 750, goldValue: 50, goldChance: 1.0,
		isMiniboss: true, knockbackResist: 0.9, healthBarWidth: 60,
		behavior: { type: 'summoner', summonId: 'swarmling', summonCount: 3, summonIntervalMs: 2800, keepDistance: 400 },
		physicalResist: 0.2, magicResist: 0.2,
		lore: '낳고, 낳고, 또 낳는다. 광맥이 마를 때까지.',
	}),
	base({
		id: 'mb-rustbanner', name: 'Rustbanner', hp: 950, speed: 64, damage: 35, size: 86,
		tint: '#eab308', xpValue: 750, goldValue: 50, goldChance: 1.0,
		isMiniboss: true, knockbackResist: 1, healthBarWidth: 60,
		behavior: { type: 'aura', auraRadius: 320, auraDamageMult: 1.5, auraSpeedMult: 1.25 },
		physicalResist: 0.3, magicResist: 0.2,
		lore: '이 깃발이 서 있는 한 무리는 물러서지 않는다.',
	}),
	base({
		id: 'mb-headtaker', name: 'Headtaker', hp: 850, speed: 95, damage: 60, size: 84,
		tint: '#7f1d1d', xpValue: 800, goldValue: 55, goldChance: 1.0,
		isMiniboss: true, knockbackResist: 0.85, healthBarWidth: 60,
		critChance: 0.4, critDamageMultiplier: 2.5,
		affixes: ['frenzied'],
		physicalResist: 0.15, magicResist: 0.15,
		lore: '수확자. 다친 것부터 벤다 — 너처럼.',
	}),
	// --- 신규 보스 2 ---
	base({
		id: 'boss-siegehulk', name: 'Siegehulk', hp: 8000, speed: 55, damage: 70, size: 160,
		tint: '#9a3412', xpValue: 4000, goldValue: 300, goldChance: 1.0,
		isBoss: true, knockbackResist: 1, healthBarWidth: 110,
		critChance: 0.25, critDamageMultiplier: 2.2,
		behavior: { type: 'charger', windupMs: 800, dashSpeed: 560, dashDurationMs: 650, dashCooldownMs: 2400 },
		affixes: ['summoning'],
		physicalResist: 0.25, magicResist: 0.15,
		lore: '성문을 부수던 것이 이제 너를 향해 달린다.',
	}),
	base({
		id: 'boss-needlequeen', name: 'Needle Queen', hp: 6500, speed: 60, damage: 55, size: 150,
		tint: '#0d9488', xpValue: 4200, goldValue: 320, goldChance: 1.0,
		isBoss: true, knockbackResist: 1, healthBarWidth: 110,
		critChance: 0.2, critDamageMultiplier: 2.0,
		behavior: { type: 'ranged', range: 430, fireIntervalMs: 1500, projectileSpeed: 320, projectileDamage: 26, projectileCount: 7, spreadDeg: 84, damageType: 'magic' },
		affixes: ['regenerating'],
		physicalResist: 0.15, magicResist: 0.35,
		lore: '여왕의 바늘비. 서 있는 자리부터 꿰인다.',
	}),
];

const enemies = JSON.parse(readFileSync(enemyPath, 'utf8'));
for (const entry of newEnemies) {
	const idx = enemies.findIndex((e) => e.id === entry.id);
	if (idx >= 0) enemies[idx] = entry; else enemies.push(entry);
}
// 최종 보스에 warlord 태생 어픽스 (호위 강화)
const deathLord = enemies.find((e) => e.id === 'death-lord');
if (deathLord) deathLord.affixes = ['warlord'];
writeFileSync(enemyPath, JSON.stringify(enemies, null, 2) + '\n');

// ---------------------------------------------------------------------------
// waveTable: 스케일링 블록 + 중반 풀 보강 + 후반 풀 5개(minute 15~19)
// ---------------------------------------------------------------------------
const wave = JSON.parse(readFileSync(wavePath, 'utf8'));

wave.scaling = {
	hpLinear: 0.06,
	hpExpBase: 1.07,
	damageLinear: 0.03,
	damageExpBase: 1.045,
	damageCap: 28,
	bossHpExponent: 0.7,
	minibossHpExponent: 0.8,
};

const addToPool = (minute, entries) => {
	const w = wave.waves.find((x) => x.minute === minute);
	if (!w) return;
	for (const [id, weight] of entries) {
		const existing = w.pool.find((p) => p.id === id);
		if (existing) existing.weight = weight; else w.pool.push({ id, weight });
	}
};

// 중반 풀에 신규 적 주입 (divisor 3 기준: minute m → 라운드 3m+1 ~ 3m+3)
addToPool(8, [['charger', 2]]);
addToPool(9, [['charger', 2], ['sniper', 1]]);
addToPool(10, [['charger', 3], ['sniper', 2], ['blinker', 1]]);
addToPool(11, [['sniper', 2], ['blinker', 2], ['broodcaller', 1]]);
addToPool(12, [['charger', 3], ['blinker', 2], ['broodcaller', 2]]);
addToPool(13, [['sniper', 3], ['banneret', 1], ['cindermaul', 1]]);
addToPool(14, [['charger', 4], ['blinker', 3], ['banneret', 2], ['cindermaul', 2]]);

const lateWaves = [
	{
		minute: 15, spawnIntervalMs: 380, minAlive: 32,
		pool: [['shielded-shooter', 4], ['venom-slime', 3], ['cindermaul', 3], ['charger', 4], ['sniper', 3], ['blinker', 3], ['banneret', 2], ['healer', 2]],
	},
	{
		minute: 16, spawnIntervalMs: 360, minAlive: 34,
		pool: [['charger', 4], ['cindermaul', 4], ['sniper', 4], ['blinker', 3], ['banneret', 3], ['broodcaller', 3], ['shieldbearer', 3], ['healer', 2]],
	},
	{
		minute: 17, spawnIntervalMs: 340, minAlive: 36,
		pool: [['cindermaul', 5], ['charger', 4], ['sniper', 4], ['blinker', 4], ['banneret', 3], ['broodcaller', 3], ['venom-slime', 3]],
	},
	{
		minute: 18, spawnIntervalMs: 320, minAlive: 38,
		pool: [['cindermaul', 5], ['charger', 5], ['sniper', 4], ['blinker', 4], ['banneret', 4], ['broodcaller', 3], ['skullwolf-brute', 4], ['hound', 4]],
	},
	{
		minute: 19, spawnIntervalMs: 300, minAlive: 40,
		pool: [['cindermaul', 6], ['charger', 5], ['sniper', 5], ['blinker', 5], ['banneret', 4], ['broodcaller', 4], ['hound', 5], ['bomber', 4]],
	},
].map((w) => ({ ...w, pool: w.pool.map(([id, weight]) => ({ id, weight })) }));

for (const lw of lateWaves) {
	const idx = wave.waves.findIndex((x) => x.minute === lw.minute);
	if (idx >= 0) wave.waves[idx] = lw; else wave.waves.push(lw);
}
wave.waves.sort((a, b) => a.minute - b.minute);

writeFileSync(wavePath, JSON.stringify(wave, null, 2) + '\n');
console.log('enemyCatalog:', enemies.length, 'entries / waveTable waves:', wave.waves.length);
