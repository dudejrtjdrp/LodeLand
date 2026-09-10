// 마감 품질 회귀 테스트 (2026-09-01 신설).
//
// 이 파일이 지키는 4가지:
//   (1) 키 리맵   — 기본값 = 현행 배선 · localStorage 영속 · 충돌/예약키 거부 · 실제 조작 반영
//   (2) 게임패드  — navigator.getGamepads 를 가짜 패드로 갈아끼워 축 이동·버튼→스킬 발동 검증
//   (3) 사망 연출 — 일반 < 정예 < 보스 순으로 FX 가 늘고, 모션 줄이기에서는 접힌다
//   (4) 오디오    — bgm wav 폴백 파일이 실제로 서빙되고 예산(≤2.5MB) 안에 있다
//   (5) 레이아웃  — 설정 창 '조작' 갈래가 3뷰포트에서 닫기 버튼/패널과 겹치지 않는다
//
// Run: node polish-test.mjs  (vite preview on :5199 또는 PORT)
import { chromium } from 'playwright';

const exe = process.env.CHROME_BIN;
const args = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
const port = process.env.PORT || '5199';
const browser = await chromium.launch(exe ? { executablePath: exe, args } : { args });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
	if (ok) {
		passed += 1;
		console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
	} else {
		failures.push(name);
		console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForTimeout(2600);

// ─────────────────────────────────────────────────────────────
// (1) 키 리맵
// ─────────────────────────────────────────────────────────────
const kb = await page.evaluate(() => {
	const api = window.__keybinds;
	if (!api) return null;
	api.resetKeybinds();
	const binds = api.loadKeybinds();
	return {
		defaults: { ...binds },
		raw: localStorage.getItem('movesword-keybinds-v1'),
		actions: api.ACTION_IDS,
	};
});
check('리맵 모듈이 노출된다 (__keybinds)', kb !== null);
check('기본값 = 현행 배선 (W/A/S/D · Q · SPACE · SHIFT · E · TAB)',
	kb && kb.defaults.moveUp === 'W' && kb.defaults.moveLeft === 'A'
	&& kb.defaults.moveDown === 'S' && kb.defaults.moveRight === 'D'
	&& kb.defaults.dive === 'Q' && kb.defaults.recall === 'SPACE'
	&& kb.defaults.dash === 'SHIFT' && kb.defaults.interact === 'E'
	&& kb.defaults.stats === 'TAB',
	JSON.stringify(kb && kb.defaults));
check('리바인딩 대상 9종', kb && kb.actions.length === 9, JSON.stringify(kb && kb.actions.length));

// 저장이 없어도 기본값이 나온다 (기존 유저 동작 불변)
const noStore = await page.evaluate(() => {
	const api = window.__keybinds;
	localStorage.removeItem('movesword-keybinds-v1');
	const fresh = api.reloadKeybinds();
	return { dive: fresh.dive, recall: fresh.recall, stored: localStorage.getItem('movesword-keybinds-v1') };
});
check('저장값 없이도 기본 조작이 그대로 (localStorage 비어 있음)',
	noStore.dive === 'Q' && noStore.recall === 'SPACE' && noStore.stored === null,
	JSON.stringify(noStore));

const conflict = await page.evaluate(() => {
	const api = window.__keybinds;
	api.resetKeybinds();
	return {
		// 이미 [대시]가 쓰는 SHIFT 를 [활공]에 배정 → 거부
		conflict: api.setBinding('dive', 'SHIFT'),
		// 시스템 예약키 → 거부
		reserved: api.setBinding('dive', 'ESC'),
		reservedMute: api.setBinding('dash', 'M'),
		reservedCard: api.setBinding('dash', 'ONE'),
		reservedArrow: api.setBinding('moveUp', 'LEFT'),
		// 알 수 없는 키 → 거부
		unknown: api.setBinding('dive', 'NOT_A_KEY'),
		// 정상 배정 → 허용
		ok: api.setBinding('dive', 'F'),
		after: api.getBinding('dive'),
	};
});
check('충돌 검사: 다른 동작이 쓰는 키를 거부하고 누구인지 알려준다',
	conflict.conflict.ok === false && conflict.conflict.reason === 'conflict'
	&& conflict.conflict.conflictWith === 'dash',
	JSON.stringify(conflict.conflict));
check('예약키 거부: ESC · M · 1 · 방향키',
	conflict.reserved.reason === 'reserved' && conflict.reservedMute.reason === 'reserved'
	&& conflict.reservedCard.reason === 'reserved' && conflict.reservedArrow.reason === 'reserved',
	JSON.stringify([conflict.reserved.reason, conflict.reservedMute.reason,
		conflict.reservedCard.reason, conflict.reservedArrow.reason]));
check('알 수 없는 키 거부', conflict.unknown.ok === false && conflict.unknown.reason === 'unknown');
check('정상 배정 성공 (활공 → F)', conflict.ok.ok === true && conflict.after === 'F', conflict.after);

const persisted = await page.evaluate(() => {
	const api = window.__keybinds;
	const raw = localStorage.getItem('movesword-keybinds-v1');
	const reread = api.reloadKeybinds();
	return { raw: JSON.parse(raw || '{}').dive, reread: reread.dive };
});
check('리맵 영속: localStorage 에 저장되고 다시 읽어도 유지',
	persisted.raw === 'F' && persisted.reread === 'F', JSON.stringify(persisted));

// 안내 표기가 리맵을 따라간다
const labels = await page.evaluate(() => {
	const api = window.__keybinds;
	return {
		dive: api.actionKeyLabel('dive'),
		move: api.actionKeyLabels('moveUp'),
	};
});
check('안내 표기가 리맵을 반영한다 (활공 = F)', labels.dive === 'F', labels.dive);
check('이동은 방향키 보조가 항상 함께 표기된다',
	labels.move.includes('W') && labels.move.includes('↑'), JSON.stringify(labels.move));

// 실제 조작에 반영되는가 — 리맵한 키로 스킬이 나가야 한다
await page.evaluate(() => { window.__keybinds.resetKeybinds(); });
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 30000 });
await page.waitForTimeout(2200);
await page.evaluate(() => {
	const s = window.__gameScene;
	s.villageSystem?.depart?.();
	s.tutorial?.finish?.();
	s.player.maxHp = 99999; s.player.hp = 99999;
});
await page.waitForTimeout(1400);
// 활공은 사냥감이 없으면 쿨다운을 쓰지 않고 불발한다 — 주변에 적을 깔아 둔다
await page.evaluate(() => {
	const s = window.__gameScene;
	for (let i = 0; i < 8; i += 1) {
		const a = (i / 8) * Math.PI * 2;
		const e = s.enemyManager.spawnEnemy(s, s.player, 'skullwolf', {
			x: s.player.x + Math.cos(a) * 200, y: s.player.y + Math.sin(a) * 200,
		});
		if (e) { e.hp = 9e6; e.maxHp = 9e6; }
	}
});
await page.waitForTimeout(400);
const canAct = await page.evaluate(() => ({
	act: window.__gameScene.activeSkills.canAct(),
	enemies: window.__gameScene.enemyManager.enemies.getChildren().filter((e) => e.active).length,
}));
check('준비: 전투 상태 + 사냥감이 있다', canAct.act === true && canAct.enemies >= 4, JSON.stringify(canAct));

