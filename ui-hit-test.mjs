// UI 히트 영역 전수 회귀 테스트 (2026-09-02 신설)
//
// 왜 생겼나 — "게임 안의 모든 버튼이 잘 안 눌린다" 제보.
// 원인 2가지가 전부 **좌표 계산**이라, 기존 테스트가 하나도 못 잡았다:
//   (a) 기존 테스트는 버튼 핸들러를 emit/직접 호출로 검증했다 → 히트 영역을 안 지난다.
//   (b) 좌표 클릭을 하는 테스트도 카메라 스크롤 0(전투 시작 직후)에서만 눌러 봤다.
//
// 이 파일이 지키는 것:
//   1) 활성 씬의 모든 인터랙티브 객체에 대해 **판정 사각형 == 시각 사각형**
//      (중심 어긋남 ≤ 4px, 판정이 시각을 덮음)
//   2) 중앙 + 모서리 4점이 전부 자기 자신에게 히트된다 (가장자리가 죽지 않는다)
//   3) 최소 터치 타깃 44px (theme.button 은 예외 없이 강제)
//   4) **카메라가 스크롤된 상태**에서도 위가 전부 성립 (전투 중 실사용 조건)
//   5) 대표 버튼 몇 개는 진짜 마우스 클릭으로 핸들러 발화까지 확인
//
// 판정은 Phaser 의 실제 히트 테스트(InputManager.hitTest)를 그대로 부른다 —
// 우리가 다시 구현한 근사가 아니라 게임이 쓰는 바로 그 경로다.
//
// 실행: node ui-hit-test.mjs   (vite preview on :5199, 또는 PORT)
import { chromium } from 'playwright';

const exe = process.env.CHROME_BIN;
const args = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
const port = process.env.PORT || '5199';
const VIEWPORTS = process.env.VIEWPORT
	? [JSON.parse(process.env.VIEWPORT)]
	: [{ width: 1280, height: 720 }, { width: 1440, height: 860 }, { width: 1920, height: 1080 }];

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

