// Rechenkern (perf/perf.js VERSION 8) mit den EDSF-Daten (perf/aircraft/*.json, perf/airfields/edsf.json), Stand
// 20.11.2026: Die Dateien werden angenommen, und je Muster stimmen mindestens zwei Punkte mit der Handrechnung überein
// (Rechenweg im Kommentar, Zwischenwerte auf 4–6 Stellen). Dazu Durchläufe: monoton in Temperatur, QNH, Gegenwind, Nässe
// und Gewicht, nie NaN. Die Werte der Tabellen am Seitenbild prüft die Datenabnahme, nicht dieser Test.
// Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'perf', 'perf.js'));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const AF = readJson('perf/airfields/edsf.json');
const INDEX = readJson('perf/aircraft/index.json');
const AC = {};
['dr400', 'hk36r', 'ev97', 'arcusm'].forEach((id) => { AC[id] = readJson('perf/aircraft/' + id + '.json'); });

function close(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 5e-4), (msg || '') + ' ' + a + ' ≠ ' + b); }
function rwy(r, id) { return r.runways.find((x) => x.id === id); }
function meters(p) { return p.ok ? [p.m.groundRoll, p.m.overObstacle] : p.reason; }
function wx(qnhHpa, tempC, windKt, windDirTrue, runwayWet, massKg) {
  const w = { tempC, qnhHpa, windDirTrue, windKt, runwayWet: runwayWet === true };
  if (massKg !== undefined) w.massKg = massKg;
  return w;
}
function run(id, input) {
  const r = core.compute(AC[id], AF, input);
  assert.equal(r.ok, true, id + ': ' + JSON.stringify(r.error));
  return r;
}

test('EDSF-Daten: Flugzeuge (Schema 3) und Platz (Schema 2) werden angenommen, Index passt zu den Dateien', () => {
  assert.deepEqual(core.validateAirfield(AF), { ok: true, errors: [] });
  assert.equal(AF.schema, 2);
  Object.keys(AC).forEach((id) => {
    assert.deepEqual(core.validateAircraft(AC[id]), { ok: true, errors: [] }, id);
    assert.equal(AC[id].schema, 3, id);
  });
  assert.deepEqual(INDEX.aircraft.map((a) => [a.id, a.file]), [['dr400', 'dr400.json'], ['hk36r', 'hk36r.json'], ['ev97', 'ev97.json'], ['arcusm', 'arcusm.json']]);
  INDEX.aircraft.forEach((a) => assert.equal(readJson('perf/aircraft/' + a.file).id, a.id, a.file));
  assert.ok(INDEX.aircraft.some((a) => a.id === INDEX.default));
  // was die Handrechnungen unten voraussetzen
  assert.deepEqual([AF.elevation.value, AF.runways.map((r) => [r.id, r.bearingTrue, r.surface, r.takeoffAvailable.value, r.landingAvailable.value])],
    [2885, [['11', 110, 'grass', 760, 760], ['29', 290, 'grass', 760, 760]]]);
  assert.deepEqual([core.takeoffTables(AC.dr400).map((t) => t.kg), core.landingTables(AC.dr400).map((t) => t.kg)], [[1100, 1000], [1100, 1000]]);
  assert.deepEqual([AC.hk36r.charts.landing.absent, AC.arcusm.charts.landing.absent, core.landingTables(AC.hk36r)], [true, true, []]);
  assert.deepEqual([AC.ev97.charts.takeoff.table.values, AC.ev97.charts.landing.table.values], [[238, 361], [210, 530]]);
});