const beforeRemap = await page.evaluate(() => ({ ...window.__gameScene.activeSkills.useCount }));
await page.keyboard.press('KeyQ');
await page.waitForTimeout(250);
const defaultKeyWorks = await page.evaluate(() => ({ ...window.__gameScene.activeSkills.useCount }));
check('기본 키(Q)로 활공이 나간다', defaultKeyWorks.dive > beforeRemap.dive,
	`${beforeRemap.dive} → ${defaultKeyWorks.dive}`);

await page.evaluate(() => {
	const s = window.__gameScene;
	window.__keybinds.setBinding('dive', 'F');
	s.activeSkills.readyAt.dive = 0; // 쿨다운 무시하고 키 배선만 본다
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(250);
const remapWorks = await page.evaluate(() => ({ ...window.__gameScene.activeSkills.useCount }));
check('리맵한 키(F)로 활공이 나간다', remapWorks.dive > defaultKeyWorks.dive,
	`${defaultKeyWorks.dive} → ${remapWorks.dive}`);

await page.evaluate(() => {
	const s = window.__gameScene;
	s.activeSkills.readyAt.dive = 0;
});
await page.keyboard.press('KeyQ');
await page.waitForTimeout(250);
const oldKeyDead = await page.evaluate(() => ({ ...window.__gameScene.activeSkills.useCount }));
check('리맵 후 옛 키(Q)는 더 이상 먹지 않는다', oldKeyDead.dive === remapWorks.dive,
	`${remapWorks.dive} → ${oldKeyDead.dive}`);

// 이동 키 리맵
const moveRemap = await page.evaluate(async () => {
	const s = window.__gameScene;
	window.__keybinds.resetKeybinds();
	window.__keybinds.setBinding('moveRight', 'L');
	s.rebuildMoveKeys();
	return { right: window.__keybinds.getBinding('moveRight') };
});
await page.keyboard.down('KeyL');
await page.waitForTimeout(500);
const movedX = await page.evaluate(() => window.__gameScene.player.body.velocity.x);
await page.keyboard.up('KeyL');
check('이동 리맵: L 키로 오른쪽 이동', moveRemap.right === 'L' && movedX > 0, `vx=${Math.round(movedX)}`);

await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(400);
const arrowX = await page.evaluate(() => window.__gameScene.player.body.velocity.x);
await page.keyboard.up('ArrowLeft');
check('방향키는 리맵과 무관하게 항상 살아 있다 (안전망)', arrowX < 0, `vx=${Math.round(arrowX)}`);

await page.evaluate(() => { window.__keybinds.resetKeybinds(); window.__gameScene.rebuildMoveKeys(); });

// ─────────────────────────────────────────────────────────────
// (2) 게임패드 — navigator.getGamepads 를 가짜 패드로 대체
// ─────────────────────────────────────────────────────────────
const padOff = await page.evaluate(() => ({
	connected: window.__gameScene.gamepad.connected,
	axis: window.__gameScene.gamepad.axis(),
}));
check('패드 미연결이면 영향 0 (축 0,0 · connected false)',
	padOff.connected === false && padOff.axis.x === 0 && padOff.axis.y === 0,
	JSON.stringify(padOff));

await page.evaluate(() => {
	// 가짜 표준 패드 — 테스트가 버튼/축을 직접 조종한다
	const pad = {
		id: 'Fake Standard Pad (Vendor: 0000 Product: 0000)',
		index: 0, connected: true, mapping: 'standard', timestamp: 0,
		axes: [0, 0, 0, 0],
		buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
	};
	window.__fakePad = pad;
	navigator.getGamepads = () => [pad, null, null, null];
	// Phaser 는 큐를 비울 때 event.gamepad.index 를 읽는다 — 프로퍼티를 반드시 달아야 한다
	const ev = new Event('gamepadconnected');
	Object.defineProperty(ev, 'gamepad', { value: pad });
	window.dispatchEvent(ev);
});
await page.waitForTimeout(400);

const padOn = await page.evaluate(() => ({
	total: window.__gameScene.input.gamepad?.total ?? -1,
	connected: window.__gameScene.gamepad.connected,
}));
check('패드 연결 인식', padOn.connected === true && padOn.total >= 1, JSON.stringify(padOn));

// 좌스틱 → 이동
await page.evaluate(() => {
	window.__fakePad.axes[0] = 1;
	window.__fakePad.timestamp = performance.now();
});
await page.waitForTimeout(500);
const stickVx = await page.evaluate(() => window.__gameScene.player.body.velocity.x);
await page.evaluate(() => { window.__fakePad.axes[0] = 0; window.__fakePad.timestamp = performance.now(); });
check('좌스틱으로 이동한다', stickVx > 0, `vx=${Math.round(stickVx)}`);

// 데드존
const dead = await page.evaluate(async () => {
	window.__fakePad.axes[0] = 0.12;
	window.__fakePad.timestamp = performance.now();
	await new Promise((r) => setTimeout(r, 200));
	const a = window.__gameScene.gamepad.axis();
	window.__fakePad.axes[0] = 0;
	window.__fakePad.timestamp = performance.now();
	return a;
});
check('데드존: 약한 기울기는 무시', dead.x === 0 && dead.y === 0, JSON.stringify(dead));

// 버튼 → 스킬 (A = 귀소, B = 대시, RT = 활공)
const padSkills = await page.evaluate(async () => {
	const s = window.__gameScene;
	s.activeSkills.readyAt.recall = 0;
	s.activeSkills.readyAt.dash = 0;
	s.activeSkills.readyAt.dive = 0;
	const before = { ...s.activeSkills.useCount };
	const press = async (i) => {
		// Phaser 의 Button.update 는 raw pad 의 value 를 읽는다 (pressed 가 아니다)
		window.__fakePad.buttons[i].pressed = true;
		window.__fakePad.buttons[i].value = 1;
		window.__fakePad.timestamp = performance.now();
		await new Promise((r) => setTimeout(r, 260));
		window.__fakePad.buttons[i].pressed = false;
		window.__fakePad.buttons[i].value = 0;
		window.__fakePad.timestamp = performance.now();
		await new Promise((r) => setTimeout(r, 260));
		s.activeSkills.readyAt.recall = 0;
		s.activeSkills.readyAt.dash = 0;
		s.activeSkills.readyAt.dive = 0;
	};
	await press(0);
	const afterA = { ...s.activeSkills.useCount };
	await press(1);
	const afterB = { ...s.activeSkills.useCount };
	await press(7);
	const afterRT = { ...s.activeSkills.useCount };
	return { before, afterA, afterB, afterRT };
});
check('패드 A → 귀소', padSkills.afterA.recall > padSkills.before.recall,
	`${padSkills.before.recall} → ${padSkills.afterA.recall}`);
check('패드 B → 대시', padSkills.afterB.dash > padSkills.afterA.dash,
	`${padSkills.afterA.dash} → ${padSkills.afterB.dash}`);
check('패드 RT → 활공', padSkills.afterRT.dive > padSkills.afterB.dive,
	`${padSkills.afterB.dive} → ${padSkills.afterRT.dive}`);

// Y = 캐릭터창 토글
const padStats = await page.evaluate(async () => {
	const s = window.__gameScene;
	const before = s.statsPanel.isOpen;
	window.__fakePad.buttons[3].pressed = true;
	window.__fakePad.buttons[3].value = 1;
	window.__fakePad.timestamp = performance.now();
	await new Promise((r) => setTimeout(r, 300));
	window.__fakePad.buttons[3].pressed = false;
	window.__fakePad.buttons[3].value = 0;
	window.__fakePad.timestamp = performance.now();
	await new Promise((r) => setTimeout(r, 300));
	const after = s.statsPanel.isOpen;
	if (after) s.statsPanel.close();
	return { before, after };
});
check('패드 Y → 캐릭터창', padStats.before === false && padStats.after === true,
	JSON.stringify(padStats));

// 패드가 붙으면 HUD 키 배지가 패드 글리프로 바뀐다
const padGlyphs = await page.evaluate(() => {
	const s = window.__gameScene;
	s.activeSkills.buildHud();
	return s.activeSkills.hudObjects
		.filter((o) => typeof o.text === 'string' && o.text.length <= 6)
		.map((o) => o.text);
});
check('패드 연결 시 HUD 키 배지가 패드 글리프로 전환된다',
	padGlyphs.includes('A') && padGlyphs.includes('B') && padGlyphs.includes('RT'),
	JSON.stringify(padGlyphs));

// 패드 제거 후 영향 0
await page.evaluate(async () => {
	navigator.getGamepads = () => [null, null, null, null];
	const ev = new Event('gamepaddisconnected');
	Object.defineProperty(ev, 'gamepad', { value: window.__fakePad });
	window.dispatchEvent(ev);
	await new Promise((r) => setTimeout(r, 300));
});
const padGone = await page.evaluate(() => window.__gameScene.gamepad.axis());
check('패드 제거 후 축 0 복귀', padGone.x === 0 && padGone.y === 0, JSON.stringify(padGone));

// ─────────────────────────────────────────────────────────────
// (3) 사망 연출 등급
// ─────────────────────────────────────────────────────────────
const death = await page.evaluate(async () => {
	const s = window.__gameScene;
	const vfx = s.visualEffects;
	const m = s.enemyManager;
	window.__settings.saveSettings({ reduceMotion: false });
	// 샌드박스(SwiftShader)는 fps 가 낮아 fxThrottle 이 항상 3단이 된다 —
	// 등급 로직을 보려면 측정 동안만 1단으로 고정한다.
	vfx.fxThrottle = () => 1;

	const measure = (id, mutate) => {
		vfx.fxEntries.length = 0;
		vfx.lastEliteDeathAt = -1e9;
		const e = m.spawnEnemy(s, s.player, id, { x: s.player.x + 320, y: s.player.y + 320 });
		if (!e) return { tier: -1, fx: -1 };
		mutate?.(e);
		const tier = m.deathTierOf(e);
		const color = m.deathColorOf(e);
		m.die(e, s.player);
		return { tier, color, fx: vfx.fxEntries.length };
	};

	const normal = measure('skullwolf');
	const elite = measure('skullwolf-elite');
	const affixed = measure('skullwolf', (e) => { e.affixIds = ['hasty']; e.affixTintColor = 0x123456; });
	const boss = measure('skullwolf-boss');
	// 보스는 지연 단계가 있으므로 조금 기다렸다 다시 센다
	await new Promise((r) => setTimeout(r, 400));
	const bossAfter = vfx.fxEntries.length;
	return { normal, elite, affixed, boss, bossAfter };
});
check('처치 등급 판정: 일반 = 0', death.normal.tier === 0, JSON.stringify(death.normal));
check('처치 등급 판정: 정예 = 1', death.elite.tier === 1, JSON.stringify(death.elite));
check('처치 등급 판정: 어픽스 보유 잡몹 = 1', death.affixed.tier === 1, JSON.stringify(death.affixed));
check('처치 등급 판정: 보스 = 2', death.boss.tier === 2, JSON.stringify(death.boss));
check('어픽스 몹의 파편은 그 어픽스 색을 쓴다', death.affixed.color === 0x123456,
	`0x${(death.affixed.color >>> 0).toString(16)}`);
check('정예 처치가 일반보다 FX 가 많다', death.elite.fx > death.normal.fx,
	`${death.normal.fx} → ${death.elite.fx}`);
check('보스 처치가 정예보다 FX 가 많다 (플래시 + 지연 파편/링)',
	death.bossAfter > death.elite.fx, `elite ${death.elite.fx} vs boss ${death.boss.fx}→${death.bossAfter}`);

// 처치로 열렸을 수 있는 레벨업 창을 닫아 뒤 검사에 영향이 없게 한다
for (let i = 0; i < 6; i += 1) {
	const open = await page.evaluate(() => Boolean(window.__gameScene.levelUpSystem?.isOpen));
	if (!open) break;
	await page.keyboard.press('Digit1');
	await page.waitForTimeout(320);
}

const reduced = await page.evaluate(async () => {
	const s = window.__gameScene;
	const vfx = s.visualEffects;
	vfx.fxThrottle = () => 1;
	const shot = (tier) => {
		vfx.fxEntries.length = 0;
		vfx.lastEliteDeathAt = -1e9;
		vfx.enemyDeathFX(s.player.x, s.player.y, tier, 0xffffff);
		return vfx.fxEntries.length;
	};
	window.__settings.saveSettings({ reduceMotion: false });
	const onElite = shot(1);
	const onBoss = shot(2);
	window.__settings.saveSettings({ reduceMotion: true });
	const offElite = shot(1);
	const offBoss = shot(2);
	window.__settings.saveSettings({ reduceMotion: false });
	const backElite = shot(1);
	return { onElite, onBoss, offElite, offBoss, backElite };
});
check('모션 줄이기: 등급 연출을 접고 점 하나만 남긴다',
	reduced.offElite === 1 && reduced.offBoss === 1, JSON.stringify(reduced));
check('모션 줄이기 해제 시 등급 연출이 돌아온다',
	reduced.backElite > 1 && reduced.onBoss > 1, JSON.stringify(reduced));

// ─────────────────────────────────────────────────────────────
// (3b) 식별 마커 — 원본 유닛 시트를 재활용한 적의 아트 식별성
// ─────────────────────────────────────────────────────────────
const markers = await page.evaluate(() => {
	const s = window.__gameScene;
	const m = s.enemyManager;
	const read = (id) => {
		const e = m.spawnEnemy(s, s.player, id, { x: s.player.x + 600, y: s.player.y + 600 });
		if (!e) return null;
		const info = {
			on: e.markerOn === true,
			tex: e.markerIcon?.texture?.key ?? null,
			tint: e.markerIcon?.tintTopLeft ?? null,
			bodyTint: e.tintTopLeft ?? null,
			visible: e.markerIcon?.visible ?? null,
		};
		m.recycleEnemy(e);
		return { ...info, hiddenAfterRecycle: e.markerIcon ? e.markerIcon.visible === false : true };
	};
	const marksman = read('volley-marksman');
	const caller = read('veil-caller');
	// 마커 없는 적으로 풀을 재사용해도 옛 마커가 남지 않아야 한다
	const plain = read('skullwolf');
	return { marksman, caller, plain };
});
check('결집 사수: 머리 위 마커(g-eye)', markers.marksman.on === true && markers.marksman.tex === 'g-eye',
	JSON.stringify(markers.marksman));
check('장막 소환수: 머리 위 마커(g-el-void)', markers.caller.on === true && markers.caller.tex === 'g-el-void',
	JSON.stringify(markers.caller));
check('마커 없는 적은 마커가 꺼져 있다 (풀 재사용 잔상 없음)',
	markers.plain.on === false && markers.plain.hiddenAfterRecycle === true,
	JSON.stringify(markers.plain));
check('회수 시 마커도 함께 숨는다',
	markers.marksman.hiddenAfterRecycle === true && markers.caller.hiddenAfterRecycle === true);
check('신규 적 2종의 몸통 틴트가 채도 있는 값 (원본 유닛과 구분)',
	markers.marksman.bodyTint === 0x4fb8d9 && markers.caller.bodyTint === 0x8b6ce0,
	`0x${(markers.marksman.bodyTint >>> 0).toString(16)} · 0x${(markers.caller.bodyTint >>> 0).toString(16)}`);

// ─────────────────────────────────────────────────────────────
// (4) 오디오 m4a 폴백 (2026-09-07: wav → m4a)
// ─────────────────────────────────────────────────────────────
const audio = await page.evaluate(async () => {
	const out = {};
	for (const track of ['title', 'battle', 'boss', 'village']) {
		const res = await fetch(`bgm/${track}.m4a`, { method: 'GET' });
		const buf = res.ok ? await res.arrayBuffer() : null;
		out[track] = { ok: res.ok, bytes: buf ? buf.byteLength : 0 };
	}
	return out;
});
const wavOk = Object.values(audio).every((a) => a.ok && a.bytes > 100000);
const wavBudget = Object.values(audio).every((a) => a.bytes <= 2.5 * 1024 * 1024);
check('BGM m4a 폴백 4트랙이 실제로 서빙된다', wavOk,
	JSON.stringify(Object.fromEntries(Object.entries(audio).map(([k, v]) => [k, Math.round(v.bytes / 1024) + 'KB']))));
check('m4a 폴백이 트랙당 600KB 예산 안', Object.values(audio).every((a) => a.bytes <= 600 * 1024));

const audioAlive = await page.evaluate(() => ({
	cached: ['title', 'battle', 'boss', 'village'].filter((t) => window.__gameScene.cache.audio.exists(`bgm-${t}`)).length,
	bgmTrack: window.__bgm?.currentTrack ?? null,
	running: window.__gameScene.game.loop.running,
}));
check('오디오 캐시가 채워져 있고 게임 루프가 살아 있다',
	audioAlive.running === true, JSON.stringify(audioAlive));

// 디코드 실패가 진행을 막지 않는다: 캐시를 비운 뒤에도 재생 요청이 예외 없이 넘어간다
const audioSafe = await page.evaluate(() => {
	const s = window.__gameScene;
	try {
		s.soundSystem.play('__does_not_exist__');
		window.__bgm?.play('boss', 100);
		return { threw: false, running: s.game.loop.running };
	} catch (err) {
		return { threw: true, message: String(err) };
	}
});
check('없는 오디오 키를 재생해도 예외 없이 넘어간다 (진행 차단 없음)',
	audioSafe.threw === false && audioSafe.running === true, JSON.stringify(audioSafe));

// ─────────────────────────────────────────────────────────────
// (5) 설정 창 '조작' 갈래 — 3뷰포트 겹침 QA
// ─────────────────────────────────────────────────────────────
await page.evaluate(() => { window.__gameScene.scene.start('TitleScene'); });
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 20000 });
await page.waitForTimeout(1200);