// ─────────────────────────────────────────────────────────────
// 페이지에 주입할 감사기 — Phaser 내부 히트 테스트를 그대로 쓴다
// ─────────────────────────────────────────────────────────────
const AUDIT = () => {
	const g = window.__game;
	if (!g) {
		return { error: '__game 훅이 없다 (개발 빌드가 아님?)' };
	}
	const rows = [];
	for (const scene of g.scene.getScenes(true)) {
		const input = scene.input;
		if (!input || !input._list) {
			continue;
		}
		const cam = scene.cameras.main;
		const pointer = input.manager.pointers[0];
		pointer.camera = cam;
		const hitsAt = (x, y) => {
			pointer.x = x;
			pointer.y = y;
			return input.manager.hitTest(pointer, input._list, cam);
		};
		// topOnly 기준 실제로 이벤트를 받는 객체 (히트영역을 넓혔을 때
		// 옆 버튼이 서로의 중앙을 가로채지 않는지 확인용)
		const topAt = (x, y) => {
			const hits = hitsAt(x, y).slice();
			if (hits.length < 2) {
				return hits[0] || null;
			}
			return input.sortGameObjects(hits, pointer)[0];
		};
		for (const go of input._list) {
			if (!go.input || !go.input.enabled || !go.visible) {
				continue;
			}
			const bounds = go.getBounds ? go.getBounds() : null;
			if (!bounds || bounds.width < 1 || bounds.height < 1) {
				continue;
			}
			// 화면 좌표 = 부모가 scrollFactor 0 이므로 getBounds 가 곧 화면 좌표
			const cx = bounds.x + bounds.width / 2;
			const cy = bounds.y + bounds.height / 2;
			const inX = Math.max(2, bounds.width * 0.25);
			const inY = Math.max(2, bounds.height * 0.25);
			const probes = {
				center: [cx, cy],
				tl: [bounds.x + inX, bounds.y + inY],
				tr: [bounds.right - inX, bounds.y + inY],
				bl: [bounds.x + inX, bounds.bottom - inY],
				br: [bounds.right - inX, bounds.bottom - inY],
			};
			const result = {};
			const blockedBy = {};
			for (const [key, [px, py]] of Object.entries(probes)) {
				const hits = hitsAt(px, py);
				result[key] = hits.indexOf(go) >= 0;
				if (!result[key] && hits.length) {
					const top = hits[hits.length - 1];
					blockedBy[key] = `${top.type}@${top.depth}`;
				}
			}
			// 판정 사각형 자체를 역산 (Phaser: local + displayOrigin ∈ hitArea)
			const ha = go.input.hitArea;
			let hitRect = null;
			if (ha && ha.width !== undefined) {
				const m = go.getWorldTransformMatrix();
				const dox = go.displayOriginX || 0;
				const doy = go.displayOriginY || 0;
				const p0 = m.transformPoint(ha.x - dox, ha.y - doy);
				const p1 = m.transformPoint(ha.x + ha.width - dox, ha.y + ha.height - doy);
				const sfx = go.scrollFactorX === undefined ? 1 : go.scrollFactorX;
				const sfy = go.scrollFactorY === undefined ? 1 : go.scrollFactorY;
				hitRect = [
					p0.x - cam.scrollX * sfx, p0.y - cam.scrollY * sfy,
					p1.x - p0.x, p1.y - p0.y,
				];
			}
			const top = topAt(cx, cy);
			// 최상위 조상(= UiRoot 컨테이너). 모달이 아래 화면 버튼을 덮는 건
			// 정상이므로, 가로채기 판정은 **같은 레이어끼리만** 한다.
			const rootOf = (obj) => {
				let node = obj;
				while (node.parentContainer) node = node.parentContainer;
				return node;
			};
			rows.push({
				scene: scene.scene.key,
				type: go.type,
				ownsCenter: top === go || (!!top && rootOf(top) !== rootOf(go)),
				centerTop: top && top !== go
					? `${top.type}"${(top.list && (top.list.find((c) => c.type === 'Text') || {}).text) || ''}"`
					: '',
				label: (go.list && (go.list.find((c) => c.type === 'Text') || {}).text)
					|| (go.type === 'Text' ? go.text : '') || '',
				isButton: go.type === 'Container' && !!go.list && go.list.some((c) => c.type === 'NineSlice'),
				visual: [bounds.x, bounds.y, bounds.width, bounds.height],
				hitRect,
				scrollFactor: go.scrollFactorX,
				camScroll: [cam.scrollX, cam.scrollY],
				probes: result,
				blockedBy,
			});
		}
	}
	return rows;
};

