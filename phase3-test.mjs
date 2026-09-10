// Phase 3 test: sword awakening (round 40) + swordsoul collectible set.
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
await page.keyboard.press('Space'); await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForFunction(() => !!window.__gameScene, null, { timeout: 15000 });
await page.waitForTimeout(1200);

const r = await page.evaluate(async () => {
  const s = window.__gameScene;
  const a = s.augmentSystem;
  const so = s.swordOrbit;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const out = {};

  // --- milestone recalc fix: level 3 gives +1 hit, survives rebuild
  const sw0 = so.swords[0];
  const hitsL1 = sw0.hitsPerLaunch;
  so.levelUpSword(sw0); so.levelUpSword(sw0); // -> Lv3
  out.milestoneHit = sw0.hitsPerLaunch === hitsL1 + 1;
  so.rebuildLoadout(so.getLoadout());
  out.milestoneSurvivesRebuild = so.swords[0].hitsPerLaunch === hitsL1 + 1 && so.swords[0].level === 3;

  // --- awakening flow: open(40) shows sword-select UI, chained close
  let chained = false;
  a.slotIndex = 2; // round-40 slot
  a.open(40, () => { chained = true; });
  await wait(300);
  out.awakeningUiOpen = a.isOpen && a.uiObjects.length > 0;

  const target = so.swords[0];
  const dmgBefore = target.damage;
  a.pickAwakeningSword(target);
  await wait(200);
  out.optionUiBuilt = a.uiObjects.length > 0;

  const ruin = { id: 'ruin', name: '파괴 각성', icon: '🔥', desc: '' };
  a.applyAwakening(target, ruin);
  await wait(200);
  out.ruinApplied = Math.abs(target.damage - Math.round(dmgBefore * 1.85)) <= 2;
  out.awakeningRecorded = so.awakenings[target.definition.id] === 'ruin';
  out.chained = chained;
  out.slotAdvanced = a.slotIndex === 3;

  // --- awakening survives rebuildLoadout (id-keyed)
  so.rebuildLoadout(so.getLoadout());
  out.ruinSurvivesRebuild = Math.abs(so.swords[0].damage - Math.round(dmgBefore * 1.85)) <= 2;

  // --- gale & aegis on a second sword (direct)
  so.unlockedSlots = 4;
  const sw2 = so.addSword(s);
  if (sw2) {
    const cdBefore = sw2.scanInterval;
    const hitsBefore = sw2.hitsPerLaunch;
    so.awakenings[sw2.definition.id] = 'gale';
    so.recalculateSwordStats(sw2);
    out.galeApplied = sw2.scanInterval < cdBefore * 0.7 && sw2.hitsPerLaunch === hitsBefore + 1;
  } else { out.galeApplied = 'no-slot'; }

  const dmgMultBefore = so.damageMultiplier;
  const takenMultBefore = a.damageTakenMult;
  const fakeSword = so.swords[so.swords.length - 1];
  a.isOpen = true; // applyAwakening guard
  a.applyAwakening(fakeSword, { id: 'aegis', name: '수호 각성', icon: '🛡️', desc: '' });
  out.aegisApplied = Math.abs(so.damageMultiplier - (dmgMultBefore + 0.12)) < 1e-9
    && Math.abs(a.damageTakenMult - takenMultBefore * 0.92) < 1e-9;

  // --- swordsoul set: 3 pieces -> combo fires once
  const pieces = ['swordsoul-ember', 'swordsoul-wind', 'swordsoul-star'];
  const defs = pieces.map((id) => a.poolForTier('steel').concat(a.poolForTier('gold')).find((x) => x.id === id));
  out.piecesInPool = defs.every(Boolean);
  const dmg3 = so.damageMultiplier;
  const echo3 = so.echoLaunchChance;
  out.progress0 = JSON.stringify(a.getSetProgress('swordsoul'));
  for (const def of defs) { a.taken.add(def.id); a.applyAugment(def); }
  out.progress3 = JSON.stringify(a.getSetProgress('swordsoul'));
  out.setFired = a.taken.has('set:swordsoul')
    && Math.abs(so.damageMultiplier - (dmg3 + 0.08 + 0.25)) < 1e-9
    && Math.abs(so.echoLaunchChance - Math.min(0.6, echo3 + 0.15)) < 1e-9;
  // re-apply last piece -> no double combo
  const dmgAfter = so.damageMultiplier;
  a.applyAugment(defs[2]);
  out.noDoubleFire = Math.abs(so.damageMultiplier - dmgAfter) < 1e-9;

  // HUD description mentions awakening
  out.hudLine = so.describeSword(so.swords[0]).includes('각성');

  await wait(1500);
  out.stillAlive = !s.isGameOver;
  return out;
});
await browser.close();
console.log(JSON.stringify(r, null, 2), 'errors:', errors);
const vals = Object.entries(r).filter(([k]) => !['progress0', 'progress3'].includes(k));
const ok = vals.every(([, v]) => v === true || v === 'no-slot') && errors.length === 0;
console.log(ok ? 'PHASE3 TEST: PASS' : 'PHASE3 TEST: FAIL');
