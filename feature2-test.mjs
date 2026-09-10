// 2026-08-28 기능 검증: 신규 REFORGE 레시피 / 투사체 글로우·사거리 /
// 레벨 120·200라운드 / 후반 저항 스케일링 / 랜서 dashRange
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-crashpad'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 타이틀 → 캐릭터 선택 → 게임 시작
await page.evaluate(() => {
	const game = window.__PHASER_GAME__ ?? Object.values(window).find((v) => v?.scene?.keys);
});
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
	const scene = window.__gameScene;
	if (!scene) return { noScene: true };
	const so = scene.swordOrbit;
	const result = {};

	// 1) 레시피 다양화
	result.recipeCount = so.evolutionRecipes.length;
	result.newSwordDefs = ['anvilkite', 'coinquill', 'slagroc', 'rotwing', 'railshrike', 'hollowowl', 'verdiwing', 'pyreroc']
		.every((id) => Boolean(so.getDefinitionById(id)));
	result.reforgeStates = so.getReforgeStates().length;

	// 2) 신규 레시피 실제 조합 (bronze+steel → anvilkite)
	const bronze = so.getDefinitionById('bronze');
	const steel = so.getDefinitionById('steel');
	so.addToReserve(bronze, 2);
	so.addToReserve(steel, 4);
	const idx = so.evolutionRecipes.findIndex((r) => r.result === 'anvilkite');
	result.reforgeOk = so.reforge(idx);
	result.gotAnvilkite = so.swords.some((s) => s.definition?.id === 'anvilkite')
		|| so.reserve.some((e) => e.definition?.id === 'anvilkite');
	const made = so.swords.find((s) => s.definition?.id === 'anvilkite');
	result.inheritedLevel = made?.level ?? so.reserve.find((e) => e.definition?.id === 'anvilkite')?.level;

	// 3) 라운드/레벨 확장
	result.totalRounds = scene.waveSystem.totalRounds;
	result.maxLevel = scene.progression.maxLevel;

	// 4) 후반 저항/HP 스케일: 100라운드 시작시켜 확인
	scene.waveSystem.startRound(100);
	const em = scene.enemyManager;
	result.resistBonus = Number(em.resistBonus.toFixed(3));
	result.hpMultAt100 = Math.round(em.hpMult);
	em.spawnEnemy(scene, scene.player, 'skullwolf');
	const spawned = em.enemies.getChildren().filter((e) => e.active && e.enemyType === 'skullwolf').pop();
	result.spawnedResist = spawned ? Number(spawned.physicalResist.toFixed(3)) : null;

	// 5) 투사체: 글로우 + 수명
	const shooterDef = em.getEnemyTypeById('shooter');
	result.shooterRange = shooterDef.behavior.range;
	result.sniperRange = em.getEnemyTypeById('sniper').behavior.range;
	em.spawnEnemy(scene, scene.player, 'shooter');
	const sh = em.enemies.getChildren().filter((e) => e.active && e.enemyType === 'shooter').pop();
	em.fireProjectiles(sh, scene.player, shooterDef.behavior);
	const bullet = em.projectiles.getChildren().find((b) => b.active);
	result.bulletHasGlow = Boolean(bullet?.glow?.visible);
	result.bulletLifeMs = bullet ? Math.round(bullet.expiresAt - scene.time.now) : null;

	// 6) 랜서 dashRange / 넉백 면역 / 속도
	const ch = em.getEnemyTypeById('charger');
	result.chargerDashRange = ch.behavior.dashRange;
	result.chargerKb = ch.knockbackResist;
	result.chargerSpeed = ch.speed;

	// 7) 신규 스페셜 타입 동작 (slow/blast) — 유사 검 객체로 직접 발동
	const verdi = so.getDefinitionById('verdiwing');
	const fakeSword = { definition: verdi, special: verdi.special, level: 1, traitMods: {} };
	if (spawned) {
		// 후반 라운드에선 어픽스가 2~4개 붙어서 purge(감속 면역)가 섞일 확률이 높다.
		// 여기서 보려는 건 "slow 스페셜이 동작하는가"이므로 면역만 걷어내고 검사한다
		// (안 그러면 어픽스 RNG 때문에 테스트가 간헐적으로 실패한다).
		spawned.slowImmune = false;
		so.applySpecial(fakeSword, spawned, 50);
		result.slowApplied = spawned.slowFactor < 1 && spawned.slowUntil > scene.time.now;
	}
	const slag = so.getDefinitionById('slagroc');
	const fakeSlag = { definition: slag, special: slag.special, level: 1, traitMods: {} };
	em.spawnEnemy(scene, scene.player, 'skullwolf', { x: 500, y: 500 });
	em.spawnEnemy(scene, scene.player, 'skullwolf', { x: 540, y: 500 });
	const wolves = em.enemies.getChildren().filter((e) => e.active && e.enemyType === 'skullwolf').slice(-2);
	if (wolves.length === 2) {
		const nHpBefore = wolves[1].hp;
		so.applySpecial(fakeSlag, wolves[0], 100);
		result.blastHitNeighbor = wolves[1].hp < nHpBefore;
	}

	return result;
});

console.log(JSON.stringify(out, null, 1));
console.log('errors:', JSON.stringify(errors.slice(0, 5)));
const pass = out.recipeCount === 26 && out.newSwordDefs && out.reforgeOk && out.gotAnvilkite
	&& out.totalRounds === 200 && out.maxLevel === 120
	&& out.resistBonus > 0.5 && out.spawnedResist >= 0.5
	&& out.bulletHasGlow && out.bulletLifeMs > 4000
	&& out.chargerDashRange === 520 && out.chargerKb === 1
	&& out.slowApplied && out.blastHitNeighbor && errors.length === 0;
console.log(pass ? 'FEATURE2 TEST: PASS' : 'FEATURE2 TEST: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