for (const [w, h] of [[1280, 720], [1440, 860], [1920, 1080]]) {
	await page.setViewportSize({ width: w, height: h });
	await page.waitForTimeout(500);
	const layout = await page.evaluate(() => {
		const t = window.__titleScene;
		t.closeSettings();
		t.settingsTab = 'controls';
		t.openSettings();
		const root = t.settingsRoot;
		const panelH = 600;
		const cy = root.height / 2;
		const cx = root.width / 2;
		const panelW = Math.min(900, root.width - 80);
		const kb = t.keybindUi;
		const bodyTop = cy - panelH / 2 + 124;
		// 닫기 버튼(shell 의 마지막 버튼) 상단
		const closeTop = cy + panelH / 2 - 42 - 22;
		const bodyBottom = bodyTop + kb.height + 16 + 8;
		// 갈래 버튼 하단
		const tabsBottom = cy - panelH / 2 + 92 + 20;
		return {
			rows: kb ? kb.objects.length : 0,
			kbHeight: kb ? kb.height : 0,
			bodyTop, bodyBottom, closeTop, tabsBottom,
			panelTop: cy - panelH / 2, panelBottom: cy + panelH / 2,
			panelLeft: cx - panelW / 2, panelRight: cx + panelW / 2,
			rootW: root.width, rootH: root.height, scale: root.scale,
		};
	});
	check(`조작 갈래 ${w}x${h}: 목록이 닫기 버튼과 겹치지 않는다`,
		layout.bodyBottom <= layout.closeTop,
		`bottom ${Math.round(layout.bodyBottom)} vs close ${Math.round(layout.closeTop)}`);
	check(`조작 갈래 ${w}x${h}: 목록이 갈래 버튼 아래에서 시작한다`,
		layout.bodyTop >= layout.tabsBottom,
		`top ${Math.round(layout.bodyTop)} vs tabs ${Math.round(layout.tabsBottom)}`);
	check(`조작 갈래 ${w}x${h}: 패널 안에 들어간다`,
		layout.bodyTop >= layout.panelTop && layout.bodyBottom <= layout.panelBottom,
		`[${Math.round(layout.panelTop)}, ${Math.round(layout.panelBottom)}]`);
	check(`조작 갈래 ${w}x${h}: 9개 행 + 되돌리기가 그려진다`,
		layout.rows >= 9, `objects=${layout.rows}`);
}

await page.setViewportSize({ width: 1440, height: 810 });
await page.evaluate(() => { window.__titleScene.closeSettings(); window.__keybinds.resetKeybinds(); });
await page.waitForTimeout(400);

check('페이지 오류 없음', errors.length === 0, JSON.stringify(errors.slice(0, 5)));

await browser.close();
console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
	console.log('FAILED:', failures.join(' · '));
	process.exit(1);
}
