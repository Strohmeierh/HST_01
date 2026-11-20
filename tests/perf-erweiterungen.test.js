// Tests der Erweiterungen E1–E8 des Rechenkerns (perf/perf.js VERSION 8, Datenschema 3, Stand 20.11.2026) mit
// synthetischen Daten: je Erweiterung Validierung (gültig, ungültig mit Fehlertext, Grenzwerte), Ablesung,
// Interpolation, Rundung, Grenzen und Reihenfolge der Schritte. Die Sollwerte sind von Hand gerechnet (im Kommentar).
// Plan: plan-edsf.md, Abschnitt «A: Kern». Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'perf', 'perf.js'));

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function close(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ' ' + a + ' ≠ ' + b); }
function meters(p) { return [p.m.groundRoll, p.m.overObstacle]; }
function rwy(r, id) { return r.runways.find((x) => x.id === id); }

const OUT_M = [{ id: 'groundRoll', unit: 'm' }, { id: 'overObstacle', unit: 'm' }];
function axis(quantity, unit, values, more) {
  return Object.assign({ quantity, unit, values, read: 'linear', below: 'lowest', above: quantity === 'headwind' ? 'highest' : 'none' }, more || {});
}
function grid(axes, cells) { return { type: 'grid', axes, outputs: clone(OUT_M), obstacle: { value: 50, unit: 'ft' }, cells }; }
function point(values) {
  return { type: 'point', conditions: { pressureAltitudeFt: 0, temperatureC: 15 }, outputs: clone(OUT_M), obstacle: { value: 50, unit: 'ft' }, values };
}
function chart(table, corrections, extra) {
  return Object.assign({ source: 'afm', title: 'Tabelle', ref: { figure: 'Fig', page: '1' }, base: { surface: 'paved', surfaceCondition: 'dry' },
    table, corrections: corrections || [] }, extra || {});
}
// einfache Landung: nur Druckhöhe (ft), 0 … 10'000 ft
function plainLanding() { return chart(grid([axis('pressureAltitude', 'ft', [0, 10000])], [[150, 350], [250, 550]])); }
function ac3(takeoff, landing, extra) {
  return Object.assign({ schema: 3, id: 'test3', label: 'Testmuster Schema 3', mass: { kg: 1000, lb: 2205 },
    sources: { afm: { labelDe: 'AFM' }, rule: { labelDe: 'Faustregel' } },
    charts: { takeoff, landing: landing === undefined ? plainLanding() : landing } }, extra || {});
}
// Platz: Pisten 36 (360°) und optional 27 (270°); bei QNH 1013,25 hPa ist die Druckhöhe gleich der Platzhöhe
function field(elevFt, surface, withRwy27, avail) {
  const r = (id, b) => ({ id, bearingTrue: b, surface: surface || 'paved', takeoffAvailable: { value: avail || 1000, unit: 'm' }, landingAvailable: { value: avail || 1000, unit: 'm' } });
  return { schema: 2, icao: 'TEST', elevation: { value: elevFt, unit: 'ft' }, runways: withRwy27 ? [r('36', 360), r('27', 270)] : [r('36', 360)] };
}
function wx(tempC, windDirTrue, windKt, runwayWet, massKg, qnhHpa) {
  const w = { tempC, qnhHpa: qnhHpa === undefined ? 1013.25 : qnhHpa, windDirTrue, windKt, runwayWet: runwayWet === true };
  if (massKg !== undefined) w.massKg = massKg;
  return w;
}
function run(ac, af, input) {
  const r = core.compute(ac, af, input);
  assert.equal(r.ok, true, 'Rechnung ok erwartet: ' + JSON.stringify(r.error));
  return r;
}
function errs(ac) { return core.validateAircraft(ac).errors; }
function okData(ac, msg) { assert.deepEqual(core.validateAircraft(ac), { ok: true, errors: [] }, msg); }
// Fehlertext genau (einziger Fehler) und compute ergibt bad-data
function badExactly(ac, want, msg) {
  assert.deepEqual(core.validateAircraft(ac), { ok: false, errors: [want] }, msg);
  const r = core.compute(ac, field(1000), wx(10, null, 0));
  assert.deepEqual([r.ok, r.error.code], [false, 'bad-data'], msg);
}

/* ── E1: Druckhöhe in m ────────────────────────────────────── */

// Druckhöhe m [0, 500, 1000] × Temperatur [0, 20]; zwischen 500 und 1000 m steigt die Rollstrecke um 1 m je m
function e1Table() {
  return grid([axis('pressureAltitude', 'm', [0, 500, 1000]), axis('temperature', 'degC', [0, 20])], [
    [[100, 200], [110, 220]],
    [[120, 240], [132, 264]],
    [[620, 1240], [632, 1264]]
  ]);
}

test('E1 Validierung: Druckhöhe in m nur ab Schema 3, Bereich −600…6000 m, andere Einheiten unbekannt', () => {
  okData(ac3(chart(e1Table())));
  const P = 'charts.takeoff.table.axes[0]';
  const withVals = (v) => { const a = ac3(chart(e1Table())); a.charts.takeoff.table.axes[0].values = v; return a; };
  okData(withVals([-600, 500, 1000]), '−600 m');
  okData(withVals([0, 500, 6000]), '6000 m');
  badExactly(withVals([-601, 500, 1000]), P + '.values nicht streng steigend oder ausserhalb -600…6000');
  badExactly(withVals([0, 500, 6001]), P + '.values nicht streng steigend oder ausserhalb -600…6000');
  const km = ac3(chart(e1Table()));
  km.charts.takeoff.table.axes[0].unit = 'km';
  badExactly(km, P + '.unit unbekannt');
  const s2 = ac3(chart(e1Table()));
  s2.schema = 2;
  badExactly(s2, P + '.unit unbekannt', 'Schema 2');
  // weitere Tabellen: gleiche Achsen (auch die Einheit)
  const lw = ac3(chart(e1Table(), [], { lowerWeights: [{ mass: { kg: 900, lb: 1984 }, title: '900', ref: { figure: 'F', page: '2' }, table: e1Table() }] }));
  okData(lw);
  lw.charts.takeoff.lowerWeights[0].table.axes[0].unit = 'ft';
  lw.charts.takeoff.lowerWeights[0].table.axes[0].values = [0, 1500, 3000];
  badExactly(lw, 'charts.takeoff.lowerWeights[0].table: Achsen oder Ausgaben anders als in der Haupttabelle');
});

test('E1 Ablesung: ganze ft aufgerundet, dann × 0,3048 auf ganze m aufgerundet (exakt, ohne Gleitkommarest)', () => {
  // 2500 ft → 762 m (2500 × 0,3048 = 762,0 genau). Zwischen 500 und 1000 m, Gewicht 262/500 = 0,524, 0 °C:
  // Rollstrecke 120 + 262 × (620 − 120) / 500 = 382; über 15 m 240 + 262 × 1000 / 500 = 764 → 382 / 764 m
  // (mit 763 m wären es 383 / 766 m)
  let r = run(ac3(chart(e1Table())), field(2500), wx(0, null, 0));
  let p = rwy(r, '36').takeoff;
  assert.deepEqual([r.pressureAltitudeTableFt, r.pressureAltitudeTableM], [2500, 762]);
  assert.deepEqual([p.lookup.axes[0].unit, p.lookup.axes[0].input, p.lookup.axes[0].lower, p.lookup.axes[0].upper], ['m', 762, 500, 1000]);
  assert.deepEqual([p.table.groundRoll, p.table.overObstacle], [382, 764]);
  assert.deepEqual(meters(p), [382, 764]);
  // 2503,1 ft → 2504 ft (aufgerundet) → 763,2192 → 764 m (aus 2503,1 ft direkt wären es 763 m): 384 / 768 m
  r = run(ac3(chart(e1Table())), field(2503.1), wx(0, null, 0));
  assert.deepEqual([r.pressureAltitudeTableFt, r.pressureAltitudeTableM], [2504, 764]);
  assert.deepEqual(meters(rwy(r, '36').takeoff), [384, 768]);
  // 10 °C zwischen 0 und 20 (Gewicht 0,5) bei 762 m: 500 m (126 / 252), 1000 m (626 / 1252) → 126 + 0,524 × 500 = 388; 252 + 0,524 × 1000 = 776
  r = run(ac3(chart(e1Table())), field(2500), wx(10, null, 0));
  p = rwy(r, '36').takeoff;
  close(p.table.groundRoll, 388);
  close(p.table.overObstacle, 776);
  assert.equal(p.lookup.corners.length, 4);
  assert.deepEqual(p.lookup.corners.map((c) => c.axisValues), [[500, 0], [500, 20], [1000, 0], [1000, 20]]);
});

