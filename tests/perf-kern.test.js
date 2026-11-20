// Kerntests des Start-/Landestreckenrechners (perf/perf.js VERSION 8, Stand 20.11.2026): Export, Browsercode,
// Schema-2-Mechanik mit synthetischen Daten (Ablesung, Wind, Belag, Faktoren, Rundung, Grenzen, Gewicht), Fail-closed
// und Robustheit. Die Erweiterungen E1–E8 (Schema 3) prüft tests/perf-erweiterungen.test.js, die EDSF-Daten
// tests/perf-edsf-daten.test.js. Dass Schema-2-Daten bit-gleich wie VERSION 7 rechnen, ist zusätzlich lokal mit den
// 212 Tests und Daten des Repos LSZK-Webcams nachgewiesen (nicht Teil dieses Repos).
// Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const CORE_PATH = path.join(ROOT, 'perf', 'perf.js');
const core = require(CORE_PATH);

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.keys(o).forEach((k) => deepFreeze(o[k]));
  }
  return o;
}
function close(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≠ ' + b); }
function meters(p) { return [p.m.groundRoll, p.m.overObstacle]; }
function rwy(r, id) { return r.runways.find((x) => x.id === id); }

// Gitter Druckhöhe (ft) × Temperatur (°C)
function grid(paVals, tVals, cells, unit, read) {
  return {
    type: 'grid',
    axes: [
      { quantity: 'pressureAltitude', unit: 'ft', values: paVals, read: read || 'linear', below: 'lowest', above: 'none' },
      { quantity: 'temperature', unit: 'degC', values: tVals, read: read || 'linear', below: 'lowest', above: 'none' }
    ],
    outputs: [{ id: 'groundRoll', unit: unit || 'm' }, { id: 'overObstacle', unit: unit || 'm' }],
    obstacle: { value: 50, unit: 'ft' },
    cells
  };
}
// Synthetisches Muster in Schema 2: Start mit Prozent-Windregel, Gras +15 % der Rollstrecke, nass × 1,2 (mindestens);
// Landung mit absoluter Windregel, Gras +45 % der Rollstrecke, immer × 1,67
function s2() {
  return {
    schema: 2, id: 'test2', label: 'Testmuster Schema 2', mass: { kg: 1000, lb: 2205 },
    sources: { afm: { labelDe: 'AFM' } },
    charts: {
      takeoff: {
        source: 'afm', title: 'Start 1000 kg', ref: { figure: 'T', page: '1' }, base: { surface: 'paved', surfaceCondition: 'dry' },
        table: grid([0, 2000, 4000], [0, 20, 40], [
          [[200, 400], [220, 440], [250, 500]],
          [[240, 480], [266, 532], [300, 600]],
          [[290, 580], [320, 640], [360, 720]]
        ]),
        corrections: [
          { kind: 'headwind', type: 'percentPer', percent: -10, per: 9, unit: 'kt' },
          { kind: 'surface', type: 'addPercentOf', surface: 'grass', surfaceCondition: 'dry', percent: 15, of: 'groundRoll' },
          { kind: 'factor', when: 'wet', surface: 'grass', factor: 1.2, minimum: true, labelDe: 'nasse Piste', refDe: 'Test' }
        ]
      },
      landing: {
        source: 'afm', title: 'Landung 1000 kg', ref: { figure: 'L', page: '2' }, base: { surface: 'paved', surfaceCondition: 'dry' },
        table: grid([0, 2000, 4000], [0, 20, 40], [
          [[150, 350], [160, 370], [170, 390]],
          [[160, 370], [172, 394], [184, 418]],
          [[172, 394], [186, 422], [200, 450]]
        ]),
        corrections: [
          { kind: 'headwind', type: 'absolutePer', amount: -5, amountUnit: 'm', per: 1, unit: 'kt' },
          { kind: 'surface', type: 'addPercentOf', surface: 'grass', surfaceCondition: 'dry', percent: 45, of: 'groundRoll' },
          { kind: 'factor', when: 'always', factor: 1.67, minimum: false, labelDe: 'Betrieb', refDe: 'Test' }
        ]
      }
    }
  };
}
// Platz mit einer Piste 36 (rechtweisend 360°); bei QNH 1013,25 hPa ist die Druckhöhe gleich der Platzhöhe
function field(elevFt, surface, toM, ldgM) {
  return {
    schema: 2, icao: 'TEST', elevation: { value: elevFt, unit: 'ft' },
    runways: [{ id: '36', bearingTrue: 360, surface: surface || 'paved',
      takeoffAvailable: { value: toM || 1000, unit: 'm' }, landingAvailable: { value: ldgM || 900, unit: 'm' } }]
  };
}
function wx(tempC, qnhHpa, windDirTrue, windKt, runwayWet, massKg) {
  const w = { tempC, qnhHpa, windDirTrue, windKt, runwayWet: runwayWet === true };
  if (massKg !== undefined) w.massKg = massKg;
  return w;
}
function run(ac, af, input) {
  const r = core.compute(ac, af, input);
  assert.equal(r.ok, true, 'Rechnung ok erwartet: ' + JSON.stringify(r.error));
  return r;
}

/* ── Export und Browsercode ─────────────────────────────────── */

test('Export: VERSION 9, Node module.exports, im Browser window.PerfCore gleich window.LszkPerfCore', () => {
  assert.equal(core.VERSION, 9);
  assert.equal(core.SCHEMA, 2);
  assert.deepEqual(core.SCHEMAS, [2, 3]);
  assert.equal(core.SCHEMA_EXT, 3);
  ['compute', 'validateAircraft', 'validateAirfield', 'checkInput', 'lookupTable', 'windForRunway', 'takeoffTables', 'landingTables',
    'pickTakeoffTable', 'takeoffMassBracket', 'landingMassBracket', 'pressureAltitudeFt', 'pressureAltitudeM', 'ceilMeters'].forEach((k) => {
    assert.equal(typeof core[k], 'function', k);
  });
  // Browser: kein module, globales Objekt self
  const sandbox = {};
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CORE_PATH, 'utf8'), sandbox);
  assert.ok(sandbox.PerfCore && typeof sandbox.PerfCore.compute === 'function');
  assert.equal(sandbox.PerfCore, sandbox.LszkPerfCore);
  assert.equal(sandbox.PerfCore.VERSION, 9);
});

