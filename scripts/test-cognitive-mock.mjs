#!/usr/bin/env node
/**
 * CogniTrack — Pre-Desktop Mock Integration Test
 * Run from monorepo root: node scripts/test-cognitive-mock.mjs
 *
 * Validates the @cognitrack/shared cognitive engine end-to-end before
 * scaffolding apps/desktop/. If all tests pass, the shared package is
 * production-ready and the Electron agent can safely start pushing events.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// Resolve directly to dist/ — avoids pnpm symlink resolution issues
const shared = require(path.resolve(__dirname, '../packages/shared/dist/index.js'));
const {
  calculateCognitiveDebt,
  normalizeAppId,
  resolveCategory,
  decayResidue,
  applySwitch,
  computeVelocityMultiplier,
  CONTEXT_DISTANCE,
  TAU_MS,
  WM_INITIAL,
  WM_BREAK_GAIN,
} = shared;

// ─── Minimal test runner ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌  ${name}`);
    console.log(`       → ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

// ─── Suite ───────────────────────────────────────────────────────────────────
console.log('\nCogniTrack — Pre-Desktop Mock Integration Test');
console.log('='.repeat(55));

// 1. Import sanity — dist bundle loads without crashing
test('dist/index.js imports without crash', () => {
  assert(typeof calculateCognitiveDebt === 'function', 'calculateCognitiveDebt not a function');
  assert(typeof normalizeAppId         === 'function', 'normalizeAppId not a function');
  assert(typeof resolveCategory        === 'function', 'resolveCategory not a function');
  assert(typeof decayResidue           === 'function', 'decayResidue not a function');
  assert(typeof applySwitch            === 'function', 'applySwitch not a function');
  assert(typeof computeVelocityMultiplier === 'function', 'computeVelocityMultiplier not a function');
  assert(typeof TAU_MS  === 'number',  'TAU_MS not exported');
  assert(typeof WM_INITIAL === 'number', 'WM_INITIAL not exported');
});

// 2. Empty event list returns a fully-zeroed report
test('calculateCognitiveDebt([]) returns zeroed report', () => {
  const r = calculateCognitiveDebt([]);
  assert(r.cognitiveDebt       === 0,        `cognitiveDebt expected 0, got ${r.cognitiveDebt}`);
  assert(r.cognitiveLoadPct    === 0,        `cognitiveLoadPct expected 0, got ${r.cognitiveLoadPct}`);
  assert(r.wmCapacityRemaining === WM_INITIAL, `wmCapacity expected ${WM_INITIAL}, got ${r.wmCapacityRemaining}`);
  assert(r.residueAtEOD        === 0,        `residueAtEOD expected 0, got ${r.residueAtEOD}`);
  assert(Array.isArray(r.hourlyDebt) && r.hourlyDebt.length === 24, 'hourlyDebt must be a 24-element array');
});

// 3. End-to-end: a single context switch produces non-zero debt
test('Single switch event produces cognitiveDebt > 0', () => {
  const now = Date.now();
  const events = [
    { eventType: 'switch', category: 'tools',      timestamp: now - 60_000 },
    { eventType: 'switch', category: 'productive', timestamp: now },
  ];
  const r = calculateCognitiveDebt(events);
  assert(r.cognitiveDebt       > 0,        `cognitiveDebt expected > 0, got ${r.cognitiveDebt}`);
  assert(r.wmCapacityRemaining < WM_INITIAL, 'Working memory should have decreased');
});

// 4. Residue decays to < 6 % after 23 minutes  — validates TAU_MS constant
//    (Sophie Leroy 2009: attention residue clears in ~23 min)
test('Residue decays to <6% after 23 minutes (TAU_MS constant correct)', () => {
  const r23 = decayResidue(1.0, 23 * 60_000);
  assert(r23 < 0.06, `Expected residue < 6% at t=23 min, got ${(r23 * 100).toFixed(2)}%`);
});

// 5. normalizeAppId maps Windows process names correctly
//    — The Electron active-win poll pipeline depends on this map
test('normalizeAppId() maps Windows process names (active-win pipeline)', () => {
  assert(normalizeAppId('Code',            'win32') === 'win.vscode',   `'Code'            → got '${normalizeAppId('Code',            'win32')}'`);
  assert(normalizeAppId('WindowsTerminal', 'win32') === 'win.terminal', `'WindowsTerminal'  → got '${normalizeAppId('WindowsTerminal', 'win32')}'`);
  assert(normalizeAppId('msedge',          'win32') === 'win.edge',     `'msedge'           → got '${normalizeAppId('msedge',          'win32')}'`);
  assert(normalizeAppId('PowerShell',      'win32') === 'win.terminal', `'PowerShell'       → got '${normalizeAppId('PowerShell',      'win32')}'`);
  assert(normalizeAppId('Discord',         'win32') === 'win.discord',  `'Discord'          → got '${normalizeAppId('Discord',         'win32')}'`);
});

// 6. Asymmetric context distance matrix is intact
//    TikTok → VSCode (passiveWaste→productive = 9.0) must cost more than
//    VSCode → TikTok (productive→passiveWaste = 7.0)
test('Asymmetric matrix: passiveWaste→productive > productive→passiveWaste', () => {
  const pToP = CONTEXT_DISTANCE['passiveWaste']['productive']; // 9.0
  const pToW = CONTEXT_DISTANCE['productive']['passiveWaste']; // 7.0
  assert(pToP > pToW, `Expected passiveWaste→productive (${pToP}) > productive→passiveWaste (${pToW})`);
  assert(pToP === 9.0, `Expected passiveWaste→productive = 9.0, got ${pToP}`);
  assert(pToW === 7.0, `Expected productive→passiveWaste = 7.0, got ${pToW}`);
});

// 7. Velocity multiplier clamps correctly (1.0 at ≤1/min, 2.5 at ≥4/min)
test('computeVelocityMultiplier: floor=1.0, ceiling=2.5', () => {
  assert(computeVelocityMultiplier(0)   === 1.0, `0/min → expected 1.0, got ${computeVelocityMultiplier(0)}`);
  assert(computeVelocityMultiplier(1)   === 1.0, `1/min → expected 1.0, got ${computeVelocityMultiplier(1)}`);
  assert(computeVelocityMultiplier(4)   === 2.5, `4/min → expected 2.5, got ${computeVelocityMultiplier(4)}`);
  assert(computeVelocityMultiplier(10)  === 2.5, `10/min → expected 2.5 (capped), got ${computeVelocityMultiplier(10)}`);
  // Midpoint: 2.5/min → 1.0 + (2.5-1)*0.5 = 1.75
  assert(computeVelocityMultiplier(2.5) === 1.75, `2.5/min → expected 1.75, got ${computeVelocityMultiplier(2.5)}`);
});

// 8. Break event restores working memory
//    WM after [3 switches + break] > WM after [3 switches alone]
test('Break event restores working memory (WM_BREAK_GAIN applied)', () => {
  const now = Date.now();
  const switches = [
    { eventType: 'switch', category: 'productive', timestamp: now - 300_000 },
    { eventType: 'switch', category: 'social',     timestamp: now - 240_000 },
    { eventType: 'switch', category: 'productive', timestamp: now - 180_000 },
  ];
  const withBreak = [
    ...switches,
    { eventType: 'break', category: null, timestamp: now - 60_000 },
  ];

  const rNo  = calculateCognitiveDebt(switches);
  const rYes = calculateCognitiveDebt(withBreak);

  assert(
    rYes.wmCapacityRemaining > rNo.wmCapacityRemaining,
    `WM with break (${rYes.wmCapacityRemaining}) should be > WM without break (${rNo.wmCapacityRemaining})`
  );
});

// 9. resolveCategory defaults to 'tools' for unknown canonical IDs
test('resolveCategory() returns "tools" for unknown app IDs', () => {
  assert(resolveCategory('win.unknown.mygame') === 'tools', `Expected 'tools', got '${resolveCategory('win.unknown.mygame')}'`);
  assert(resolveCategory('win.unknown.someinternalapp') === 'tools', 'Fallback should be tools');
});

// 10. applySwitch() caps residue at 1.0 under extreme rapid switching
test('applySwitch() residue never exceeds 1.0 (20 rapid max-cost switches)', () => {
  let residue = 0;
  for (let i = 0; i < 20; i++) {
    residue = applySwitch(residue, 100, 9.0); // 100 ms apart, max cost
  }
  assert(residue <= 1.0, `Expected residue ≤ 1.0, got ${residue}`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('─'.repeat(55));
if (failed === 0) {
  console.log(`\n🎉  All ${passed} tests passed — shared cognitive engine is production-ready.`);
  console.log('    You\'re clear to scaffold apps/desktop/\n');
} else {
  console.log(`\n⚠️   ${passed} passed, ${failed} FAILED — fix issues before touching apps/desktop/\n`);
  process.exit(1);
}