test('Fall A (Hauptsitzung): QNH 1010 hPa, 5,6 °C, Wind 269° / 14,04 kt, trocken – Piste 29, 13 kt', () => {
  // Druckhöhe 2885 + 145442,16 × (1 − (1010 / 1013,25)^0,190263) = 2973,87 ft → 2974 ft → 2974 × 0,3048 = 906,4752 → 907 m.
  // Gegenwind 29: 14,04 × cos(269° − 290°) = 13,107 → 13 kt; Piste 11 hat Rückenwind (nicht gerechnet).
  //
  // DR400 1100 kg (ohne Eingabe): Std(2974 ft) = 7 + 474 × (−1 − 7) / 2500 = 5,4832 °C, ΔT = 5,6 − 5,4832 = 0,1168.
  //   Start 2500 ft: 250 + 0,1168 × 40/20 = 250,2336 | 490 + 0,1168 × 80/20 = 490,4672
  //         5000 ft: 305 + 0,1168 × 50/20 = 305,292  | 605 + 0,1168 × 100/20 = 605,584
  //         Druckhöhe 474/2500 = 0,1896: 250,2336 + 0,1896 × 55,0584 = 260,6727 | 490,4672 + 0,1896 × 115,1168 = 512,2933
  //         Wind 13 kt: 0,85 + 3 × (0,65 − 0,85)/10 = 0,79 → 205,9314 | 404,7117; Gras × 1,15 → 236,8211 | 465,4185 → 237 / 466 m
  //   Landung 2500 ft: 185 + 0,1168 × 30/20 = 185,1752 | 440 + 0,1168 × 70/20 = 440,4088
  //           5000 ft: 200 + 0,1168 × 35/20 = 200,2044 | 460 + 0,1168 × 75/20 = 460,438
  //           0,1896: 188,0247 | 444,2063; × 0,79 × 1,15 → 170,8205 | 403,5615 → 171 / 404 m
  // HK36R 907 m (800…1200, Gewicht 107/400 = 0,2675), 5,6 °C (0…15, 0,37333), 13 kt (10…15, 0,6):
  //   800 m:  0 °C 113 + 0,6 × (88 − 113) = 98 | 190 + 0,6 × (156 − 190) = 169,6; 15 °C 117 | 201,4 → 105,0933 | 181,472
  //   1200 m: 0 °C 125 − 16,8 = 108,2 | 210 − 22,8 = 187,2; 15 °C 148 − 19,2 = 128,8 | 248 − 25,8 = 222,2 → 115,8907 | 200,2667
  //   907 m: 105,0933 + 0,2675 × 10,7973 = 107,9816 | 181,472 + 0,2675 × 18,7947 = 186,4996
  //   Gras +20 % der Rollstrecke (21,5963) auf beide: 129,5779 | 208,0959 → 130 / 209 m; Landung: nicht im AFM
  // EV97: Höhe × (1 + 10 × 2974 / 100000) = × 1,2974; ISA = 15 − 1,98 × 2,974 = 9,1115 °C > 5,6 °C → Temperatur × 1.
  //   Start 238 × 1,2974 = 308,7812 | 361 × 1,2974 = 468,3614 → 309 / 469 m (kein Wind im AFM: keine Gutschrift)
  //   Landung × (1 + 5 × 2,974 / 100) = × 1,1487: 241,227 | 608,811 → 242 / 609 m
  // Arcus M 907 m (500…1000, 407/500 = 0,814), 5,6 °C (0…15, 0,37333):
  //   500 m: 225 + 0,37333 × 28 = 235,4533 | 435 + 0,37333 × 55 = 455,5333; 1000 m: 245 + 11,2 = 256,2 | 474 + 22,0267 = 496,0267
  //   907 m: 235,4533 + 0,814 × 20,7467 = 252,3411 | 455,5333 + 0,814 × 40,4933 = 488,4949; Gras +20 % (50,4682): 302,8093 | 538,9631 → 303 / 539 m
  const inp = wx(1010, 5.6, 14.04, 269);
  let r = run('dr400', inp);
  assert.deepEqual([r.pressureAltitudeTableFt, r.pressureAltitudeTableM, rwy(r, '29').wind.kt, rwy(r, '11').reason], [2974, 907, 13, 'tailwind']);
  let p = rwy(r, '29');
  const dv = p.takeoff.lookup.axes[1];
  close(dv.std.stdTempC, 5.4832, 1e-9);
  close(dv.input, 0.1168, 1e-9);
  close(p.takeoff.table.groundRoll, 260.6727);
  close(p.takeoff.table.overObstacle, 512.2933);
  assert.equal(p.takeoff.wind.factor, 0.79);
  close(p.takeoff.final.groundRoll, 236.8211);
  close(p.takeoff.final.overObstacle, 465.4185);
  assert.deepEqual([meters(p.takeoff), meters(p.landing)], [[237, 466], [171, 404]]);
  close(p.landing.final.overObstacle, 403.5615);
  p = rwy(run('hk36r', inp), '29');
  close(p.takeoff.table.groundRoll, 107.9816);
  close(p.takeoff.surface.inc, 21.5963);
  assert.deepEqual([meters(p.takeoff), p.landing.reason, p.takeoff.wind.inTable], [[130, 209], 'not-in-afm', true]);
  p = rwy(run('ev97', inp), '29');
  assert.deepEqual([p.takeoff.rules[0].factor, p.takeoff.rules[1].factor, p.takeoff.wind.noRule], [1.2974, 1, true]);
  close(p.takeoff.rules[1].isaC, 9.11148, 1e-9);
  assert.deepEqual([meters(p.takeoff), meters(p.landing)], [[309, 469], [242, 609]]);
  p = rwy(run('arcusm', inp), '29');
  close(p.takeoff.table.groundRoll, 252.3411);
  assert.deepEqual([meters(p.takeoff), p.landing.reason], [[303, 539], 'not-in-afm']);
});