test('Browsercode: ES5 ohne ?., ??, Lookbehind, Pfeilfunktionen, let/const, Template-Strings und ohne BOM', () => {
  const src = fs.readFileSync(CORE_PATH, 'utf8');
  assert.ok(!src.includes('?.'), '?.');
  assert.ok(!src.includes('??'), '??');
  assert.ok(!src.includes('(?<'), 'Lookbehind');
  assert.ok(!src.includes('=>'), 'Pfeilfunktion');
  assert.ok(!/\b(let|const)\s/.test(src), 'let/const');
  assert.ok(!src.includes('`'), 'Template-String');
  assert.ok(src.charCodeAt(0) !== 0xfeff, 'BOM');
  assert.ok(src.includes('VERSION gleich dem ?v= in index.html'), 'Kopfkommentar');
});

test('Druckhöhe: Formel, Aufrunden auf ganze ft, in m exakt aufgerundet ohne −0', () => {
  assert.equal(core.pressureAltitudeFt(2885, 1013.25), 2885);
  close(core.pressureAltitudeFt(0, 1000), 363.79, 0.01);           // rund 27,5 ft je hPa
  // m = ft × 0,3048 aufgerundet (2500 ft = 762,0 m genau, 2974 ft = 906,4752 m → 907 m)
  [[2500, 762], [1, 1], [0, 0], [3280, 1000], [3281, 1001], [2974, 907], [2702, 824], [-4, -1], [10000, 3048]].forEach(([ft, m]) => {
    assert.equal(core.pressureAltitudeM(ft), m, ft + ' ft');
  });
  assert.ok(Object.is(core.pressureAltitudeM(-1), 0), '−1 ft → 0 m ohne −0');
  // jede ganze Druckhöhe von −2000 bis 20000 ft gegen exakte Ganzzahlrechnung (BigInt): ceil(ft × 3048 / 10000)
  for (let ft = -2000; ft <= 20000; ft++) {
    const n = BigInt(ft) * 3048n;
    let q = n / 10000n;                                       // BigInt teilt zur Null hin
    if (n > 0n && n % 10000n !== 0n) q += 1n;
    assert.ok(Object.is(core.pressureAltitudeM(ft), Number(q) === 0 ? 0 : Number(q)), ft + ' ft');
  }
});

