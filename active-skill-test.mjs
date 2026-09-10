// 능동 스킬 · 타격감 회귀 테스트 (2026-09-01 신설).
// 검증: (1) 카탈로그 수치가 코드가 아니라 data 에서 온다
//       (2) 활공 사냥 — 강제 STRIKE · +30% 보너스 부여 · 쿨다운 · 헛발질 시 쿨다운 미소모
//       (3) 귀소 — 전원 RETURN · 넉백 · 0.5초 피해 무효 창(들어갔다 나온다)
//       (4) 대시 — 실제 이동량 ~120px · 쿨다운
//       (5) 히트스톱 — physics.pause 를 쓰지 않고 시간 배율만 · 반드시 1로 복원 · 설정 토글
//       (6) 잠금 — 대기마을/일시정지 중에는 발동하지 않는다
//       (7) HUD — 쿨다운 아이콘 3개 · 3뷰포트 겹침 없음
// Run: node active-skill-test.mjs  (vite preview :5197 필요, PORT env 로 변경 가능)
import { chromium } from 'playwright';

const PORT = process.env.PORT || 5197;
const results = [];
const check = (name, ok, detail = '') => {
	results.push([name, ok, detail]);
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
	executablePath: process.env.CHROME_BIN || undefined,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-gpu'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (err) => errors.push(err.message));
await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 무시 */ } });
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
await page.waitForTimeout(2600);

// 전투 상태로 고정: 대기마을이면 출발하고, 레벨업 오버레이(전투 update 를 멈춘다)는 봉인한다.
await page.evaluate(() => {
	const s = window.__gameScene;
	if (s.villageSystem?.isActive) s.villageSystem.depart();
	s.progression.xpToNext = 999999999;
	if (s.levelUpSystem?.isOpen) { s.levelUpSystem.pendingChoices = 0; s.levelUpSystem.close(); }
	s.tutorial?.finish?.();
	s.player.maxHp = 100000;
	s.player.hp = 100000;
});
await page.waitForTimeout(900);

/** 플레이어 주변에 사냥감을 깔고, 검을 최대한 늘려 무리 판정을 만든다. */
const seedCombat = async (count = 8) => page.evaluate((n) => {
	const s = window.__gameScene;
	const orbit = s.swordOrbit;
	// 검 3자루 이상 — "무리 전체" 판정을 보려면 1자루로는 부족하다
	const defs = orbit.swordCatalog ?? [];
	while (orbit.swords.length < 4 && defs.length > 0) {
		if (orbit.swords.length >= orbit.getEffectiveMaxSwords()) orbit.unlockSlot();
		orbit.addSword(s, defs[orbit.swords.length % defs.length]);
	}
	const spawned = [];
	for (let i = 0; i < n; i += 1) {
		const a = (Math.PI * 2 * i) / n;
		const e = s.enemyManager.spawnEnemy(s, s.player, 'skullwolf', {
			x: s.player.x + Math.cos(a) * 150,
			y: s.player.y + Math.sin(a) * 150,
		});
		if (e) { e.hp = 999999; e.maxHp = 999999; spawned.push(true); }
	}
	return { swords: orbit.swords.length, enemies: spawned.length };
}, count);

// ─────────────────────────────────────────────────────────────
// (1) 카탈로그 — 수치는 코드가 아니라 data/skillCatalog.json 에서 온다
// ─────────────────────────────────────────────────────────────
const cat = await page.evaluate(() => {
	const c = window.__gameScene.activeSkills.catalog;
	return JSON.parse(JSON.stringify(c));
});
check('카탈로그: 활공 사냥 8초 · +30%',
	cat.dive.cooldownMs === 8000 && cat.dive.damageBonus === 0.3, JSON.stringify(cat.dive.keys));
check('카탈로그: 귀소 12초 · 무적 500ms',
	cat.recall.cooldownMs === 12000 && cat.recall.invulnerableMs === 500, JSON.stringify(cat.recall.keys));
check('카탈로그: 대시 120px / 150ms / 3초',
	cat.dash.distance === 120 && cat.dash.durationMs === 150 && cat.dash.cooldownMs === 3000,
	JSON.stringify(cat.dash.keys));
check('카탈로그: 키 배선 = Q · SPACE · SHIFT',
	cat.dive.keys[0] === 'Q' && cat.recall.keys[0] === 'SPACE' && cat.dash.keys[0] === 'SHIFT');
