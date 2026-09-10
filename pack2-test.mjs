// pack2 통합 회귀: 신규 적 10종 스폰/애니, 보스 로테이션, 탈각(페이즈) 보스, 마을 전용 창 3종.
// Run: node pack2-test.mjs (vite preview :5197, CHROME_BIN 주입 가능)
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5197;
const results = [];
const check = (name, ok, detail = '') => {
	results.push([name, ok]);
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
	executablePath: process.env.CHROME_BIN || undefined,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-gpu'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (err) => errors.push(err.message));
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForTimeout(2600);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(2400);

// ── (1) 신규 적 10종: 스폰·애니·특성
const spawnProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const ids = ['boss-abyss-demon', 'boss-minos', 'boss-frost-guardian', 'mb-frost-golem', 'mb-magma-golem',
		'demonling', 'blood-horror', 'duskbat', 'verdrat', 'boss-molt'];
	const out = {};
	for (const id of ids) {
		const e = m.spawnEnemy(s, s.player, id, { x: s.player.x + 700, y: s.player.y + 700 });
		out[id] = {
			ok: Boolean(e),
			anim: s.anims.exists(`${id}-idle`),
			traits: (e?.traitIds ?? []).length,
			playing: e?.anims?.currentAnim?.key ?? null,
		};
		if (e) {
			e.maxHp = 99999; e.hp = 99999; // 사망/경험치 오염 방지
		}
	}
	return out;
});
for (const [id, info] of Object.entries(spawnProbe)) {
	check(`스폰: ${id}`, info.ok && info.anim && info.traits > 0, JSON.stringify(info));
}
await page.evaluate(() => {
	const s = window.__gameScene;
	for (const e of s.enemyManager.enemies.getChildren()) {
		if (e.active) s.enemyManager.recycleEnemy(e);
	}
	s.enemyManager.bossTelegraphs.length = 0;
});

// ── (2) 보스 로테이션 (정찰 결정론)
const rotation = await page.evaluate(() => {
	const w = window.__gameScene.waveSystem;
	const ids = (round) => w.getRoundIntel(round).targets.map((t) => t.def.id).join(',');
	return { r30: ids(30), r40: ids(40), r50: ids(50), r60: ids(60), r100: ids(100), r200: ids(200) };
});
check('로테이션: 30라 미노스 데뷔', rotation.r30.includes('boss-minos'), rotation.r30);
check('로테이션: 40라 서리 수호자', rotation.r40.includes('boss-frost-guardian'), rotation.r40);
check('로테이션: 50라 심연 데몬', rotation.r50.includes('boss-abyss-demon'), rotation.r50);
check('로테이션: 60라 페어', rotation.r60.split(',').length >= 2, rotation.r60);
check('로테이션: 100라 탈각하는 것', rotation.r100 === 'boss-molt', rotation.r100);
check('로테이션: 200라 최심부 유지', rotation.r200.includes('death-lord'), rotation.r200);

// ── (3) 탈각하는 것: 페이즈 전환 (형태·스킬·특성 교체)
const moltProbe = await page.evaluate(async () => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	m.setRound(100);
	const molt = m.spawnEnemy(s, s.player, 'boss-molt', { x: s.player.x + 420, y: s.player.y });
	window.__molt = molt;
	const grab = () => ({
		phase: molt.phaseIndex,
		anim: molt.anims?.currentAnim?.key ?? null,
		skills: [...(molt.skillIds ?? [])],
		slowImmune: molt.slowImmune,
		name: molt.enemyName,
	});
	const p0 = grab();
	const step = (pct) => new Promise((resolve) => {
		molt.hp = Math.floor(molt.maxHp * pct);
		setTimeout(() => resolve(grab()), 400);
	});
	const p1 = await step(0.74);
	const p2 = await step(0.49);
	const p3 = await step(0.24);
	return { p0, p1, p2, p3, maxHp: molt.maxHp };
});
check('탈각: 시작 본체 (강타만)', moltProbe.p0.phase === 0 && moltProbe.p0.skills.join() === 'slam', JSON.stringify(moltProbe.p0));
check('탈각: 75% 진흙 형태', moltProbe.p1.phase === 1 && moltProbe.p1.anim === 'boss-molt-mud'
	&& moltProbe.p1.skills.includes('barrage'), JSON.stringify(moltProbe.p1));