test('E1 Grenzen: über der grössten Druckhöhe kein Wert, auf dem Tabellenwert ein Wert; ft und m getrennt gemeldet', () => {
  // 3280 ft → 999,744 → 1000 m (letzte Zeile); 3281 ft → 1000,0488 → 1001 m: kein Wert
  let r = run(ac3(chart(e1Table())), field(3280), wx(0, null, 0));
  assert.deepEqual([r.pressureAltitudeTableM, meters(rwy(r, '36').takeoff)], [1000, [620, 1240]]);
  r = core.compute(ac3(chart(e1Table())), field(3281), wx(0, null, 0));
  assert.deepEqual([r.ok, r.error.code, r.error.above, r.pressureAltitudeTableM], [false, 'above-range',
    [{ quantity: 'pressureAltitude', unit: 'm', value: 1001, max: 1000 }], 1001]);
  // Start in m (bis 1000 m), Landung in ft (bis 3000 ft): 3300 ft → 1006 m; je Einheit ein Eintrag
  const landFt = chart(grid([axis('pressureAltitude', 'ft', [0, 3000])], [[150, 350], [250, 550]]));
  r = core.compute(ac3(chart(e1Table()), landFt), field(3300), wx(0, null, 0));
  assert.deepEqual(r.error.above, [
    { quantity: 'pressureAltitude', unit: 'm', value: 1006, max: 1000 },
    { quantity: 'pressureAltitude', unit: 'ft', value: 3300, max: 3000 }
  ]);
});

/* ── E2: Gegenwind als Tabellenachse ───────────────────────── */

// Druckhöhe ft [0, 2000] × Temperatur [0, 20] × Gegenwind [0, 10, 20] kt
function e2Cells() {
  return [
    [[[200, 400], [160, 330], [130, 280]], [[220, 440], [176, 362], [142, 306]]],
    [[[240, 480], [192, 396], [156, 336]], [[264, 528], [211, 435], [171, 367]]]
  ];
}
function e2Table(cells) {
  return grid([axis('pressureAltitude', 'ft', [0, 2000]), axis('temperature', 'degC', [0, 20]), axis('headwind', 'kt', [0, 10, 20])], cells || e2Cells());
}

test('E2 Validierung: Gegenwindachse nur «linear», «highest», ab 0 kt, Werte nicht steigend, ohne Gegenwind-Regel', () => {
  okData(ac3(chart(e2Table())));
  const P = 'charts.takeoff.table';
  const mut = (fn) => { const a = ac3(chart(e2Table())); fn(a.charts.takeoff.table, a); return a; };
  badExactly(mut((t, a) => { a.schema = 2; }), P + '.axes[2].quantity unbekannt');
  badExactly(mut((t) => { t.axes[2].read = 'nextHigher'; }), P + '.axes[2].read unbekannt');
  badExactly(mut((t) => { t.axes[2].above = 'none'; }), P + '.axes[2].above unbekannt');
  badExactly(mut((t) => { t.axes[0].above = 'highest'; }), P + '.axes[0].above unbekannt');
  badExactly(mut((t) => { t.axes[2].values = [5, 10, 20]; }), P + '.axes[2].values: Gegenwind beginnt nicht bei 0 kt');
  badExactly(mut((t) => { t.axes[2].values = [0, 10, 101]; }), P + '.axes[2].values nicht streng steigend oder ausserhalb 0…100');
  badExactly(mut((t) => { t.axes[2].unit = 'kmh'; }), P + '.axes[2].unit unbekannt');
  // mehr Gegenwind, längere Strecke: nicht erlaubt (eine Zelle, sonst gültig)
  badExactly(mut((t) => { t.cells[1][1][2] = [212, 436]; }), P + '.cells nicht monoton');
  badExactly(mut((t, a) => { a.charts.takeoff.corrections.push({ kind: 'headwind', type: 'percentPer', percent: -10, per: 9, unit: 'kt' }); }),
    'charts.takeoff.corrections[0]: Gegenwind steht in der Tabelle, keine Gegenwind-Regel erlaubt');
  badExactly(mut((t, a) => { a.charts.takeoff.corrections.push({ kind: 'headwind', type: 'factorTable', unit: 'kt', points: [[0, 1], [10, 0.9]], above: 'highest' }); }),
    'charts.takeoff.corrections[0]: Gegenwind steht in der Tabelle, keine Gegenwind-Regel erlaubt');
  const dup = mut((t) => { t.axes.push(axis('headwind', 'kt', [0, 5])); });
  assert.ok(errs(dup).includes(P + '.axes[3].quantity doppelt'));
  // gleich bleibende Werte entlang der Gegenwindachse sind erlaubt (nicht steigend)
  okData(ac3(chart(grid([axis('pressureAltitude', 'ft', [0, 2000]), axis('headwind', 'kt', [0, 10, 20])],
    [[[200, 400], [200, 400], [150, 300]], [[240, 480], [240, 480], [180, 360]]]))), 'gleich bleibend');
});

test('E2 Ablesung: Gegenwind der Piste in der Tabelle interpoliert, keine Korrektur, keine 50-%-Grenze', () => {
  // 1000 ft (0,5), 10 °C (0,5), 15 kt (0,5 zwischen 10 und 20): Mittel der acht Ecken mit 10 und 20 kt
  // Rollstrecke (160 + 176 + 192 + 211 + 130 + 142 + 156 + 171) / 8 = 1338 / 8 = 167,25
  // über 15 m   (330 + 362 + 396 + 435 + 280 + 306 + 336 + 367) / 8 = 2812 / 8 = 351,5 → 168 / 352 m
  let r = run(ac3(chart(e2Table())), field(1000), wx(10, 360, 15.4));
  let p = rwy(r, '36').takeoff;
  assert.equal(rwy(r, '36').wind.kt, 15);
  close(p.table.groundRoll, 167.25);
  close(p.table.overObstacle, 351.5);
  assert.deepEqual(meters(p), [168, 352]);
  assert.deepEqual([p.wind.inTable, p.wind.applied, p.wind.noRule, p.wind.type, p.wind.aboveHighest, p.wind.factor], [true, false, false, null, false, null]);
  assert.deepEqual(p.afterWind, p.afterRules);
  const hx = p.lookup.axes[2];
  assert.deepEqual([hx.quantity, hx.unit, hx.input, hx.lower, hx.upper, hx.weight, hx.aboveHighest], ['headwind', 'kt', 15, 10, 20, 0.5, false]);
  assert.equal(p.lookup.corners.length, 8);
  // die Ablesung oben (lookups) gilt für 0 kt; je Piste die eigene
  assert.deepEqual(r.lookups.takeoff.axes[2].input, 0);
  // Windstill: Spalte 0 kt → (200 + 220 + 240 + 264) / 4 = 231; (400 + 440 + 480 + 528) / 4 = 462
  r = run(ac3(chart(e2Table())), field(1000), wx(10, null, 0.5));
  assert.deepEqual([meters(rwy(r, '36').takeoff), rwy(r, '36').takeoff.wind.inTable], [[231, 462], true]);
  // über 20 kt: Werte für 20 kt, (130 + 142 + 156 + 171) / 4 = 149,75; (280 + 306 + 336 + 367) / 4 = 322,25 → 150 / 323 m
  r = run(ac3(chart(e2Table())), field(1000), wx(10, 360, 25));
  p = rwy(r, '36').takeoff;
  assert.deepEqual([meters(p), p.wind.aboveHighest, p.lookup.axes[2].aboveHighest, p.lookup.axes[2].interpolated, p.lookup.axes[2].value],
    [[150, 323], true, true, false, 20]);
  // über 40 kt: kein Wert
  r = run(ac3(chart(e2Table())), field(1000), wx(10, 360, 41));
  assert.deepEqual([rwy(r, '36').takeoff.ok, rwy(r, '36').takeoff.reason], [false, 'headwind-limit']);
  // AFM-Werte unter der Hälfte (20 kt: 80 von 200) sind erlaubt: keine 50-%-Grenze
  const half = grid([axis('pressureAltitude', 'ft', [0, 2000]), axis('headwind', 'kt', [0, 20])], [[[200, 400], [80, 150]], [[240, 480], [96, 180]]]);
  r = run(ac3(chart(half)), field(0), wx(10, 360, 20));
  assert.deepEqual([rwy(r, '36').takeoff.ok, meters(rwy(r, '36').takeoff)], [true, [80, 150]]);
});