check('카탈로그: 히트스톱 처치 1~2프레임 · 대형 3프레임',
	cat.hitStop.killMs <= 34 && cat.hitStop.bigKillMs >= 34 && cat.hitStop.bigKillMs <= 60,
	JSON.stringify(cat.hitStop));

// ─────────────────────────────────────────────────────────────
// (2) 활공 사냥 — 강제 STRIKE
// ─────────────────────────────────────────────────────────────
const seeded = await seedCombat(8);
check('준비: 검 4자루 · 사냥감 8마리', seeded.swords >= 3 && seeded.enemies >= 6, JSON.stringify(seeded));
await page.waitForTimeout(400);

// 커서를 화면 오른쪽에 두고 발동 (커서 방향 판정 경로를 태운다)
await page.mouse.move(1100, 430);
await page.waitForTimeout(120);

const dive = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	// 궤도로 되돌려 "강제" 여부를 분명히 본다
	for (const sw of s.swordOrbit.swords) s.swordOrbit.startReturningSword(sw);
	for (const sw of s.swordOrbit.swords) { sw.state = 'orbiting'; sw.target = null; }
	const before = a.useCount.dive;
	const ok = a.useDive();
	const swords = s.swordOrbit.swords.map((sw) => ({
		state: sw.state,
		hasTarget: Boolean(sw.target),
		mult: sw._diveBonusMult ?? 0,
		window: (sw._diveBonusUntil ?? 0) - s.time.now,
	}));
	return { ok, used: a.useCount.dive - before, swords, remaining: a.remainingMs('dive'), cd: a.cooldownMs('dive') };
});
check('활공: 발동 성공', dive.ok === true && dive.used === 1, JSON.stringify(dive.ok));
check('활공: 무리 전체 강제 STRIKE(launched)',
	dive.swords.length > 0 && dive.swords.every((sw) => sw.state === 'launched' && sw.hasTarget),
	JSON.stringify(dive.swords.map((sw) => sw.state)));
check('활공: 이 출격에만 +30% 배율 부여',
	dive.swords.every((sw) => Math.abs(sw.mult - 1.3) < 1e-6),
	JSON.stringify(dive.swords.map((sw) => sw.mult)));
check('활공: 보너스 창이 유한하다 (영구 버프 아님)',
	dive.swords.every((sw) => sw.window > 0 && sw.window <= 1700),
	JSON.stringify(dive.swords.map((sw) => Math.round(sw.window))));
check('활공: 쿨다운 시작', dive.remaining > 0 && dive.remaining <= dive.cd,
	`${Math.round(dive.remaining)}/${dive.cd}ms`);

const diveAgain = await page.evaluate(() => {
	const a = window.__gameScene.activeSkills;
	const before = a.useCount.dive;
	return { ok: a.useDive(), used: a.useCount.dive - before };
});
check('활공: 쿨다운 중 재발동 차단', diveAgain.ok === false && diveAgain.used === 0);

// 사냥감이 없으면 쿨다운을 소모하지 않는다 (헛발질로 8초를 잃지 않게)
const whiff = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	for (const e of s.enemyManager.enemies.getChildren()) s.enemyManager.recycleEnemy(e);
	s.enemyManager.gridBuiltAt = -1;
	a.readyAt.dive = 0;
	const before = a.useCount.dive;
	const ok = a.useDive();
	return { ok, used: a.useCount.dive - before, remaining: a.remainingMs('dive') };
});
check('활공: 사냥감 없으면 쿨다운 미소모',
	whiff.ok === false && whiff.used === 0 && whiff.remaining === 0, JSON.stringify(whiff));

// ─────────────────────────────────────────────────────────────
// (3) 귀소 — 전원 RETURN + 넉백 + 무적 창
// ─────────────────────────────────────────────────────────────
await seedCombat(8);
await page.waitForTimeout(500);
const recall = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	a.readyAt.dive = 0;
	a.readyAt.recall = 0;
	a.useDive(); // 전부 나가 있는 상태를 만든다
	const launched = s.swordOrbit.swords.filter((sw) => sw.state === 'launched').length;
	const nearby = s.enemyManager.queryRadius(s.player.x, s.player.y, 200, []).slice(0, 6);
	for (const e of nearby) e.setVelocity(0, 0);
	const beforeSpeeds = nearby.map((e) => Math.hypot(e.body.velocity.x, e.body.velocity.y));

	const ok = a.useRecall();
	const afterSpeeds = nearby.map((e) => Math.hypot(e.body.velocity.x, e.body.velocity.y));
	return {
		ok,
		launched,
		states: s.swordOrbit.swords.map((sw) => sw.state),
		bonusCleared: s.swordOrbit.swords.every((sw) => (sw._diveBonusUntil ?? 0) === 0),
		invulnFor: s.player.invulnerableUntil - s.time.now,
		sweepFor: a.recallSweepUntil - s.time.now,
		pushed: afterSpeeds.filter((v, i) => v > beforeSpeeds[i] + 40).length,
		nearby: nearby.length,
	};
});
check('귀소: 발동 성공', recall.ok === true);
check('귀소: 나가 있던 검 전부 RETURN',
	recall.launched > 0 && recall.states.every((st) => st === 'returning' || st === 'orbiting'),
	JSON.stringify(recall.states));