/* ── Schema 2: Rechnung mit synthetischen Daten (von Hand nachgerechnet) ── */

test('Schema 2: Ablesung linear, Windstille, Hartbelag – Start und Landung von Hand', () => {
  // Druckhöhe 1000 ft (Gewicht 0,5 zwischen 0 und 2000), 10 °C (Gewicht 0,5 zwischen 0 und 20):
  // Start: Mittel der vier Ecken (200 + 220 + 240 + 266) / 4 = 231,5; (400 + 440 + 480 + 532) / 4 = 463 → 232 / 463 m
  // Landung: (150 + 160 + 160 + 172) / 4 = 160,5; (350 + 370 + 370 + 394) / 4 = 371; × 1,67 = 268,035 / 619,57 → 269 / 620 m
  const r = run(s2(), field(1000), wx(10, 1013.25, null, 0));
  const p = rwy(r, '36');
  assert.equal(r.mode, 'calm');
  assert.deepEqual([p.takeoff.table.groundRoll, p.takeoff.table.overObstacle], [231.5, 463]);
  assert.deepEqual(meters(p.takeoff), [232, 463]);
  close(p.landing.final.groundRoll, 268.035, 1e-9);
  close(p.landing.final.overObstacle, 619.57, 1e-9);
  assert.deepEqual(meters(p.landing), [269, 620]);
  assert.deepEqual([p.takeoff.rules, p.takeoff.ruleOfThumb, p.takeoff.afterRules], [[], false, { groundRoll: 231.5, overObstacle: 463 }]);
  assert.equal(r.pressureAltitudeTableM, 305);                  // 1000 ft × 0,3048 = 304,8 → 305 m
  assert.deepEqual([r.landingAbsent, r.ruleOfThumb], [false, false]);
});

test('Schema 2: Gegenwind nach Regel – Prozent abgerundet, absolut, Belag aus der Tabellen-Rollstrecke, Faktoren', () => {
  // 13,9 kt von vorn → 13 kt. Start: 10 % je 9 kt → 14,44 % → 14 % (abgerundet): 231,5 × 0,86 = 199,09; 463 × 0,86 = 398,18
  // Gras +15 % von 231,5 = 34,725 → 233,815 / 432,905 → 234 / 433 m; nass × 1,2 → 280,578 / 519,486 → 281 / 520 m
  // Landung: 5 m je kt → 65 m: 95,5 / 306; Gras +45 % von 160,5 = 72,225 → 167,725 / 378,225; × 1,67 → 280,10… / 631,63… → 281 / 632 m
  let r = run(s2(), field(1000, 'paved'), wx(10, 1013.25, 360, 13.9));
  let p = rwy(r, '36');
  assert.deepEqual([p.wind.kt, p.takeoff.wind.percent, p.takeoff.wind.type], [13, 14, 'percentPer']);
  close(p.takeoff.afterWind.groundRoll, 199.09, 1e-9);
  assert.deepEqual(meters(p.takeoff), [200, 399]);
  assert.deepEqual([p.landing.wind.type, p.landing.wind.reduction], ['absolutePer', 65]);
  r = run(s2(), field(1000, 'grass'), wx(10, 1013.25, 360, 13.9));
  p = rwy(r, '36');
  assert.deepEqual([p.takeoff.surface.type, p.takeoff.surface.base, p.takeoff.surface.minimum], ['addPercentOf', 231.5, false]);
  close(p.takeoff.surface.inc, 34.725, 1e-9);
  assert.deepEqual(meters(p.takeoff), [234, 433]);
  assert.deepEqual(meters(p.landing), [281, 632]);
  assert.equal(p.landing.factors.length, 1);
  r = run(s2(), field(1000, 'grass'), wx(10, 1013.25, 360, 13.9, true));
  p = rwy(r, '36');
  assert.deepEqual(meters(p.takeoff), [281, 520]);
  assert.deepEqual(p.takeoff.factors.map((f) => [f.factor, f.when, f.minimum]), [[1.2, 'wet', true]]);
  assert.deepEqual([p.takeoff.wetFactorMissing, p.landing.wetFactorMissing], [false, true]);
  // Der Nässefaktor gilt nur für seinen Belag (Gras): nasser Hartbelag rechnet wie trocken, ohne Faktor, mit Hinweis
  // (mit Faktor wären es 239 / 479 m)
  r = run(s2(), field(1000, 'paved'), wx(10, 1013.25, 360, 13.9, true));
  p = rwy(r, '36');
  assert.deepEqual([meters(p.takeoff), p.takeoff.factors, p.takeoff.wetFactorMissing], [[200, 399], [], true]);
});