test('Fall B (Hauptsitzung): QNH 1020 hPa, 25 °C, Wind 100° / 6 kt, nass, DR400 1050 kg – Piste 11, 5 kt', () => {
  // Druckhöhe 2701,15 ft → 2702 ft → 823,5696 → 824 m. Gegenwind 11: 6 × cos(100° − 110°) = 5,909 → 5 kt.
  // DR400 1050 kg (Mitte zwischen 1100 und 1000 kg): Std(2702) = 7 − 202 × 8/2500 = 6,3536 °C, ΔT = 18,6464, Höhe 202/2500 = 0,0808
  //   Start 1100 kg: 2500 ft 250 + 18,6464 × 2 = 287,2928 | 490 + 18,6464 × 4 = 564,5856; 5000 ft 305 + 18,6464 × 2,5 = 351,616 | 605 + 18,6464 × 5 = 698,232
  //                  → 287,2928 + 0,0808 × 64,3232 = 292,4901 | 564,5856 + 0,0808 × 133,6464 = 575,3842
  //         1000 kg: 2500 ft 190 + 18,6464 × 1,5 = 217,9696 | 370 + 18,6464 × 3 = 425,9392; 5000 ft 235 + 18,6464 × 2 = 272,2928 | 555 + 18,6464 × 4,75 = 643,5704
  //                  → 222,3589 | 443,5238;  1050 kg: (292,4901 + 222,3589)/2 = 257,4245 | (575,3842 + 443,5238)/2 = 509,4540
  //         Wind 5 kt × (1 + 5 × (0,85 − 1)/10) = × 0,925 → 238,1177 | 471,2450; Gras × 1,15 → 273,8353 | 541,9317 → 274 / 542 m
  //         nass: das AFM nennt keinen Wert (kein Zuschlag, Hinweis)
  //   Landung 1100 kg: 2500 ft 185 + 18,6464 × 1,5 = 212,9696 | 440 + 18,6464 × 3,5 = 505,2624; 5000 ft 232,6312 | 529,924 → 214,5583 | 507,2551
  //           1000 kg: 2500 ft 170 + 27,9696 = 197,9696 | 405 + 18,6464 × 3,25 = 465,6008; 5000 ft 207,9696 | 495,2624 → 198,7776 | 467,9975
  //           1050 kg: 206,6679 | 487,6263; × 0,925 × 1,15 → 219,8430 | 518,7124 → 220 / 519 m
  // HK36R (ohne Gewicht): 824 m (800…1200, 0,06), 25 °C (15…30, 0,66667), 5 kt genau (Spalte 5 kt)
  //   800 m: 168 + 0,66667 × 33 = 190 | 269 + 0,66667 × 53 = 304,3333; 1200 m: 183 + 24 = 207 | 295 + 38 = 333
  //   824 m: 190 + 0,06 × 17 = 191,02 | 304,3333 + 0,06 × 28,6667 = 306,0533; Gras +38,204 → 229,224 | 344,2573 → 230 / 345 m
  // EV97: × (1 + 10 × 2702/100000) = × 1,2702; ISA = 15 − 1,98 × 2,702 = 9,65004; 25 − 9,65004 = 15,34996 °C darüber
  //   → × (1 + 10 × 15,34996/1000) = × 1,1534996; nass × 1,15 (AFM: «hohes Gras, Regen o. ä.»)
  //   Start 238 × 1,2702 × 1,1534996 × 1,15 = 401,0185 | 361 × … = 608,2675 → 402 / 609 m
  //   Landung × 1,1351 × 1,0767498: 256,6659 | 647,7759 → 257 / 648 m (nass: kein Wert im AFM, kein Zuschlag)
  // Arcus M: 824 m (500…1000, 0,648), 25 °C (15…30, 0,66667)
  //   500 m: 253 + 20 = 273 | 490 + 38,6667 = 528,6667; 1000 m: 275 + 22 = 297 | 533 + 42 = 575
  //   824 m: 273 + 0,648 × 24 = 288,552 | 528,6667 + 0,648 × 46,3333 = 558,6907; Gras +57,7104 → 346,2624 | 616,4011 → 347 / 617 m
  let r = run('dr400', wx(1020, 25, 6, 100, true, 1050));
  let p = rwy(r, '11');
  assert.deepEqual([r.pressureAltitudeTableFt, r.pressureAltitudeTableM, p.wind.kt, rwy(r, '29').reason], [2702, 824, 5, 'tailwind']);
  assert.deepEqual([r.mass.interpolated, r.massLandingUsed.kg, r.massLandingUsed.interpolated, r.massLandingUsed.lowerKg], [true, 1050, true, 1000]);
  close(p.takeoff.lookup.mass.upper.values.groundRoll, 292.4901);
  close(p.takeoff.lookup.mass.lower.values.groundRoll, 222.3589);
  close(p.takeoff.table.groundRoll, 257.4245);
  close(p.takeoff.table.overObstacle, 509.4540);
  close(p.landing.table.overObstacle, 487.6263);
  assert.deepEqual([p.takeoff.wind.factor, p.takeoff.surface.factor, p.takeoff.wetFactorMissing, p.landing.wetFactorMissing], [0.925, 1.15, true, true]);
  assert.deepEqual([meters(p.takeoff), meters(p.landing)], [[274, 542], [220, 519]]);
  p = rwy(run('hk36r', wx(1020, 25, 6, 100, true)), '11');
  close(p.takeoff.table.overObstacle, 306.0533);
  assert.deepEqual([meters(p.takeoff), p.takeoff.wetFactorMissing], [[230, 345], true]);
  p = rwy(run('ev97', wx(1020, 25, 6, 100, true)), '11');
  close(p.takeoff.rules[1].factor, 1.1534996, 1e-9);
  assert.deepEqual(p.takeoff.factors.map((f) => [f.factor, f.when]), [[1.15, 'wet']]);
  assert.deepEqual([meters(p.takeoff), meters(p.landing), p.landing.wetFactorMissing], [[402, 609], [257, 648], true]);
  p = rwy(run('arcusm', wx(1020, 25, 6, 100, true)), '11');
  close(p.takeoff.table.groundRoll, 288.552);
  assert.deepEqual(meters(p.takeoff), [347, 617]);
  // Gewicht über dem Höchstgewicht: wie bisher kein Wert (die Anzeige schickt bei einer Starttabelle kein Gewicht)
  assert.deepEqual(core.compute(AC.hk36r, AF, wx(1020, 25, 6, 100, true, 1050)).error, { code: 'above-mass', massKg: 1050, maxKg: 770 });
});

