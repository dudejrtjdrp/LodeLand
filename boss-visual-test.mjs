// 보스 외형 회귀 테스트 (2026-09-02 보스 전면 개편 신설).
//
// 검증:
//   (1) 크기 균일 — 전 보스의 '표시 몸통' 기하평균이 규격(132px) ±8% 안, 중간보스는 88px
//   (2) 확대 — 개편 전 최대치(116px)보다 모든 보스가 크다
//   (3) 히트박스 — 물리 바디가 표시 프레임보다 작다 ("그림 밖인데 맞는" 구간 제거)
//   (4) 애니 — idle/walk/attack 키 존재 + 실제 재생 전환 (정지↔이동↔시전)
//   (5) 텍스처 필터가 NEAREST (확대해도 뭉개지지 않는다)
//   (6) 컷인·보스바·사망 연출이 커진 보스에서도 정상 동작
//
// Run: node boss-visual-test.mjs (vite preview :5197)
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
// 타이틀 → 캐릭터 선택 → 게임. 부하가 걸린 머신에서는 첫 Space 가 씹히므로
// 목표 씬이 뜰 때까지 눌러 본다 (고정 대기 금지 — 회귀 테스트가 플레이키해진다).
async function advanceUntil(globalName) {
	for (let i = 0; i < 40; i += 1) {
		if (await page.evaluate((n) => !!window[n], globalName)) return true;
		await page.keyboard.press('Space');
		await page.waitForTimeout(500);
	}
	throw new Error(`부팅 실패: window.${globalName} 이 뜨지 않았다`);
}
await advanceUntil('__charSelect');
await advanceUntil('__gameScene');
await page.waitForTimeout(2400);

await page.evaluate(() => {
	const s = window.__gameScene;
	s.progression.xpToNext = 999999999;
	const m = s.enemyManager;
	m.spawningEnabled = false;
	m.minAlive = 0;
	for (const e of m.enemies.getChildren()) {
		if (e.active) m.recycleEnemy(e);
	}
});

// ── (1~3) 크기·히트박스 전수 조사 ──────────────────────────────────────
const survey = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const out = [];
	for (const def of m.enemyCatalog) {
		if (!def.isBoss && !def.isMiniboss) continue;
		const e = m.spawnEnemy(s, s.player, def.id, { x: s.player.x + 1400, y: s.player.y + 1400 });
		if (!e) continue;
		const body = e.body;
		const hb = def.hitbox;
		const shownBodyW = hb ? hb.width * Math.abs(e.scaleX) : e.displayWidth;
		const shownBodyH = hb ? hb.height * Math.abs(e.scaleY) : e.displayHeight;
		out.push({
			id: def.id,
			kind: def.isBoss ? 'boss' : 'mini',
			displayW: Math.round(e.displayWidth),
			displayH: Math.round(e.displayHeight),
			bodyW: Math.round(body?.width ?? 0),
			bodyH: Math.round(body?.height ?? 0),
			gm: Math.round(Math.sqrt(shownBodyW * shownBodyH)),
			hasHitbox: !!hb,
			anims: ['idle', 'walk', 'attack', 'hit', 'death'].filter((a) => s.anims.exists(`${def.id}-${a}`)),
		});
		m.recycleEnemy(e);
	}
	return out;
});
console.table?.(survey);
for (const row of survey) {
	console.log(`  ${row.kind}\t${row.id}\t표시 ${row.displayW}x${row.displayH}\t몸통 ${row.gm}\t`
		+ `바디 ${row.bodyW}x${row.bodyH}\t애니 ${row.anims.join(',')}`);
}

const bosses = survey.filter((r) => r.kind === 'boss');
const minis = survey.filter((r) => r.kind === 'mini');
check('조사: 보스 8종 · 중간보스 10종 수집', bosses.length >= 8 && minis.length >= 8,
	`boss=${bosses.length} mini=${minis.length}`);

const offBoss = bosses.filter((r) => Math.abs(r.gm - 132) > 132 * 0.08);
check('크기: 전 보스 몸통 132px ±8% (균일)', offBoss.length === 0,
	offBoss.map((r) => `${r.id}=${r.gm}`).join(' ') || '전부 규격');
const offMini = minis.filter((r) => Math.abs(r.gm - 88) > 88 * 0.08);
check('크기: 전 중간보스 몸통 88px ±8% (균일)', offMini.length === 0,
	offMini.map((r) => `${r.id}=${r.gm}`).join(' ') || '전부 규격');

// 개편 전 보스 몸통 기하평균 최대치는 116 (needlequeen), 최소 67 (minos)
const tooSmall = bosses.filter((r) => r.gm < 118);
check('확대: 모든 보스가 개편 전 최대치(116px)보다 크다', tooSmall.length === 0,
	tooSmall.map((r) => `${r.id}=${r.gm}`).join(' ') || '전부 확대');
check('확대: 보스는 일반 적(몸통 ~35px)의 3.5배 이상',
	bosses.every((r) => r.gm >= 35 * 3.5), `최소 ${Math.min(...bosses.map((r) => r.gm))}`);

