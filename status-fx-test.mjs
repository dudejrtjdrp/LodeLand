// 상태이상 표시 회귀 테스트 (2026-09-04)
//
// 검증 대상:
//  1) 부여 헬퍼(StatusEffectSystem)가 필드를 실제로 세우고 가드가 통일돼 있다.
//  2) "걸려 있는 동안" 스프라이트 틴트가 상태색으로 바뀌고, 우선순위대로 이긴다.
//  3) 만료되면 **원래 색**으로 정확히 돌아온다 (tint 복구 버그 회귀).
//  4) 피격 백색 플래시가 끝난 뒤에도 상태색/원래색이 복구된다.
//  5) 지속 오버레이가 공유 Graphics 한 장에 실제로 그려지고, 화면 밖은 그리지 않는다.
//  6) 지속 피해 숫자가 뜨고, 예산 상한을 넘기지 않는다.
//  7) 다수 적에게 상태를 걸어도 프레임이 살아 있다 (오버레이 예산제).
//
// 실행: vite dev(5173) 띄운 뒤 `node status-fx-test.mjs`
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
await page.waitForTimeout(1200);

const r = await page.evaluate(async () => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const st = s.statusEffects;
	const fx = s.visualEffects;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const checks = [];
	const ok = (name, cond, extra) => checks.push({ name, pass: !!cond, ...(extra ?? {}) });

	// 검이 적을 죽이면 상태 확인이 불가능하므로 궤도를 멈춘다
	if (s.swordOrbit) {
		s.swordOrbit.noLaunch = true;
	}
	m.spawningEnabled = false;
	const clearAll = () => {
		for (const e of m.enemies.getChildren()) {
			if (e.active) m.recycleEnemy(e);
		}
		m.gridBuiltAt = -1;
	};
	clearAll();

	/** 화면 안, 플레이어 옆에 죽지 않을 만큼 튼튼한 적 하나 */
	const spawn = (dx = 90, dy = 0) => {
		const e = m.spawnEnemy(s, s.player, 'skullwolf', { x: s.player.x + dx, y: s.player.y + dy });
		e.hp = 1e9;
		e.maxHp = 1e9;
		return e;
	};
	/** 현재 걸려 있는 틴트 (Phaser 는 코너별로 들고 있다 — 좌상단만 본다) */
	const tintOf = (e) => (e.isTinted ? e.tintTopLeft : null);

	ok('statusEffects 시스템이 붙어 있다', !!st);

	// ── 1) 부여 헬퍼가 필드를 세운다
	const a = spawn();
	await wait(60);
	const baseTint = tintOf(a);

	st.slow(a, 0.5, 1500);
	ok('slow(): slowFactor/slowUntil 이 선다',
		Math.abs((a.slowFactor ?? 1) - 0.5) < 1e-6 && (a.slowUntil ?? 0) > s.time.now,
		{ factor: a.slowFactor });

	st.shock(a, 2000);
	ok('shock(): setShockUntil 이 선다', (a.setShockUntil ?? 0) > s.time.now);

	st.bleed(a, 12, 2000);
	ok('bleed(): setBleedUntil/Dps 가 선다',
		(a.setBleedUntil ?? 0) > s.time.now && (a.setBleedDps ?? 0) >= 12);

	const froze = st.freeze(a, 1200);
	ok('freeze(): 잡몹은 얼고 완전 정지한다',
		froze && (a.setFrozenUntil ?? 0) > s.time.now && a.slowFactor === 0);

	const stacked = st.poisonStack(a, 5);
	ok('poisonStack(): 중첩이 오른다', stacked === 1 && a.setPoisonStacks === 1);

	// ── 2) 가드 통일: 보스는 감속·빙결이 통하지 않는다
	clearAll();
	const boss = m.spawnEnemy(s, s.player, 'skullwolf-boss', { x: s.player.x + 200, y: s.player.y });
	if (boss) {
		boss.hp = 1e9;
		boss.maxHp = 1e9;
		await wait(60);
		ok('보스에게 slow() 가 막힌다', st.slow(boss, 0.5, 1000) === false);
		ok('보스에게 freeze() 가 막힌다', st.freeze(boss, 1000) === false);
		st.shock(boss, 1500);
		ok('보스도 감전(취약)은 걸린다', (boss.setShockUntil ?? 0) > s.time.now);
		ok('보스는 감전으로도 멈추지 않는다', (boss.slowFactor ?? 1) === 1, { factor: boss.slowFactor });
		// allowBoss 예외 (스킬 트리 광역 감속)
		ok('allowBoss 옵션이면 보스도 절반 감속',
			st.slow(boss, 0.3, 1000, { allowBoss: true }) === true);
		m.recycleEnemy(boss);
	} else {
		ok('보스 스폰 (가드 검증용)', false);
	}

	// ── 3) 틴트: 상태색으로 바뀌고 우선순위대로 이긴다
	clearAll();
	const b = spawn();
	await wait(120);
	const bBase = tintOf(b);

	m.applyDot(b, 20, 4000, 0xf97316); // 화상
	await wait(120);
	const burnTint = tintOf(b);
	ok('화상 중에는 틴트가 원래 색과 다르다', burnTint !== bBase, { base: bBase, burn: burnTint });

	st.freeze(b, 3000); // 빙결이 화상보다 우선
	await wait(120);
	const freezeTint = tintOf(b);
	ok('빙결이 화상보다 우선해 틴트를 가져간다', freezeTint !== burnTint,
		{ burn: burnTint, freeze: freezeTint });

	// ── 4) 만료 시 원래 색 복구 (tint 복구 버그 회귀)
	b.setFrozenUntil = 0;
	b.dotUntil = 0;
	b.dotDps = 0;
	b.slowUntil = 0;
	b.setShockUntil = 0;
	b.setBleedUntil = 0;
	await wait(200);
	ok('상태가 풀리면 원래 색으로 돌아온다', tintOf(b) === bBase, { base: bBase, now: tintOf(b) });

	// ── 5) 피격 플래시 후에도 색이 복구된다 (예전엔 여기서 색이 날아갔다)
	m.applyDot(b, 20, 4000, 0x4ade80); // 중독
	await wait(120);
	const poisonTint = tintOf(b);
	fx.flashSprite(b, 60);
	await wait(300);
	ok('플래시가 끝나면 상태색이 되돌아온다', tintOf(b) === poisonTint,
		{ want: poisonTint, got: tintOf(b) });

	b.dotUntil = 0;
	b.dotDps = 0;
	await wait(160);
	fx.flashSprite(b, 60);
	await wait(300);
	ok('상태가 없으면 플래시 후 원래 색으로 돌아온다', tintOf(b) === bBase,
		{ want: bBase, got: tintOf(b) });

	// 이 아래 두 절은 "프레임에 여유가 있을 때의 동작"을 본다.
	// 샌드박스(SwiftShader)는 정상 상태에서도 fps 가 낮게 잡혀 적응형 감축(fxThrottle 3)이
	// 걸리므로, 오버레이·숫자 검증 동안만 감축을 끈다. 감축 자체는 아래 부하 절에서 본다.
	const realThrottle = fx.fxThrottle.bind(fx);
	fx.fxThrottle = () => 1;

	// ── 6) 지속 오버레이가 실제로 그려진다
	m.applyDot(b, 20, 6000, 0xf97316); // 화상만 (감전은 깜빡이므로 틴트 비교가 흔들린다)
	await wait(220);
	const g = st.overlayGraphics;
	const cmdCount = () => st.overlayGraphics?.commandBuffer?.length ?? 0;
	ok('상태 오버레이 Graphics 가 생성됐다', !!g);
	ok('오버레이가 실제로 도형을 그린다', cmdCount() > 0, { commands: cmdCount() });
	ok('오버레이는 순간 FX(56)·체력바(59) 사이에 온다', g && g.depth === 55, { depth: g?.depth });

	// 화면 밖으로 옮기면 오버레이가 사라진다 (컬링) — 틴트는 남아야 한다
	const homeX = b.x;
	const homeY = b.y;
	b.x = s.player.x + 4000;
	b.y = s.player.y + 4000;
	await wait(260);
	ok('화면 밖 적은 오버레이를 그리지 않는다', cmdCount() === 0, { commands: cmdCount() });
	ok('화면 밖이어도 틴트는 유지된다', tintOf(b) !== bBase, { base: bBase, now: tintOf(b) });
	b.x = homeX;
	b.y = homeY;
	await wait(220);

	// ── 7) 지속 피해 숫자
	// 실제 DoT 틱이 전역 간격 제한을 막 소모했을 수 있으니 화상을 끄고 잠시 기다린다
	b.dotUntil = 0;
	b.dotDps = 0;
	await wait(160);
	const textsBefore = fx.activeTextCount;
	fx.showStatusDamageText(s.player.x, s.player.y - 40, 123, 'burn');
	ok('지속 피해 숫자가 뜬다', fx.activeTextCount > textsBefore,
		{ before: textsBefore, after: fx.activeTextCount });
	// 폭주 방지: 한 프레임에 몰아쳐도 상한을 넘지 않는다
	for (let i = 0; i < 200; i += 1) {
		fx.showStatusDamageText(s.player.x, s.player.y - 40, 9, 'poison');
	}
	ok('지속 피해 숫자가 예산을 넘지 않는다', fx.activeTextCount <= 40,
		{ active: fx.activeTextCount });

	fx.fxThrottle = realThrottle;

	// ── 8) 다수 부하: 40마리에 상태이상을 전부 걸어도 프레임이 크게 떨어지지 않는다
	//     (샌드박스 절대 fps 는 믿을 수 없으므로 **같은 조건의 전/후 비율**로 본다)
	clearAll();
	const enemies = [];
	for (let i = 0; i < 40; i += 1) {
		enemies.push(spawn(Math.cos(i) * 220, Math.sin(i) * 160));
	}
	await wait(2500);
	const fpsClean = s.game.loop.actualFps;

	for (const e of enemies) {
		m.applyDot(e, 10, 12000, e.x > s.player.x ? 0xf97316 : 0x4ade80);
		st.shock(e, 12000);
		st.bleed(e, 6, 12000);
		st.slow(e, 0.4, 12000, { fx: false });
	}
	// 색 판정은 바로 본다 — 라운드 전환(40초)이 끼어들어 필드가 비워지기 전에.
	await wait(250);
	const alive = enemies.filter((e) => e.active && !e.isDying);
	const anyTinted = alive.filter((e) => e.isTinted).length;
	ok('다수 적이 상태색으로 칠해져 있다', alive.length >= 30 && anyTinted === alive.length,
		{ alive: alive.length, tinted: anyTinted });

	await wait(2250);
	const fpsStatus = s.game.loop.actualFps;
	ok('40마리 전원 상태이상이어도 프레임 손실이 25% 미만',
		fpsStatus > fpsClean * 0.75,
		{ clean: Math.round(fpsClean), status: Math.round(fpsStatus) });

	clearAll();
	m.spawningEnabled = true;
	return { checks };
});

const failed = r.checks.filter((c) => !c.pass);
for (const c of r.checks) {
	console.log(`${c.pass ? '  ok' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c)}`}`);
}
console.log(`\n${r.checks.length - failed.length}/${r.checks.length} passed`);
console.log('pageerrors:', errors.length ? errors : 'none');
const pass = failed.length === 0 && errors.length === 0;
console.log(pass ? 'STATUS-FX TEST: PASS' : 'STATUS-FX TEST: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