test('Schema 2: Grenzen – 50-%-Grenze der Windregel, über 40 kt, über dem Tabellenbereich, Rückenwind, über dem Höchstgewicht', () => {
  // Landung 17 kt: 85 m Abzug > Hälfte von 160,5 → kein Wert; Start 17 kt: 10 × 17 / 9 = 18,89 % → abgerundet 18 %
  // → 231,5 × 0,82 = 189,83 → 190; 463 × 0,82 = 379,66 → 380 (gerundet 19 % gäbe 188 / 376)
  let r = run(s2(), field(1000), wx(10, 1013.25, 360, 17.5));
  assert.deepEqual([rwy(r, '36').landing.ok, rwy(r, '36').landing.reason, rwy(r, '36').takeoff.ok], [false, 'wind-credit-limit', true]);
  assert.deepEqual([rwy(r, '36').takeoff.wind.percent, meters(rwy(r, '36').takeoff)], [18, [190, 380]]);
  r = run(s2(), field(1000), wx(10, 1013.25, 360, 41));
  assert.deepEqual([rwy(r, '36').takeoff.reason, rwy(r, '36').takeoff.limitKt, rwy(r, '36').landing.reason], ['headwind-limit', 40, 'headwind-limit']);
  r = core.compute(s2(), field(1000), wx(40.1, 1013.25, null, 0));
  assert.deepEqual([r.ok, r.error.code, r.error.above], [false, 'above-range', [{ quantity: 'temperature', unit: 'degC', value: 40.1, max: 40 }]]);
  assert.deepEqual([r.pressureAltitudeTableFt, r.pressureAltitudeTableM], [1000, 305]);
  r = core.compute(s2(), field(4001), wx(10, 1013.25, null, 0));
  assert.deepEqual(r.error.above, [{ quantity: 'pressureAltitude', unit: 'ft', value: 4001, max: 4000 }]);
  r = run(s2(), field(1000), wx(10, 1013.25, 180, 10));
  assert.deepEqual([rwy(r, '36').computed, rwy(r, '36').reason, rwy(r, '36').takeoff, rwy(r, '36').landing], [false, 'tailwind', null, null]);
  r = core.compute(s2(), field(1000), wx(10, 1013.25, null, 0, false, 1001));
  assert.deepEqual([r.ok, r.error], [false, { code: 'above-mass', massKg: 1001, maxKg: 1000 }]);
  r = core.compute(s2(), field(1000), wx(61, 1013.25, null, 0));
  assert.deepEqual([r.ok, r.error.code, r.error.fields], [false, 'invalid-input', [{ field: 'tempC', value: 61 }]]);
});

test('Schema 2: nächsthöherer Tabellenwert, Tabelle in ft auf ganze m aufgerundet', () => {
  const ac = s2();
  ac.charts.takeoff.table = grid([0, 2000, 4000], [0, 20, 40], ac.charts.takeoff.table.cells, 'm', 'nextHigher');
  // 1000 ft → 2000 ft, 10 °C → 20 °C: Zelle [266, 532]
  let r = run(ac, field(1000), wx(10, 1013.25, null, 0));
  assert.deepEqual(meters(rwy(r, '36').takeoff), [266, 532]);
  assert.deepEqual([r.lookups.takeoff.interpolated, r.lookups.takeoff.axes.map((a) => a.unit)], [false, ['ft', 'degC']]);
  // Tabelle in ft: 1000 ft / 0 °C → [656, 1312] ft (linear zwischen 0 und 2000 ft: (600 + 712) / 2 = 656, (1200 + 1424) / 2 = 1312)
  // in m: 656 × 0,3048 = 199,9488 → 200; 1312 × 0,3048 = 399,8976 → 400
  const ft = s2();
  ft.charts.landing.table = grid([0, 2000], [0, 20], [[[600, 1200], [650, 1300]], [[712, 1424], [760, 1520]]], 'ft');
  ft.charts.landing.corrections = [];
  r = run(ft, field(1000), wx(0, 1013.25, null, 0));
  const l = rwy(r, '36').landing;
  assert.deepEqual([l.unit, l.final.groundRoll, l.final.overObstacle], ['ft', 656, 1312]);
  close(l.meters.groundRoll, 199.9488, 1e-9);
  assert.deepEqual(meters(l), [200, 400]);
});

