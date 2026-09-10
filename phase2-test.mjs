// Phase 2 mechanic augments headless test (dual orbit / return hit / twin sortie / rifts).
import { chromium } from 'playwright';
const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
  const a = s.augmentSystem;
  const so = s.swordOrbit;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const out = {};

  // condition: hasSwordTrio
  out.trioBefore = a.checkCondition('hasSwordTrio'); // 2 swords at start
  so.unlockedSlots = 4;
  so.addSword(s); so.addSword(s);
  out.swordCount = so.swords.length;
  out.trioAfter = a.checkCondition('hasSwordTrio');

  // apply phase-2 effects
  a.applyAugment({ id: 'p1', effects: { returnDamagePct: 0.45 } });
  a.applyAugment({ id: 'p2', effects: { twinLaunchChance: 0.2 } });
  a.applyAugment({ id: 'p3', effects: { dualOrbit: true, orbitSpeedMult: 0.2 } });
  a.applyAugment({ id: 'p4', effects: { returnMagnetRadius: 140 } });
  a.applyAugment({ id: 'p5', effects: { riftOnHit: { pct: 0.5, radius: 110, cooldownMs: 1200 } } });
  a.applyAugment({ id: 'p6', effects: { trailRift: { pct: 0.4, radius: 100, intervalMs: 450 } } });
  out.fields = {
    ret: so.returnDamagePct === 0.45,
    twin: so.twinLaunchChance === 0.2,
    dual: so.dualOrbit === true,
    magnet: a.returnMagnetRadius === 140,
    rift: !!a.riftOnHit,
    trail: !!a.trailRift,
  };

  // dual orbit positions: radii should split into two rings
  await wait(300);
  const p = s.player;
  const radii = so.swords.map((sw) => Math.round(Math.hypot(sw.x - p.x, sw.y - p.y)))
    .filter((d, i) => so.swords[i].state === 'orbiting');
  out.radii = radii;
  const rBase = so.radius;
  out.dualRings = radii.some((d) => Math.abs(d - rBase * 0.68) < 25) && radii.some((d) => Math.abs(d - rBase * 1.18) < 30);

  // carveRift: damages a far-away enemy after the delay (swords can't reach it,
  // and spawnGeneration guards against pool recycling resetting hp)
  const far = s.enemyManager.enemies.getChildren()
    .find((e) => e.active && e.hp > 5 && Math.hypot(e.x - s.player.x, e.y - s.player.y) > 380);
  if (far) {
    const hpBefore = far.hp;
    const genBefore = far.spawnGeneration;
    a.carveRift(far.x, far.y, 4, 600, 0xf59e0b);
    await wait(9000);
    out.riftDamaged = far.spawnGeneration !== genBefore ? 'recycled' : far.hp < hpBefore;
  } else {
    out.riftDamaged = 'no-enemy';
  }

  // twin launch smoke: force a launch and confirm no crash / claimed targets ok
  const orbiting = so.swords.find((sw) => sw.state === 'orbiting');
  const target = s.enemyManager.enemies.getChildren().find((e) => e.active);
  if (orbiting && target) {
    so.twinLaunchChance = 1; // force
    so.startLaunchedSword(orbiting, target, new Set());
    await wait(100);
    out.twinLaunched = so.swords.filter((sw) => sw.state === 'launched').length >= 2;
    so.twinLaunchChance = 0.2;
  } else {
    out.twinLaunched = 'no-enemy';
  }

  // let combat run a bit with everything active to shake out crashes
  await wait(2500);
  out.stillAlive = !s.isGameOver;
  return out;
});
await browser.close();
console.log(JSON.stringify(r, null, 2), 'errors:', errors);
const ok = r.trioBefore === false && r.trioAfter === true && Object.values(r.fields).every(Boolean)
  && r.dualRings && (r.riftDamaged === true || r.riftDamaged === 'no-enemy')
  && (r.twinLaunched === true || r.twinLaunched === 'no-enemy') && r.stillAlive && errors.length === 0;
console.log(ok ? 'PHASE2 TEST: PASS' : 'PHASE2 TEST: FAIL');