test('Fall C: QNH 1000 hPa, 31 °C, Wind 290° / 18 kt – nur der Eurostar hat einen Wert (Faustregel), sonst über der Tabelle', () => {
  // Druckhöhe 2885 + 363,79 = 3248,79 ft → 3249 ft → 990,2952 → 991 m.
  // DR400: Std(3249) = 7 − 749 × 8/2500 = 4,6032 °C; ΔT = 26,3968 > 20 → kein Wert; höchste Temperatur 24,6032 °C.
  // HK36R und Arcus M: 31 °C über der grössten Spalte 30 °C → kein Wert.
  // EV97 Piste 29, 18 kt (keine Gutschrift): Höhe × 1,3249; ISA = 15 − 1,98 × 3,249 = 8,56698; 31 − 8,56698 = 22,43302
  //   → × 1,2243302. Start 238 × 1,3249 = 315,3262 × 1,2243302 = 386,0634 → 387; 361 × 1,3249 = 478,2889 → 585,5835 → 586 m
  //   Landung × 1,16245 × 1,1121651: 210 → 244,1145 → 271,4956 → 272; 530 → 616,0985 → 685,2033 → 686 m
  const inp = wx(1000, 31, 18, 290);
  let r = core.compute(AC.dr400, AF, inp);
  assert.deepEqual([r.ok, r.error.code, r.pressureAltitudeTableFt, r.pressureAltitudeTableM], [false, 'above-range', 3249, 991]);
  assert.equal(r.error.above.length, 1);
  const a = r.error.above[0];
  assert.deepEqual([a.quantity, a.unit, a.max, a.tempC], ['temperatureDeviation', 'degC', 20, 31]);
  close(a.value, 26.3968, 1e-9);
  close(a.maxTempC, 24.6032, 1e-9);
  ['hk36r', 'arcusm'].forEach((id) => {
    r = core.compute(AC[id], AF, inp);
    assert.deepEqual([r.ok, r.error.above], [false, [{ quantity: 'temperature', unit: 'degC', value: 31, max: 30 }]], id);
  });
  r = run('ev97', inp);
  const p = rwy(r, '29');
  close(p.takeoff.rules[1].aboveIsaC, 22.43302, 1e-9);
  close(p.takeoff.final.groundRoll, 386.0634);
  assert.deepEqual([meters(p.takeoff), meters(p.landing), r.ruleOfThumb], [[387, 586], [272, 686], true]);
});

