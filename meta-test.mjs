// 메타 진행(도감 · 도전과제) + 연출 3종 회귀 테스트 — 2026-09-01
//
//  A. 코어 모듈: 도감 획득 이력 · 누적 통계 · 도전과제 판정/보상/영속
//  B. 도감 화면: 격자 생성 예산 · 등급/원소 필터 · 페이지 · NEW 배지 · ??? · 상세
//     + 3뷰포트(1280×720 / 1440×860 / 1920×1080) 겹침 QA
//  C. 인게임: 검 획득 → 도감 기록 배선 · 보스 등장 컷인 · SURGE 비네트 ·
//     REFORGE 성공 연출 · 도전과제 토스트
//
// 실행: vite preview 띄운 뒤 `node meta-test.mjs` (PORT/CHROME_BIN/CHROME_ARGS 지원)
import { chromium } from 'playwright';

const exe = process.env.CHROME_BIN;
const args = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
const port = process.env.PORT || '5173';
const browser = await chromium.launch(exe ? { executablePath: exe, args } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));
page.on('console', (msg) => {
	if (msg.type() === 'error' && !msg.text().includes('net::') && !msg.text().includes('Failed to load resource')) {
		errors.push(msg.text());
	}
});

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
	if (ok) {
		pass += 1;
		console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
	} else {
		fail += 1;
		console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2600);
await page.waitForFunction(() => !!window.__codex && !!window.__achievements, null, { timeout: 15000 });

// ===============================================================
// A. 코어 모듈
// ===============================================================

const moduleProbe = await page.evaluate(() => {
	const codex = window.__codex;
	const stats = window.__stats;
	const Ach = window.__achievements;
	const metaKey = 'movesword-meta-v1';
	const readMeta = () => JSON.parse(localStorage.getItem(metaKey) || '{}');
	const out = {};

	// 결정적 상태로 초기화
	codex.resetCodex();
	stats.resetStats();
	Ach.reset();
	const meta = readMeta();
	meta.gold = 0;
	meta.lifetimeGold = 0;
	localStorage.setItem(metaKey, JSON.stringify(meta));

	out.emptyAfterReset = codex.seenCount() === 0;

	// 기록 · 중복 기록 방지
	out.recordNew = codex.recordSwordSeen('bronze') === true;
	out.recordDuplicate = codex.recordSwordSeen('bronze') === false;
	out.seenLookup = codex.isSwordSeen('bronze') && !codex.isSwordSeen('rusty');
	out.freshBadge = codex.isFreshSword('bronze') === true;

	// 영속: localStorage 에 즉시 반영되고, 다시 읽어도 살아 있다
	const stored = JSON.parse(localStorage.getItem('movesword-codex-v1') || '{}');
	out.codexPersisted = Array.isArray(stored.seen) && stored.seen.includes('bronze');
	codex.reloadCodex();
	out.codexReloaded = codex.isSwordSeen('bronze');

	// 통계: bump 는 메모리만, flush 에서만 저장 (핫패스 쓰기 금지 규약)
	stats.bumpStat('kills', 40);
	out.statsDeferred = localStorage.getItem('movesword-stats-v1') === null;
	stats.flushStats();
	out.statsFlushed = JSON.parse(localStorage.getItem('movesword-stats-v1') || '{}').kills === 40;

	// 도전과제: 미달성 → 달성 → 보상 1회
	out.notUnlockedYet = Ach.isUnlocked('kill_100') === false;
	out.evaluateNoop = Ach.evaluate().length === 0;
	stats.bumpStat('kills', 70); // 총 110
	stats.flushStats();
	const unlocked = Ach.evaluate();
	out.unlockedKill100 = unlocked.some((entry) => entry.id === 'kill_100');
	out.goldRewarded = readMeta().gold === 20;
	out.evaluateAgainNoDouble = Ach.evaluate().length === 0 && readMeta().gold === 20;
	out.achievementPersisted = (JSON.parse(localStorage.getItem('movesword-achievements-v1') || '{}').unlocked || [])
		.includes('kill_100');
	Ach.reload();
	out.achievementReloaded = Ach.isUnlocked('kill_100');

	// 도감 수집 수를 보는 도전과제 (codex_25)
	const ids = ['rusty', 'steel', 'iron', 'copper'];
	for (const id of ids) codex.recordSwordSeen(id);
	out.codexAchievementLocked = Ach.isUnlocked('codex_25') === false;
	// 카탈로그 앞쪽 25종을 강제로 기록
	const seeded = [];
	for (let i = 0; i < 40; i += 1) seeded.push(`seed-${i}`);
	for (const id of seeded) codex.recordSwordSeen(id);
	const goldBefore = readMeta().gold;
	const unlocked2 = Ach.evaluate();
	out.codexAchievementUnlocked = unlocked2.some((entry) => entry.id === 'codex_25');
	out.codexRewardPaid = readMeta().gold === goldBefore + 30;

	// 진행도 스냅샷 (도감 화면이 쓰는 형태)
	const snapshot = Ach.snapshot();
	out.snapshotSize = snapshot.length;
	out.snapshotSorted = snapshot[0].unlocked === true;
	out.snapshotRatio = snapshot.every((row) => row.ratio >= 0 && row.ratio <= 1);
	out.catalogSize = Ach.catalog().length;

	// 다음 단계 검사를 위해 도감을 초기화하고 bronze 만 남긴다
	codex.resetCodex();
	codex.recordSwordSeen('bronze');
	return out;
});