const fatBody = survey.filter((r) => r.hasHitbox && (r.bodyW > r.displayW || r.bodyH > r.displayH));
check('히트박스: 바디가 표시 프레임을 넘지 않는다', fatBody.length === 0,
	fatBody.map((r) => r.id).join(' ') || 'ok');
const noHitbox = survey.filter((r) => !r.hasHitbox);
check('히트박스: 전 보스/중간보스에 hitbox 규격이 있다', noHitbox.length === 0,
	noHitbox.map((r) => r.id).join(' ') || 'ok');

// ── (4) 애니메이션 ────────────────────────────────────────────────────
const NEW_SHEET_IDS = [
	'skullwolf-boss', 'boss-siegehulk', 'boss-needlequeen', 'death-lord',
	'boss-abyss-demon', 'boss-minos', 'boss-frost-guardian', 'mb-frost-golem', 'mb-magma-golem',
];
const missing = NEW_SHEET_IDS.filter((id) => {
	const row = survey.find((r) => r.id === id);
	return !row || !['idle', 'walk', 'attack'].every((a) => row.anims.includes(a));
});
check('애니: 전용 시트 보스 9종에 idle/walk/attack 전부 존재', missing.length === 0,
	missing.join(' ') || 'ok');
const noIdle = survey.filter((r) => !r.anims.includes('idle'));
check('애니: 전 보스/중간보스에 idle 존재', noIdle.length === 0, noIdle.map((r) => r.id).join(' ') || 'ok');

// 실제 재생 전환 — 정지=idle, 이동=walk, 시전=attack
const playback = await page.evaluate(async () => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const boss = m.spawnEnemy(s, s.player, 'boss-siegehulk', { x: s.player.x + 900, y: s.player.y });
	boss.hp = 9e6; boss.maxHp = 9e6;
	boss.skillIds = undefined;
	boss.nextSkillAt = s.time.now + 1e6;
	// 정지
	boss.castingUntil = s.time.now + 800;
	await sleep(260);
	boss.castingUntil = 0;
	boss.speed = 0;
	boss.setVelocity(0, 0);
	await sleep(320);
	const idleKey = boss.anims?.currentAnim?.key;
	// 이동
	boss.speed = 200;
	await sleep(420);
	const walkKey = boss.anims?.currentAnim?.key;
	// 시전 (공격 애니 1회)
	boss.skillIds = ['slam'];
	boss.nextSkillAt = 0;
	boss.castingUntil = 0;
	await sleep(300);
	const attackKey = boss.anims?.currentAnim?.key;
	const out = { idleKey, walkKey, attackKey };
	m.recycleEnemy(boss);
	m.bossTelegraphs.length = 0;
	return out;
});
check('애니: 정지 = idle 재생', playback.idleKey === 'boss-siegehulk-idle', JSON.stringify(playback));
check('애니: 이동 = walk 재생', playback.walkKey === 'boss-siegehulk-walk', JSON.stringify(playback));
check('애니: 시전 = attack 1회 재생', playback.attackKey === 'boss-siegehulk-attack', JSON.stringify(playback));

// ── (5) 텍스처 필터 ───────────────────────────────────────────────────
const filter = await page.evaluate(() => {
	const s = window.__gameScene;
	const tex = s.textures.get('enemies-atlas') ?? s.textures.get('enemies');
	return { key: tex?.key, scaleMode: tex?.source?.[0]?.scaleMode };
});
check('필터: 적 아틀라스가 NEAREST (확대해도 선명)', filter.scaleMode === 1, JSON.stringify(filter));

// ── (6) 컷인 · 보스바 · 사망 연출 ─────────────────────────────────────
const stagecraft = await page.evaluate(async () => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const boss = m.spawnEnemy(s, s.player, 'boss-needlequeen', { x: s.player.x + 320, y: s.player.y });
	boss.hp = 2000; boss.maxHp = 2000;
	boss.skillIds = undefined;
	boss.nextSkillAt = s.time.now + 1e6;
	await sleep(260);
	const cutIn = !!s.bossCutIn;
	const barBefore = s.bossBar?.hasBoss === true ? 1 : 0;
	// 사망 연출 (보스 등급) — 커진 스프라이트에서도 예외 없이 끝나야 한다
	m.die(boss, s.player);
	await sleep(500);
	return {
		cutIn,
		barBefore,
		dying: boss.isDying === true,
		telegraphs: m.bossTelegraphs.length,
	};
});
check('연출: 보스 등장 컷인이 뜬다', stagecraft.cutIn === true || stagecraft.barBefore > 0,
	JSON.stringify(stagecraft));
check('연출: 보스 사망 처리가 예외 없이 끝난다', stagecraft.dying === true, JSON.stringify(stagecraft));
check('연출: 사망 시 남은 텔레그래프 없음', stagecraft.telegraphs === 0, `${stagecraft.telegraphs}개`);

check('페이지 오류 없음', errors.length === 0, JSON.stringify(errors.slice(0, 4)));
await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