test('E2 je Piste: zwei Pisten mit verschiedenem Gegenwind, «je Starttabelle» und «möglich bis» mit dem Wind der Piste', () => {
  // Wind 330° / 20 kt: Piste 36 cos 30° → 17,32 → 17 kt; Piste 27 cos 60° → 10 kt
  // Piste 27 genau 10 kt: (160 + 176 + 192 + 211) / 4 = 184,75; (330 + 362 + 396 + 435) / 4 = 380,75 → 185 / 381 m
  // Piste 36 17 kt (0,7 zwischen 10 und 20): Ecken 139; 152,2; 166,8; 183 → 160,25; 295; 322,8; 354; 387,4 → 339,8 → 161 / 340 m
  const ac = ac3(chart(e2Table()));
  let r = run(ac, field(1000, 'paved', true), wx(10, 330, 20));
  assert.deepEqual([rwy(r, '36').wind.kt, rwy(r, '27').wind.kt], [17, 10]);
  close(rwy(r, '27').takeoff.table.groundRoll, 184.75);
  assert.deepEqual(meters(rwy(r, '27').takeoff), [185, 381]);
  close(rwy(r, '36').takeoff.table.groundRoll, 160.25);
  close(rwy(r, '36').takeoff.table.overObstacle, 339.8);
  assert.deepEqual(meters(rwy(r, '36').takeoff), [161, 340]);
  // Starttabellen 1000 und 900 kg (900 kg: −10 / −20 m), linear: jede Zeile «je Starttabelle» gleich der Rechnung mit diesem Gewicht
  const lw = ac3(chart(e2Table(), [], { massRead: 'linear', lowerWeights: [{ mass: { kg: 900, lb: 1984 }, title: '900 kg', ref: { figure: 'F', page: '2' },
    table: e2Table(e2Cells().map((a) => a.map((b) => b.map((c) => [c[0] - 10, c[1] - 20])))) }] }));
  okData(lw);
  r = run(lw, field(1000, 'paved', true), wx(10, 330, 20));
  ['36', '27'].forEach((id) => {
    rwy(r, id).takeoffByMass.forEach((t) => {
      const one = run(lw, field(1000, 'paved', true), wx(10, 330, 20, false, t.kg));
      assert.deepEqual(t.m, rwy(one, id).takeoff.m, id + ' ' + t.kg + ' kg');
    });
  });
  assert.deepEqual(rwy(r, '27').takeoffByMass.map((t) => t.m.overObstacle), [381, 361]);
  // «möglich bis» mit dem Wind der Piste: verfügbar 370 m. Piste 27 (10 kt): über 15 m 380,75 (1000 kg), 360,75 (900 kg)
  // → 360,75 + 20 × (kg − 900) / 100 ≤ 370 → kg ≤ 946,25 → 946 kg (mit 0 kt wären es 462 / 442 m: nie möglich)
  r = run(lw, field(1000, 'paved', true, 370), wx(10, 330, 20));
  assert.deepEqual([rwy(r, '27').takeoffLimit.state, rwy(r, '27').takeoffLimit.maxKg], ['limit', 946]);
  assert.equal(rwy(r, '36').takeoffLimit.state, 'possible');
});

test('E2 bei der Landung: Gegenwind der Piste in der Landetabelle, auch mit Landetabellen nach Gewicht (E7)', () => {
  // Landung mit derselben Tabelle wie oben (Start einfache Tabelle ohne Wind). Wind 330° / 20 kt: Piste 36 17 kt → 160,25 / 339,8
  // → 161 / 340 m; Piste 27 10 kt → 184,75 / 380,75 → 185 / 381 m (mit 0 kt wären es 231 / 462 m)
  const ldg = ac3(e5Chart(POE(15)), chart(e2Table()));
  okData(ldg);
  let r = run(ldg, field(1000, 'paved', true), wx(10, 330, 20));
  assert.deepEqual([meters(rwy(r, '36').landing), meters(rwy(r, '27').landing)], [[161, 340], [185, 381]]);
  assert.deepEqual([rwy(r, '36').landing.lookup.axes[2].input, rwy(r, '27').landing.lookup.axes[2].input, r.lookups.landing.axes[2].input], [17, 10, 0]);
  assert.deepEqual([rwy(r, '36').landing.wind.inTable, rwy(r, '36').landing.wind.applied], [true, false]);
  // mit Landetabelle 900 kg (−10 / −20 m) und Gewicht 950 kg: Piste 27 Mitte aus 184,75 / 380,75 und 174,75 / 360,75
  // → 179,75 / 370,75 → 180 / 371 m
  const lw = ac3(e5Chart(POE(15)), chart(e2Table(), [], { massRead: 'linear', lowerWeights: [{ mass: { kg: 900, lb: 1984 }, title: '900 kg',
    ref: { figure: 'F', page: '3' }, table: e2Table(e2Cells().map((a) => a.map((b) => b.map((c) => [c[0] - 10, c[1] - 20])))) }] }));
  okData(lw);
  r = run(lw, field(1000, 'paved', true), wx(10, 330, 20, false, 950));
  const p = rwy(r, '27').landing;
  close(p.table.groundRoll, 179.75);
  assert.deepEqual([meters(p), p.lookup.mass.weight, p.lookup.mass.upper.axes[2].input, r.massLandingUsed.interpolated], [[180, 371], 0.5, 10, true]);
});

/* ── E3: Temperatur als Abweichung von der Tabellen-Standardtemperatur ── */

// Druckhöhe ft [0, 2500, 5000] × Abweichung [−20, 0, 20] mit Std 15 / 7 / −1 °C (wie Robin DR400)
function e3Table(std, read) {
  return grid([axis('pressureAltitude', 'ft', [0, 2500, 5000], { read: read || 'linear' }),
    axis('temperatureDeviation', 'degC', [-20, 0, 20], { stdTempC: std || [15, 7, -1], read: read || 'linear' })], [
    [[100, 200], [120, 240], [140, 280]],
    [[130, 260], [150, 300], [180, 360]],
    [[160, 320], [190, 380], [230, 460]]
  ]);
}

test('E3 Validierung: stdTempC je Druckhöhenzeile, nicht steigend; nur mit Druckhöhe, nicht neben der Temperatur', () => {
  okData(ac3(chart(e3Table())));
  const P = 'charts.takeoff.table';
  const mut = (fn) => { const a = ac3(chart(e3Table())); fn(a.charts.takeoff.table, a); return a; };
  badExactly(mut((t, a) => { a.schema = 2; }), P + '.axes[1].quantity unbekannt');
  badExactly(mut((t) => { t.axes[1].stdTempC = [15, 7]; }), P + '.axes[1].stdTempC falsch');
  badExactly(mut((t) => { t.axes[1].stdTempC = [15, 7, 8]; }), P + '.axes[1].stdTempC falsch');
  badExactly(mut((t) => { t.axes[1].stdTempC = [61, 7, -1]; }), P + '.axes[1].stdTempC falsch');
  badExactly(mut((t) => { t.axes[1].stdTempC = [15, '7', -1]; }), P + '.axes[1].stdTempC falsch');
  badExactly(mut((t) => { delete t.axes[1].stdTempC; }), P + '.axes[1].stdTempC falsch');
  badExactly(mut((t) => { t.axes[0].stdTempC = [15, 7, -1]; }), P + '.axes[0].stdTempC nur bei temperatureDeviation');
  badExactly(mut((t) => { t.axes[1].values = [-20, 0, 61]; }), P + '.axes[1].values nicht streng steigend oder ausserhalb -60…60');
  // gleich bleibend erlaubt (nicht steigend)
  okData(mut((t) => { t.axes[1].stdTempC = [15, 15, 15]; }));
  // ohne Druckhöhenachse
  const noPa = ac3(chart(grid([axis('temperatureDeviation', 'degC', [-20, 0, 20], { stdTempC: [15, 7, -1] })], [[100, 200], [120, 240], [140, 280]])));
  badExactly(noPa, P + '.axes[0]: temperatureDeviation ohne pressureAltitude');
  // neben einer Temperaturachse
  const both = ac3(chart(grid([axis('pressureAltitude', 'ft', [0, 2500, 5000]), axis('temperatureDeviation', 'degC', [-20, 0, 20], { stdTempC: [15, 7, -1] }),
    axis('temperature', 'degC', [0, 20])], e3Table().cells.map((row) => row.map((c) => [c, [c[0] + 1, c[1] + 1]])))));
  badExactly(both, P + '.axes: temperature und temperatureDeviation zusammen');
});