test('Fall D: QNH 1030 hPa, −12 °C, windstill, DR400 mit 980 kg (unter der leichtesten Tabelle) – beide Pisten', () => {
  // Druckhöhe 2885 − 454,42 = 2430,58 ft → 2431 ft → 740,9688 → 741 m. Windstill: beide Pisten ohne Windkorrektur.
  // DR400 980 kg → Start- und Landetabelle 1000 kg. Std(2431) = 15 − 2431 × 8/2500 = 7,2208; ΔT = −19,2208 (0,7792 über −20);
  //   Höhe 2431/2500 = 0,9724.
  //   Start 0 ft: 135 + 0,7792 × 20/20 = 135,7792 | 260 + 0,7792 × 40/20 = 261,5584; 2500 ft: 165 + 0,7792 × 25/20 = 165,974 | 315 + 0,7792 × 55/20 = 317,1428
  //         → 135,7792 + 0,9724 × 30,1948 = 165,1406 | 261,5584 + 0,9724 × 55,5844 = 315,6087; Gras × 1,15 → 189,9117 | 362,9500 → 190 / 363 m
  //   Landung 0 ft: 140,7792 | 330 + 0,7792 × 55/20 = 332,1428; 2500 ft: 145,974 | 345 + 0,7792 × 60/20 = 347,3376
  //         → 145,8306 | 346,9182; × 1,15 → 167,7052 | 398,9560 → 168 / 399 m
  // HK36R 741 m (400…800, 341/400 = 0,8525), −12 °C → Spalte 0 °C, 0 kt:
  //   156 + 0,8525 × 20 = 173,05 | 242 + 0,8525 × 29 = 266,7225; Gras +34,61 → 207,66 | 301,3325 → 208 / 302 m
  // EV97: × (1 + 10 × 2431/100000) = × 1,2431; ISA 10,18662 °C > −12 °C → × 1. Start 295,8578 | 448,7591 → 296 / 449 m;
  //   Landung × 1,12155: 235,5255 | 594,4215 → 236 / 595 m
  // Arcus M 741 m (500…1000, 241/500 = 0,482), −12 °C (−15…0, 0,2):
  //   500 m: 199 + 0,2 × 26 = 204,2 | 384 + 0,2 × 51 = 394,2; 1000 m: 216 + 5,8 = 221,8 | 418 + 11,2 = 429,2
  //   741 m: 204,2 + 0,482 × 17,6 = 212,6832 | 394,2 + 0,482 × 35 = 411,07; Gras +42,5366 → 255,2198 | 453,6066 → 256 / 454 m
  const inp = wx(1030, -12, 0.5, null);
  let r = run('dr400', Object.assign({}, inp, { massKg: 980 }));
  assert.deepEqual([r.mode, r.pressureAltitudeTableFt, r.pressureAltitudeTableM, r.computedCount], ['calm', 2431, 741, 2]);
  assert.deepEqual([r.mass.tableKg, r.mass.belowLowest, r.mass.interpolated, r.massLandingUsed.tableKg, r.massLandingUsed.belowLowest], [1000, true, false, 1000, true]);
  ['11', '29'].forEach((id) => {
    const p = rwy(r, id);
    close(p.takeoff.lookup.axes[1].input, -19.2208, 1e-9);
    close(p.takeoff.table.groundRoll, 165.1406);
    close(p.landing.table.overObstacle, 346.9182);
    assert.deepEqual([meters(p.takeoff), meters(p.landing), p.takeoffLimit.state], [[190, 363], [168, 399], 'possible'], id);
  });
  r = run('hk36r', inp);
  assert.deepEqual([rwy(r, '11').takeoff.lookup.axes[1].belowLowest, meters(rwy(r, '11').takeoff), meters(rwy(r, '29').takeoff)], [true, [208, 302], [208, 302]]);
  r = run('ev97', inp);
  assert.deepEqual([rwy(r, '11').takeoff.rules[0].factor, meters(rwy(r, '11').takeoff), meters(rwy(r, '29').landing)], [1.2431, [296, 449], [236, 595]]);
  r = run('arcusm', inp);
  close(rwy(r, '29').takeoff.table.groundRoll, 212.6832);
  assert.deepEqual(meters(rwy(r, '29').takeoff), [256, 454]);
});