test('Schema 2: Gewicht – Starttabellen linear und nächsthöher, «möglich bis» auf ganze kg; Landung immer maximales Landegewicht', () => {
  const ac = s2();
  // 900-kg-Tabelle: Haupttabelle − 40 m (Rollstrecke) bzw. − 80 m (über 15 m)
  ac.charts.takeoff.lowerWeights = [{
    mass: { kg: 900, lb: 1984 }, title: 'Start 900 kg', ref: { figure: 'T', page: '3' },
    table: grid([0, 2000, 4000], [0, 20, 40], ac.charts.takeoff.table.cells.map((row) => row.map((c) => [c[0] - 40, c[1] - 80])))
  }];
  ac.charts.takeoff.massRead = 'linear';
  // 950 kg: Mitte zwischen 1000 kg (231,5 / 463) und 900 kg (191,5 / 383) → 211,5 / 423
  let r = run(ac, field(1000), wx(10, 1013.25, null, 0, false, 950));
  let p = rwy(r, '36');
  assert.deepEqual([p.takeoff.table.groundRoll, p.takeoff.table.overObstacle], [211.5, 423]);
  assert.deepEqual([r.mass.tableKg, r.mass.lowerKg, r.mass.interpolated, r.lookups.takeoff.mass.weight], [1000, 900, true, 0.5]);
  assert.deepEqual(p.takeoffByMass.map((t) => [t.kg, t.m.overObstacle]), [[1000, 463], [900, 383]]);
  // Landung (Schema 2): eine Tabelle, maximales Landegewicht
  assert.deepEqual([r.massLandingUsed.kg, r.massLandingUsed.tableCount, r.massLandingUsed.interpolated, r.massLandingUsed.capped], [1000, 1, false, false]);
  assert.deepEqual(meters(p.landing), meters(rwy(run(s2(), field(1000), wx(10, 1013.25, null, 0)), '36').landing));
  // «möglich bis»: verfügbar 440 m; 1000 kg 463 m zu lang. Über 15 m(kg) = 383 + 80 × (kg − 900) / 100 ≤ 440 → kg ≤ 971,25 → 971 kg
  r = run(ac, field(1000, 'paved', 440), wx(10, 1013.25, null, 0));
  p = rwy(r, '36');
  assert.deepEqual([p.takeoffLimit.state, p.takeoffLimit.maxKg, p.takeoffLimit.maxPossibleKg], ['limit', 971, 971]);
  // nächsthöher: 950 kg → Tabelle 1000 kg; «möglich bis» die Tabelle 900 kg
  delete ac.charts.takeoff.massRead;
  r = run(ac, field(1000, 'paved', 440), wx(10, 1013.25, null, 0, false, 950));
  p = rwy(r, '36');
  assert.deepEqual([meters(p.takeoff), p.takeoffLimit.state, p.takeoffLimit.maxKg], [[232, 463], 'limit', 900]);
  assert.deepEqual(core.takeoffMassBracket(ac, 950), { upper: 0, lower: null, num: null, den: null, weight: null });
});

/* ── Fail-closed und Robustheit ────────────────────────────── */