check('탈각: 50% 빙결 형태 (감속 면역)', moltProbe.p2.phase === 2 && moltProbe.p2.anim === 'boss-molt-ice'
	&& moltProbe.p2.slowImmune === true && moltProbe.p2.skills.includes('beam'), JSON.stringify(moltProbe.p2));
check('탈각: 25% 비상 형태', moltProbe.p3.phase === 3 && moltProbe.p3.anim === 'boss-molt-flying', JSON.stringify(moltProbe.p3));
await page.evaluate(() => {
	const s = window.__gameScene;
	s.enemyManager.recycleEnemy(window.__molt);
	s.enemyManager.bossTelegraphs.length = 0;
	s.enemyManager.setRound(1);
});

// ── (4) 대기마을 전용 창 3종
await page.evaluate(() => {
	const s = window.__gameScene;
	s.waveSystem.objective = { type: 'kill-count', required: 0, label: 't' };
	// 2026-09-06: 스폰 창 종료 + 잔당 전멸이 종료 조건 — 테스트는 지름길로 채운다
	s.waveSystem.skipToRoundEnd();
});
await page.waitForFunction(() => window.__gameScene.villageSystem.isActive, null, { timeout: 9000 });
await page.waitForTimeout(1200);

for (const kind of ['smith', 'edda', 'altar']) {
	await page.evaluate((k) => window.__gameScene.villageSystem.openStall(k), kind);
	await page.waitForTimeout(500);
	const open = await page.evaluate(() => window.__gameScene.villageSystem.activeWindow?.kind ?? null);
	check(`창 열림: ${kind}`, open === kind, String(open));
	await page.keyboard.press('Escape');
	await page.waitForTimeout(400);
	const closed = await page.evaluate(() => ({
		window: window.__gameScene.villageSystem.windowOpen,
		paused: window.__gameScene.isPaused,
	}));
	check(`창 닫힘: ${kind} (ESC, 일시정지 없음)`, closed.window === false && closed.paused === false, JSON.stringify(closed));
}

// 대장간에서 실제 구매 1회 (골드 지급 후)
await page.evaluate(() => { window.__gameScene.pickupSystem.runGold = 500; });
await page.evaluate(() => window.__gameScene.villageSystem.openStall('smith'));
await page.waitForTimeout(500);
const buyProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const before = {
		gold: s.pickupSystem.runGold,
		swords: s.swordOrbit.swords.length + s.swordOrbit.reserve.length,
		offers: s.shopSystem.swordOffers.length,
	};
	const offer = s.shopSystem.swordOffers[0];
	if (offer) {
		s.shopSystem.buySword(offer);
	}
	return {
		before,
		after: {
			gold: s.pickupSystem.runGold,
			swords: s.swordOrbit.swords.length + s.swordOrbit.reserve.length,
			offers: s.shopSystem.swordOffers.length,
		},
	};
});
check('대장간: 구매로 골드 차감·검 획득', buyProbe.after.gold < buyProbe.before.gold
	&& (buyProbe.after.swords > buyProbe.before.swords || buyProbe.after.offers < buyProbe.before.offers),
JSON.stringify(buyProbe));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ── (5) 정찰 보고 신형 레이아웃이 에러 없이 열린다
await page.evaluate(() => {
	const s = window.__gameScene;
	const gate = s.villageSystem.stalls.find((st) => st.id === 'gate');
	s.player.setPosition(gate.x, gate.y + 40);
	s.player.body?.reset(gate.x, gate.y + 40);
});
await page.waitForTimeout(400);
await page.keyboard.press('KeyE');
await page.waitForTimeout(700);
check('정찰: 신형 레이아웃 열림', await page.evaluate(() => window.__gameScene.villageSystem.scoutOpen === true));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

check('페이지 오류 없음', errors.length === 0, JSON.stringify(errors.slice(0, 4)));
await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