check('귀소: 활공 보너스 해제 (방어 행동)', recall.bonusCleared === true);
check('귀소: 0.5초 피해 무효 창 설정',
	recall.invulnFor > 400 && recall.invulnFor <= 520, `${Math.round(recall.invulnFor)}ms`);
check('귀소: 귀환 궤적 넉백 창 열림', recall.sweepFor > 0, `${Math.round(recall.sweepFor)}ms`);
check('귀소: 시전 즉시 주변 적 밀어냄',
	recall.nearby === 0 || recall.pushed >= 1, `${recall.pushed}/${recall.nearby}`);

// 무적 창 "안" — 피해가 들어오지 않는다
const invulnIn = await page.evaluate(() => {
	const s = window.__gameScene;
	s.player.hp = 50000;
	const before = s.player.hp;
	s.applyPlayerDamage(500, s.player.x + 10, s.player.y, 'physical', '테스트');
	return { before, after: s.player.hp };
});
check('귀소: 무적 창 안에서는 피해 무효', invulnIn.after === invulnIn.before,
	`${invulnIn.before}→${invulnIn.after}`);

// 무적 창 "밖" — 다시 피해가 들어온다 (무적이 영구화되지 않았다)
await page.waitForTimeout(900);
const invulnOut = await page.evaluate(() => {
	const s = window.__gameScene;
	s.player.invulnerableUntil = 0;
	s.player.dodgeChance = 0;
	const before = s.player.hp;
	s.applyPlayerDamage(500, s.player.x + 10, s.player.y, 'physical', '테스트');
	return { before, after: s.player.hp };
});
check('귀소: 창이 지나면 다시 피해를 받는다', invulnOut.after < invulnOut.before,
	`${invulnOut.before}→${invulnOut.after}`);

const recallAgain = await page.evaluate(() => {
	const a = window.__gameScene.activeSkills;
	const before = a.useCount.recall;
	return { ok: a.useRecall(), used: a.useCount.recall - before, remaining: a.remainingMs('recall') };
});
check('귀소: 쿨다운 중 재발동 차단',
	recallAgain.ok === false && recallAgain.used === 0 && recallAgain.remaining > 0,
	`${Math.round(recallAgain.remaining)}ms`);

// ─────────────────────────────────────────────────────────────
// (4) 대시 — 실제 이동량
// ─────────────────────────────────────────────────────────────
const dashStart = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	// 적이 밀어붙여 이동량이 흐려지지 않게 비운다
	for (const e of s.enemyManager.enemies.getChildren()) s.enemyManager.recycleEnemy(e);
	s.enemyManager.gridBuiltAt = -1;
	s.player.setVelocity(0, 0);
	s.player.knockbackUntil = 0;
	a.readyAt.dash = 0;
	const from = { x: s.player.x, y: s.player.y };
	const ok = a.useDash();
	return { ok, from, dashing: a.isDashing, dashFor: a.dashUntil - s.time.now };
});
check('대시: 발동 성공', dashStart.ok === true && dashStart.dashing === true);
check('대시: 지속 ~0.15초', dashStart.dashFor > 100 && dashStart.dashFor <= 160,
	`${Math.round(dashStart.dashFor)}ms`);

await page.waitForTimeout(420);
const dashEnd = await page.evaluate((from) => {
	const s = window.__gameScene;
	return {
		dist: Math.hypot(s.player.x - from.x, s.player.y - from.y),
		dashing: s.activeSkills.isDashing,
		remaining: s.activeSkills.remainingMs('dash'),
	};
}, dashStart.from);
check('대시: 이동량 ≈120px', dashEnd.dist >= 90 && dashEnd.dist <= 175, `${Math.round(dashEnd.dist)}px`);
check('대시: 시간이 지나면 종료', dashEnd.dashing === false);
check('대시: 쿨다운 진행 중', dashEnd.remaining > 0 && dashEnd.remaining <= 3000,
	`${Math.round(dashEnd.remaining)}ms`);