test('E3 Ablesung: Std(PA) linear zwischen den Zeilen, ΔT = T − Std, unter der tiefsten Zeile deren Std', () => {
  // 1250 ft: Std = 15 + 1250 × (7 − 15) / 2500 = 11 °C. 11 °C → ΔT 0 → (120 + 150) / 2 = 135; (240 + 300) / 2 = 270
  let r = run(ac3(chart(e3Table())), field(1250), wx(11, null, 0));
  let p = rwy(r, '36').takeoff;
  const dx = p.lookup.axes[1];
  assert.deepEqual([dx.quantity, dx.unit, dx.input, dx.interpolated], ['temperatureDeviation', 'degC', 0, false]);
  assert.deepEqual(dx.std, { tempC: 11, stdTempC: 11, pressureAltitude: 1250, unit: 'ft', read: 'linear', belowLowest: false, interpolated: true,
    index: 1, value: 2500, lowerIndex: 0, lower: 0, upper: 2500, lowerStdC: 15, upperStdC: 7, num: 1250, den: 2500, weight: 0.5 });
  assert.deepEqual(meters(p), [135, 270]);
  // 21 °C → ΔT 10 (Gewicht 0,5): 0 ft (130 / 260), 2500 ft (165 / 330) → 147,5 / 295 → 148 / 295 m
  r = run(ac3(chart(e3Table())), field(1250), wx(21, null, 0));
  p = rwy(r, '36').takeoff;
  assert.deepEqual([p.lookup.axes[1].input, p.table.groundRoll, p.table.overObstacle, meters(p)], [10, 147.5, 295, [148, 295]]);
  // 1000 ft: Std = 15 − 3,2 = 11,8; 15 °C → ΔT 3,2
  r = run(ac3(chart(e3Table())), field(1000), wx(15, null, 0));
  close(rwy(r, '36').takeoff.lookup.axes[1].std.stdTempC, 11.8);
  close(rwy(r, '36').takeoff.lookup.axes[1].input, 3.2);
  // −500 ft: unter der tiefsten Zeile Std 15; 15 °C → ΔT 0 → Zeile 0 ft: 120 / 240
  r = run(ac3(chart(e3Table())), field(-500), wx(15, null, 0));
  p = rwy(r, '36').takeoff;
  assert.deepEqual([p.lookup.axes[1].std.stdTempC, p.lookup.axes[1].std.belowLowest, p.lookup.axes[1].std.interpolated, meters(p)], [15, true, false, [120, 240]]);
  // sehr kalt: 0 ft, −30 °C → ΔT −45 → Spalte −20: 100 / 200
  r = run(ac3(chart(e3Table())), field(0), wx(-30, null, 0));
  assert.deepEqual([rwy(r, '36').takeoff.lookup.axes[1].belowLowest, meters(rwy(r, '36').takeoff)], [true, [100, 200]]);
  // Druckhöhe «nextHigher»: Std der Zeile, die abgelesen wird (2500 ft: 7 °C), nicht die interpolierte (11 °C):
  // 1250 ft, 11 °C → ΔT 4, linear 150 + 4 × 30 / 20 = 156; 300 + 4 × 60 / 20 = 312 (mit Std 11 wären es 150 / 300)
  const nh = e3Table();
  nh.axes[0].read = 'nextHigher';
  r = run(ac3(chart(nh)), field(1250), wx(11, null, 0));
  p = rwy(r, '36').takeoff;
  assert.deepEqual([p.lookup.axes[1].std.stdTempC, p.lookup.axes[1].input, meters(p)], [7, 4, [156, 312]]);
  // beide Achsen «nextHigher»: ΔT 4 → Spalte 20: 180 / 360
  r = run(ac3(chart(e3Table(null, 'nextHigher'))), field(1250), wx(11, null, 0));
  assert.deepEqual(meters(rwy(r, '36').takeoff), [180, 360]);
  // Druckhöhenachse in m: Std zu den m-Werten. 2500 ft → 762 m; Std = 15 + 762 × (10 − 15) / 800 = 10,2375
  const inM = grid([axis('pressureAltitude', 'm', [0, 800, 1600]), axis('temperatureDeviation', 'degC', [-20, 0, 20], { stdTempC: [15, 10, 5] })], e3Table().cells);
  r = run(ac3(chart(inM)), field(2500), wx(15, null, 0));
  const st = rwy(r, '36').takeoff.lookup.axes[1].std;
  assert.deepEqual([st.unit, st.pressureAltitude, st.lower, st.upper], ['m', 762, 0, 800]);
  close(st.stdTempC, 10.2375);
});

test('E3 Grenzen: über der grössten Abweichung kein Wert (mit höchster Temperatur), über der Druckhöhe nur deren Meldung', () => {
  // 2500 ft (Std 7), 28 °C → ΔT 21 > 20; höchste rechenbare Temperatur 27 °C; 27 °C selbst hat einen Wert
  let r = core.compute(ac3(chart(e3Table())), field(2500), wx(28, null, 0));
  assert.deepEqual([r.ok, r.error.code, r.error.above], [false, 'above-range',
    [{ quantity: 'temperatureDeviation', unit: 'degC', value: 21, max: 20, tempC: 28, stdTempC: 7, maxTempC: 27 }]]);
  r = run(ac3(chart(e3Table())), field(2500), wx(27, null, 0));
  assert.deepEqual(meters(rwy(r, '36').takeoff), [180, 360]);
  // 5500 ft: Druckhöhe über der Tabelle; die Abweichung wird nicht bewertet (keine zweite Meldung), auch bei 40 °C
  r = core.compute(ac3(chart(e3Table())), field(5500), wx(40, null, 0));
  assert.deepEqual(r.error.above, [{ quantity: 'pressureAltitude', unit: 'ft', value: 5500, max: 5000 }]);
  // Start Std 15/7/−1, Landung Std 15/9/3: bei 2500 ft und 30 °C beide über der Tabelle; gemeldet der Eintrag mit der tieferen
  // höchsten Temperatur (Start: 27 °C), nicht die Landung (29 °C) – auch wenn die Landung zuerst käme
  const land = (std) => chart(e3Table(std));
  r = core.compute(ac3(chart(e3Table()), land([15, 9, 3])), field(2500), wx(30, null, 0));
  assert.deepEqual(r.error.above, [{ quantity: 'temperatureDeviation', unit: 'degC', value: 23, max: 20, tempC: 30, stdTempC: 7, maxTempC: 27 }]);
  r = core.compute(ac3(chart(e3Table([15, 9, 3])), land([15, 7, -1])), field(2500), wx(30, null, 0));
  assert.deepEqual(r.error.above, [{ quantity: 'temperatureDeviation', unit: 'degC', value: 23, max: 20, tempC: 30, stdTempC: 7, maxTempC: 27 }]);
});

/* ── E4: Gegenwind-Faktortabelle ───────────────────────────── */

// Druckhöhe ft [0, 5000]; bei 0 ft 1000 / 2000 m
function e4Chart(points, more) {
  return chart(grid([axis('pressureAltitude', 'ft', [0, 5000])], [[1000, 2000], [1500, 3000]]),
    [Object.assign({ kind: 'headwind', type: 'factorTable', unit: 'kt', points: points || [[0, 1], [15, 0.8], [25, 0.7]], above: 'highest' }, more || {})]);
}

test('E4 Validierung: erster Punkt [0, 1], kt streng steigend, Faktor (0, 1] nicht steigend mit drei Dezimalen, above «highest»', () => {
  okData(ac3(e4Chart()));
  okData(ac3(e4Chart(null, { per: 9 })), 'per wird nicht gebraucht');
  okData(ac3(e4Chart([[0, 1], [10, 1], [20, 0.001]])), 'gleich bleibend, kleinster Faktor');
  const P = 'charts.takeoff.corrections[0]';
  [
    [[[0, 0.95], [10, 0.9]], P + '.points[0] falsch'],
    [[[5, 1], [10, 0.9]], P + '.points[0] falsch'],
    [[[0, 1], [10, 0.9], [10, 0.8]], P + '.points[2] falsch'],
    [[[0, 1], [10, 0.8], [20, 0.85]], P + '.points[2] falsch'],
    [[[0, 1], [10, 1.05]], P + '.points[1] falsch'],
    [[[0, 1], [10, 0]], P + '.points[1] falsch'],
    [[[0, 1], [10, -0.5]], P + '.points[1] falsch'],
    [[[0, 1], [10, 0.8555]], P + '.points[1] falsch'],
    [[[0, 1], [101, 0.5]], P + '.points[1] falsch'],
    [[[0, 1], [10]], P + '.points[1] falsch'],
    [[[0, 1], [10, '0.9']], P + '.points[1] falsch'],
    [[[0, 1]], P + '.points falsch'],
    ['0,1;10,0.9', P + '.points falsch']
  ].forEach(([pts, want]) => badExactly(ac3(e4Chart(pts)), want, JSON.stringify(pts)));
  badExactly(ac3(e4Chart(null, { above: 'none' })), P + '.above unbekannt');
  badExactly(ac3(e4Chart(null, { unit: 'kmh' })), P + '.unit unbekannt');
  const dbl = ac3(e4Chart());
  dbl.charts.takeoff.corrections.push({ kind: 'headwind', type: 'percentPer', percent: -10, per: 9, unit: 'kt' });
  badExactly(dbl, 'charts.takeoff.corrections: Gegenwind-Regel doppelt');
  const s2 = ac3(e4Chart());
  s2.schema = 2;
  assert.deepEqual(errs(s2), [P + '.per ausserhalb 1–50 kt', P + '.type unbekannt']);
});

