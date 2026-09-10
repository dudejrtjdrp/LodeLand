// 이중 궤도(내부/외부 원) 회귀 테스트
// 1) 슬롯 0~2 검은 내부 원(radius×0.8), 슬롯 3~6 검은 외부 원(radius×1.4)을 돈다.
// 2) 외부 원은 역회전(내부와 반대 방향).
// 3) 각 링 안에서 검은 균등 간격으로 분배된다.
// 4) getOrbitPosition(귀환 목표)과 실제 궤도 위치가 일치한다.
// 실행: vite dev(5173) 띄운 뒤 `node orbit-ring-test.mjs`
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2500);
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
await page.waitForTimeout(1200);

const r = await page.evaluate(async () => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const TAU = Math.PI * 2;
	const wrapDelta = (a, b) => ((b - a + Math.PI * 3) % TAU) - Math.PI; // 최단 각도 차

	// 7자루 장착, 출격 금지(궤도 유지) 상태로 기하만 검사
	so.unlockedSlots = 7;
	so.noLaunch = true;
	for (const sw of [...so.swords]) so.removeSword(sw);
	so.minSwords = 0;
	for (let i = 0; i < 7; i++) so.addSword(s);
	await wait(300);

	const innerR = so.radius * so.innerRingRadiusMult; // 기대 내부 반지름
	const outerR = so.radius * so.outerRingRadiusMult; // 기대 외부 반지름

	// 12프레임 샘플링: slot별 (거리, 각도)
	const samples = [];
	for (let i = 0; i < 12; i++) {
		await wait(60);
		samples.push(so.swords.map((sw) => ({
			slot: sw.slot,
			dist: Math.hypot(sw.x - s.player.x, sw.y - s.player.y),
			ang: Math.atan2(sw.y - s.player.y, sw.x - s.player.x),
			state: sw.state,
		})));
	}

	// 1) 반지름: 모든 샘플에서 링별 기대 반지름 ±3px
	let radiusOk = true;
	const badRadius = [];
	for (const frame of samples) {
		for (const p of frame) {
			if (p.state !== 'orbiting') continue;
			const expected = p.slot < so.innerRingSlots ? innerR : outerR;
			if (Math.abs(p.dist - expected) > 3) {
				radiusOk = false;
				badRadius.push({ slot: p.slot, dist: Math.round(p.dist), expected: Math.round(expected) });
			}
		}
	}

	// 2) 회전 방향: slot별 각도 변화 누적 — 내부 양(+), 외부 음(-)
	const drift = {};
	for (let i = 1; i < samples.length; i++) {
		for (const p of samples[i]) {
			const prev = samples[i - 1].find((q) => q.slot === p.slot);
			if (!prev) continue;
			drift[p.slot] = (drift[p.slot] ?? 0) + wrapDelta(prev.ang, p.ang);
		}
	}
	const innerDirOk = [0, 1, 2].every((slot) => (drift[slot] ?? 0) > 0.05);
	const outerDirOk = [3, 4, 5, 6].every((slot) => (drift[slot] ?? 0) < -0.05);

	// 3) 링 내 균등 간격 (마지막 샘플 기준)
	const gapsOf = (slots) => {
		const angles = samples.at(-1)
			.filter((p) => slots.includes(p.slot))
			.map((p) => ((p.ang % TAU) + TAU) % TAU)
			.sort((a, b) => a - b);
		return angles.map((a, i) => {
			const next = angles[(i + 1) % angles.length];
			return ((next - a + TAU) % TAU) || TAU;
		});
	};
	const innerGaps = gapsOf([0, 1, 2]);
	const outerGaps = gapsOf([3, 4, 5, 6]);
	const spacingOk = innerGaps.every((g) => Math.abs(g - TAU / 3) < 0.05)
		&& outerGaps.every((g) => Math.abs(g - TAU / 4) < 0.05);

	// 4) getOrbitPosition(귀환 목표)이 링 반지름과 일치
	let returnTargetOk = true;
	for (const sw of so.swords) {
		const pos = so.getOrbitPosition(s.player, sw);
		const d = Math.hypot(pos.x - s.player.x, pos.y - s.player.y);
		const expected = sw.slot < so.innerRingSlots ? innerR : outerR;
		if (Math.abs(d - expected) > 1) returnTargetOk = false;
	}

	return {
		radius: so.radius, innerR: Math.round(innerR), outerR: Math.round(outerR),
		swordCount: so.swords.length,
		radiusOk, badRadius: badRadius.slice(0, 5),
		innerDirOk, outerDirOk, drift,
		spacingOk, innerGaps: innerGaps.map((g) => +g.toFixed(3)), outerGaps: outerGaps.map((g) => +g.toFixed(3)),
		returnTargetOk,
	};
});

const pass = r.radiusOk && r.innerDirOk && r.outerDirOk && r.spacingOk && r.returnTargetOk && errors.length === 0;
console.log(JSON.stringify(r, null, 1));
console.log('pageerrors:', errors.length ? errors : 'none');
console.log(pass ? 'ORBIT-RING TEST: PASS' : 'ORBIT-RING TEST: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
