// 재도전 지갑 회귀 테스트 (2026-09-08 신설).
// 버그: 죽어서 대기마을로 돌아오면 골드가 "죽기 직전 값"에 못 박혀, 마을에서 쓰든
//       다음 도전에서 벌든 다시 같은 값으로 되살아났다. 원인 두 가지 —
//   (A) 재도전이 `스냅샷 + max(0, 사망골드 − 스냅샷)` 으로 지갑을 되감았다.
//       사망 골드가 스냅샷보다 적으면(마을에서 쓰고 죽으면) 스냅샷 값이 부활한다.
//   (B) 에다(능력치)·증강 제단 구매는 RunSave 를 다시 찍지 않아 스냅샷이 마을 입장
//       시점에 머물렀다 — 그래서 (A)가 되살리는 값이 늘 "그 라운드 시작 골드"였다.
// 검증: (1) 게이트 출발 시 스냅샷이 마을에서 쓴 골드까지 반영하는가
//       (2) 재도전 후 지갑이 사망 시점 잔액 그대로인가 (되감기 없음)
//       (3) 다시 죽어도 예전 값이 되살아나지 않는가
// Run: node retry-gold-test.mjs   (vite preview :5197 필요, PORT env 로 변경 가능)
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
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(2400);

const snapshotGold = () => page.evaluate(() => {
	const raw = localStorage.getItem('movesword-run-v1');
	return raw ? JSON.parse(raw).runGold : null;
});
const walletGold = () => page.evaluate(() => window.__gameScene.pickupSystem.runGold);

// 죽을 때까지 때린다 (부활은 끈다)
const killPlayer = async () => {
	await page.evaluate(() => {
		const s = window.__gameScene;
		s.revivalsLeft = 0;
		s.player.maxHp = 30;
		s.player.hp = 30;
	});
	const t0 = Date.now();
	while (Date.now() - t0 < 30000) {
		const dead = await page.evaluate(() => {
			const s = window.__gameScene;
			if (!s.isGameOver && s.player && !s.player.isDead) {
				s.player.invulnerableUntil = 0;
				s.applyPlayerDamage(15, s.player.x + 20, s.player.y, 'physical', '테스트');
			}
			return s.isGameOver;
		});
		if (dead) break;
		await page.waitForTimeout(250);
	}
	return page.evaluate(() => window.__gameScene.isGameOver);
};

const clickRetry = async () => {
	await page.waitForTimeout(1600);
	const pos = await page.evaluate(() => {
		const s = window.__gameScene;
		let found = null;
		const visit = (obj) => {
			if (found) return;
			if (typeof obj.text === 'string' && obj.text.includes('재도전') && obj.parentContainer) {
				const m = obj.parentContainer.getWorldTransformMatrix();
				found = { x: m.tx, y: m.ty };
				return;
			}
			if (obj.list) obj.list.forEach(visit);
		};
		s.children.list.forEach(visit);
		return found;
	});
	if (!pos) return false;
	await page.mouse.move(pos.x, pos.y);
	await page.waitForTimeout(150);
	await page.mouse.down();
	await page.waitForTimeout(80);
	await page.mouse.up();
	await page.waitForFunction(() => window.__gameScene && !window.__gameScene.isGameOver, null, { timeout: 15000 });
	await page.waitForTimeout(2600);
	return true;
};

// ── 라운드 1 클리어 → 대기마을 (마을 입장 시 스냅샷이 찍힌다)
await page.evaluate(() => {
	const s = window.__gameScene;
	// 라운드 종료 조건(목표 달성 + 스폰 창 종료 + 잔당 전멸)을 지름길로 채운다
	s.waveSystem.objective = { type: 'kill-count', required: 0, label: '테스트' };
	s.waveSystem.skipToRoundEnd();
});
await page.waitForFunction(() => window.__gameScene.villageSystem.isActive, null, { timeout: 25000 });
await page.waitForTimeout(600);

// 마을 입장 스냅샷을 1000 으로 맞춘다 (상점 열고 닫으면 스냅샷이 다시 찍힌다)
await page.evaluate(() => {
	const s = window.__gameScene;
	s.pickupSystem.runGold = 1000;
	s.shopSystem.open(1);
	s.shopSystem.close();
});
await page.waitForTimeout(500);
const entrySnapshot = await snapshotGold();
check('마을 입장 스냅샷 = 1000', entrySnapshot === 1000, `snapshot=${entrySnapshot}`);