test('Pistenwahl an EDSF: Wind 2–5° hinter quer ist Rückenwind (keine Rechnung), genau quer beide Pisten ohne Wind', () => {
  // Quer zu 110° / 290° sind 20° und 200°. 202°…205° und 15°…18° kommen schräg von hinten auf Piste 11, 195°…198° und
  // 22°…25° auf Piste 29: diese Piste wird nicht gerechnet, die Gegenpiste mit ihrem (kleinen) Gegenwind.
  // Beispiel 205° / 20 kt: Piste 11 cos 95° = −0,0872 → 1,74 kt Rückenwind; Piste 29 cos 85° = 0,0872 → 1,74 → 1 kt.
  const cases = [];
  [2, 3, 4, 5].forEach((k) => {
    cases.push([200 + k, '11', '29', k], [20 - k, '11', '29', k], [200 - k, '29', '11', k], [20 + k, '29', '11', k]);
  });
  cases.forEach(([dir, tail, head, k]) => {
    const r = run('dr400', wx(1013, 15, 20, dir));
    const t = rwy(r, tail), h = rwy(r, head);
    assert.deepEqual([t.computed, t.reason, t.wind.kind, t.takeoff, t.landing], [false, 'tailwind', 'tailwind', null, null], dir + '°');
    close(t.wind.componentKt, 20 * Math.sin(k * Math.PI / 180), 1e-6, dir + '° Rückenwind');
    assert.deepEqual([h.computed, h.wind.kt, h.takeoff.ok, h.landing.ok], [true, Math.floor(20 * Math.sin(k * Math.PI / 180) + 1e-9), true, true], dir + '°');
    assert.equal(r.computedCount, 1, dir + '°');
  });
  // genau quer: beide Pisten ohne Windkorrektur
  [20, 200].forEach((dir) => {
    const r = run('dr400', wx(1013, 15, 20, dir));
    assert.deepEqual(r.runways.map((x) => [x.id, x.computed, x.wind.along, x.wind.kt]), [['11', true, 0, 0], ['29', true, 0, 0]], dir + '°');
  });
});