check('도감: 초기화 후 0종', moduleProbe.emptyAfterReset);
check('도감: 신규 기록 true / 중복 기록 false', moduleProbe.recordNew && moduleProbe.recordDuplicate);
check('도감: 획득 조회', moduleProbe.seenLookup);
check('도감: NEW 배지 대기열', moduleProbe.freshBadge);
check('도감: localStorage 영속', moduleProbe.codexPersisted && moduleProbe.codexReloaded);
check('통계: bump 는 메모리만 (핫패스 쓰기 없음)', moduleProbe.statsDeferred);
check('통계: flush 시 저장', moduleProbe.statsFlushed);
check('도전과제: 목표 미달 시 미달성', moduleProbe.notUnlockedYet && moduleProbe.evaluateNoop);
check('도전과제: 목표 도달 시 달성 (kill_100)', moduleProbe.unlockedKill100);
check('도전과제: 보상 지급 20골드', moduleProbe.goldRewarded);
check('도전과제: 재판정 시 이중 지급 없음', moduleProbe.evaluateAgainNoDouble);
check('도전과제: localStorage 영속', moduleProbe.achievementPersisted && moduleProbe.achievementReloaded);
check('도전과제: 도감 수집 연동 (codex_25)', moduleProbe.codexAchievementLocked && moduleProbe.codexAchievementUnlocked);
check('도전과제: 도감 보상 지급', moduleProbe.codexRewardPaid);
check('도전과제: 카탈로그 20종', moduleProbe.catalogSize === 20, `${moduleProbe.catalogSize}`);
check('도전과제: 스냅샷 정렬·진행률', moduleProbe.snapshotSize === 20 && moduleProbe.snapshotSorted && moduleProbe.snapshotRatio);

// ===============================================================
// B. 도감 화면
// ===============================================================

await page.keyboard.press('d');
await page.waitForFunction(() => !!window.__codexScene, null, { timeout: 10000 });
await page.waitForTimeout(600);