test('E4 Rechnung: linear zwischen den Punkten, Faktor auf drei Dezimalen aufgerundet, über dem letzten Punkt dessen Faktor', () => {
  const at = (kt, pts) => rwy(run(ac3(e4Chart(pts)), field(0), wx(15, 360, kt)), '36').takeoff;
  // 2 kt: 1 + 2 × (0,8 − 1) / 15 = 0,97333… → aufgerundet 0,974 → 974 / 1948 m
  // (ungerundet wären es 974 / 1947 m, kaufmännisch gerundet 0,973 → 973 / 1946 m)
  let p = at(2);
  assert.deepEqual([p.wind.applied, p.wind.type, p.wind.factor, p.wind.points, p.wind.inTable, p.wind.aboveHighest], [true, 'factorTable', 0.974, [[0, 1], [15, 0.8]], false, false]);
  close(p.wind.factorRaw, 0.9733333333333334);
  assert.deepEqual([p.afterWind.groundRoll, p.afterWind.overObstacle, meters(p)], [974, 1948, [974, 1948]]);
  // auf einem Punkt: 15 kt → 0,8 → 800 / 1600; zwischen 15 und 25: 20 kt → 0,75 → 750 / 1500
  p = at(15);
  assert.deepEqual([p.wind.factor, p.wind.points, meters(p)], [0.8, [[15, 0.8]], [800, 1600]]);
  assert.deepEqual([at(20).wind.factor, meters(at(20))], [0.75, [750, 1500]]);
  // am und über dem letzten Punkt: 0,7
  assert.deepEqual([at(25).wind.factor, at(25).wind.aboveHighest], [0.7, false]);
  p = at(30);
  assert.deepEqual([p.wind.factor, p.wind.points, p.wind.aboveHighest, meters(p)], [0.7, [[25, 0.7]], true, [700, 1400]]);
  // 0 kt: keine Korrektur
  p = at(0.5);
  assert.deepEqual([p.wind.kt, p.wind.applied, p.wind.factor, meters(p)], [0, false, null, [1000, 2000]]);
  // 50-%-Grenze gilt: Faktor 0,4 → kein Wert; genau 0,5 erlaubt
  p = at(10, [[0, 1], [10, 0.4]]);
  assert.deepEqual([p.ok, p.reason], [false, 'wind-credit-limit']);
  p = at(10, [[0, 1], [10, 0.5]]);
  assert.deepEqual([p.ok, meters(p)], [true, [500, 1000]]);
  // über 40 kt kein Wert
  p = at(41);
  assert.deepEqual([p.ok, p.reason], [false, 'headwind-limit']);
  // die Punkte der Daten bleiben unverändert (Kopien im Ergebnis)
  const ac = ac3(e4Chart());
  const r = run(ac, field(0), wx(15, 360, 30));
  rwy(r, '36').takeoff.wind.points[0][1] = 0.1;
  assert.deepEqual(ac.charts.takeoff.corrections[0].points, [[0, 1], [15, 0.8], [25, 0.7]]);
});

/* ── E5: Belagszuschlag auf jede Strecke, «minimum» ────────── */

function e5Chart(surfaceRule, wind) {
  return chart(grid([axis('pressureAltitude', 'ft', [0, 5000])], [[200, 400], [300, 600]]),
    [wind || { kind: 'headwind', type: 'percentPer', percent: -10, per: 10, unit: 'kt' }, surfaceRule]);
}
const POE = (p, more) => Object.assign({ kind: 'surface', type: 'percentOfEach', surface: 'grass', surfaceCondition: 'dry', percent: p }, more || {});
const APO = (p, more) => Object.assign({ kind: 'surface', type: 'addPercentOf', surface: 'grass', surfaceCondition: 'dry', percent: p, of: 'groundRoll' }, more || {});

test('E5 Validierung: percentOfEach ohne «of», Prozent 0 < p ≤ 200, «minimum» boolesch und nur ab Schema 3', () => {
  okData(ac3(e5Chart(POE(15))));
  okData(ac3(e5Chart(POE(200, { minimum: true }))));
  okData(ac3(e5Chart(APO(20, { minimum: true }))));
  const P = 'charts.takeoff.corrections[1]';
  badExactly(ac3(e5Chart(POE(15, { of: 'groundRoll' }))), P + '.of bei percentOfEach nicht erlaubt');
  badExactly(ac3(e5Chart(POE(0))), P + '.percent ausserhalb 0–200 %');
  badExactly(ac3(e5Chart(POE(201))), P + '.percent ausserhalb 0–200 %');
  badExactly(ac3(e5Chart(POE(15, { minimum: 'ja' }))), P + '.minimum unbekannt');
  assert.deepEqual(errs(ac3(e5Chart(POE(15, { type: 'percentOf' })))), [P + '.type unbekannt', P + '.of unbekannt']);
  badExactly(ac3(e5Chart(APO(15, { of: 'overObstacle' }))), P + '.of unbekannt');
  const s2 = ac3(e5Chart(APO(15, { minimum: false })));
  s2.schema = 2;
  badExactly(s2, P + '.minimum nur ab Schema 3');
  // zwei Beläge in einer Phase: erlaubt, derselbe Belag doppelt nicht
  const two = ac3(e5Chart(POE(15)));
  two.charts.takeoff.corrections.push(APO(30, { surface: 'gravel' }));
  okData(two);
  two.charts.takeoff.corrections.push(APO(30));
  badExactly(two, 'charts.takeoff.corrections[3].surface doppelt');
});

test('E5 Rechnung: jede Strecke × (100 + p) / 100 nach dem Wind; addPercentOf bleibt; «minimum» im Ergebnis', () => {
  // 10 kt Gegenwind: −10 % → 180 / 360; Gras +15 % auf jede Strecke → 207 / 414 m
  let r = run(ac3(e5Chart(POE(15))), field(0, 'grass'), wx(15, 360, 10));
  let p = rwy(r, '36').takeoff;
  assert.deepEqual(p.surface, { surface: 'grass', type: 'percentOfEach', percent: 15, minimum: false, base: null, inc: null, factor: 1.15,
    incEach: { groundRoll: 27, overObstacle: 54 }, after: { groundRoll: 207, overObstacle: 414 } });
  assert.deepEqual(meters(p), [207, 414]);
  // «minimum» aus den Daten (true / false), Zahlen gleich
  p = rwy(run(ac3(e5Chart(POE(15, { minimum: true }))), field(0, 'grass'), wx(15, 360, 10)), '36').takeoff;
  assert.deepEqual([p.surface.minimum, meters(p)], [true, [207, 414]]);
  p = rwy(run(ac3(e5Chart(POE(15, { minimum: false }))), field(0, 'grass'), wx(15, 360, 10)), '36').takeoff;
  assert.equal(p.surface.minimum, false);
  // 14 % statt 15 %: 205,2 / 410,4 → 206 / 411 m
  assert.deepEqual(meters(rwy(run(ac3(e5Chart(POE(14))), field(0, 'grass'), wx(15, 360, 10)), '36').takeoff), [206, 411]);
  // addPercentOf 15 % der Tabellen-Rollstrecke (30 m) auf beide Strecken: 210 / 390 m
  r = run(ac3(e5Chart(APO(15, { minimum: true }))), field(0, 'grass'), wx(15, 360, 10));
  p = rwy(r, '36').takeoff;
  assert.deepEqual(p.surface, { surface: 'grass', type: 'addPercentOf', percent: 15, minimum: true, base: 200, inc: 30, factor: null,
    incEach: { groundRoll: 30, overObstacle: 30 }, after: { groundRoll: 210, overObstacle: 390 } });
  assert.deepEqual(meters(p), [210, 390]);
  // aufrunden: 100 ft → 202 / 404; × 1,15 → 232,3 / 464,6 → 233 / 465 m
  r = run(ac3(e5Chart(POE(15))), field(100, 'grass'), wx(15, null, 0));
  close(rwy(r, '36').takeoff.final.groundRoll, 232.3);
  assert.deepEqual(meters(rwy(r, '36').takeoff), [233, 465]);
  // Piste mit dem Belag der Tabelle: kein Zuschlag
  r = run(ac3(e5Chart(POE(15))), field(0, 'paved'), wx(15, null, 0));
  assert.deepEqual([rwy(r, '36').takeoff.surface, meters(rwy(r, '36').takeoff)], [null, [200, 400]]);
  // Belag ohne Regel: kein Wert
  r = run(ac3(e5Chart(POE(15))), field(0, 'gravel'), wx(15, null, 0));
  assert.deepEqual([rwy(r, '36').takeoff.ok, rwy(r, '36').takeoff.reason], [false, 'no-surface-rule']);
});

/* ── E6: Landung fehlt im AFM ──────────────────────────────── */

const ABSENT = () => ({ absent: true, reasonDe: 'Das Handbuch nennt keine Landestrecke.' });

test('E6 Validierung: nur die Landung, nur ab Schema 3, Begründung Pflicht, keine Rechenfelder, kein maximales Landegewicht', () => {
  okData(ac3(e5Chart(POE(15)), ABSENT()));
  okData(ac3(e5Chart(POE(15)), Object.assign(ABSENT(), { title: 'Landung', notesDe: ['x'], ref: { figure: 'F', page: '9' }, source: 'afm' })), 'beschreibend');
  const L = 'charts.landing';
  badExactly(ac3(e5Chart(POE(15)), { absent: true }), L + '.reasonDe fehlt');
  badExactly(ac3(e5Chart(POE(15)), { absent: true, reasonDe: '' }), L + '.reasonDe fehlt');
  badExactly(ac3(e5Chart(POE(15)), { absent: 'ja', reasonDe: 'x' }), L + '.absent unbekannt');
  badExactly(ac3(e5Chart(POE(15)), { absent: false, reasonDe: 'x' }), L + '.absent unbekannt');
  badExactly(ac3(e5Chart(POE(15)), Object.assign(ABSENT(), { source: 'poh' })), L + '.source unbekannt');
  ['table', 'corrections', 'lowerWeights', 'massRead', 'base'].forEach((k) => {
    const a = ac3(e5Chart(POE(15)), Object.assign(ABSENT(), { [k]: plainLanding()[k] || 'linear' }));
    badExactly(a, L + '.' + k + ' bei fehlender Landung nicht erlaubt', k);
  });
  badExactly(ac3(e5Chart(POE(15)), ABSENT(), { massLanding: { kg: 950, lb: 2094 } }), 'massLanding bei fehlender Landung nicht erlaubt');
  const to = ac3(Object.assign(e5Chart(POE(15)), { absent: true, reasonDe: 'x' }));
  badExactly(to, 'charts.takeoff.absent nur bei der Landung erlaubt');
  const s2 = ac3(e5Chart(APO(15)), ABSENT());
  s2.schema = 2;
  assert.ok(errs(s2).includes(L + '.absent nur ab Schema 3'));
});