// ── (1) 에다에서 실제로 능력치를 산다 (에다 창은 RunSave 를 직접 찍지 않는다)
const statSnapshot = () => page.evaluate(() => {
	const p = window.__gameScene.player;
	return {
		maxHp: p.maxHp, defense: p.defense, moveSpeed: p.moveSpeed,
		attackDamage: p.attackDamage, critChance: p.critChance, luck: p.luck,
		hpRegen: p.hpRegen, dodgeChance: p.dodgeChance,
		bought: Object.values(window.__gameScene.shopSystem.purchaseCounts ?? {})
			.reduce((a, b) => a + b, 0),
	};
});
const beforeBuy = await statSnapshot();
await page.evaluate(() => window.__gameScene.villageSystem.openStall('edda'));
await page.waitForTimeout(700);
// 카드의 히트 사각형에 직접 pointerdown — 좌표 계산 없이 실제 구매 경로를 탄다.
// (딤 배경도 Rectangle+input 이라 카드 크기로 걸러야 한다. 구매되면 창이 rebuild 되므로
//  성공할 때까지 후보를 하나씩 두드린다 — MAX 찍힌 능력치는 그냥 넘어간다.)
const bought = await page.evaluate(() => {
	const s = window.__gameScene;
	const total = () => Object.values(s.shopSystem.purchaseCounts ?? {}).reduce((a, b) => a + b, 0);
	const cards = () => (s.villageSystem.activeWindow?.objects ?? [])
		.filter((o) => o.type === 'Rectangle' && o.input && o.fillAlpha <= 0.01
			&& o.height > 60 && o.height < 160 && o.width < 400);
	const before = total();
	const count = cards().length;
	for (let i = 0; i < count; i += 1) {
		cards()[i]?.emit('pointerdown');
		if (total() > before) {
			return count;
		}
	}
	return 0;
});
await page.waitForTimeout(700);
const afterBuy = await statSnapshot();
const changedStat = Object.keys(afterBuy).find((k) => k !== 'bought' && afterBuy[k] !== beforeBuy[k]);
check('에다: 능력치 구매 성사', bought > 0 && afterBuy.bought === beforeBuy.bought + 1 && !!changedStat,
	`카드=${bought} 구매수=${afterBuy.bought} 바뀐스탯=${changedStat}`);
await page.evaluate(() => window.__gameScene.villageSystem.closeActiveWindow());
await page.waitForTimeout(400);

// 남은 지갑을 200 으로 맞춘다 (이후 계산을 단순하게)
await page.evaluate(() => { window.__gameScene.pickupSystem.runGold = 200; });
const beforeDepart = await walletGold();
check('에다 구매 후 지갑 200', beforeDepart === 200, `wallet=${beforeDepart}`);

await page.evaluate(() => window.__gameScene.villageSystem.depart());
await page.waitForTimeout(2600);
const departSnapshot = await snapshotGold();
check('게이트 출발 스냅샷이 소비를 반영 (200)', departSnapshot === 200, `snapshot=${departSnapshot}`);

// ── (2) 라운드 2에서 50 벌고 사망 → 재도전 → 지갑은 사망 시점(250) 그대로
await page.evaluate(() => { window.__gameScene.pickupSystem.runGold = 250; });
check('사망 직전 지갑 250', await walletGold() === 250);
check('사망: 게임오버 도달', await killPlayer());
const goldAtDeath = await walletGold();
check('사망 시점 지갑 250 유지', goldAtDeath === 250, `wallet=${goldAtDeath}`);

check('재도전 버튼 클릭', await clickRetry());
const afterRetry = await walletGold();
check('재도전 후 지갑 = 사망 시점 250 (되감기 없음)', afterRetry === 250, `wallet=${afterRetry}`);
check('재도전 후 스냅샷도 250', await snapshotGold() === 250, `snapshot=${await snapshotGold()}`);
check('재도전 후 대기마을', await page.evaluate(() => window.__gameScene.villageSystem.isActive));

// 죽기 전에 마을에서 산 것은 죽은 뒤에도 남는다 (의도된 규칙 — 검·레벨만 되감긴다)
const afterRetryStats = await statSnapshot();
check('재도전 후 에다 구매 유지 (구매 횟수)', afterRetryStats.bought === afterBuy.bought,
	`${afterRetryStats.bought} vs ${afterBuy.bought}`);
check('재도전 후 에다 구매 유지 (능력치 값)',
	changedStat ? afterRetryStats[changedStat] === afterBuy[changedStat] : false,
	`${changedStat}: ${afterRetryStats[changedStat]} vs ${afterBuy[changedStat]}`);

// ── (3) 두 번째 죽음: 마을에서 또 쓰고 죽어도 옛 값이 되살아나지 않는다
await page.evaluate(() => {
	const s = window.__gameScene;
	s.pickupSystem.spendGold(200); // 지갑 50
	s.villageSystem.depart();
});
await page.waitForTimeout(2600);
await page.evaluate(() => { window.__gameScene.pickupSystem.runGold = 70; });
check('2회차 사망: 게임오버 도달', await killPlayer());
check('2회차 재도전 클릭', await clickRetry());
const afterRetry2 = await walletGold();
check('2회차 재도전 후 지갑 = 70 (250 부활 없음)', afterRetry2 === 70, `wallet=${afterRetry2}`);

check('페이지 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