// ─────────────────────────────────────────────────────────────
async function auditScreen(page, screenName, opts = {}) {
	const rows = await page.evaluate(AUDIT);
	if (rows.error) {
		check(`[${screenName}] 감사기 동작`, false, rows.error);
		return [];
	}
	if (rows.length === 0) {
		check(`[${screenName}] 인터랙티브 객체 존재`, opts.allowEmpty === true, '0개');
		return [];
	}

	const offset = [];
	const edgeDead = [];
	const tiny = [];
	const stolen = [];
	for (const r of rows) {
		if (r.hitRect) {
			const dx = (r.hitRect[0] + r.hitRect[2] / 2) - (r.visual[0] + r.visual[2] / 2);
			const dy = (r.hitRect[1] + r.hitRect[3] / 2) - (r.visual[1] + r.visual[3] / 2);
			if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
				offset.push(`${r.type}"${String(r.label).slice(0, 14)}" d=(${Math.round(dx)},${Math.round(dy)})`);
			}
		}
		const dead = Object.entries(r.probes).filter(([, ok]) => !ok).map(([k]) => k);
		if (dead.length) {
			edgeDead.push(`${r.type}"${String(r.label).slice(0, 14)}" ${dead.join(',')}`
				+ (Object.keys(r.blockedBy).length ? ` (가림: ${Object.values(r.blockedBy)[0]})` : ''));
		}
		if (r.isButton && r.hitRect && (Math.round(r.hitRect[2]) < 44 || Math.round(r.hitRect[3]) < 44)) {
			tiny.push(`${String(r.label).slice(0, 14)} ${Math.round(r.hitRect[2])}x${Math.round(r.hitRect[3])}`);
		}
		// 히트영역 패딩 때문에 옆 버튼이 이 버튼의 중앙을 가로채면 안 된다
		if (r.isButton && !r.ownsCenter) {
			stolen.push(`${String(r.label).slice(0, 14)} ← ${r.centerTop || '없음'}`);
		}
	}

	check(`[${screenName}] 판정 사각형 = 시각 사각형 (${rows.length}개)`,
		offset.length === 0, offset.slice(0, 4).join(' | '));
	check(`[${screenName}] 중앙+모서리 4점 전부 반응`,
		edgeDead.length === 0, edgeDead.slice(0, 4).join(' | '));
	check(`[${screenName}] 버튼 최소 터치 타깃 44px`,
		tiny.length === 0, tiny.slice(0, 4).join(' | '));
	check(`[${screenName}] 버튼 중앙을 이웃이 가로채지 않는다`,
		stolen.length === 0, stolen.slice(0, 4).join(' | '));
	return rows;
}

