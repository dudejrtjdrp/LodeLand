/**
 * 배포본(dist) 스모크 테스트.
 * 정적 서버로 띄운 dist를 실제 브라우저로 열어 404·콘솔 에러·캔버스 생성을 확인한다.
 * 사용: node scripts/deploy-smoke.mjs [http://localhost:5199]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5199';
const EXEC = process.env.CHROME_BIN || undefined;

const launchOpts = {
	args: [
		'--no-sandbox',
		'--disable-dev-shm-usage',
		'--no-proxy-server',
		'--disable-crashpad',
		'--use-gl=swiftshader',
		'--enable-unsafe-swiftshader',
	],
};
if (EXEC) launchOpts.executablePath = EXEC;
if (process.env.CRASH_DIR) launchOpts.args.push(`--crash-dumps-dir=${process.env.CRASH_DIR}`);

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const failures = [];
const consoleErrors = [];

// Google Fonts는 index.html 주석대로 실패해도 시스템 폰트로 폴백되는 선택적 리소스다.
// 네트워크 없는 환경에서 잡음만 만들므로 아예 차단해 결과를 결정적으로 만든다.
// abort하면 net::ERR_FAILED 콘솔 에러가 남으므로 빈 응답으로 채운다.
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
	route.fulfill({ status: 200, contentType: 'text/css', body: '' })
);

page.on('requestfailed', (r) => {
	const url = r.url();
	if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return;
	failures.push(`${r.failure()?.errorText ?? 'failed'} ${url}`);
});
page.on('response', (r) => {
	if (r.status() >= 400) failures.push(`HTTP ${r.status()} ${r.url()}`);
});
page.on('console', (m) => {
	if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });

// Phaser가 캔버스를 붙이고 프리로드가 끝날 시간을 준다
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForTimeout(12000);

const info = await page.evaluate(() => {
	const c = document.querySelector('canvas');
	return { hasCanvas: !!c, w: c?.width ?? 0, h: c?.height ?? 0 };
});

await browser.close();

console.log('canvas:', JSON.stringify(info));
console.log(`network failures: ${failures.length}`);
failures.slice(0, 30).forEach((f) => console.log('  ✗', f));
console.log(`console errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 30).forEach((e) => console.log('  ✗', e));

const ok = info.hasCanvas && info.w > 0 && failures.length === 0 && consoleErrors.length === 0;
console.log(ok ? '\nSMOKE PASS' : '\nSMOKE FAIL');
process.exit(ok ? 0 : 1);