const dashAgain = await page.evaluate(() => {
	const a = window.__gameScene.activeSkills;
	const before = a.useCount.dash;
	return { ok: a.useDash(), used: a.useCount.dash - before };
});
check('대시: 쿨다운 중 재발동 차단', dashAgain.ok === false && dashAgain.used === 0);

// ─────────────────────────────────────────────────────────────
// (5) 히트스톱 — 시간 배율 방식 (physics.pause 금지) · 반드시 복원
// ─────────────────────────────────────────────────────────────
const stopOn = await page.evaluate(() => {
	const s = window.__gameScene;
	s.visualEffects.releaseHitStop();
	s.visualEffects.hitStop(60, { force: true });
	return {
		physics: s.physics.world.timeScale,
		tweens: s.tweens.timeScale,
		anims: s.anims.globalTimeScale,
		paused: s.physics.world.isPaused === true,
		active: s.visualEffects.hitStopActive,
		slowFactor: s.activeSkills.catalog.hitStop.slowFactor,
	};
});
check('히트스톱: 발동 시 물리 시간 배율 감속',
	stopOn.physics === stopOn.slowFactor && stopOn.active === true, JSON.stringify(stopOn));
check('히트스톱: 트윈·애니메이션도 함께 감속',
	Math.abs(stopOn.tweens - 1 / stopOn.slowFactor) < 1e-6
	&& Math.abs(stopOn.anims - 1 / stopOn.slowFactor) < 1e-6,
	`${stopOn.tweens}/${stopOn.anims}`);
check('히트스톱: physics.pause 를 쓰지 않는다 (재시작 프리즈 회귀 방지)',
	stopOn.paused === false);

await page.waitForTimeout(600);
const stopOff = await page.evaluate(() => {
	const s = window.__gameScene;
	return {
		physics: s.physics.world.timeScale,
		tweens: s.tweens.timeScale,
		anims: s.anims.globalTimeScale,
		active: s.visualEffects.hitStopActive,
		paused: s.physics.world.isPaused === true,
	};
});
check('히트스톱: 시간 배율 전부 1로 복원',
	stopOff.physics === 1 && stopOff.tweens === 1 && stopOff.anims === 1 && stopOff.active === false,
	JSON.stringify(stopOff));
check('히트스톱: 해제 후에도 월드가 멈추지 않는다', stopOff.paused === false);

// 감시자: 복구 타이머를 놓쳐 배율이 남아도 다음 프레임에 되돌린다
await page.evaluate(() => {
	const s = window.__gameScene;
	s.visualEffects.hitStopActive = false;
	s.physics.world.timeScale = 24;
	s.tweens.timeScale = 1 / 24;
});
await page.waitForTimeout(400);
const watchdog = await page.evaluate(() => {
	const s = window.__gameScene;
	return { physics: s.physics.world.timeScale, tweens: s.tweens.timeScale };
});
check('히트스톱: 잔류 배율을 감시자가 복원',
	watchdog.physics === 1 && watchdog.tweens === 1, JSON.stringify(watchdog));