const codexProbe = await page.evaluate(() => {
	const s = window.__codexScene;
	const out = { metrics: s.layoutMetrics() };
	const texts = s.pageTexts();
	out.hasSilhouette = texts.includes('???');
	out.cellBudget = out.metrics.pageObjects;
	out.perPage = out.metrics.cols * out.metrics.rows;

	// 2026-09-02: 도감이 기본으로 등급 그룹(신화→일반) 정렬이라 일반 등급 검(bronze)은
	// 첫 쪽이 아니라 뒤쪽에 온다 — NEW 배지는 쪽을 넘겨가며 찾는다.
	out.hasNewBadge = (() => {
		const pages = s.layoutMetrics().pageCount;
		for (let i = 0; i < pages; i += 1) {
			if (s.pageTexts().includes('NEW')) {
				return true;
			}
			s.movePage(1);
		}
		return false;
	})();
	s.movePage(-999);
	// 등급 그룹 정렬 자체도 회귀 검사 (신화 → 일반)
	const rankOf = (rarity) => ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'].indexOf(rarity ?? 'common');
	const sorted = s.filteredSwords().map((d) => rankOf(d.rarity));
	out.rarityGrouped = sorted.every((r, i) => i === 0 || sorted[i - 1] <= r);

	// 등급 필터 (전설 10종) · 원소 필터 (불 19종)
	s.applyFilter('legendary', 'all');
	out.legendary = s.layoutMetrics().filtered;
	s.applyFilter('all', 'fire');
	out.fire = s.layoutMetrics().filtered;
	s.applyFilter('all', 'none');
	out.noElement = s.layoutMetrics().filtered;
	s.applyFilter('all', 'all');
	out.all = s.layoutMetrics().filtered;

	// 페이지 이동
	const before = s.layoutMetrics().page;
	s.movePage(1);
	const after = s.layoutMetrics().page;
	s.movePage(-99);
	out.pageMoved = before === 0 && after === 1 && s.layoutMetrics().page === 0;
	out.pageCount = s.layoutMetrics().pageCount;

	// 상세: 획득한 검은 이름·스탯 공개, 미획득은 잠금 문구
	s.showSwordDetail('bronze');
	const ownedDetail = s.detailTexts().join('|');
	s.showSwordDetail('inferno');
	const lockedDetail = s.detailTexts().join('|');
	out.ownedDetail = ownedDetail.includes('피해') && !ownedDetail.includes('???');
	out.lockedDetail = lockedDetail.includes('???') && lockedDetail.includes('아직 획득하지 않은');
	// 조합식: 미발견이면 ??? + ???
	out.recipeHidden = String(s.recipeTextFor({ id: 'inferno' })).startsWith('???');
	out.recipeNullForBase = s.recipeTextFor({ id: 'bronze' }) === null;
	return out;
});

check('도감 화면: 페이지당 칸만 생성 (183칸 일괄 생성 없음)',
	codexProbe.cellBudget > 0 && codexProbe.cellBudget <= codexProbe.perPage * 5 + 10,
	`objects=${codexProbe.cellBudget}, perPage=${codexProbe.perPage}`);
check('도감 화면: 미획득 검은 ??? 실루엣', codexProbe.hasSilhouette);
check('도감 화면: 신규 획득 NEW 배지', codexProbe.hasNewBadge);
check('도감 화면: 등급 그룹 정렬 (신화→일반)', codexProbe.rarityGrouped);
check('도감 화면: 등급 필터 (전설 10)', codexProbe.legendary === 10, `${codexProbe.legendary}`);
check('도감 화면: 원소 필터 (불 19)', codexProbe.fire === 19, `${codexProbe.fire}`);
check('도감 화면: 무속성 필터 (39)', codexProbe.noElement === 39, `${codexProbe.noElement}`);
check('도감 화면: 전체 186종', codexProbe.all === 186, `${codexProbe.all}`);
check('도감 화면: 페이지 이동·클램프', codexProbe.pageMoved, `pages=${codexProbe.pageCount}`);
check('도감 화면: 획득 검 상세 공개', codexProbe.ownedDetail);
check('도감 화면: 미획득 검 상세 잠금', codexProbe.lockedDetail);
check('도감 화면: 미발견 조합식 ???', codexProbe.recipeHidden && codexProbe.recipeNullForBase);

// 도전과제 탭
await page.evaluate(() => window.__codexScene.switchTab('achievements'));
await page.waitForTimeout(700);
const achProbe = await page.evaluate(() => {
	const s = window.__codexScene;
	const texts = s.pageTexts();
	return {
		tab: s.layoutMetrics().tab,
		rows: texts.filter((t) => t === '달성' || t === '미달성').length,
		hasUnlocked: texts.includes('달성'),
		hasLocked: texts.includes('미달성'),
		hasReward: texts.some((t) => t.startsWith('보상 ')),
		hasProgress: texts.some((t) => t.includes('/')),
		pageCount: s.layoutMetrics().pageCount,
	};
});
check('도전과제 탭: 전환', achProbe.tab === 'achievements');
check('도전과제 탭: 페이지당 5행', achProbe.rows === 5, `${achProbe.rows}`);
check('도전과제 탭: 달성/미달성 표시', achProbe.hasUnlocked && achProbe.hasLocked);
check('도전과제 탭: 보상·진행도 표시', achProbe.hasReward && achProbe.hasProgress);
check('도전과제 탭: 4쪽', achProbe.pageCount === 4, `${achProbe.pageCount}`);