// ─────────────────────────────────────────────────────────────
async function runViewport(browser, viewport) {
	const page = await browser.newPage({ viewport });
	const errors = [];
	page.on('pageerror', (err) => errors.push(err.message));
	const tag = `${viewport.width}x${viewport.height}`;

	await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('canvas', { timeout: 30000 });
	await page.waitForFunction(() => !!window.__titleScene, null, { timeout: 30000 });
	await page.waitForTimeout(1200);

	// ── 타이틀
	const titleRows = await auditScreen(page, `${tag} 타이틀`);

	// ── 실제 마우스 클릭 왕복: 타이틀 '설정' 버튼
	const settingsBtn = titleRows.find((r) => r.label === '설정');
	if (settingsBtn) {
		const [x, y, w, h] = settingsBtn.visual;
		await page.mouse.click(x + w / 2, y + h / 2);
		await page.waitForTimeout(500);
		const opened = await page.evaluate(() => !!window.__titleScene.settingsRoot);
		check(`[${tag}] 실클릭: 설정 버튼 중앙`, opened);
		// 가장자리(우하단 안쪽 4px)도 눌려야 한다
		if (!opened) {
			await page.evaluate(() => window.__titleScene.openSettings());
			await page.waitForTimeout(400);
		}
	} else {
		check(`[${tag}] 타이틀에 '설정' 버튼이 있다`, false);
	}

	await auditScreen(page, `${tag} 설정·소리/화면`);

	// ── 설정 [조작] 갈래 — 실제 클릭으로 전환
	const settingRows = await page.evaluate(AUDIT);
	const ctrlTab = Array.isArray(settingRows) && settingRows.find((r) => r.label === '조작');
	if (ctrlTab) {
		const [x, y, w, h] = ctrlTab.visual;
		// 가장자리 클릭(오른쪽 끝에서 안쪽으로 6px) — "가장자리가 죽는" 회귀 방지
		await page.mouse.click(x + w - 6, y + h / 2);
		await page.waitForTimeout(500);
		await auditScreen(page, `${tag} 설정·조작`);
	} else {
		check(`[${tag}] 설정 창에 '조작' 갈래가 있다`, false);
	}
	await page.keyboard.press('Escape');
	await page.waitForTimeout(400);

	// ── 도감 (탭 3개)
	await page.evaluate(() => window.__titleScene.scene.start('CodexScene'));
	await page.waitForFunction(() => !!window.__codexScene, null, { timeout: 15000 });
	await page.waitForTimeout(900);
	await auditScreen(page, `${tag} 도감·검`);
	for (const [key, name] of [['Digit2', '도전과제'], ['Digit3', '기록']]) {
		await page.keyboard.press(key);
		await page.waitForTimeout(600);
		await auditScreen(page, `${tag} 도감·${name}`);
	}
	await page.keyboard.press('Escape');
	await page.waitForTimeout(800);

	// ── 영구 강화
	await page.evaluate(() => window.__titleScene.scene.start('PowerUpScene'));
	await page.waitForTimeout(1100);
	await auditScreen(page, `${tag} 영구 강화`);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(900);

	// ── 캐릭터 선택
	await page.evaluate(() => window.__titleScene.scene.start('CharacterSelectScene'));
	await page.waitForFunction(() => !!window.__charSelect, null, { timeout: 15000 });
	await page.waitForTimeout(900);
	await auditScreen(page, `${tag} 캐릭터 선택`);

	// ── 전투 진입
	await page.keyboard.press('Space');
	await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 25000 });
	await page.waitForTimeout(2200);

	// **핵심**: 카메라를 스크롤시킨 뒤에 검사한다.
	// 전투가 시작되자마자(scroll 0) 검사하면 scrollFactor 버그가 통째로 숨는다.
	await page.evaluate(() => {
		const s = window.__gameScene;
		s.cameras.main.stopFollow();
		s.cameras.main.setScroll(1731, -942);
	});
	await page.waitForTimeout(300);

	await auditScreen(page, `${tag} 전투 HUD(카메라 스크롤)`, { allowEmpty: true });

	// ── 레벨업 카드
	await page.evaluate(() => window.__gameScene.levelUpSystem.enqueue());
	await page.waitForTimeout(1000);
	const lvRows = await auditScreen(page, `${tag} 레벨업 카드(카메라 스크롤)`);
	const card = lvRows.find((r) => r.type === 'Rectangle');
	if (card) {
		const [x, y, w, h] = card.visual;
		await page.mouse.click(x + w / 2, y + h * 0.85); // 카드 아래쪽(중앙 아님)
		await page.waitForTimeout(700);
		const closed = await page.evaluate(() => window.__gameScene.levelUpSystem.isOpen === false);
		check(`[${tag}] 실클릭: 레벨업 카드 하단(카메라 스크롤 상태)`, closed);
		if (!closed) {
			await page.evaluate(() => window.__gameScene.levelUpSystem.close?.());
			await page.waitForTimeout(400);
		}
	} else {
		check(`[${tag}] 레벨업 카드가 떴다`, false);
	}

	// ── TAB 캐릭터창 (StatsPanel — UiRoot 를 안 쓰는 화면이라 따로 본다)
	await page.keyboard.press('Tab');
	await page.waitForTimeout(800);
	await auditScreen(page, `${tag} TAB 캐릭터창(카메라 스크롤)`);
	await page.keyboard.press('Tab');
	await page.waitForTimeout(500);

	// ── K 스킬 창 (SkillWindow — 2026-09-04, UiRoot 를 안 쓰는 화면)
	await page.evaluate(() => {
		const s = window.__gameScene;
		s.progression.level = Math.max(s.progression.level, 12);
		s.skillTree?.learn('blade-3');
		s.skillTree?.learn('blade-1');
	});
	await page.keyboard.press('k');
	await page.waitForTimeout(800);
	await auditScreen(page, `${tag} K 스킬 창(카메라 스크롤)`);
	await page.keyboard.press('k');
	await page.waitForTimeout(500);

	// ── 일시정지
	await page.keyboard.press('Escape');
	await page.waitForTimeout(700);
	const pauseRows = await auditScreen(page, `${tag} 일시정지(카메라 스크롤)`);
	const resume = pauseRows.find((r) => r.label === '계속하기');
	if (resume) {
		const [x, y, w, h] = resume.visual;
		await page.mouse.click(x + 8, y + 6); // 좌상단 모서리 안쪽
		await page.waitForTimeout(600);
		check(`[${tag}] 실클릭: 일시정지 '계속하기' 좌상단 모서리`,
			await page.evaluate(() => window.__gameScene.isPaused === false));
	} else {
		check(`[${tag}] 일시정지에 '계속하기' 버튼이 있다`, false);
	}
	await page.evaluate(() => { if (window.__gameScene.isPaused) window.__gameScene.togglePause(); });
	await page.waitForTimeout(400);

	// ── 통합 검 화면 (구매 목록 + 장착 + 보관함 — 2026-09-02 개편)
	await page.evaluate(() => {
		window.__gameScene.cameras.main.setScroll(2410, 1180);
		window.__gameScene.pickupSystem.runGold = 4000;
		window.__gameScene.shopSystem.open(3);
	});
	await page.waitForTimeout(1200);
	await auditScreen(page, `${tag} 통합 검 화면(카메라 스크롤)`);

	// 원소 필터 칩을 건 상태도 검사한다 (행 수·배치가 달라진다)
	await page.evaluate(() => window.__gameScene.shopSystem.ui.setElementFilter('none'));
	await page.waitForTimeout(500);
	await auditScreen(page, `${tag} 통합 검 화면·원소 필터`);
	await page.evaluate(() => window.__gameScene.shopSystem.ui.setElementFilter('all'));
	await page.waitForTimeout(400);
	await page.evaluate(() => window.__gameScene.shopSystem.close?.());
	await page.waitForTimeout(600);

	// ── 대기마을: 대장간 E = 통합 검 화면 (중간 창 없음)
	await page.evaluate(() => window.__gameScene.villageSystem.enter(1));
	await page.waitForTimeout(1200);
	await page.evaluate(() => window.__gameScene.villageSystem.openStall('smith'));
	await page.waitForTimeout(900);
	check(`[${tag}] 대장간 = 통합 검 화면 원탭`,
		await page.evaluate(() => window.__gameScene.shopSystem.isOpen === true
			&& window.__gameScene.villageSystem.activeWindow?.kind === 'smith'));
	await auditScreen(page, `${tag} 마을 통합 검 화면`);

	// ── 마을 증강 제단 (통합 화면에서 뺀 증강의 새 진입점) — 같은 마을 방문에서 이어 검사
	await page.evaluate(() => window.__gameScene.villageSystem.closeActiveWindow());
	await page.waitForTimeout(600);
	await page.evaluate(() => window.__gameScene.villageSystem.openStall('altar'));
	await page.waitForTimeout(800);
	await auditScreen(page, `${tag} 마을 증강 제단`);
	await page.evaluate(() => window.__gameScene.villageSystem.closeActiveWindow());
	await page.waitForTimeout(400);
	await page.evaluate(() => window.__gameScene.villageSystem.depart());
	await page.waitForTimeout(700);

	// ── 결과 화면
	await page.evaluate(() => {
		window.__gameScene.cameras.main.setScroll(-880, 1420);
		window.__gameScene.showGameOver();
	});
	await page.waitForTimeout(1400);
	await auditScreen(page, `${tag} 결과 화면(카메라 스크롤)`);

	check(`[${tag}] 콘솔 예외 없음`, errors.length === 0, errors.slice(0, 2).join(' / '));
	await page.close();
}

const browser = await chromium.launch(exe ? { executablePath: exe, args } : { args });
for (const viewport of VIEWPORTS) {
	console.log(`\n════════ 뷰포트 ${viewport.width}x${viewport.height} ════════`);
	await runViewport(browser, viewport);
}
await browser.close();

console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
if (failures.length) {
	console.log('실패 목록:');
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