// 설정 토글 — 일시정지 메뉴의 "히트스톱" 버튼을 실제로 눌러 끈다
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const togglePos = await page.evaluate(() => {
	const s = window.__gameScene;
	let found = null;
	const visit = (obj) => {
		if (found) return;
		if (typeof obj.text === 'string' && obj.text.includes('히트스톱') && obj.parentContainer) {
			const m = obj.parentContainer.getWorldTransformMatrix();
			found = { x: m.tx, y: m.ty, label: obj.text };
			return;
		}
		if (obj.list) obj.list.forEach(visit);
	};
	s.children.list.forEach(visit);
	return found;
});
check('설정: 일시정지 메뉴에 히트스톱 토글 존재', Boolean(togglePos), togglePos?.label ?? '');
if (togglePos) {
	await page.mouse.move(togglePos.x, togglePos.y);
	await page.waitForTimeout(120);
	await page.mouse.down();
	await page.waitForTimeout(80);
	await page.mouse.up();
	await page.waitForTimeout(400);
	const toggled = await page.evaluate(() => {
		const raw = localStorage.getItem('movesword-settings-v1');
		return { stored: raw, off: /"hitStop":false/.test(raw ?? '') };
	});
	check('설정: 토글이 localStorage 에 기록', toggled.off === true, toggled.stored ?? '');

	await page.keyboard.press('Escape');
	await page.waitForTimeout(600);
	const disabled = await page.evaluate(() => {
		const s = window.__gameScene;
		s.visualEffects.hitStop(60, { force: true });
		return {
			physics: s.physics.world.timeScale,
			active: s.visualEffects.hitStopActive,
		};
	});
	check('설정: 히트스톱 끄면 발동하지 않는다',
		disabled.physics === 1 && disabled.active === false, JSON.stringify(disabled));

	// 되돌린다 (뒤 검사에 영향 주지 않게)
	await page.keyboard.press('Escape');
	await page.waitForTimeout(700);
	const backPos = await page.evaluate(() => {
		const s = window.__gameScene;
		let found = null;
		const visit = (obj) => {
			if (found) return;
			if (typeof obj.text === 'string' && obj.text.includes('히트스톱') && obj.parentContainer) {
				const m = obj.parentContainer.getWorldTransformMatrix();
				found = { x: m.tx, y: m.ty };
				return;
			}
			if (obj.list) obj.list.forEach(visit);
		};
		s.children.list.forEach(visit);
		return found;
	});
	if (backPos) {
		await page.mouse.move(backPos.x, backPos.y);
		await page.mouse.down();
		await page.waitForTimeout(80);
		await page.mouse.up();
		await page.waitForTimeout(300);
	}
	await page.keyboard.press('Escape');
	await page.waitForTimeout(600);
}

// ─────────────────────────────────────────────────────────────
// (6) 잠금 — 대기마을 · 일시정지 중에는 발동하지 않는다
// ─────────────────────────────────────────────────────────────
const locked = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	a.readyAt.dive = 0; a.readyAt.recall = 0; a.readyAt.dash = 0;
	const wasVillage = s.villageSystem.isActive;
	s.villageSystem.isActive = true;
	const inVillage = { dive: a.useDive(), recall: a.useRecall(), dash: a.useDash(), can: a.canAct() };
	s.villageSystem.isActive = wasVillage;
	const wasPaused = s.isPaused;
	s.isPaused = true;
	const inPause = { dive: a.useDive(), recall: a.useRecall(), dash: a.useDash(), can: a.canAct() };
	s.isPaused = wasPaused;
	return { inVillage, inPause, restored: a.canAct() };
});
check('잠금: 대기마을 중에는 스킬이 잠긴다 (SPACE 출발과 충돌 없음)',
	locked.inVillage.can === false && !locked.inVillage.dive
	&& !locked.inVillage.recall && !locked.inVillage.dash, JSON.stringify(locked.inVillage));
check('잠금: 일시정지 중에는 스킬이 잠긴다',
	locked.inPause.can === false && !locked.inPause.dive
	&& !locked.inPause.recall && !locked.inPause.dash, JSON.stringify(locked.inPause));
check('잠금: 상황이 끝나면 다시 풀린다', locked.restored === true);

// 키 배선 — 실제 키 입력으로도 도는가 (Q / SHIFT)
await seedCombat(6);
await page.waitForTimeout(400);
const beforeKeys = await page.evaluate(() => {
	const a = window.__gameScene.activeSkills;
	a.readyAt.dive = 0; a.readyAt.dash = 0;
	return { dive: a.useCount.dive, dash: a.useCount.dash };
});
await page.keyboard.press('q');
await page.waitForTimeout(200);
await page.keyboard.press('Shift');
await page.waitForTimeout(200);
const afterKeys = await page.evaluate(() => {
	const a = window.__gameScene.activeSkills;
	return { dive: a.useCount.dive, dash: a.useCount.dash };
});
check('키 배선: Q → 활공 사냥', afterKeys.dive > beforeKeys.dive,
	`${beforeKeys.dive}→${afterKeys.dive}`);
check('키 배선: SHIFT → 대시', afterKeys.dash > beforeKeys.dash,
	`${beforeKeys.dash}→${afterKeys.dash}`);

// ─────────────────────────────────────────────────────────────
// (7) HUD — 쿨다운 아이콘 3개 · 3뷰포트 겹침 QA
// ─────────────────────────────────────────────────────────────
const hudProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const a = s.activeSkills;
	a.readyAt.dive = s.time.now + 5000;
	a.readyAt.dash = 0;
	a.readyAt.recall = 0;
	a.update(16);
	const texts = [];
	const visit = (o) => {
		if (typeof o.text === 'string' && o.text.length > 0) texts.push(o.text);
		if (o.list) o.list.forEach(visit);
	};
	s.children.list.forEach(visit);
	return {
		rects: ['dive', 'recall', 'dash'].map((id) => a.iconRect(id)),
		labels: texts.filter((t) => /활공|귀소|대시/.test(t)),
	};
});
check('HUD: 스킬 아이콘 3칸 생성',
	hudProbe.rects.every((r) => r && r.w > 0 && r.h > 0), JSON.stringify(hudProbe.rects[0]));