// 기록 탭 (로컬 런 텔레메트리)
const runsProbe = await page.evaluate(async () => {
	const T = window.__telemetry;
	T.resetRunLog();
	// 결정적 표본 3런 (사망 2 · 귀환 1)
	T.recordRun({
		round: 30, keeper: 'hero-basic', won: false, durationMs: 605000, kills: 900, level: 34, affixes: 12,
		swords: { count: 7, elements: { fire: 4, none: 3 }, archetypes: { orbit: 5, lance: 2 } },
	});
	T.recordRun({
		round: 42, keeper: 'berserker', won: false, durationMs: 812000, kills: 1400, level: 41, affixes: 18,
		swords: { count: 7, elements: { fire: 2, void: 5 }, archetypes: { orbit: 4, stake: 3 } },
	});
	T.recordRun({
		round: 200, keeper: 'hero-basic', won: true, durationMs: 3000000, kills: 9000, level: 90, affixes: 23,
		swords: { count: 7, elements: { void: 7 }, archetypes: { orbit: 7 } },
	});
	const stats = T.runStats();
	const stored = JSON.parse(localStorage.getItem('movesword-runlog-v1') || '{}');

	// 순환 버퍼 상한 (50)
	for (let i = 0; i < 60; i += 1) {
		T.recordRun({
			round: i, keeper: 'gambler', won: false, durationMs: 1000, kills: i, level: 1, affixes: 0,
			swords: { count: 1, elements: { ice: 1 }, archetypes: { boomerang: 1 } },
		});
	}
	const capped = T.runCount();
	const newestFirst = T.recentRuns()[0];

	// 다시 3런만 남기고 화면 검사
	T.resetRunLog();
	T.recordRun({
		round: 30, keeper: 'hero-basic', won: false, durationMs: 605000, kills: 900, level: 34, affixes: 12,
		swords: { count: 7, elements: { fire: 4, none: 3 }, archetypes: { orbit: 5, lance: 2 } },
	});
	T.recordRun({
		round: 42, keeper: 'berserker', won: false, durationMs: 812000, kills: 1400, level: 41, affixes: 18,
		swords: { count: 7, elements: { fire: 2, void: 5 }, archetypes: { orbit: 4, stake: 3 } },
	});
	window.__codexScene.switchTab('runs');
	await new Promise((r) => setTimeout(r, 700));
	const sc = window.__codexScene;
	return {
		avgDeathRound: stats.avgDeathRound,
		bestRound: stats.bestRound,
		deaths: stats.deaths,
		clears: stats.clears,
		bestByKeeper: stats.bestByKeeper,
		topElement: stats.topElements[0],
		persistedRuns: Array.isArray(stored.runs) ? stored.runs.length : -1,
		persistedShape: stored.runs?.[0] ? Object.keys(stored.runs[0]).sort().join(',') : '',
		capped,
		newestRound: newestFirst?.round ?? null,
		tab: sc.layoutMetrics().tab,
		pageTexts: sc.pageTexts(),
		detailTexts: sc.detailTexts(),
		metrics: sc.layoutMetrics(),
	};
});

check('기록 탭: 전환', runsProbe.tab === 'runs', runsProbe.tab);
check('기록 탭: 평균 사망 라운드 (30·42 → 36)', runsProbe.avgDeathRound === 36, `${runsProbe.avgDeathRound}`);
check('기록 탭: 최고 라운드 / 사망·귀환 집계',
	runsProbe.bestRound === 200 && runsProbe.deaths === 2 && runsProbe.clears === 1,
	JSON.stringify({ best: runsProbe.bestRound, d: runsProbe.deaths, c: runsProbe.clears }));
check('기록 탭: 키퍼별 최고 라운드',
	runsProbe.bestByKeeper[0]?.keeper === 'hero-basic' && runsProbe.bestByKeeper[0]?.round === 200,
	JSON.stringify(runsProbe.bestByKeeper));
check('기록 탭: 최다 사용 원소 (void 12)',
	runsProbe.topElement?.element === 'void' && runsProbe.topElement?.count === 12,
	JSON.stringify(runsProbe.topElement));
check('기록 탭: localStorage 영속 (movesword-runlog-v1)',
	runsProbe.persistedRuns === 3
	&& runsProbe.persistedShape === 'affixes,at,durationMs,keeper,kills,level,round,swords,won',
	`${runsProbe.persistedRuns}런 / ${runsProbe.persistedShape}`);