test('E6 Rechnung: Landung «not-in-afm», Start, «je Starttabelle», «möglich bis» und Zahl der Pisten unverändert', () => {
  const to = () => chart(e2Table(), [], { massRead: 'linear', lowerWeights: [{ mass: { kg: 900, lb: 1984 }, title: '900 kg', ref: { figure: 'F', page: '2' },
    table: e2Table(e2Cells().map((a) => a.map((b) => b.map((c) => [c[0] - 10, c[1] - 20])))) }] });
  const withL = ac3(to());
  const noL = ac3(to(), ABSENT());
  okData(noL);
  const af = field(1000, 'paved', true, 370);
  const inp = wx(10, 330, 20, true);
  const a = run(withL, af, inp), b = run(noL, af, inp);
  ['36', '27'].forEach((id) => {
    const x = rwy(a, id), y = rwy(b, id);
    assert.deepEqual(y.takeoff, x.takeoff, id + ' Start');
    assert.deepEqual([y.takeoffByMass, y.takeoffLimit, y.computed, y.wind], [x.takeoffByMass, x.takeoffLimit, x.computed, x.wind], id);
    assert.deepEqual(y.landing, { ok: false, reason: 'not-in-afm', absent: true, reasonDe: 'Das Handbuch nennt keine Landestrecke.', limitKt: null, unit: null,
      availableM: 370, lookup: null, table: null, rules: [], ruleOfThumb: false, afterRules: null, wind: null, afterWind: null, surface: null,
      factors: [], wetFactorMissing: false, final: null, meters: null, m: null, exceeds: null }, id + ' Landung');
  });
  assert.deepEqual([b.computedCount, b.mode, b.mass], [a.computedCount, a.mode, a.mass]);
  assert.deepEqual([b.landingAbsent, b.massLandingUsed, b.lookups.landing, a.landingAbsent], [true, null, null, false]);
  assert.deepEqual(b.lookups.takeoff, a.lookups.takeoff);
  assert.deepEqual([core.landingTables(noL), core.landingMassBracket(noL, 950)], [[], null]);
  // Rückenwindpiste: keine Rechnung, auch keine Landung
  const t = run(noL, field(1000, 'paved', true), wx(10, 180, 10));
  assert.deepEqual([rwy(t, '36').computed, rwy(t, '36').landing], [false, null]);
  // Nur der Start bestimmt den Tabellenbereich: Landung bis 2000 ft, Start bis 2000 ft; bei 1500 ft beides, bei 2001 ft
  // mit Landung kein Wert, ohne Landung (Start bis 5000 ft) ein Wert
  const tallTo = chart(grid([axis('pressureAltitude', 'ft', [0, 5000])], [[200, 400], [300, 600]]));
  const shortL = chart(grid([axis('pressureAltitude', 'ft', [0, 2000])], [[150, 350], [170, 390]]));
  assert.equal(core.compute(ac3(tallTo, shortL), field(2001), wx(10, null, 0)).error.code, 'above-range');
  assert.equal(run(ac3(clone(tallTo), ABSENT()), field(2001), wx(10, null, 0)).ok, true);
});

/* ── E7: Landung nach Gewicht ──────────────────────────────── */

// Landetabellen nur Druckhöhe ft [0, 4000]: 1000 kg (300 / 600 bei 0 ft), 900 kg (260 / 520)
function e7Landing(massRead) {
  return chart(grid([axis('pressureAltitude', 'ft', [0, 4000])], [[300, 600], [340, 680]]), [], Object.assign({
    lowerWeights: [{ mass: { kg: 900, lb: 1984 }, title: 'Landung 900 kg', ref: { figure: 'L', page: '8' },
      table: grid([axis('pressureAltitude', 'ft', [0, 4000])], [[260, 520], [300, 600]]) }]
  }, massRead ? { massRead } : {}));
}

test('E7 Validierung: Landetabellen wie beim Start, massLanding nicht über dem Höchstgewicht, nur ab Schema 3', () => {
  okData(ac3(e5Chart(POE(15)), e7Landing('linear')));
  okData(ac3(e5Chart(POE(15)), e7Landing('nextHigher')));
  okData(ac3(e5Chart(POE(15)), e7Landing('linear'), { massLanding: { kg: 950, lb: 2094 } }));
  const L = 'charts.landing.lowerWeights';
  const mut = (fn, extra) => { const a = ac3(e5Chart(POE(15)), e7Landing('linear'), extra); fn(a.charts.landing, a); return a; };
  badExactly(mut((l) => { l.lowerWeights[0].mass = { kg: 1000, lb: 2205 }; }), L + '[0].mass nicht absteigend unter dem Höchstgewicht');
  badExactly(mut((l) => { l.lowerWeights[0].table.cells[1] = [341, 600]; }), L + '[0].table.cells: länger als die nächstschwerere Tabelle');
  badExactly(mut((l) => { l.lowerWeights[0].mass.lb = 2000; }), L + '[0].mass: kg und lb passen nicht zusammen');
  badExactly(mut((l) => { delete l.lowerWeights[0].ref; }), L + '[0].ref fehlt');
  badExactly(mut((l) => { l.massRead = 'interpolate'; }), 'charts.landing.massRead unbekannt');
  badExactly(mut((l) => { l.lowerWeights[0].mass = { kg: 900.5, lb: 1985 }; }), 'charts.landing.massRead: Tabellengewichte nicht ganze kg');
  // massLanding: nur ab Schema 3, Form, nicht über mass, kg/lb, Tabellen darunter
  badExactly(mut(() => {}, { massLanding: { kg: 1001, lb: 2207 } }), 'massLanding über dem Höchstgewicht');
  badExactly(mut(() => {}, { massLanding: { kg: 950, lb: 2200 } }), 'massLanding: kg und lb passen nicht zusammen');
  badExactly(mut(() => {}, { massLanding: { kg: 0, lb: 0 } }), 'massLanding unbekannt');
  badExactly(mut(() => {}, { massLanding: 950 }), 'massLanding unbekannt');
  badExactly(mut((l) => { l.lowerWeights[0].mass = { kg: 950, lb: 2094 }; }, { massLanding: { kg: 950, lb: 2094 } }),
    L + '[0].mass nicht absteigend unter dem Höchstgewicht');
  const s2 = mut(() => {});
  s2.schema = 2;
  assert.ok(errs(s2).includes(L + ' nur beim Start erlaubt'));
  assert.ok(errs(s2).includes('charts.landing.massRead nur beim Start erlaubt'));
});

