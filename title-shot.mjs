// 타이틀 화면 QA 캡처 — 3뷰포트 × (기본 / '출격' 호버).
// Run: node title-shot.mjs [outDir]  (preview 서버가 :5199 에 떠 있어야 한다)
//
// 뷰포트 3종을 도는 이유는 UI 규약: 스케일이 바뀌면 로고·좌측 메뉴·우상단
// 재화 줄이 서로 겹치는지 매번 확인해야 한다 (movesword-ui-scale-qa).
import { chromium } from 'playwright';

const outDir = process.argv[2] ?? 'shots-title';
const { mkdirSync } = await import('node:fs');
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = [
	{ name: '1600x900', width: 1600, height: 900 },
	{ name: '1280x720', width: 1280, height: 720 },
	{ name: '1920x1080', width: 1920, height: 1080 },
];

const browser = await chromium.launch({
	executablePath: process.env.CHROME_BIN,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--disable-crashpad',
		`--crash-dumps-dir=${process.env.CH_DUMPS ?? '/dev/shm/dumps'}`],
});

for (const vp of VIEWPORTS) {
	const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
	await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
	await page.waitForSelector('canvas', { timeout: 20000 });
	await page.waitForTimeout(2800);
	await page.screenshot({ path: `${outDir}/title-${vp.name}.png` });

	// 메뉴 두 번째 줄(대개 '출격') 위로 마우스를 올려 확대·발광 상태를 잡는다.
	const box = await page.evaluate(() => {
		const scene = window.__titleScene;
		if (!scene || !scene.menu || scene.menu.length === 0) return null;
		const entry = scene.menu[Math.min(1, scene.menu.length - 1)];
		const m = entry.root.getWorldTransformMatrix();
		return { x: m.tx, y: m.ty };
	});
	if (box) {
		await page.mouse.move(box.x, box.y);
		await page.waitForTimeout(500);
		await page.screenshot({ path: `${outDir}/title-hover-${vp.name}.png` });
	} else {
		console.warn(`[title-shot] ${vp.name}: __titleScene.menu 훅을 찾지 못했습니다`);
	}
	await page.close();
}

await browser.close();
console.log(`saved to ${outDir}`);