check('기록 탭: 순환 버퍼 상한 50 · 최신이 앞',
	runsProbe.capped === 50 && runsProbe.newestRound === 59,
	`${runsProbe.capped}런, 최신 ${runsProbe.newestRound}`);
check('기록 탭: 목록에 사망 라운드·키퍼·검 구성이 보인다',
	runsProbe.pageTexts.some((t) => t === '사망')
	&& runsProbe.pageTexts.some((t) => t.startsWith('라운드 42'))
	&& runsProbe.pageTexts.some((t) => t.includes('검 7') && t.includes('말뚝검')),
	JSON.stringify(runsProbe.pageTexts.slice(0, 10)));
check('기록 탭: 통계 패널에 평균 사망 라운드·최다 원소',
	runsProbe.detailTexts.includes('평균 사망 라운드') && runsProbe.detailTexts.includes('최다 사용 원소'),
	JSON.stringify(runsProbe.detailTexts.slice(0, 8)));

// 빈 상태
const emptyRuns = await page.evaluate(async () => {
	window.__telemetry.resetRunLog();
	window.__codexScene.scene.restart({ tab: 'runs' });
	await new Promise((r) => setTimeout(r, 800));
	return { texts: window.__codexScene.pageTexts(), detail: window.__codexScene.detailTexts() };
});
check('기록 탭: 기록이 없으면 안내 문구',
	emptyRuns.texts.some((t) => t.includes('아직 기록된 런이 없습니다')),
	JSON.stringify(emptyRuns.texts.slice(0, 4)));

await page.evaluate(() => window.__codexScene.scene.restart({ tab: 'swords' }));
await page.waitForTimeout(700);

// 3뷰포트 겹침 QA
for (const [w, h] of [[1280, 720], [1440, 860], [1920, 1080]]) {
	await page.setViewportSize({ width: w, height: h });
	await page.waitForTimeout(400);
	await page.evaluate(() => window.__codexScene.scene.restart({ tab: 'swords' }));
	await page.waitForFunction(() => !!window.__codexScene && !!window.__codexScene.layoutMetrics().cols, null, { timeout: 8000 });
	await page.waitForTimeout(500);
	const m = await page.evaluate(() => window.__codexScene.layoutMetrics());
	// 기록 탭도 같은 뷰포트에서 검사 (탭 3개 + 닫기 버튼이 겹치지 않아야 한다)
	const mr = await page.evaluate(async () => {
		const T = window.__telemetry;
		T.resetRunLog();
		for (let i = 0; i < 8; i += 1) {
			T.recordRun({
				round: 10 + i, keeper: 'hero-basic', won: false, durationMs: 300000 + i * 1000,
				kills: 100 * i, level: 10 + i, affixes: i,
				swords: { count: 7, elements: { fire: 7 }, archetypes: { orbit: 5, lance: 2 } },
			});
		}
		window.__codexScene.scene.restart({ tab: 'runs' });
		await new Promise((r) => setTimeout(r, 800));
		return window.__codexScene.layoutMetrics();
	});
	const tabsVsClose = mr.tabsRight <= mr.closeLeft - 4;
	const rowsVsDetail = mr.rowsRight <= mr.detailX - 4;
	const rowsVsPager = mr.rowsBottom <= mr.pagerY - 20;
	check(`기록 탭 ${w}×${h}: 탭·닫기·행·상세·페이저 겹침 없음`,
		tabsVsClose && rowsVsDetail && rowsVsPager && mr.tab === 'runs',
		JSON.stringify({ tabsVsClose, rowsVsDetail, rowsVsPager, tabsRight: Math.round(mr.tabsRight), closeLeft: Math.round(mr.closeLeft), rowsBottom: Math.round(mr.rowsBottom), pagerY: Math.round(mr.pagerY) }));
	await page.evaluate(async () => {
		window.__telemetry.resetRunLog();
		window.__codexScene.scene.restart({ tab: 'swords' });
		await new Promise((r) => setTimeout(r, 700));
	});
	await page.waitForTimeout(300);
	const gridVsDetail = m.gridRight <= m.detailX - 4;
	const detailInScreen = m.detailX + m.detailW <= m.uiWidth - 8;
	const gridVsPager = m.gridBottom <= m.pagerY - 30;
	const chipsInGrid = m.rarityChipRight <= m.detailX && m.elementChipRight <= m.detailX;
	const chipsVsGrid = m.elementChipBottom <= m.gridY;
	check(`도감 ${w}×${h}: 격자·상세·필터·페이저 겹침 없음`,
		gridVsDetail && detailInScreen && gridVsPager && chipsInGrid && chipsVsGrid,
		JSON.stringify({ gridVsDetail, detailInScreen, gridVsPager, chipsInGrid, chipsVsGrid, cols: m.cols }));
}
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(300);

