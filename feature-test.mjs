// 신규 기능 검증: Tab 스탯 패널 / 스탯 상한 / 카드 readout / 피드백·필살기 FX
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

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

const results = {};

// 1) Tab 패널 토글
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
results.tabOpens = await page.evaluate(() => window.__gameScene.statsPanel?.isOpen === true);
results.tabRows = await page.evaluate(() => window.__gameScene.statsPanel?.collectRows()?.length ?? 0);
await page.screenshot({ path: process.env.SHOT_DIR + '/stats-panel.png' });
await page.keyboard.press('Tab');
await page.waitForTimeout(200);
results.tabCloses = await page.evaluate(() => window.__gameScene.statsPanel?.isOpen === false);

// 2) 상한: 이동속도를 상한 위로 밀어넣고 적용
results.caps = await page.evaluate(() => {
	const s = window.__gameScene;
	const lus = s.levelUpSystem;
	const out = {};
	const player = s.player;
	const base = player.baseMoveSpeed;

	// 상한 미만 → 선택지 존재
	out.strideAvailableBefore = lus.isUpgradeAvailable({ type: 'moveSpeedMultiplier' });
	// 상한 근처로 세팅 후 적용 → 클램프
	player.moveSpeed = Math.round(base * 1.55);
	lus.applyChoice({ upgrade: { type: 'moveSpeedMultiplier', name: 'STRIDE', descTemplate: '' }, rarity: { id: 'common', name: 'IRON', color: '#fff' }, value: 0.3, swordDefinition: null });
	out.moveSpeedAfter = player.moveSpeed;
	out.moveSpeedCap = Math.round(base * 1.6);
	out.clamped = player.moveSpeed <= base * 1.6 + 1e-6;
	// 상한 도달 → 선택지 제외
	out.strideAvailableAfter = lus.isUpgradeAvailable({ type: 'moveSpeedMultiplier' });

	// 쿨다운 하한
	const orbit = s.swordOrbit;
	orbit.cooldownMultiplier = 0.36;
	lus.applyChoice({ upgrade: { type: 'cooldownReduction', name: 'QUICKEN', descTemplate: '' }, rarity: { id: 'common', name: 'IRON', color: '#fff' }, value: 0.3, swordDefinition: null });
	out.cooldownAfter = orbit.cooldownMultiplier;
	out.cooldownFloorOk = orbit.cooldownMultiplier >= 0.35 - 1e-6;
	out.quickenAvailableAfter = lus.isUpgradeAvailable({ type: 'cooldownReduction' });

	// 궤도 속도 상한
	orbit.orbitSpeed = orbit.baseOrbitSpeed * 2.45;
	lus.applyChoice({ upgrade: { type: 'orbitSpeedMultiplier', name: 'FAST ORBIT', descTemplate: '' }, rarity: { id: 'common', name: 'IRON', color: '#fff' }, value: 0.5, swordDefinition: null });
	out.orbitSpeedOk = orbit.orbitSpeed <= orbit.baseOrbitSpeed * 2.5 + 1e-6;
	return out;
});

// 3) readout: 값 형태 확인
results.readouts = await page.evaluate(() => {
	const lus = window.__gameScene.levelUpSystem;
	const mk = (type, value) => lus.readoutForChoice({ upgrade: { type, descTemplate: '' }, rarity: { id: 'rare' }, value, swordDefinition: null });
	return {
		damage: mk('damageMultiplier', 0.22),
		orbitSpeed: mk('orbitSpeedMultiplier', 0.18),
		crit: mk('critChanceAdd', 0.08),
		addSword: mk('addSword', 0),
	};
});

// 4) FX 스모크: 피드백/필살기/스페셜 — 예외 없이 실행되는지
results.fxOk = await page.evaluate(() => {
	const s = window.__gameScene;
	try {
		s.visualEffects.upgradeFeedbackFX({ type: 'orbitRadiusMultiplier', name: 'WIDE ORBIT', rarityColor: '#63a7cf', desc: '+15%' });
		s.visualEffects.upgradeFeedbackFX({ type: 'damageMultiplier', name: 'SHARPEN', rarityColor: '#d9a83c', desc: '+70%' });
		s.visualEffects.upgradeFeedbackFX({ type: 'magnetMultiplier', name: 'MAGNET', rarityColor: '#8fbf52', desc: '+25%' });
		s.visualEffects.specialProcFX(s.player.x + 60, s.player.y, 'burn');
		s.visualEffects.specialProcFX(s.player.x + 80, s.player.y, 'midas');
		s.visualEffects.specialProcFX(s.player.x + 40, s.player.y, 'execute');
		s.visualEffects.ultimateCalloutFX('fire', s.player.x, s.player.y);
		s.swordOrbit.castUltimate('fire', s.player);
		s.swordOrbit.castUltimate('electric', s.player);
		s.swordOrbit.castUltimate('void', s.player);
		return true;
	} catch (e) {
		return `FX_ERROR: ${e.message}`;
	}
});
await page.waitForTimeout(300);
await page.screenshot({ path: process.env.SHOT_DIR + '/fx-burst.png' });

// 5) 레벨업 카드 (readout 줄 포함) 스크린샷
await page.evaluate(() => { window.__gameScene.levelUpSystem.enqueue(); });
await page.waitForTimeout(700);
results.levelUpOpen = await page.evaluate(() => window.__gameScene.levelUpSystem.isOpen);
await page.screenshot({ path: process.env.SHOT_DIR + '/levelup-cards.png' });
await page.keyboard.press('1');
await page.waitForTimeout(900);
await page.screenshot({ path: process.env.SHOT_DIR + '/pick-feedback.png' });

await browser.close();

results.errors = errors.filter((m) => !m.includes('Proxy Authentication Required') && !m.includes('Failed to load resource') && !m.includes('GL Driver'));
console.log(JSON.stringify(results, null, 2));
const failed = !results.tabOpens || !results.tabCloses || !results.caps.clamped || !results.caps.cooldownFloorOk
	|| !results.caps.orbitSpeedOk || results.caps.strideAvailableAfter !== false || results.fxOk !== true
	|| !results.levelUpOpen || results.errors.length > 0;
process.exit(failed ? 1 : 0);