test('EDSF-Durchlauf: monoton in Temperatur, QNH, Gegenwind, Nässe und Gewicht; nie NaN, nie eine Ausnahme', () => {
  const vals = (r) => {
    const out = [];
    r.runways.forEach((x) => ['takeoff', 'landing'].forEach((ph) => {
      const p = x[ph];
      out.push(p && p.ok ? [p.m.groundRoll, p.m.overObstacle] : null);
    }));
    return out;
  };
  // b gilt «länger oder gleich» a, wo beide einen Wert haben; ein Wert darf nur auf der längeren Seite fehlen
  const notShorter = (a, b, msg) => a.forEach((x, k) => {
    if (x && b[k]) assert.ok(b[k][0] >= x[0] && b[k][1] >= x[1], msg + ' ' + JSON.stringify([x, b[k]]));
    if (!x && b[k]) assert.fail(msg + ': kürzere Seite ohne Wert');
  });
  let n = 0;
  Object.keys(AC).forEach((id) => {
    const masses = id === 'dr400' ? [undefined, 1000, 1050, 1099] : [undefined];
    masses.forEach((kg) => {
      [0, 8, 17, 33].forEach((w) => [false, true].forEach((wet) => {
        let prev = null;
        for (let t = -25; t <= 40; t += 1.5) {
          const r = core.compute(AC[id], AF, wx(1013, t, w, 290, wet, kg));
          n++;
          assert.ok(!/NaN|Infinity/.test(JSON.stringify(r)), id);
          if (!r.ok) { assert.ok(r.error.code === 'above-range', id + ' ' + t + ' °C: ' + JSON.stringify(r.error)); prev = 'over'; continue; }
          assert.notEqual(prev, 'over', id + ': Wert nach «über der Tabelle»');
          if (prev) notShorter(prev, vals(r), id + ' Temperatur ' + t);
          prev = vals(r);
        }
        prev = null;
        for (let q = 1045; q >= 960; q -= 2.5) {
          const r = core.compute(AC[id], AF, wx(q, 12, w, 290, wet, kg));
          n++;
          if (!r.ok) { prev = 'over'; continue; }
          assert.notEqual(prev, 'over', id + ': Wert nach «über der Tabelle» (QNH)');
          if (prev) notShorter(prev, vals(r), id + ' QNH ' + q);
          prev = vals(r);
        }
        const dry = core.compute(AC[id], AF, wx(1013, 12, w, 290, false, kg)), wetR = core.compute(AC[id], AF, wx(1013, 12, w, 290, true, kg));
        if (dry.ok && wetR.ok) notShorter(vals(dry), vals(wetR), id + ' nass');
      }));
      // Piste 29 (Wind genau von vorn): mehr Gegenwind, nicht länger. Piste 11 wechselt bei 1 kt von windstill (gerechnet)
      // zu Rückenwind (nicht gerechnet) und bleibt darum aussen vor.
      let prev = null;
      for (let w = 0; w <= 40; w += 0.5) {
        const r = core.compute(AC[id], AF, wx(1013, 12, w, 290, false, kg));
        n++;
        const x = rwy(r, '29');
        const v = ['takeoff', 'landing'].map((ph) => (x[ph] && x[ph].ok ? [x[ph].m.groundRoll, x[ph].m.overObstacle] : null));
        if (prev) notShorter(v, prev, id + ' Gegenwind ' + w);
        prev = v;
      }
    });
  });
  // DR400: schwerer ist nie kürzer (Start und Landung)
  let prev = null;
  for (let kg = 950; kg <= 1100; kg += 5) {
    const v = vals(core.compute(AC.dr400, AF, wx(1013, 18, 4, 290, false, kg)));
    if (prev) notShorter(prev, v, 'DR400 ' + kg + ' kg');
    prev = v;
  }
  assert.ok(n > 2000);
});