// 도감을 닫으면 NEW 배지 대기열이 비워진다
await page.evaluate(() => window.__codexScene.back());
await page.waitForTimeout(900);
const freshCleared = await page.evaluate(() => window.__codex.freshCount() === 0);
check('도감: 닫으면 NEW 배지 소진', freshCleared);

// ===============================================================
// C. 인게임 배선 + 연출
// ===============================================================

await page.evaluate(() => {
	window.__codex.resetCodex();
	window.__stats.resetStats();
	window.__achievements.reset();
});
// 부팅 대기: 타이틀 씬이 뜨기 전에 Space 를 누르면 입력이 씹힌다 (2026-09-02 — 보스 에셋
// 추가로 프리로드가 길어져 고정 대기 2.6초로는 느린 머신에서 부족하다).
await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 40000 });
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 30000 });
await page.waitForTimeout(800); // 캐릭터 선택 씬이 입력을 받을 준비가 되도록
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 20000 });
await page.waitForTimeout(2200);

const runProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	const out = {};
	// 런 시작 시 장착된 검이 도감에 기록됐는가
	out.startingSwordLogged = s.swordOrbit.swords.every((sword) => window.__codex.isSwordSeen(sword.definition.id));
	out.seenCount = window.__codex.seenCount();
	// 새 검을 보관함으로 받으면 그것도 기록된다
	const target = s.swordOrbit.getDefinitionById('inferno');
	const before = window.__codex.isSwordSeen('inferno');
	s.swordOrbit.addToReserve(target);
	out.reserveLogged = !before && window.__codex.isSwordSeen('inferno');
	// 출격 횟수 집계
	out.runsCounted = window.__stats.getStats().runs >= 1;
	return out;
});
check('배선: 런 시작 검이 도감에 기록', runProbe.startingSwordLogged && runProbe.seenCount > 0, `${runProbe.seenCount}종`);
check('배선: 보관함 지급 검도 기록', runProbe.reserveLogged);
check('배선: 출격 횟수 집계', runProbe.runsCounted);

// 보스 등장 컷인
const cutInProbe = await page.evaluate(() => {
	const s = window.__gameScene;
	s.progression.xpToNext = 999999999;
	s.player.invulnerableUntil = s.time.now + 600000;
	const before = s.bossCutIn.shownCount;
	const boss = s.enemyManager.spawnEnemy(s, s.player, 'skullwolf-boss', { x: s.player.x + 500, y: s.player.y + 500 });
	return {
		shown: s.bossCutIn.shownCount === before + 1,
		visible: s.bossCutIn.visible === true,
		name: boss.enemyName,
		tracking: s.achievements !== undefined,
	};
});
check('컷인: 보스 스폰 시 배너 표시', cutInProbe.shown && cutInProbe.visible, cutInProbe.name);

await page.waitForTimeout(1700);
const cutInGone = await page.evaluate(() => window.__gameScene.bossCutIn.visible === false);
check('컷인: 1.2초 뒤 사라짐 (재사용 컨테이너)', cutInGone);

// 보스 무피격 처치 → 도전과제
const bossKill = await page.evaluate(async () => {
	const s = window.__gameScene;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const boss = s.enemyManager.enemies.getChildren().find((e) => e.active && e.catalog?.isBoss);
	s.enemyManager.takeDamage(boss, 9999999, s.player);
	await wait(900);
	const stats = window.__stats.getStats();
	return {
		bossKills: stats.bossKills,
		flawless: stats.bossFlawless,
		unlockedFirst: window.__achievements.isUnlocked('boss_first'),
		unlockedFlawless: window.__achievements.isUnlocked('boss_flawless'),
		toastVisible: s.achievements.toast?.visible === true,
	};
});
check('도전과제: 보스 처치 집계', bossKill.bossKills >= 1 && bossKill.unlockedFirst, JSON.stringify(bossKill));
check('도전과제: 무피격 보스 처치 달성', bossKill.flawless >= 1 && bossKill.unlockedFlawless);
check('도전과제: 달성 토스트 표시', bossKill.toastVisible);