test('Fail-closed Schema 2: Fehlertexte wie VERSION 7, Erweiterungsfelder nur ab Schema 3', () => {
  const errs = (mut, base) => { const a = clone(base || s2()); mut(a); return core.validateAircraft(a).errors; };
  assert.deepEqual(core.validateAircraft(s2()), { ok: true, errors: [] });
  assert.deepEqual(errs((a) => { a.schema = 4; }), ['schema unbekannt']);
  assert.deepEqual(errs((a) => { a.schema = '3'; }), ['schema unbekannt']);
  assert.deepEqual(errs((a) => { a.charts.landing.lowerWeights = [{ mass: { kg: 900, lb: 1984 }, table: clone(a.charts.landing.table) }]; }),
    ['charts.landing.lowerWeights nur beim Start erlaubt']);
  assert.deepEqual(errs((a) => { a.charts.landing.massRead = 'linear'; }), ['charts.landing.massRead nur beim Start erlaubt']);
  assert.deepEqual(errs((a) => { a.charts.takeoff.table.axes[0].unit = 'm'; }), ['charts.takeoff.table.axes[0].unit unbekannt']);
  assert.deepEqual(errs((a) => { a.charts.takeoff.table.axes[1].quantity = 'temperatureDeviation'; }), ['charts.takeoff.table.axes[1].quantity unbekannt']);
  assert.deepEqual(errs((a) => { a.charts.takeoff.table.axes[1].quantity = 'headwind'; }), ['charts.takeoff.table.axes[1].quantity unbekannt']);
  assert.deepEqual(errs((a) => { a.charts.takeoff.corrections[1].minimum = true; }), ['charts.takeoff.corrections[1].minimum nur ab Schema 3']);
  assert.deepEqual(errs((a) => { a.massLanding = { kg: 950, lb: 2094 }; }), ['massLanding nur ab Schema 3']);
  assert.ok(errs((a) => { a.charts.landing = { absent: true, reasonDe: 'fehlt' }; }).includes('charts.landing.absent nur ab Schema 3'));
  assert.ok(errs((a) => { a.charts.takeoff.corrections[1].type = 'percentOfEach'; delete a.charts.takeoff.corrections[1].of; })
    .includes('charts.takeoff.corrections[1].type unbekannt'));
  assert.ok(errs((a) => { a.charts.takeoff.corrections[0] = { kind: 'headwind', type: 'factorTable', unit: 'kt', points: [[0, 1], [10, 0.9]], above: 'highest' }; })
    .includes('charts.takeoff.corrections[0].type unbekannt'));
  assert.ok(errs((a) => { a.charts.landing.corrections.push({ kind: 'altitudeRule', percentPer1000ft: 5, labelDe: 'x', refDe: 'y' }); })
    .includes('charts.landing.corrections[3].kind unbekannt'));
  assert.ok(errs((a) => { a.charts.landing.table = { type: 'point', conditions: { pressureAltitudeFt: 0, temperatureC: 15 }, outputs: a.charts.landing.table.outputs, obstacle: { value: 50, unit: 'ft' }, values: [100, 200] }; })
    .includes('charts.landing.table.type unbekannt'));
  assert.ok(errs((a) => { a.charts.takeoff.table.axes[1].stdTempC = [15, 7, -1]; }).includes('charts.takeoff.table.axes[1].stdTempC nur bei temperatureDeviation'));
  // Platzdaten: nur Schema 2
  const af = field(1000);
  af.schema = 3;
  assert.deepEqual(core.validateAirfield(af), { ok: false, errors: ['schema unbekannt'] });
  const r = core.compute(s2(), af, wx(10, 1013.25, null, 0));
  assert.deepEqual([r.ok, r.error.code], [false, 'bad-data']);
});

test('Fail-closed Schema 2: Monotonie, Hindernis, Ausgaben, Form der Zellen', () => {
  const bad = (mut) => { const a = clone(s2()); mut(a); return core.validateAircraft(a).errors; };
  assert.deepEqual(bad((a) => { a.charts.takeoff.table.cells[1][1] = [215, 532]; }), ['charts.takeoff.table.cells nicht monoton']);
  assert.deepEqual(bad((a) => { a.charts.takeoff.table.cells[0][0] = [200, 199]; }), ['charts.takeoff.table.cells: Strecke über Hindernis kürzer als Rollstrecke']);
  assert.deepEqual(bad((a) => { a.charts.takeoff.table.obstacle.value = 35; }), ['charts.takeoff.table.obstacle unbekannt']);
  assert.deepEqual(bad((a) => { a.charts.takeoff.table.cells[2].pop(); }), ['charts.takeoff.table.cells Form oder Wert falsch']);
  assert.deepEqual(bad((a) => { a.charts.takeoff.table.cells[2][2][1] = 9001; }), ['charts.takeoff.table.cells Form oder Wert falsch']);
  assert.deepEqual(bad((a) => { a.charts.takeoff.table.outputs[1].unit = 'ft'; }), ['charts.takeoff.table.outputs[1].unit verschieden']);
  assert.deepEqual(bad((a) => { a.charts.takeoff.table.axes[0].values = [0, 2000, 25000]; }),
    ['charts.takeoff.table.axes[0].values nicht streng steigend oder ausserhalb -2000…20000']);
  assert.deepEqual(bad((a) => { a.charts.takeoff.table.axes[0].above = 'highest'; }), ['charts.takeoff.table.axes[0].above unbekannt']);
});