test('E7 Rechnung: Landegewicht = Eingabe bis zum maximalen Landegewicht, linear oder nächsthöher, darunter die leichteste Tabelle', () => {
  const ac = ac3(e5Chart(POE(15)), e7Landing('linear'));
  const land = (kg, a) => { const r = run(a || ac, field(0), wx(15, null, 0, false, kg)); return [r, rwy(r, '36').landing]; };
  // ohne Eingabe: 1000 kg → 300 / 600
  let [r, p] = land(undefined);
  assert.deepEqual(meters(p), [300, 600]);
  assert.deepEqual(r.massLandingUsed, { inputKg: null, kg: 1000, capped: false, maxKg: 1000, maxLb: 2205, read: 'linear',
    tableKg: 1000, tableLb: 2205, tableIndex: 0, tableCount: 2, tableRef: { figure: 'Fig', page: '1' }, tableTitle: 'Tabelle',
    interpolated: false, lowerKg: null, lowerIndex: null, lowerRef: null, lowerTitle: null, lightestKg: 900, belowLowest: false, tablesKg: [1000, 900] });
  // 950 kg: Mitte → 260 + 50 × 40 / 100 = 280; 520 + 50 × 80 / 100 = 560
  [r, p] = land(950);
  assert.deepEqual([meters(p), r.massLandingUsed.kg, r.massLandingUsed.interpolated, r.massLandingUsed.lowerKg, r.massLandingUsed.lowerTitle],
    [[280, 560], 950, true, 900, 'Landung 900 kg']);
  assert.deepEqual([p.lookup.mass.kg, p.lookup.mass.upperKg, p.lookup.mass.lowerKg, p.lookup.mass.weight], [950, 1000, 900, 0.5]);
  // 990 kg: 260 + 90 × 40 / 100 = 296; 520 + 90 × 80 / 100 = 592 (Mutation «nächsthöher» gäbe 300 / 600)
  assert.deepEqual(meters(land(990)[1]), [296, 592]);
  // unter der leichtesten Tabelle: 850 kg → Tabelle 900 kg, 260 / 520
  [r, p] = land(850);
  assert.deepEqual([meters(p), r.massLandingUsed.belowLowest, r.massLandingUsed.tableKg], [[260, 520], true, 900]);
  // nächsthöher: 950 kg → Tabelle 1000 kg
  assert.deepEqual(meters(land(950, ac3(e5Chart(POE(15)), e7Landing('nextHigher')))[1]), [300, 600]);
  // maximales Landegewicht 950 kg (Haupttabelle der Landung gilt für 950 kg): Eingabe 1000 kg → gekappt auf 950 kg
  const ml = ac3(e5Chart(POE(15)), e7Landing('linear'), { massLanding: { kg: 950, lb: 2094 } });
  [r, p] = land(1000, ml);
  assert.deepEqual([meters(p), r.massLandingUsed.kg, r.massLandingUsed.capped, r.massLandingUsed.maxKg, r.massLandingUsed.inputKg], [[300, 600], 950, true, 950, 1000]);
  // 920 kg zwischen 950 und 900: Gewicht 20 / 50 = 0,4 → 260 + 0,4 × 40 = 276; 520 + 0,4 × 80 = 552
  [r, p] = land(920, ml);
  assert.deepEqual([meters(p), r.massLandingUsed.capped, r.massLandingUsed.tablesKg], [[276, 552], false, [950, 900]]);
  // Start rechnet unabhängig davon mit dem Höchstgewicht (eine Starttabelle)
  assert.deepEqual([r.mass.tableKg, r.mass.inputKg], [1000, 920]);
  // Anzeige-Hilfen
  assert.deepEqual(core.landingTables(ml).map((t) => [t.kg, t.lb, t.title]), [[950, 2094, 'Tabelle'], [900, 1984, 'Landung 900 kg']]);
  assert.deepEqual(core.landingMassBracket(ml, 920), { upper: 0, lower: 1, num: 20, den: 50, weight: 0.4 });
  assert.deepEqual(core.landingMassBracket(ml, 1000), { upper: 0, lower: null, num: null, den: null, weight: null });
  assert.deepEqual(core.landingMassBracket(ml), { upper: 0, lower: null, num: null, den: null, weight: null });
  // ohne weitere Landetabellen: wie VERSION 7 (eine Tabelle, maximales Landegewicht, Gewicht ohne Einfluss)
  const one = ac3(e5Chart(POE(15)));
  r = run(one, field(0), wx(15, null, 0, false, 900));
  assert.deepEqual(rwy(r, '36').landing, rwy(run(one, field(0), wx(15, null, 0)), '36').landing);
  assert.deepEqual([r.massLandingUsed.inputKg, r.massLandingUsed.kg, r.massLandingUsed.capped, r.massLandingUsed.belowLowest, r.massLandingUsed.tableCount],
    [900, 1000, false, false, 1]);
  assert.deepEqual(core.landingMassBracket(one, 900), { upper: 0, lower: null, num: null, den: null, weight: null });
  // mit massLanding und einer Landetabelle: immer massLanding (auch bei leichterer Eingabe)
  const oneMl = ac3(e5Chart(POE(15)), undefined, { massLanding: { kg: 950, lb: 2094 } });
  r = run(oneMl, field(0), wx(15, null, 0, false, 1000));
  assert.deepEqual([r.massLandingUsed.kg, r.massLandingUsed.maxKg, r.massLandingUsed.capped, r.massLandingUsed.tablesKg], [950, 950, false, [950]]);
});

/* ── E8: Faustregel-Punkt ─────────────────────────────────── */

const ALT = (p) => ({ kind: 'altitudeRule', percentPer1000ft: p, labelDe: 'Faustregel Druckhöhe', refDe: 'UK CAA, nicht aus dem AFM' });
const TMP = (p, more) => Object.assign({ kind: 'temperatureRule', percentPer10C: p, reference: 'isa', labelDe: 'Faustregel Temperatur', refDe: 'UK CAA, nicht aus dem AFM' }, more || {});
function e8Ac(toCorr, ldgCorr) {
  return ac3(chart(point([200, 300]), toCorr || [ALT(10), TMP(10)], { base: { surface: 'grass', surfaceCondition: 'dry' } }),
    chart(point([150, 400]), ldgCorr || [ALT(5), TMP(5)], { base: { surface: 'grass', surfaceCondition: 'dry' } }));
}

test('E8 Validierung: Punkt genau 0 ft / 15 °C, beide Regeln genau einmal und nur zum Punkt, keine weiteren Tabellen', () => {
  okData(e8Ac());
  const T = 'charts.takeoff.table', C = 'charts.takeoff.corrections';
  const mut = (fn) => { const a = e8Ac(); fn(a.charts.takeoff, a); return a; };
  badExactly(mut((c) => { c.table.conditions.temperatureC = 20; }), T + '.conditions nicht genau 0 ft und 15 °C');
  badExactly(mut((c) => { c.table.conditions.pressureAltitudeFt = 1000; }), T + '.conditions nicht genau 0 ft und 15 °C');
  badExactly(mut((c) => { c.table.conditions.windKt = 0; }), T + '.conditions nicht genau 0 ft und 15 °C');
  badExactly(mut((c) => { delete c.table.conditions.temperatureC; }), T + '.conditions nicht genau 0 ft und 15 °C');
  badExactly(mut((c) => { c.table.conditions = [0, 15]; }), T + '.conditions nicht genau 0 ft und 15 °C');
  badExactly(mut((c) => { c.table.axes = []; }), T + ': Punkt-Tabelle ohne axes und cells');
  badExactly(mut((c) => { c.table.values = [200]; }), T + '.values Form oder Wert falsch');
  badExactly(mut((c) => { c.table.values = [200, 9001]; }), T + '.values Form oder Wert falsch');
  badExactly(mut((c) => { c.table.values = [0, 300]; }), T + '.values Form oder Wert falsch');
  badExactly(mut((c) => { c.table.values = [300, 200]; }), T + '.values: Strecke über Hindernis kürzer als Rollstrecke');
  badExactly(mut((c) => { c.table.obstacle.value = 35; }), T + '.obstacle unbekannt');
  badExactly(mut((c) => { c.corrections = [ALT(10)]; }), C + ': Punkt-Tabelle verlangt altitudeRule und temperatureRule');
  badExactly(mut((c) => { c.corrections = [TMP(10)]; }), C + ': Punkt-Tabelle verlangt altitudeRule und temperatureRule');
  badExactly(mut((c) => { c.corrections.push(ALT(5)); }), C + ': Faustregel doppelt');
  badExactly(mut((c) => { c.corrections[0] = ALT(0); }), C + '[0].percentPer1000ft ausserhalb 0–50 %');
  badExactly(mut((c) => { c.corrections[0] = ALT(51); }), C + '[0].percentPer1000ft ausserhalb 0–50 %');
  badExactly(mut((c) => { c.corrections[1] = TMP(-5); }), C + '[1].percentPer10C ausserhalb 0–50 %');
  badExactly(mut((c) => { c.corrections[1] = TMP(10, { reference: 'std' }); }), C + '[1].reference unbekannt');
  badExactly(mut((c) => { c.corrections[1] = TMP(10, { labelDe: '' }); }), C + '[1].labelDe oder refDe fehlt');
  badExactly(mut((c) => { c.lowerWeights = [{ mass: { kg: 900, lb: 1984 }, title: '', ref: { figure: 'F', page: '1' }, table: point([180, 280]) }]; }),
    'charts.takeoff.lowerWeights bei Punkt-Tabelle nicht erlaubt');
  okData(mut((c) => { c.corrections.push(ALT(50)); c.corrections.shift(); }), 'Grenzwert 50 %');
  // Regeln nur zum Punkt
  const gridRule = ac3(e5Chart(POE(15)));
  gridRule.charts.takeoff.corrections.push(ALT(10));
  badExactly(gridRule, 'charts.takeoff.corrections[2]: Faustregel nur mit Punkt-Tabelle');
  // Schema 2: Punkt und Regeln unbekannt
  const s2 = e8Ac();
  s2.schema = 2;
  assert.ok(errs(s2).includes(T + '.type unbekannt'));
  assert.ok(errs(s2).includes(C + '[0].kind unbekannt'));
});