// SURGE 비네트 (원소 필살기 화면 가장자리 펄스)
const surge = await page.evaluate(async () => {
	const s = window.__gameScene;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const layer = () => s.children.list.find((o) => o.type === 'Graphics' && o.depth === 92);
	const before = Boolean(layer());
	s.visualEffects.ultimateCalloutFX('fire', s.player.x, s.player.y);
	await wait(160);
	const during = layer();
	const alphaDuring = during ? during.alpha : -1;
	await wait(700);
	const after = layer();
	return { before, created: Boolean(during), alphaDuring, alphaAfter: after ? after.alpha : -1, hiddenAfter: after ? after.visible === false : false };
});
check('SURGE: 원소색 가장자리 비네트 펄스', surge.created && surge.alphaDuring > 0.05,
	JSON.stringify({ alphaDuring: surge.alphaDuring }));
check('SURGE: 펄스 종료 후 원위치', surge.hiddenAfter && surge.alphaAfter <= 0.01);

// REFORGE 성공 연출
const reforge = await page.evaluate(async () => {
	const s = window.__gameScene;
	const so = s.swordOrbit;
	const shop = s.shopSystem;
	const wait = (ms) => new Promise((res) => setTimeout(res, ms));
	const def = (id) => so.getDefinitionById(id);
	for (const sword of [...so.swords]) so.removeSword(sword);
	so.minSwords = 0;
	so.reserve.length = 0;
	so.unlockedSlots = 7;
	so.addSword(s, def('ruby'));
	so.addSword(s, def('gold'));
	s.pickupSystem.runGold = 5000;
	shop.open?.(3);
	await wait(300);
	shop.ui.openModal('reforge');
	await wait(200);
	const state = so.getReforgeStates().find((st) => st.ready);
	const reforgesBefore = window.__stats.getStats().reforges;
	shop.reforgeRecipe(state.recipeIndex);
	await wait(150);
	const fxCount = shop.ui.reforgeFxObjects.length;
	const fxTexts = shop.ui.reforgeFxObjects
		.filter((o) => o.type === 'Text')
		.map((o) => o.text);
	await wait(2400);
	const cleaned = shop.ui.reforgeFxObjects.length;
	return {
		fxCount,
		fxTexts,
		cleaned,
		reforgesBefore,
		reforgesAfter: window.__stats.getStats().reforges,
		unlocked: window.__achievements.isUnlocked('reforge_first'),
		resultOwned: window.__codex.isSwordSeen('inferno'),
	};
});
check('REFORGE 연출: 결과 검 강조 오브젝트 생성', reforge.fxCount >= 4, JSON.stringify(reforge.fxTexts));
check('REFORGE 연출: 연출 종료 후 정리', reforge.cleaned === 0);
check('REFORGE: 조합 성공 집계 + 도전과제', reforge.reforgesAfter === reforge.reforgesBefore + 1 && reforge.unlocked);
check('REFORGE: 결과 검 도감 기록', reforge.resultOwned);

// 런 종료 배선: showGameOver 가 로컬 런 기록을 정확히 한 줄 남긴다
const runEnd = await page.evaluate(async () => {
	window.__telemetry.resetRunLog();
	const s = window.__gameScene;
	s.showGameOver();
	await new Promise((r) => setTimeout(r, 400));
	const runs = window.__telemetry.recentRuns();
	return {
		count: runs.length,
		row: runs[0] ?? null,
		keeperMatches: runs[0]?.keeper === s.characterId,
		swordTotal: s.swordOrbit.swords.length + s.swordOrbit.reserve.length,
	};
});
check('배선: 런 종료 시 로컬 기록 1줄 (라운드·키퍼·검 구성·어픽스·시간)',
	runEnd.count === 1 && runEnd.keeperMatches
	&& typeof runEnd.row?.round === 'number' && runEnd.row.round >= 1
	&& runEnd.row.swords.count === runEnd.swordTotal
	&& typeof runEnd.row.affixes === 'number' && runEnd.row.durationMs >= 0,
	JSON.stringify(runEnd.row));
await page.evaluate(() => window.__telemetry.resetRunLog());

await page.screenshot({ path: process.env.SHOT_PATH || '/tmp/meta-test.png' });

check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