test('Robustheit: compute wirft nie, Validierung liest die Korrekturen genau einmal, Eingaben und Daten bleiben unverändert', () => {
  const attempt = (fn) => { try { return fn(); } catch (e) { return 'geworfen'; } };
  const fail = () => { throw new Error('Falle'); };
  const hostile = new Proxy({}, { get: fail, has: fail, ownKeys: fail, getOwnPropertyDescriptor: fail });
  [hostile, undefined, null, 0, 'x', [], {}, { schema: 3, charts: [] }, { schema: 3, charts: { takeoff: null, landing: { absent: true } } }].forEach((x, i) => {
    const v = attempt(() => core.validateAircraft(x));
    assert.ok(v !== 'geworfen' && v.ok === false && v.errors.length > 0, 'Flugzeug ' + i);
    const r = attempt(() => core.compute(x, field(1000), wx(10, 1013.25, null, 0)));
    assert.ok(r !== 'geworfen' && r.ok === false && r.error.code === 'bad-data', 'compute ' + i);
  });
  // Getter wirft ab dem zweiten Zugriff: die Prüfung liest einmal, die Rechnung danach → internal (nicht bad-data)
  const late = s2();
  late.schema = 3;
  const corr = late.charts.takeoff.corrections;
  let reads = 0;
  Object.defineProperty(late.charts.takeoff, 'corrections', { get() { reads++; if (reads > 1) throw new Error('kaputt'); return corr; } });
  const r = core.compute(late, field(1000), wx(10, 1013.25, null, 0));
  assert.deepEqual([r.ok, r.error.code, reads], [false, 'internal', 2]);
  // eingefroren: rechnet und verändert nichts
  const ac = deepFreeze(s2()), af = deepFreeze(field(1000, 'grass')), inp = deepFreeze(wx(10, 1013.25, 360, 13.9, true));
  const before = JSON.stringify([ac, af, inp]);
  assert.deepEqual(meters(rwy(run(ac, af, inp), '36').takeoff), [281, 520]);
  assert.equal(JSON.stringify([ac, af, inp]), before);
});

test('Schlussprobe im Kern: unplausible Zwischenwerte ergeben internal (direkt aufgerufen, auch mit Punkt-Kontext)', () => {
  const chart = s2().charts.takeoff;
  const lk = (gr, ob) => ({ values: { groundRoll: gr, overObstacle: ob } });
  let p = core._computePhase(chart, lk(300, 450.2), { surface: 'paved' }, { kt: 0 }, false, 1000);
  assert.deepEqual([p.ok, p.m], [true, { groundRoll: 300, overObstacle: 451 }]);
  [[450, 300], [300.5, 300.2], [NaN, 450], [300, Infinity], [0, 450]].forEach(([gr, ob]) => {
    p = core._computePhase(chart, lk(gr, ob), { surface: 'paved' }, { kt: 0 }, false, 1000);
    assert.deepEqual([p.ok, p.reason, p.m], [false, 'internal', null], gr + ' / ' + ob);
  });
  // Faustregel-Punkt ohne Druckhöhe und Temperatur: Ausnahme, die compute als internal abfängt
  const pt = { source: 'afm', base: { surface: 'grass', surfaceCondition: 'dry' }, table: { type: 'point', outputs: chart.table.outputs, values: [100, 200] },
    corrections: [{ kind: 'altitudeRule', percentPer1000ft: 10 }, { kind: 'temperatureRule', percentPer10C: 10, reference: 'isa' }] };
  assert.throws(() => core._computePhase(pt, lk(100, 200), { surface: 'grass' }, { kt: 0 }, false, 1000));
});