test('E8 Rechnung: Druckhöhe und Temperatur über ISA nach Faustregel, keine Gutschrift unter 0 ft und unter ISA, über 10000 ft kein Wert', () => {
  // 2000 ft, 15 °C: Höhe × (1 + 10 × 2000 / 100000) = × 1,2; ISA = 15 − 1,98 × 2 = 11,04 °C, 3,96 °C darüber
  // → × (1 + 10 × 3,96 / 1000) = × 1,0396. Start 200 × 1,2 = 240 × 1,0396 = 249,504 → 250; 300 × 1,2 = 360 × 1,0396 = 374,256 → 375
  // Landung (5 / 5): × 1,1 und × 1,0198: 150 → 165 → 168,267 → 169; 400 → 440 → 448,712 → 449
  let r = run(e8Ac(), field(2000, 'grass'), wx(15, null, 0));
  let p = rwy(r, '36').takeoff;
  assert.deepEqual([r.ruleOfThumb, p.ruleOfThumb, p.lookup.point, p.table.groundRoll, p.table.overObstacle], [true, true, true, 200, 300]);
  assert.deepEqual(p.lookup.conditions, { pressureAltitudeFt: 0, temperatureC: 15 });
  const [ra, rt] = p.rules;
  assert.deepEqual([ra.kind, ra.percentPer1000ft, ra.pressureAltitudeFt, ra.creditedFt, ra.factor, ra.after], ['altitudeRule', 10, 2000, 2000, 1.2, { groundRoll: 240, overObstacle: 360 }]);
  assert.deepEqual([ra.labelDe, ra.refDe], ['Faustregel Druckhöhe', 'UK CAA, nicht aus dem AFM']);
  assert.deepEqual([rt.kind, rt.percentPer10C, rt.reference, rt.tempC], ['temperatureRule', 10, 'isa', 15]);
  close(rt.isaC, 11.04);
  close(rt.aboveIsaC, 3.96);
  close(rt.factor, 1.0396);
  close(rt.after.groundRoll, 249.504);
  assert.deepEqual(p.afterRules, rt.after);
  assert.deepEqual(meters(p), [250, 375]);
  assert.deepEqual(meters(rwy(r, '36').landing), [169, 449]);
  // unter ISA (5 °C bei 2000 ft): keine Gutschrift, nur die Höhe → 240 / 360
  r = run(e8Ac(), field(2000, 'grass'), wx(5, null, 0));
  assert.deepEqual([rwy(r, '36').takeoff.rules[1].aboveIsaC, rwy(r, '36').takeoff.rules[1].factor, meters(rwy(r, '36').takeoff)], [0, 1, [240, 360]]);
  // unter 0 ft: keine Gutschrift für die Höhe, ISA wie auf 0 ft (15 °C): −500 ft, 20 °C → × 1 und × 1,05 → 210 / 315
  // (mit ISA auf −500 ft, 15,99 °C, wären es × 1,0401 → 208,02 → 209 / 312,03 → 313)
  r = run(e8Ac(), field(-500, 'grass'), wx(20, null, 0));
  p = rwy(r, '36').takeoff;
  assert.deepEqual([p.rules[0].pressureAltitudeFt, p.rules[0].creditedFt, p.rules[0].factor, p.rules[1].isaC], [-500, 0, 1, 15]);
  assert.deepEqual(meters(p), [210, 315]);
  // Obergrenze 10000 ft: genau 10000 ft rechnet, 10001 ft nicht
  assert.equal(run(e8Ac(), field(10000, 'grass'), wx(-5, null, 0)).ok, true);
  r = core.compute(e8Ac(), field(10001, 'grass'), wx(-5, null, 0));
  assert.deepEqual([r.ok, r.error.code, r.error.above], [false, 'above-range', [{ quantity: 'pressureAltitude', unit: 'ft', value: 10001, max: 10000 }]]);
  // 10 % statt 5 % je 1000 ft bei der Landung fällt auf: 150 × 1,2 × 1,0198 = 183,564 → 184; 400 × 1,2 × 1,0198 = 489,504 → 490
  assert.deepEqual(meters(rwy(run(e8Ac(null, [ALT(10), TMP(5)]), field(2000, 'grass'), wx(15, null, 0)), '36').landing), [184, 490]);
});

test('E8 Reihenfolge: Faustregeln vor Wind, Belag aus der Rollstrecke nach den Regeln, 50-%-Grenze ab den Regeln, dann Faktoren', () => {
  // 2000 ft, 15 °C → nach den Regeln 249,504 / 374,256 (siehe oben)
  // absolute Windregel −5 m je kt, 10 kt → −50 m: 199,504 / 324,256 → 200 / 325
  // (Wind vor den Regeln gäbe (200 − 50) × 1,2 × 1,0396 = 187,128 → 188)
  const wind = { kind: 'headwind', type: 'absolutePer', amount: -5, amountUnit: 'm', per: 1, unit: 'kt' };
  let ac = e8Ac([ALT(10), TMP(10), wind]);
  let p = rwy(run(ac, field(2000, 'grass'), wx(15, 360, 10)), '36').takeoff;
  close(p.afterWind.groundRoll, 199.504);
  assert.deepEqual(meters(p), [200, 325]);
  // 50-%-Grenze: −11 m je kt × 10 kt = 110 m; Hälfte nach den Regeln 124,752 → erlaubt (vom Tabellenwert 200 aus wäre es zu viel)
  ac = e8Ac([ALT(10), TMP(10), Object.assign({}, wind, { amount: -11 })]);
  p = rwy(run(ac, field(2000, 'grass'), wx(15, 360, 10)), '36').takeoff;
  assert.deepEqual([p.ok, meters(p)], [true, [140, 265]]);
  // −13 m je kt × 10 kt = 130 m > 124,752 → kein Wert
  ac = e8Ac([ALT(10), TMP(10), Object.assign({}, wind, { amount: -13 })]);
  p = rwy(run(ac, field(2000, 'grass'), wx(15, 360, 10)), '36').takeoff;
  assert.deepEqual([p.ok, p.reason], [false, 'wind-credit-limit']);
  // Belag: Punkt für Hartbelag, Piste Gras +20 % der Rollstrecke nach den Regeln (49,9008): 299,4048 / 424,1568; danach immer
  // × 1,1: 329,34528 / 466,57248 → 330 / 467 (vom Tabellenwert 200 aus wären es +40 → 318,4544 / 455,6816 → 319 / 456);
  // nass zusätzlich × 1,15: 378,747072 / 536,558352 → 379 / 537
  ac = e8Ac([ALT(10), TMP(10), APO(20), { kind: 'factor', when: 'always', factor: 1.1, minimum: false, labelDe: 'Betrieb', refDe: 'T' },
    { kind: 'factor', when: 'wet', surface: 'grass', factor: 1.15, minimum: false, labelDe: 'nass', refDe: 'T' }]);
  ac.charts.takeoff.base.surface = 'paved';
  p = rwy(run(ac, field(2000, 'grass'), wx(15, null, 0)), '36').takeoff;
  close(p.surface.base, 249.504);
  close(p.surface.inc, 49.9008);
  close(p.surface.after.overObstacle, 424.1568);
  assert.deepEqual(meters(p), [330, 467]);
  p = rwy(run(ac, field(2000, 'grass'), wx(15, null, 0, true)), '36').takeoff;
  assert.deepEqual(p.factors.map((f) => f.factor), [1.1, 1.15]);
  close(p.factors[0].after.groundRoll, 329.34528);
  close(p.final.groundRoll, 378.747072);
  assert.deepEqual(meters(p), [379, 537]);
});

/* ── Reihenfolge der Schritte bei Gittertabellen ───────────── */

test('Reihenfolge: Tabelle → Faktortabelle Wind → Belag je Strecke → AFM-Faktoren in Dateireihenfolge', () => {
  // 0 ft: 1000 / 2000; 15 kt × 0,8 = 800 / 1600; Gras × 1,1 = 880 / 1760; immer × 1,2 = 1056 / 2112; nass × 1,05 = 1108,8 / 2217,6
  const c = e4Chart();
  c.corrections.push(POE(10), { kind: 'factor', when: 'always', factor: 1.2, minimum: false, labelDe: 'A', refDe: 'T' },
    { kind: 'factor', when: 'wet', surface: 'grass', factor: 1.05, minimum: true, labelDe: 'B', refDe: 'T' });
  let p = rwy(run(ac3(c), field(0, 'grass'), wx(15, 360, 15, true)), '36').takeoff;
  assert.deepEqual([p.table.groundRoll, p.afterWind.groundRoll, p.surface.after.groundRoll], [1000, 800, 880]);
  assert.deepEqual(p.factors.map((f) => [f.labelDe, f.after.groundRoll]), [['A', 1056], ['B', 1108.8]]);
  close(p.final.overObstacle, 2217.6);
  assert.deepEqual(meters(p), [1109, 2218]);
  // Faktoren umgekehrt in der Datei: Zwischenwerte in der neuen Reihenfolge, Ergebnis gleich
  const d = clone(c);
  d.corrections.reverse();
  p = rwy(run(ac3(d), field(0, 'grass'), wx(15, 360, 15, true)), '36').takeoff;
  assert.deepEqual(p.factors.map((f) => [f.labelDe, f.after.groundRoll]), [['B', 924], ['A', 1108.8]]);
  assert.deepEqual(meters(p), [1109, 2218]);
});

test('Alles zusammen (Schema 3): Daten unverändert, gleiche Eingabe gleiche Rechnung, Ergebnis ohne NaN', () => {
  const ac = ac3(chart(e2Table(), [POE(15)], { massRead: 'linear', lowerWeights: [{ mass: { kg: 900, lb: 1984 }, title: '900 kg', ref: { figure: 'F', page: '2' },
    table: e2Table(e2Cells().map((a) => a.map((b) => b.map((x) => [x[0] - 10, x[1] - 20])))) }] }), e7Landing('linear'));
  const before = JSON.stringify(ac);
  const af = field(1000, 'grass', true);
  for (const inp of [wx(10, 330, 20, true, 950), wx(-20, null, 2), wx(19.9, 90, 7, false, 901), wx(15, 300, 44)]) {
    const a = core.compute(ac, af, inp), b = core.compute(ac, af, inp);
    assert.deepEqual(a, b);
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(a)), JSON.stringify(inp));
  }
  assert.equal(JSON.stringify(ac), before);
});