check('HUD: 키 + 이름 라벨 표기', hudProbe.labels.length >= 3, JSON.stringify(hudProbe.labels));
const hudTimer = await page.evaluate(() => {
	const a = window.__gameScene.activeSkills;
	return {
		dive: a.icons.dive?.timer?.text ?? '',
		veil: a.icons.dive?.veil?.displayHeight ?? 0,
		ready: a.icons.dash?.timer?.text ?? '',
	};
});
check('HUD: 쿨다운 남은 초 · 가림막 표시',
	/^[1-9]$/.test(hudTimer.dive) && hudTimer.veil > 0, JSON.stringify(hudTimer));
check('HUD: 준비된 스킬은 숫자 없음', hudTimer.ready === '', JSON.stringify(hudTimer.ready));

const hidden = await page.evaluate(() => {
	const s = window.__gameScene;
	s.setGameHudVisible(false);
	const off = (s.activeSkills.hudObjects ?? []).every((o) => o.visible === false);
	s.setGameHudVisible(true);
	const on = (s.activeSkills.hudObjects ?? []).some((o) => o.visible === true);
	return { off, on };
});
check('HUD: 오버레이가 열리면 숨고 닫히면 돌아온다', hidden.off === true && hidden.on === true,
	JSON.stringify(hidden));

const overlaps = (a, b) => a && b
	&& a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [w, h] of [[1280, 720], [1440, 860], [1920, 1080]]) {
	await page.setViewportSize({ width: w, height: h });
	await page.waitForTimeout(900);
	const layout = await page.evaluate(() => {
		const s = window.__gameScene;
		const a = s.activeSkills;
		return {
			w: s.scale.width,
			h: s.scale.height,
			icons: ['dive', 'recall', 'dash'].map((id) => a.iconRect(id)),
			hp: s.hudSystem.hpBarRect,
			// 검 칸(좌하단) 실측 사각형 — Graphics 등 크기가 없는 요소는 건너뛴다
			swordIcons: (s.swordOrbit.hudIcons ?? [])
				.filter((i) => Number.isFinite(i.displayWidth) && i.displayWidth > 0
					&& Number.isFinite(i.displayHeight) && i.displayHeight > 0)
				.map((i) => ({
					x: i.x - i.displayWidth * (i.originX ?? 0.5),
					y: i.y - i.displayHeight * (i.originY ?? 0.5),
					w: i.displayWidth, h: i.displayHeight,
				})),
		};
	});
	const icons = layout.icons;
	const inScreen = icons.every((r) => r && r.x >= 0 && r.y >= 0
		&& r.x + r.w <= layout.w + 1 && r.y + r.h <= layout.h + 1);
	const vsHp = icons.every((r) => !overlaps(r, layout.hp));
	const vsSwords = icons.every((r) => layout.swordIcons.every((sr) => !overlaps(r, sr)));
	const vsSelf = icons.every((r, i) => icons.every((o, j) => i === j || !overlaps(r, o)));
	check(`HUD ${w}×${h}: 화면 안 · 체력바/검칸/서로 겹침 없음`,
		inScreen && vsHp && vsSwords && vsSelf,
		JSON.stringify({ inScreen, vsHp, vsSwords, vsSelf, icons: icons.map((r) => r && Math.round(r.x)) }));
}
await page.setViewportSize({ width: 1440, height: 860 });
await page.waitForTimeout(600);

// 정리 후 시간 배율이 남아 있지 않은지 최종 확인
const finalScale = await page.evaluate(() => {
	const s = window.__gameScene;
	return { physics: s.physics.world.timeScale, tweens: s.tweens.timeScale, anims: s.anims.globalTimeScale };
});
check('마무리: 시간 배율 잔류 없음',
	finalScale.physics === 1 && finalScale.tweens === 1 && finalScale.anims === 1,
	JSON.stringify(finalScale));

check('페이지 오류 없음', errors.length === 0, JSON.stringify(errors.slice(0, 4)));

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
	console.log('FAILED:', failed.map(([n]) => n).join(' | '));
	process.exit(1);
}
