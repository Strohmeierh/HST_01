// Anzeigetests für den Start-/Landestreckenrechner EDSF (perf/perf-ui.js VERSION 8, Fork der LSZK-Anzeige VERSION 7):
// Adapter für window.EDSF_WX, Nässe nur bei Regen laut Station EDSF, Kartentexte je Muster mit den neuen Kernstufen
// (Druckhöhe in m, Standardtemperatur der Tabelle, Gegenwind in der Tabelle bzw. als Faktortabelle, Belag je Strecke,
// Faustregel, Landung nach Gewicht, Landung fehlt im AFM), Gewichtsfeld, Fehlertexte und der Browserteil boot().
// Sollwerte der Strecken aus der unabhängigen Handrechnung der Hauptsitzung (scratchpad/datencheck/handrechnung.js,
// 20.11.2026), nicht aus dem Rechenkern.
// Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ui = require(path.join(ROOT, 'perf', 'perf-ui.js'));
const core = require(path.join(ROOT, 'perf', 'perf.js'));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const DR400 = readJson('perf/aircraft/dr400.json');
const HK36R = readJson('perf/aircraft/hk36r.json');
const EV97 = readJson('perf/aircraft/ev97.json');
const ARCUS = readJson('perf/aircraft/arcusm.json');
const AF = readJson('perf/airfields/edsf.json');
const INDEX_RAW = readJson('perf/aircraft/index.json');
const LIST = ui.parseIndex(INDEX_RAW).list;
const clone = (o) => JSON.parse(JSON.stringify(o));

// 20.11.2026, 11:45 Uhr in Hütten (MEZ)
const NOW = Date.UTC(2026, 10, 20, 10, 45);
const MIN = 60000;

// Referenzfall wie gauge-data.txt vom 20.11.2026, 10:40 UTC: QNH 1010, 5,6 °C, 269° / 26 km/h, Böe 48 km/h, kein Regen.
// Handrechnung: Druckhöhe 2974 ft = 907 m, Piste 29 mit 13 kt Gegenwind.
function wxEdsf(over) {
  return Object.assign({
    src: 'edsf', srcLabel: 'Station EDSF', time: NOW - 5 * MIN, ageMin: 5, stale: false,
    windKt: 26 / 1.852, windDir: 269, gustKt: 48 / 1.852, tempC: 5.6, dewC: 3.3, humPct: 85, qnhHpa: 1010,
    rainMmH: 0, rainTodayMm: 0.6
  }, over);
}
function ctxOf(wx, over) {
  return Object.assign({ dataState: 'ready', list: LIST, aircraft: DR400, airfield: AF, wx, nowMs: NOW, detailsOpen: false, afmTag: false }, over);
}
const render = (wx, over) => ui.renderHtml(ctxOf(wx, over));
const parts = (wx, over) => ui.renderParts(ctxOf(wx, over));
// Sichtbarer Text: Tags weg, Entities auflösen, Leerraum zusammenfassen
function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
function block(html, id) {
  const start = html.indexOf('<section class="perf-block" aria-label="Piste ' + id + '">');
  if (start < 0) return null;
  return html.slice(start, html.indexOf('</section>', start) + 10);
}
function details(html) {
  const a = html.indexOf('<details class="perf-details"');
  return a < 0 ? null : html.slice(a, html.indexOf('</details>', a) + 10);
}
function assertClean(html, label) {
  ['NaN', 'undefined', 'null', 'Infinity', '[object'].forEach((w) => assert.ok(!html.includes(w), (label || '') + ': enthält ' + w));
}
function assertNoResult(html, label) {
  ['perf-grid', 'perf-table', 'perf-block', 'perf-details', 'perf-meas', '&nbsp;m<'].forEach((w) => {
    assert.ok(!html.includes(w), (label || '') + ': Ergebnisblock (' + w + ')');
  });
  assert.ok(html.includes('class="perf-foot"'), (label || '') + ': Fusszeile fehlt');
}
const has = (html, s) => text(html).includes(s);

/* ── Adapter window.EDSF_WX ────────────────────────────────── */

test('adaptEdsfWx: gültige Werte der Station EDSF, Böe nur Anzeige, Regenrate', () => {
  const a = ui.adaptEdsfWx(wxEdsf({ rainMmH: 1.2 }), NOW);
  assert.equal(a.ok, true);
  assert.deepEqual(a.wx, { tempC: 5.6, qnhHpa: 1010, windDirTrue: 269, windKt: 26 / 1.852 });
  assert.deepEqual([a.gustKt, a.rainMmH, a.srcLabel, a.ageMin], [48 / 1.852, 1.2, 'Station EDSF', 5]);
  [null, undefined, 'x', NaN, -1].forEach((g) => {
    const b = ui.adaptEdsfWx(wxEdsf({ gustKt: g }), NOW);
    assert.equal(b.ok, true, 'Böe ' + g);
    assert.equal(b.gustKt, null);
  });
  [[null, null], [undefined, null], ['0.4', null], [-0.1, null], [0, 0], [2.5, 2.5], [NaN, null]].forEach(([v, exp]) => {
    assert.equal(ui.adaptEdsfWx(wxEdsf({ rainMmH: v }), NOW).rainMmH, exp, 'Regen ' + v);
  });
  assert.equal('rain1hMm' in ui.adaptEdsfWx(wxEdsf(), NOW), false, 'keine Stundensumme (die Station EDSF liefert die Rate)');
});

test('adaptEdsfWx: nur Station EDSF, frisch und vollständig; Alter selbst gerechnet', () => {
  const code = (w) => ui.adaptEdsfWx(w, NOW).code;
  assert.equal(code(undefined), 'no-data');
  assert.equal(code('x'), 'no-data');
  ['pfa', 'speck', null, undefined, 'EDSF', ''].forEach((src) => assert.equal(code(wxEdsf({ src })), 'no-source', 'src ' + src));
  assert.equal(code(wxEdsf({ time: null })), 'no-time');
  assert.equal(code(wxEdsf({ time: '2026-11-20' })), 'no-time');
  assert.equal(code(wxEdsf({ stale: true })), 'stale');
  assert.equal(code(wxEdsf({ time: NOW - 46 * MIN, ageMin: 0, stale: false })), 'stale');
  assert.equal(ui.adaptEdsfWx(wxEdsf({ time: NOW - 45 * MIN, ageMin: 99 }), NOW).ok, true);
  assert.equal(ui.adaptEdsfWx(wxEdsf({ time: NOW + 6 * MIN }), NOW).future, true);
  assert.equal(ui.adaptEdsfWx(wxEdsf({ time: NOW + 4 * MIN }), NOW).ok, true);
  assert.deepEqual(ui.adaptEdsfWx(wxEdsf({ qnhHpa: null, windKt: '8' }), NOW).fields, ['qnhHpa', 'windKt']);
  assert.deepEqual(ui.adaptEdsfWx(wxEdsf({ tempC: '5,6' }), NOW).fields, ['tempC']);
  assert.deepEqual(ui.adaptEdsfWx(wxEdsf({ windDir: '269' }), NOW).fields, ['windDir']);
  [[null, 8], [undefined, 2]].forEach(([dir, kt]) => {
    const w = wxEdsf({ windKt: kt });
    if (dir === undefined) delete w.windDir; else w.windDir = dir;
    assert.equal(ui.adaptEdsfWx(w, NOW).wx.windDirTrue, null);
  });
});

// Schnittstelle der Seite: edsfWx aus index.html herausgeschnitten (wie in tests/seite.test.js), dann in die Anzeige
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const WX_CODE = (() => {
  const a = SRC.indexOf('    var EDSF_WX_STALE_MIN = 45;');
  const b = SRC.indexOf('    // Rechner über neue Werte informieren', a);
  if (a < 0 || b < 0) throw new Error('edsfWx in index.html nicht gefunden');
  return SRC.slice(a, b);
})();
const edsfWx = new Function(WX_CODE + '\nreturn edsfWx;')();
function gauge(over) {
  return Object.assign({
    timeUTC: '2026,11,20,10,40,00', SensorContactLost: '0', windunit: 'km/h', temp: '5,6', hum: '85', dew: '3,3',
    press: '1010,0', rfall: '0.6', rrate: '0.0', wspeed: '26', wgust: '48', bearing: '270', avgbearing: '269'
  }, over);
}

test('Seite → Anzeige: gauge-data.txt über window.EDSF_WX bis zur Karte (Kommazahlen, Sensorausfall, Alter, Richtung 0)', () => {
  let p = parts(edsfWx(gauge(), NOW));
  assert.equal(p.kind, 'result');
  assert.ok(has(p.body, 'Messwerte Station EDSF, 11:40 Uhr (vor 5 min): 5,6 °C · QNH 1010,0 hPa · Wind 269° / 14,0 kt, Böen 26 kt · Druckhöhe 2.974 ft (907 m)'), text(p.body));
  assert.ok(has(block(p.body, '29'), 'Start 237 m 466 m 760 m'));
  // Sensorausfall: keine Zahlen
  p = parts(edsfWx(gauge({ SensorContactLost: '1' }), NOW));
  assert.equal(p.kind, 'no-wx');
  assert.ok(has(p.body, 'Keine aktuellen Messwerte vom Platz – keine Berechnung.'));
  assertNoResult(p.body, 'Sensorausfall');
  // Messzeit unlesbar oder 45 min alt: keine Zahlen
  p = parts(edsfWx(gauge({ timeUTC: 'x' }), NOW));
  assert.equal(p.kind, 'no-wx');
  p = parts(edsfWx(gauge(), Date.UTC(2026, 10, 20, 11, 25)), { nowMs: Date.UTC(2026, 10, 20, 11, 25) });
  assert.ok(has(p.body, 'Messwerte veraltet (Stand 11:40 Uhr, vor 45 min) – keine Berechnung.'), text(p.body));
  // Richtung 0 (Cumulus: keine Richtung) bei 14 kt: Gegenwindpiste nicht bestimmbar; bei 2 km/h windstill
  p = parts(edsfWx(gauge({ avgbearing: '0' }), NOW));
  assert.equal(p.kind, 'no-direction');
  assert.ok(has(p.body, ui.TEXT.noDirection));
  p = parts(edsfWx(gauge({ avgbearing: '0', wspeed: '1,5' }), NOW));
  assert.equal(p.kind, 'result');
  assert.ok(has(p.teaser, 'windstill'), text(p.teaser));
  p = parts(edsfWx(gauge({ avgbearing: '0', wspeed: '5' }), NOW));            // 2,7 kt ohne Richtung: beide Pisten
  assert.ok(has(p.teaser, 'ohne Windrichtung'), text(p.teaser));
  // Messwert fehlt: Text nennt ihn
  p = parts(edsfWx(gauge({ press: '---' }), NOW));
  assert.ok(has(p.body, 'Messwert fehlt (QNH) – keine Berechnung.'), text(p.body));
  // Regenrate mit Komma macht nass
  p = parts(edsfWx(gauge({ rrate: '0,2' }), NOW));
  assert.ok(has(p.body, 'Piste gilt als nass: Die Station EDSF misst Regen (0,2 mm/h).'), text(p.body));
});

/* ── Nässe: nur Regen laut Station EDSF ────────────────────── */

test('Nässe: nass genau bei Regenrate > 0; ohne Regenwert unbekannt und trocken gerechnet', () => {
  const st = (r) => ui.wetState(ui.rainState({ rainMmH: r }));
  const pick = (w) => [w.wet, w.byRain, w.unknown];
  assert.deepEqual(pick(st(0)), [false, false, false], 'kein Regen');
  assert.deepEqual(pick(st(0.1)), [true, true, false], 'Regen');
  assert.deepEqual(pick(st(12)), [true, true, false]);
  [null, undefined, -0.1, NaN, '0.4'].forEach((r) => assert.deepEqual(pick(st(r)), [false, false, true], 'unbekannt ' + r));
  assert.deepEqual(ui.rainState(null), { rain: false, known: false, mmH: null });
  // Karte: Rechnung mit runwayWet wie die Nässe
  const spy = [];
  const orig = core.compute;
  try {
    core.compute = (ac, af, inp) => { spy.push(inp.runwayWet); return orig(ac, af, inp); };
    [0, 0.3, null].forEach((r) => render(wxEdsf({ rainMmH: r })));
  } finally {
    core.compute = orig;
  }
  assert.deepEqual(spy, [false, true, false]);
});

test('Pistenzustand-Texte: trocken gedämpft, nass im gelben Kasten mit Folge je Phase, unbekannt in der Hinweisfarbe', () => {
  // trocken: keine Pistenmeldung für EDSF, kein Regen, Belag, Vorbehalt – alles gedämpft, kein Hinweis
  let html = render(wxEdsf(), { detailsOpen: true });
  const cond = /<div class="perf-cond">([^<]*)<\/div>/.exec(html);
  assert.ok(cond, html);
  assert.equal(text(cond[1]), ui.TEXT.noReport + ' ' + ui.TEXT.noRain + ' Gerechnet für trockenes Gras. ' + ui.TEXT.reserve);
  assert.ok(!html.includes('perf-warn') && !html.includes('class="perf-note"'));
  assert.ok(has(html, 'Piste trocken gerechnet'));
  // nass (DR400: das AFM nennt für nasses Gras keinen Wert, Start und Landung)
  html = render(wxEdsf({ rainMmH: 1.2 }), { detailsOpen: true });
  const warn = /<div class="perf-cond perf-warn" role="note"><div>(.*?)<\/div><\/div>/.exec(html);
  assert.ok(warn, html);
  assert.equal(text(warn[1]), 'Piste gilt als nass: Die Station EDSF misst Regen (1,2 mm/h). Das AFM nennt für nasses Gras keinen Wert; Start- und Landestrecke können deutlich länger sein.');
  assert.ok(!html.includes('<div class="perf-cond">'), 'bei Nässe keine gedämpfte Zeile');
  assert.ok(has(html, 'Piste nass gerechnet') && has(html, 'nasse Piste: kein Wert im AFM, ohne Zuschlag gerechnet'));
  // Zahlen unverändert (kein Nässewert im AFM)
  assert.ok(has(block(html, '29'), 'Start 237 m 466 m 760 m'));
  // unbekannt: Hinweis in der Hinweisfarbe, trocken gerechnet, ohne «kein Regen»
  html = render(wxEdsf({ rainMmH: null }), { detailsOpen: true });
  assert.ok(html.includes('<div class="perf-note">' + ui.TEXT.unknown + '</div>'), html);
  assert.ok(has(html, ui.TEXT.noReport) && !has(html, ui.TEXT.noRain));
  assert.ok(has(html, 'Piste trocken gerechnet'));
  assert.ok(has(block(html, '29'), 'Start 237 m 466 m 760 m'));
  // Texte ohne LSZK-Bezug
  ['FGZO', 'MeteoSchweiz', 'Speck', 'Stundensumme'].forEach((w) => {
    [render(wxEdsf(), { detailsOpen: true }), render(wxEdsf({ rainMmH: 1 }), { detailsOpen: true }), render(wxEdsf({ rainMmH: null }))].forEach((h) => {
      assert.ok(!h.includes(w), 'enthält ' + w);
    });
  });
});

test('Nässe je Muster: Eurostar Start ca. +15 % eingerechnet, Landung ohne Wert; Super Dimona und Arcus nur der Start', () => {
  // Handrechnung 22,3 °C, nass: Eurostar 402/610 und 258/649, Super Dimona 159/253, Arcus 345/613
  const wx = wxEdsf({ tempC: 22.3, rainMmH: 0.4 });
  let html = render(wx, { aircraft: EV97 });
  // Das AFM nennt den Zuschlag nur ungefähr («ca. 15 %»): Zuschläge ohne «mindestens» stehen mit «ca.»
  assert.ok(has(html, 'Piste gilt als nass: Die Station EDSF misst Regen (0,4 mm/h). Start: ca. +15 % eingerechnet (ACHTUNG unter 5.2.3, S. 35). ' +
    'Landung: Das AFM nennt für nasses Gras keinen Wert; die Strecke kann deutlich länger sein.'), text(html));
  // mit minimum: true «mindestens» statt «ca.»
  const minEv = clone(EV97);
  minEv.charts.takeoff.corrections.forEach((c) => { if (c.kind === 'factor') c.minimum = true; });
  const hm = render(wx, { aircraft: minEv });
  assert.ok(has(hm, 'Start: mindestens +15 % eingerechnet (ACHTUNG unter 5.2.3, S. 35).') && !has(hm, 'ca. +15'), text(hm));
  assert.ok(has(block(html, '29'), 'Start 402 m 610 m 760 m Landung 258 m 649 m 760 m'), text(block(html, '29')));
  html = render(wx, { aircraft: HK36R });
  assert.ok(has(html, 'Piste gilt als nass: Die Station EDSF misst Regen (0,4 mm/h). Start: Das AFM nennt für nasses Gras keinen Wert; die Strecke kann deutlich länger sein.'), text(html));
  assert.ok(!has(html, 'Landung: Das AFM nennt für nasses'), 'Landung fehlt im AFM: kein Nässesatz');
  assert.ok(has(block(html, '29'), 'Start 159 m 253 m 760 m'));
  html = render(wx, { aircraft: ARCUS });
  assert.ok(has(block(html, '29'), 'Start 345 m 613 m 760 m'));
});

/* ── Referenzfall je Muster ────────────────────────────────── */

test('Referenzfall: Zahlen aller Muster wie die Handrechnung, nur Piste 29, Kopf und Pflichthinweis', () => {
  const exp = [
    [DR400, 'Start 237 m 466 m 760 m Landung 171 m 404 m 760 m'],
    [HK36R, 'Start 130 m 209 m 760 m Landung – – 760 m'],
    [EV97, 'Start 309 m 469 m 760 m Landung 242 m 609 m 760 m'],
    [ARCUS, 'Start 303 m 539 m 760 m Landung – – 760 m']
  ];
  exp.forEach(([ac, s]) => {
    const html = render(wxEdsf(), { aircraft: ac, detailsOpen: true });
    assertClean(html, ac.id);
    assert.equal(block(html, '11'), null, ac.id + ': Rückenwindpiste gezeigt');
    assert.ok(has(block(html, '29'), s), ac.id + ': ' + text(block(html, '29')));
    assert.ok(html.endsWith('<div class="perf-foot">' + ui.TEXT.advice + '</div>'), ac.id + ': Pflichthinweis');
    assert.ok(has(html, 'Maximales Abfluggewicht ' + ui.fmtInt(ac.mass.kg) + ' kg (' + ui.fmtInt(ac.mass.lb) + ' lb)'), ac.id);
    assert.ok(has(html, 'Druckhöhe 2.974 ft = 907 m (QNH 1010,0 hPa, Platzhöhe 2.885 ft)'), ac.id + ': Eingaben');
    assert.ok(has(html, 'Piste 29 (290° rechtweisend) · Gegenwind 13,10 kt, abgerundet 13 kt'), ac.id);
  });
  // Piste 11 bei Wind aus 100°, 15 °C, QNH 1020: Handrechnung DR400 281/551 und 206/486, Eurostar 319/484 und 245/618
  const wx = wxEdsf({ windDir: 100, windKt: 8, tempC: 15, qnhHpa: 1020 });
  assert.ok(has(block(render(wx), '11'), 'Start 281 m 551 m 760 m Landung 206 m 486 m 760 m'));
  assert.ok(has(block(render(wx, { aircraft: EV97 }), '11'), 'Start 319 m 484 m 760 m Landung 245 m 618 m 760 m'));
  assert.ok(has(block(render(wx, { aircraft: HK36R }), '11'), 'Start 187 m 285 m 760 m'));
  assert.ok(has(block(render(wx, { aircraft: ARCUS }), '11'), 'Start 321 m 572 m 760 m'));
});

test('Robin DR400: Rechenweg mit Standardtemperatur der Tabelle, Ecken «Std», Faktortabelle und Graszuschlag je Strecke', () => {
  const d = text(details(render(wxEdsf(), { detailsOpen: true })));
  [
    'Start · Flughandbuch, Abschnitt 5, Startleistungen, Seite 5.03 · Tabelle 1.100 kg',
    'Standardtemperatur der Tabelle bei 2.974 ft: 5,4832 °C (linear zwischen 7 °C bei 2.500 ft und −1 °C bei 5.000 ft) · Abweichung 5,6 − 5,4832 = +0,1168 °C',
    'Tabelle 2.500 ft / Std 250 m 490 m',
    'Tabelle 2.500 ft / Std+20 °C 290 m 570 m',
    'Tabelle 5.000 ft / Std 305 m 605 m',
    'Tabelle 5.000 ft / Std+20 °C 355 m 705 m',
    'interpoliert für 2.974 ft / Std+0,1168 °C ≈260,67 m ≈512,29 m',
    'Gegenwind 13 kt: × 0,79 (Faktortabelle des AFM, zwischen 10 kt × 0,85 und 20 kt × 0,65 linear) ≈205,93 m ≈404,71 m',
    'Gras +15 % je Strecke (× 1,15) 236,83 m 465,42 m',
    'aufgerundet 237 m 466 m',
    'Landung · Flughandbuch, Abschnitt 5, Landeleistungen, Seite 5.08 · Tabelle 1.100 kg',
    'interpoliert für 2.974 ft / Std+0,1168 °C ≈188,02 m ≈444,21 m',
    'Gras +15 % je Strecke (× 1,15) 170,83 m 403,57 m',
    'aufgerundet 171 m 404 m',
    'Druckhöhe, Temperaturabweichung, Startgewicht und Landegewicht linear interpoliert.',
    ui.TEXT.calcStd.replace(/&nbsp;/g, ' '), ui.TEXT.calcWindFactor, ui.TEXT.calcWindFull, ui.TEXT.calcSurfaceEach,
    'Gewicht 1.100 kg (maximales Abfluggewicht) · Landung mit 1.100 kg (maximales Landegewicht)'
  ].forEach((s) => assert.ok(d.includes(s), 'fehlt: ' + s + '\n' + d));
  assert.ok(!d.includes(ui.TEXT.calcRoundM), 'keine Meterachse beim DR400');
  // Gegenwind genau auf einem Stützpunkt (10 kt) und dazwischen mit drei Dezimalen (7 kt: 0,895)
  const at = (dir, kt) => text(details(render(wxEdsf({ windDir: dir, windKt: kt }), { detailsOpen: true })));
  assert.ok(at(290, 10.4).includes('Gegenwind 10 kt: × 0,85 (Faktortabelle des AFM, Stützpunkt 10 kt × 0,85)'), at(290, 10.4));
  assert.ok(at(290, 7.9).includes('Gegenwind 7 kt: × 0,895 (Faktortabelle des AFM, zwischen 0 kt × 1 und 10 kt × 0,85 linear)'));
  assert.ok(at(290, 35).includes('Gegenwind 35 kt: × 0,55 (Faktortabelle des AFM, über dem letzten Stützpunkt 30 kt × 0,55)'), at(290, 35));
});

test('Super Dimona: Druckhöhe in m, Gegenwind in der Tabelle (acht Ecken), Graszuschlag «mindestens», Landung fehlt', () => {
  const html = render(wxEdsf(), { aircraft: HK36R, detailsOpen: true });
  const d = text(details(html));
  [
    'Start · Flughandbuch, 5.3.3 Starttabelle, Seite 5-7',
    'Tabelle 800 m / 0 °C / 10 kt 113 m 190 m',
    'Tabelle 800 m / 0 °C / 15 kt 88 m 156 m',
    'Tabelle 1.200 m / 15 °C / 15 kt 116 m 205 m',
    'interpoliert für 907 m / 5,6 °C / 13 kt ≈107,98 m ≈186,5 m',
    'Gegenwind 13 kt: in der AFM-Tabelle abgelesen',
    'Gras: mindestens +20 % von ≈107,98 m = ≈+21,6 m 129,58 m 208,1 m',
    'aufgerundet 130 m 209 m',
    'Landung Das AFM nennt keine Landestrecke.',
    'Druckhöhe, Temperatur und Gegenwind linear interpoliert.',
    ui.TEXT.calcWindTable, ui.TEXT.calcRoundM, ui.TEXT.calcWindFull, ui.TEXT.calcSurface,
    'Gewicht 770 kg (einzige Starttabelle) · Druckhöhe 2.974 ft = 907 m'
  ].forEach((s) => assert.ok(d.includes(s), 'fehlt: ' + s + '\n' + d));
  assert.equal((details(html).match(/<tr><th scope="row">Tabelle /g) || []).length, 8, 'acht Tabellenzellen');
  assert.ok(!d.includes('Faktortabelle') && !d.includes('nicht angerechnet'));
  // über dem grössten Tabellenwind: dessen Wert, mit Hinweis
  const d2 = text(details(render(wxEdsf({ windDir: 290, windKt: 18 }), { aircraft: HK36R, detailsOpen: true })));
  assert.ok(d2.includes('Gegenwind 18 kt: in der AFM-Tabelle abgelesen (über dem grössten Tabellenwind gilt dessen Wert)'), d2);
  assert.ok(d2.includes('/ 15 kt'), d2);
});

test('Zuschlag «mindestens» ohne Aufklappen sichtbar: Satz am Pistenblock in der Hinweisfarbe, nicht in der Kurzzeile', () => {
  const NOTE = '<div class="perf-finding perf-min">Start: Graszuschlag laut AFM mindestens +20&nbsp;% der Rollstrecke – die Strecke kann länger sein.</div>';
  let p = parts(wxEdsf(), { aircraft: HK36R });
  const b = block(p.body, '29');
  assert.ok(b.includes(NOTE), b);
  assert.ok(p.body.indexOf(NOTE) < p.body.indexOf('<details'), 'vor dem Rechenweg');
  assert.ok(!has(p.teaser, 'mindestens') && !p.teaser.includes('perf-min'), 'nicht in der Kurzzeile');
  // windstill: an beiden Pistenblöcken
  p = parts(wxEdsf({ windKt: 0.6 }), { aircraft: HK36R });
  assert.ok(block(p.body, '11').includes(NOTE) && block(p.body, '29').includes(NOTE));
  // Zuschläge ohne «mindestens» (DR400 je Strecke, Arcus aus der Rollstrecke): kein Satz
  [DR400, ARCUS, EV97].forEach((ac) => assert.ok(!parts(wxEdsf(), { aircraft: ac }).body.includes('perf-min'), ac.id));
  // Zuschlag je Strecke mit «mindestens»: ohne «der Rollstrecke»
  const dr = clone(DR400);
  dr.charts.takeoff.corrections.forEach((c) => { if (c.kind === 'surface') c.minimum = true; });
  assert.ok(block(parts(wxEdsf(), { aircraft: dr }).body, '29').includes(
    '<div class="perf-finding perf-min">Start: Graszuschlag laut AFM mindestens +15&nbsp;% – die Strecke kann länger sein.</div>'));
  // kein Wert (Gegenwind über 40 kt): kein Satz
  assert.ok(!parts(wxEdsf({ windDir: 290, windKt: 45 }), { aircraft: HK36R }).body.includes('perf-min'));
  assert.ok(ui.CSS.includes('.perf-min { color: #fcd34d; }'));
});

test('Eurostar: Faustregel deutlich – Kasten ohne Aufklappen, markierte Zeilen im Rechenweg, Element «Faustregel» in der Kurzzeile', () => {
  const p = parts(wxEdsf(), { aircraft: EV97, detailsOpen: true });
  const box = /<div class="perf-cond perf-rule" role="note">(.*?)<\/div>/.exec(p.body);
  assert.ok(box, p.body);
  assert.equal(text(box[1]).trim(), 'Faustregel UK CAA, nicht aus dem AFM: Das AFM nennt nur Werte für Meereshöhe und 15 °C. Druckhöhe und Temperatur ' +
    'sind mit einer allgemeinen Faustregel eingerechnet: Start +10 % je 1000 ft Druckhöhe und +10 % je 10 °C über der Standardtemperatur; ' +
    'Landung +5 % je 1000 ft Druckhöhe und +5 % je 10 °C über der Standardtemperatur.');
  assert.ok(box[1].startsWith('<b>Faustregel UK CAA, nicht aus dem AFM:</b>'));
  assert.ok(p.body.indexOf('perf-rule') < p.body.indexOf('perf-grid'), 'Kasten vor den Pistenblöcken');
  assert.ok(p.body.indexOf('perf-rule') < p.body.indexOf('<details'), 'Kasten ausserhalb des Rechenwegs');
  const d = details(p.body);
  assert.equal((d.match(/<tr class="perf-steps-rule-h"><td class="perf-steps-note" colspan="3">Faustregel UK CAA, nicht aus dem AFM · UK CAA Safety Sense Leaflet 7, nicht aus dem Handbuch<\/td><\/tr>/g) || []).length, 2);
  assert.equal((d.match(/<tr class="perf-steps-rule">/g) || []).length, 4, 'je Phase zwei Regelzeilen');
  [
    'AFM-Wert für 0 ft / 15 °C 238 m 361 m',
    'Faustregel Druckhöhe: +10 % je 1000 ft: 2.974 ft → × 1,2974 308,7812 m 468,3614 m',
    'Faustregel Temperatur: +10 % je 10 °C über der Standardtemperatur: 5,6 °C, Standardtemperatur ≈9,11 °C, darüber 0 °C → × 1 308,79 m 468,37 m',
    'Gegenwind 13 kt: nicht angerechnet (das AFM nennt keine Windkorrektur)',
    'aufgerundet 309 m 469 m',
    'AFM-Wert für 0 ft / 15 °C 210 m 530 m',
    'Faustregel Druckhöhe: +5 % je 1000 ft: 2.974 ft → × 1,1487 241,227 m 608,811 m',
    'aufgerundet 242 m 609 m',
    ui.TEXT.calcRule.replace(/&nbsp;/g, ' '), ui.TEXT.calcWindNone
  ].forEach((s) => assert.ok(text(d).includes(s), 'fehlt: ' + s + '\n' + text(d)));
  // Kurzzeile: Kopf, Element «Faustregel» (title und Screenreader: «Faustregel UK CAA, nicht aus dem AFM»), Zeile wie bei den
  // anderen Mustern
  assert.equal(p.teaser, '<span class="perf-t-head">Eurostar SLW-Sport · Piste&nbsp;29</span>' +
    '<span class="perf-t-tag perf-t-rule" title="Faustregel UK CAA, nicht aus dem AFM">Faustregel<span class="perf-sr"> UK CAA, nicht aus dem AFM</span></span>' +
    '<span class="perf-t-row">Rollstrecke: <span class="perf-nw">Start <b>309&nbsp;m</b></span> · <span class="perf-nw">Landung <b>242&nbsp;m</b></span></span>');
  assert.ok(!p.teaser.includes('(Faustregel)'));
  // Temperatur über der Standardtemperatur: Faktor angenähert mit «≈», Werte wie die Handrechnung (22,3 °C: 402/610 nass)
  const w = text(details(render(wxEdsf({ tempC: 15 }), { aircraft: EV97, detailsOpen: true })));
  assert.ok(w.includes('15,0 °C, Standardtemperatur ≈9,11 °C, darüber ≈5,89 °C → × ≈1,0589'), w);
  // Andere Muster ohne Faustregel
  [DR400, HK36R, ARCUS].forEach((ac) => {
    const q = parts(wxEdsf(), { aircraft: ac, detailsOpen: true });
    assert.ok(!q.body.includes('perf-rule') && !has(q.body, 'Faustregel') && !has(q.teaser, 'Faustregel'), ac.id);
  });
});

test('Arcus M: keine Windkorrektur im AFM – «ohne Gutschrift», Lesehilfe ohne «voll angerechnet»; Landung fehlt', () => {
  const html = render(wxEdsf(), { aircraft: ARCUS, detailsOpen: true });
  assert.ok(has(block(html, '29'), 'Piste 29 · Gegenwind 13 kt, ohne Gutschrift'), text(block(html, '29')));
  const d = text(details(html));
  [
    'Start · Flughandbuch, 5.2.3 Startstrecken, Seite 5.2.3',
    'Tabelle 500 m / 0 °C 225 m 435 m',
    'Tabelle 1.000 m / 15 °C 275 m 533 m',
    'interpoliert für 907 m / 5,6 °C ≈252,34 m ≈488,49 m',
    'Gegenwind 13 kt: nicht angerechnet (das AFM nennt keine Windkorrektur)',
    'Gras +20 % von ≈252,34 m = ≈+50,47 m 302,81 m 538,97 m',
    'aufgerundet 303 m 539 m',
    'Landung Das AFM nennt keine Landestrecke.',
    ui.TEXT.calcWindNone
  ].forEach((s) => assert.ok(d.includes(s), 'fehlt: ' + s + '\n' + d));
  assert.ok(!d.includes(ui.TEXT.calcWindFull));
  // Muster mit Windkorrektur: Titel ohne «ohne Gutschrift»
  [DR400, HK36R].forEach((ac) => assert.ok(has(block(render(wxEdsf(), { aircraft: ac }), '29'), 'Piste 29 · Gegenwind 13 kt Rollstrecke'), ac.id));
});

test('Landung fehlt im AFM: Zeile «–», gedämpfter Satz statt Rechenfehler, Kurzzeile «Landung –» mit Erklärung', () => {
  [HK36R, ARCUS].forEach((ac) => {
    const p = parts(wxEdsf(), { aircraft: ac, detailsOpen: true });
    const b = block(p.body, '29');
    assert.ok(b.includes('<tr><th scope="row">Landung</th><td>–</td><td>–</td><td>760&nbsp;m</td></tr>'), b);
    assert.ok(b.includes('<div class="perf-finding perf-absent">Landung: Das AFM nennt keine Landestrecke.</div>'), b);
    assert.ok(!b.includes('perf-nov') && !has(b, 'Rechenfehler'), ac.id);
    assert.ok(p.teaser.includes('<span class="perf-nw" title="Das AFM nennt keine Landestrecke">Landung –<span class="perf-sr"> (Das AFM nennt keine Landestrecke)</span></span>'), p.teaser);
    assert.ok(!has(p.teaser, 'kein Wert'));
    // windstill: beide Pisten, je «–»
    const c = parts(wxEdsf({ windKt: 0.6 }), { aircraft: ac });
    assert.ok(has(c.teaser, 'windstill') && has(c.teaser, 'Landung –'), text(c.teaser));
    assert.ok(has(block(c.body, '11'), 'Landung – – 760 m') && has(block(c.body, '29'), 'Landung – – 760 m'));
  });
  assert.ok(ui.CSS.includes('.perf-absent { color: var(--text-muted); }'));
});

/* ── Gewicht ───────────────────────────────────────────────── */

test('Gewichtsfeld nur beim DR400 (Tabellen 1.100 und 1.000 kg), Landung mit demselben Gewicht; sonst der Satz zur einen Tabelle', () => {
  let html = render(wxEdsf());
  const hint = /<div class="perf-mass-hint" id="perf-mass-hint">(.*?)<\/div>/.exec(html);
  assert.ok(hint, html);
  assert.equal(text(hint[1]), 'höchstens 1.100 kg · zwischen den AFM-Tabellen für 1.100 und 1.000 kg interpoliert, darunter gilt die Tabelle für 1.000 kg · ' +
    'Landung mit demselben Gewicht gerechnet (AFM-Landetabellen 1.100 und 1.000 kg)');
  assert.ok(html.includes('<input id="perf-mass-in"'));
  [[HK36R, 770], [EV97, 600], [ARCUS, 800]].forEach(([ac, kg]) => {
    html = render(wxEdsf(), { aircraft: ac });
    assert.ok(!html.includes('<input') && html.includes('<div class="perf-mass-one">Abfluggewicht: ' + kg + '&nbsp;kg – das AFM hat nur diese Starttabelle.</div>'), ac.id);
    // eine Eingabe gilt bei einer Tabelle nicht
    assert.ok(has(render(wxEdsf(), { aircraft: ac, massText: '500' }), 'Maximales Abfluggewicht'), ac.id);
  });
});

test('parseMass und massIncomplete: Tausenderpunkt («1.050») und Apostroph gelten, angefangene Punkte sind «noch am Tippen»', () => {
  const kg = (t) => ui.parseMass(t, DR400).kg;
  [['1050', 1050], ['1.050', 1050], ["1'050", 1050], ['1 050', 1050], ['1.100', 1100], ['550', 550], [' 1.000 ', 1000]].forEach(([t, v]) => {
    assert.equal(kg(t), v, t);
  });
  ['1.05', '1.0500', '10.50', '1,050', '1.050.', '.1050', '1..050', 'abc', '1050kg'].forEach((t) => {
    assert.equal(ui.parseMass(t, DR400).error, ui.TEXT.massNotInt, t);
  });
  // Fehlertexte mit geschütztem Leerzeichen vor «kg» (kein Umbruch zwischen Zahl und Einheit)
  const err = (t) => ui.parseMass(t, DR400).error.replace(/ /g, ' ');
  assert.equal(err('1.101'), '1.101 kg liegt über dem maximalen Abfluggewicht von 1.100 kg – keine Berechnung.');
  assert.equal(err('549'), '549 kg ist unplausibel tief (unter 550 kg) – keine Berechnung.');
  assert.ok(ui.parseMass('1.101', DR400).error.includes('1.101 kg'));
  assert.equal(ui.parseMass('', DR400).error, ui.TEXT.massEmpty);
  // noch am Tippen: leer, Ziffern unter der Untergrenze, angefangener Tausenderpunkt
  ['', '1', '11', '115', '1.', '1.0', '1.05', "1'"].forEach((t) => assert.equal(ui.massIncomplete(t, DR400), true, t));
  ['1.050', '1050', '1.0500', '1,0', 'x', '1101', '1.101'].forEach((t) => assert.equal(ui.massIncomplete(t, DR400), false, t));
});

test('DR400 mit 1.050 kg: Start und Landung zwischen den Tabellen interpoliert (Kopf, Eingaben, Rechenweg, Kurzzeile)', () => {
  const p = parts(wxEdsf(), { massText: '1050', detailsOpen: true });
  assert.ok(has(p.body, 'Abfluggewicht 1.050 kg: Start zwischen den AFM-Tabellen für 1.100 und 1.000 kg interpoliert, Landung mit demselben Gewicht ' +
    'zwischen den AFM-Landetabellen für 1.100 und 1.000 kg interpoliert'), text(p.body));
  // Handrechnung: 209/417 und 164/389
  assert.ok(has(block(p.body, '29'), 'Start 209 m 417 m 760 m Landung 164 m 389 m 760 m'), text(block(p.body, '29')));
  const d = text(details(p.body));
  [
    'Gewicht 1.050 kg, zwischen den Starttabellen 1.100 und 1.000 kg interpoliert · Landung mit 1.050 kg, zwischen den Landetabellen 1.100 und 1.000 kg interpoliert',
    'Start · Flughandbuch, Abschnitt 5, Startleistungen, Seite 5.03 · Tabellen 1.100 und 1.000 kg',
    'Landung · Flughandbuch, Abschnitt 5, Landeleistungen, Seite 5.08 · Tabellen 1.100 und 1.000 kg',
    'Tabelle 1.000 kg · 2.500 ft / Std 190 m 370 m',
    '1.000 kg · interpoliert für 2.974 ft / Std+0,1168 °C ≈198,72 m ≈405,47 m',
    'interpoliert für 1.050 kg ≈229,7 m ≈458,88 m',
    'Tabelle 1.000 kg · 2.500 ft / Std 170 m 405 m',
    'interpoliert für 1.050 kg ≈180,05 m ≈427,17 m'
  ].forEach((s) => assert.ok(d.includes(s), 'fehlt: ' + s + '\n' + d));
  assert.equal(text(p.teaser).trim(), 'Robin DR400/200R · 1.050 kg · Piste 29 Rollstrecke: Start 209 m · Landung 164 m');
  // unter der leichtesten Tabelle: deren Werte (Handrechnung 900 kg: 181/369 und 157/373)
  const q = parts(wxEdsf(), { massText: '900', detailsOpen: true });
  assert.ok(has(q.body, 'Abfluggewicht 900 kg: Start nach der kleinsten AFM-Tabelle (1.000 kg), Landung mit demselben Gewicht nach der kleinsten AFM-Landetabelle (1.000 kg)'), text(q.body));
  assert.ok(has(block(q.body, '29'), 'Start 181 m 369 m 760 m Landung 157 m 373 m 760 m'), text(block(q.body, '29')));
  assert.ok(text(details(q.body)).includes('Gewicht 900 kg, Starttabelle 1.000 kg · Landung mit 900 kg, kleinste Landetabelle 1.000 kg'), text(details(q.body)));
  // genau eine Tabelle (1.000 kg)
  const r = parts(wxEdsf(), { massText: '1.000', detailsOpen: true });
  assert.ok(has(r.body, 'Start nach der AFM-Tabelle für 1.000 kg, Landung mit demselben Gewicht nach der AFM-Landetabelle für 1.000 kg'), text(r.body));
  assert.ok(text(details(r.body)).includes('Landung · Flughandbuch, Abschnitt 5, Landeleistungen, Seite 5.08 · Tabelle 1.000 kg'));
  // ungültig: keine Zahlen
  const e = parts(wxEdsf(), { massText: '1.05' });
  assert.equal(e.kind, 'mass-error');
  assertNoResult(e.body, 'Gewicht ungültig');
});

/* ── Fehler und Pistenwahl ─────────────────────────────────── */

test('Fehlertexte: Temperatur über Std + 20 °C (DR400) bzw. über 30 °C, unplausible Messwerte', () => {
  let html = render(wxEdsf({ tempC: 31 }));
  assert.ok(has(html, 'Temperatur 31,0 °C liegt über dem Tabellenbereich des AFM (bis Standardtemperatur +20 °C, hier 25,4 °C) – kein Wert.'), text(html));
  assertNoResult(html, 'DR400 31 °C');
  assert.equal(render(wxEdsf({ tempC: 25.4 })).includes('perf-grid'), true, '25,4 °C rechnet noch');
  [HK36R, ARCUS].forEach((ac) => {
    html = render(wxEdsf({ tempC: 31 }), { aircraft: ac });
    assert.ok(has(html, 'Temperatur 31,0 °C liegt über dem Tabellenbereich des AFM (bis 30 °C) – kein Wert.'), ac.id + ': ' + text(html));
  });
  assert.ok(render(wxEdsf({ tempC: 39.9 }), { aircraft: EV97 }).includes('perf-grid'), 'Faustregel ohne Temperaturgrenze');
  html = render(wxEdsf({ qnhHpa: 850 }));
  assert.ok(has(html, 'Messwert unplausibel (QNH 850,0 hPa) – keine Berechnung.'), text(html));
  html = render(wxEdsf({ windDir: 400 }));
  assert.ok(has(html, 'Messwert unplausibel (Windrichtung 400°) – keine Berechnung.'), text(html));
});

test('Pistenwahl: windstill, ohne Richtung, quer – beide Pisten ohne Windkorrektur; Richtung fehlt bei starkem Wind', () => {
  // windstill: Handrechnung DR400 300/590 und 217/511 auf beiden Pisten
  let html = render(wxEdsf({ windKt: 0.6 }), { detailsOpen: true });
  assert.ok(has(html, ui.TEXT.calm));
  ['11', '29'].forEach((id) => assert.ok(has(block(html, id), 'Start 300 m 590 m 760 m Landung 217 m 511 m 760 m'), id));
  assert.ok(has(html, 'Pisten 11 und 29 · windstill, ohne Windkorrektur'), 'eine Tabelle für beide Pisten');
  html = render(wxEdsf({ windDir: null, windKt: 2.5 }));
  assert.ok(has(html, ui.TEXT.nodir) && block(html, '11') && block(html, '29'));
  html = render(wxEdsf({ windDir: 200, windKt: 12 }));
  assert.ok(has(html, ui.TEXT.cross) && block(html, '11') && block(html, '29'));
  html = render(wxEdsf({ windDir: null, windKt: 6 }));
  assert.ok(has(html, ui.TEXT.noDirection));
  assertNoResult(html, 'Richtung fehlt');
});

test('Zustände ohne Wert: Laden, Datenfehler (Schema 3 nur mit gültigen Daten), alte Messwerte; Text, Kopf, Pflichthinweis', () => {
  let html = render(wxEdsf(), { dataState: 'loading', aircraft: null, selectedId: 'ev97' });
  assert.ok(has(html, ui.TEXT.loading) && has(html, 'D-MZWH'));
  assertNoResult(html, 'Laden');
  html = render(wxEdsf(), { dataState: 'error', aircraft: null });
  assert.ok(has(html, ui.TEXT.dataError));
  // kaputte Schema-3-Daten (Faustregel ohne Temperaturregel): Datenfehler statt Zahlen
  const bad = clone(EV97);
  bad.charts.takeoff.corrections = bad.charts.takeoff.corrections.filter((c) => c.kind !== 'temperatureRule');
  html = render(wxEdsf(), { aircraft: bad });
  assert.ok(has(html, ui.TEXT.dataError), text(html));
  assertNoResult(html, 'kaputte Daten');
  // Landung «absent» beim Start ist nicht erlaubt
  const bad2 = clone(HK36R);
  bad2.charts.takeoff = { absent: true, reasonDe: 'x' };
  assert.ok(has(render(wxEdsf(), { aircraft: bad2 }), ui.TEXT.dataError));
  html = render(wxEdsf({ time: NOW - 50 * MIN }));
  assert.ok(has(html, 'Messwerte veraltet (Stand 10:55 Uhr, vor 50 min) – keine Berechnung.'), text(html));
  assert.ok(has(html, 'Maximales Abfluggewicht 1.100 kg'));
  assertNoResult(html, 'veraltet');
});

/* ── Formate, Version, Code ────────────────────────────────── */

test('Formate wie die EDSF-Seite: Tausenderpunkt, Dezimalkomma, echtes Minus; Faktoren der Faustregel exakt oder «≈»', () => {
  assert.equal(ui.fmtInt(2885), '2.885');
  assert.equal(ui.fmtInt(1234567), '1.234.567');
  assert.equal(ui.fmtInt(-1500), '−1.500');
  assert.equal(ui.fmtInt(-0.4), '0');
  assert.equal(ui.fmtDec(1010, 1), '1.010,0');
  assert.equal(ui.fmtExact(1234.5), '1.234,5');
  assert.equal(ui.fmtExact(2 / 3), '≈0,67');
  assert.equal(ui.fmtUp2(236.8211), '236,83');
  assert.equal(ui.fmtFactorExact(1.2974), '1,2974');
  assert.equal(ui.fmtFactorExact(1.1088258), '≈1,1088');
  assert.equal(ui.fmtFactorExact(1), '1');
  // QNH ohne Tausendertrenner
  assert.ok(has(render(wxEdsf()), 'QNH 1010,0 hPa'));
});

test('Version: perf.js, perf-ui.js und index.html stimmen überein (VERSION 8); Kern als PerfCore', () => {
  assert.equal(ui.VERSION, 8);
  assert.equal(core.VERSION, ui.VERSION);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m1 = html.match(/<script defer src="perf\/perf\.js\?v=(\d+)"><\/script>/);
  const m2 = html.match(/<script defer src="perf\/perf-ui\.js\?v=(\d+)"><\/script>/);
  assert.ok(m1 && m2);
  assert.equal(Number(m1[1]), core.VERSION);
  assert.equal(Number(m2[1]), ui.VERSION);
  // Browser: die Anzeige nimmt window.PerfCore, sonst window.LszkPerfCore
  const src = fs.readFileSync(path.join(ROOT, 'perf', 'perf-ui.js'), 'utf8');
  assert.ok(src.includes("var core = isNode ? require('./perf.js') : (root && (root.PerfCore || root.LszkPerfCore));"));
  // Versionsprüfung: ungleicher Kern ergibt «Rechenfehler», keine Zahlen
  const v = core.VERSION;
  try {
    core.VERSION = v + 1;
    const h = render(wxEdsf());
    assert.ok(has(h, 'Rechenfehler – keine Berechnung.'));
    assertNoResult(h, 'Version');
  } finally {
    core.VERSION = v;
  }
});

test('Browsercode ohne ?., ?? und Lookbehind, ohne BOM; keine LSZK-Reste in der Anzeige', () => {
  ['perf/perf.js', 'perf/perf-ui.js'].forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!src.includes('?.'), rel + ': ?.');
    assert.ok(!src.includes('??'), rel + ': ??');
    assert.ok(!src.includes('(?<'), rel + ': Lookbehind');
    assert.ok(!(src.charCodeAt(0) === 0xfeff), rel + ': BOM');
  });
  const src = fs.readFileSync(path.join(ROOT, 'perf', 'perf-ui.js'), 'utf8');
  ['fgzo', 'FGZO', 'LSZK_WX', 'LszkPerf ', 'lszk-perf', 'MeteoSchweiz', 'Speck', 'Europe/Zurich', 'data/fgzo_status.json'].forEach((w) => {
    assert.ok(!src.includes(w), 'enthält ' + w);
  });
  assert.ok(src.includes("var STORE_KEY = 'edsf-perf-aircraft';") && src.includes("var OPEN_KEY = 'edsf-perf-open';"));
});

test('CSS und HTML: nur Klassen und IDs mit Präfix perf-; Faustregel rot/gelb, Pflichthinweis rot und fett', () => {
  const selectors = ui.CSS.replace(/\{[^}]*\}/g, ' ').replace(/@media[^{]*\{/g, ' ');
  const names = selectors.match(/[.#][a-zA-Z][\w-]*/g) || [];
  assert.ok(names.length > 10);
  names.forEach((n) => assert.ok(n.slice(1).startsWith('perf-'), 'CSS ' + n));
  [DR400, HK36R, EV97, ARCUS].forEach((ac) => {
    const html = render(wxEdsf({ rainMmH: 1 }), { aircraft: ac, detailsOpen: true, massText: ac === DR400 ? '1050' : undefined });
    (html.match(/class="[^"]*"/g) || []).forEach((c) => c.slice(7, -1).split(/\s+/).forEach((k) => assert.ok(k.startsWith('perf-'), 'Klasse ' + k)));
    (html.match(/ id="[^"]*"/g) || []).forEach((i) => assert.ok(i.slice(5, -1).startsWith('perf-'), 'ID ' + i));
  });
  assert.ok(ui.CSS.includes('.perf-cond.perf-rule { color: #fcd34d; background: rgba(239, 68, 68, 0.12); border-left: 3px solid #ef4444;'));
  assert.ok(ui.CSS.includes('.perf-cond.perf-rule b { color: #f87171; font-weight: 700; }'));
  assert.ok(ui.CSS.includes('.perf-foot { font-size: 0.78rem; color: #f87171; font-weight: 700;'));
});

test('Durchlauf: nie NaN, undefined, null oder Infinity im HTML, nie eine Ausnahme', () => {
  [DR400, HK36R, EV97, ARCUS].forEach((ac) => [null, 0, 110, 200, 290].forEach((dir) => [0, 0.6, 2, 8.7, 22, 45].forEach((kt) =>
    [-30, 0, 10.8, 25.1, 39.9].forEach((t) => [[null, undefined], [0, '1050'], [1, '900']].forEach(([rain, mt]) => {
      const p = parts(wxEdsf({ windDir: dir, windKt: kt, gustKt: kt ? kt * 1.5 : null, tempC: t, rainMmH: rain }),
        { aircraft: ac, detailsOpen: true, massText: mt });
      assertClean(p.sel + p.mass + p.body + p.teaser, ac.id + ' ' + dir + '/' + kt + '/' + t + '/' + rain);
    })))));
});

/* ── Browserteil boot() mit nachgebautem window/document (wie die LSZK-Tests) ── */

// Nachgebautes Element: innerHTML mit Schreibzähler; <details class="perf-details"> und <select id="perf-ac"> werden zu
// Objekten (open bzw. value); jedes Schreiben mit <input id="perf-mass-in"> legt ein neues, leeres Feld an.
function fakeEl(env, id, style) {
  return {
    id, html: '', style: Object.assign({}, style), listeners: {}, children: [], details: null, select: null, input: null, err: null, open: false,
    get innerHTML() { return this.children.length ? this.children.map((c) => c.innerHTML).join('') : this.html; },
    set innerHTML(v) {
      this.html = String(v);
      env.writes++;
      env.writesBy[this.id] = (env.writesBy[this.id] || 0) + 1;
      this.details = this.html.includes('<details class="perf-details"') ? { open: this.html.includes('<details class="perf-details" open>') } : null;
      const s = /<select id="perf-ac"[^>]*>(.*?)<\/select>/.exec(this.html);
      this.select = null;
      if (s) {
        const opts = [...s[1].matchAll(/<option value="([^"]*)"( selected)?>/g)];
        const pick = opts.find((o) => o[2]) || opts[0];
        this.select = { id: 'perf-ac', value: pick ? pick[1] : '' };
      }
      this.input = /<input id="perf-mass-in"[^>]*>/.test(this.html) ? fakeInput(env) : null;
      this.err = this.html.includes('<div class="perf-mass-err" id="perf-mass-err" role="alert"></div>') ? { textContent: '' } : null;
    },
    querySelector(q) {
      if (q === 'details.perf-details') return this.details;
      if (q === 'select') return this.select;
      if (q === 'input') return this.input;
      if (q === '.perf-mass-err') return this.err;
      return null;
    },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(c) { this.children.push(c); if (c.id) env.nodes[c.id] = c; return c; },
    getAttribute: (n) => (n === 'data-airfield' ? 'edsf' : null)
  };
}
function fakeInput(env) {
  let value = '';
  return {
    id: 'perf-mass-in', attrs: {},
    get value() { return value; },
    set value(v) { value = String(v); env.valueWrites++; },
    typed(v) { value = String(v); },
    setSelectionRange() {},
    setAttribute(n, v) { this.attrs[n] = String(v); },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  };
}
function fakeBrowser(opts) {
  opts = opts || {};
  const env = {
    clock: NOW, fetchUrls: [], failPerf: !!opts.failPerf, intervals: [], timeouts: [], docListeners: {},
    writes: 0, writesBy: {}, nodes: {}, valueWrites: 0, store: Object.assign({}, opts.store),
    files: Object.assign({
      'perf/aircraft/index.json': INDEX_RAW, 'perf/airfields/edsf.json': AF, 'perf/aircraft/dr400.json': DR400,
      'perf/aircraft/hk36r.json': HK36R, 'perf/aircraft/ev97.json': EV97, 'perf/aircraft/arcusm.json': ARCUS
    }, opts.files)
  };
  const card = fakeEl(env, 'perf-card');
  const content = fakeEl(env, 'perf-content');
  const box = opts.noBox ? null : fakeEl(env, 'perf-box', { display: 'none' });
  const teaser = opts.noBox ? null : fakeEl(env, 'perf-teaser-text');
  [card, content, box, teaser].forEach((el) => { if (el) env.nodes[el.id] = el; });
  const styles = [];
  const doc = {
    readyState: opts.readyState || 'interactive', hidden: false, activeElement: null,
    head: { appendChild: (el) => { styles.push(el); } },
    getElementById: (id) => {
      if (opts.noCard) return null;
      if (id === 'perf-style') return styles.find((s) => s.id === 'perf-style') || null;
      return env.nodes[id] || null;
    },
    createElement: (tag) => (tag === 'style' ? { tagName: 'STYLE', id: '', textContent: '' } : fakeEl(env, '')),
    addEventListener: (type, fn) => { env.docListeners[type] = fn; }
  };
  const fail = () => { throw new Error('SecurityError'); };
  const win = {
    document: doc,
    EDSF_WX: opts.initialWx,
    localStorage: opts.storeThrows ? { getItem: fail, setItem: fail, removeItem: fail } : {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(env.store, k) ? env.store[k] : null),
      setItem: (k, v) => { env.store[k] = String(v); },
      removeItem: (k) => { delete env.store[k]; }
    },
    setInterval: (fn, ms) => { env.intervals.push({ fn, ms }); return env.intervals.length; },
    setTimeout: (fn, ms) => { env.timeouts.push({ fn, ms }); return env.timeouts.length; },
    fetch: (url) => {
      env.fetchUrls.push(url);
      const p = url.split('?')[0];
      if (env.failPerf && p.startsWith('perf/')) return Promise.reject(new Error('offline'));
      const data = env.files[p];
      if (data === undefined) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(data))) });
    }
  };
  Object.assign(env, { win, doc, card, content, box, teaser, styles });
  Object.defineProperty(env, 'sel', { get: () => env.nodes['perf-sel'] || null });
  Object.defineProperty(env, 'mass', { get: () => env.nodes['perf-mass'] || null });
  Object.defineProperty(env, 'body', { get: () => env.nodes['perf-body'] || null });
  return env;
}
async function settle() { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); }
function startBrowser(t, opts) {
  const env = fakeBrowser(opts);
  t.mock.method(Date, 'now', () => env.clock);
  ui.boot(env.win);
  return env;
}
const shown = (env) => text(env.content.innerHTML);
const teaserText = (env) => text(env.teaser.innerHTML.replace(/<span class="perf-(?:t-tag|sr)">[^<]*<\/span>/g, '')).trim();
function choose(env, id) {
  const s = env.sel.querySelector('select');
  s.value = id;
  env.sel.listeners.change({ target: s });
}
function evilWx() {
  const evil = {};
  Object.defineProperty(evil, 'tempC', { enumerable: true, get() { throw new Error('kaputt'); } });
  return evil;
}

test('boot: Box versteckt bis zum ersten update, dann sofort Zahlen (kein FGZO-Abruf); window.EdsfPerf', async (t) => {
  const env = startBrowser(t);
  await settle();
  assert.equal(env.box.style.display, 'none');
  assert.equal(env.content.innerHTML, '');
  assert.deepEqual(env.content.children.map((c) => c.id), ['perf-sel', 'perf-mass', 'perf-body']);
  assert.equal(env.styles.length, 1);
  assert.equal(env.styles[0].textContent, ui.CSS);
  assert.equal(env.win.EdsfPerf.version, ui.VERSION);
  assert.equal(env.win.LszkPerf, undefined);
  assert.deepEqual(env.intervals.map((i) => i.ms), [60000]);
  env.win.EdsfPerf.update(wxEdsf());
  assert.equal(env.box.style.display, 'block');
  await settle();
  assert.ok(shown(env).includes('Start 237 m 466 m 760 m'), shown(env));
  assert.equal(teaserText(env), 'Robin DR400/200R · Piste 29 Rollstrecke: Start 237 m · Landung 171 m');
  assert.deepEqual(env.timeouts, [], 'kein Warten auf einen Flugplatzstatus');
  assert.ok(!env.fetchUrls.some((u) => u.startsWith('data/')), env.fetchUrls.join(' '));
  assert.deepEqual(env.fetchUrls.map((u) => u.split('?')[0]).sort(), ['perf/aircraft/dr400.json', 'perf/aircraft/index.json', 'perf/airfields/edsf.json']);
});

test('boot: EDSF_WX beim Start einmal gelesen; ohne #perf-card nichts tun', async (t) => {
  let env = startBrowser(t, { initialWx: wxEdsf() });
  await settle();
  assert.equal(env.box.style.display, 'block');
  assert.ok(teaserText(env).includes('Rollstrecke: Start 237 m'));
  env = fakeBrowser({ noCard: true });
  ui.boot(env.win);
  assert.doesNotThrow(() => env.win.EdsfPerf.update(wxEdsf()));
  await settle();
  assert.equal(env.fetchUrls.length, 0);
  assert.equal(env.writes, 0);
});

test('boot: Altern über den Takt lässt die Zahlen verschwinden; kaputtes update ergibt Rechenfehler bis zum nächsten gültigen', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.EdsfPerf.update(wxEdsf({ time: NOW - 44 * MIN }));
  await settle();
  assert.ok(env.teaser.innerHTML.includes('perf-t-row'));
  env.clock = NOW + 2 * MIN;
  env.intervals[0].fn();
  assert.ok(!env.content.innerHTML.includes('perf-grid'));
  assert.equal(teaserText(env), 'Start- und Landestrecke · Robin DR400/200R Messwerte veraltet – keine Berechnung');
  env.win.EdsfPerf.update(wxEdsf({ time: env.clock - 5 * MIN }));
  await settle();
  assert.ok(teaserText(env).includes('Start 237 m'));
  assert.doesNotThrow(() => env.win.EdsfPerf.update(evilWx()));
  assert.ok(shown(env).includes('Rechenfehler – keine Berechnung.'));
  assert.equal(teaserText(env), 'Start- und Landestrecke Rechenfehler – keine Berechnung');
  env.win.EdsfPerf.update(wxEdsf({ time: env.clock - 5 * MIN }));
  await settle();
  assert.ok(teaserText(env).includes('Start 237 m') && !shown(env).includes('Rechenfehler'));
  // leere Schnittstelle der Seite (Wetterdaten nicht ladbar): keine Zahlen
  env.win.EdsfPerf.update({ src: null, srcLabel: null, time: null, ageMin: null, stale: true, windKt: null, windDir: null, gustKt: null,
    tempC: null, dewC: null, humPct: null, qnhHpa: null, rainMmH: null, rainTodayMm: null });
  assert.equal(teaserText(env), 'Start- und Landestrecke · Robin DR400/200R Keine aktuellen Messwerte – keine Berechnung');
});

test('boot: Auf- und Zuklappen gemerkt (edsf-perf-open), Musterwahl gespeichert (edsf-perf-aircraft)', async (t) => {
  const env = startBrowser(t);
  await settle();
  assert.equal(env.box.open, false, 'Standard zu');
  env.box.open = true;
  env.box.listeners.toggle();
  assert.equal(env.store['edsf-perf-open'], '1');
  env.box.open = false;
  env.box.listeners.toggle();
  assert.ok(!('edsf-perf-open' in env.store));
  env.win.EdsfPerf.update(wxEdsf());
  await settle();
  choose(env, 'ev97');
  assert.equal(teaserText(env), 'Start- und Landestrecke Lade Flugzeug- und Platzdaten …');
  await settle();
  assert.equal(env.store['edsf-perf-aircraft'], 'ev97');
  assert.equal(teaserText(env), 'Eurostar SLW-Sport · Piste 29 Faustregel Rollstrecke: Start 309 m · Landung 242 m');
  assert.ok(shown(env).includes('Faustregel UK CAA, nicht aus dem AFM:'));
  choose(env, 'hk36r');
  await settle();
  assert.equal(teaserText(env), 'Super Dimona HK36R · Piste 29 Rollstrecke: Start 130 m · Landung –');
  // nächster Seitenaufruf: gespeichertes Muster und offene Box
  env.store['edsf-perf-open'] = '1';
  const next = fakeBrowser({ store: env.store, initialWx: wxEdsf() });
  ui.boot(next.win);
  assert.equal(next.box.open, true);
  await settle();
  assert.ok(teaserText(next).startsWith('Super Dimona HK36R'), teaserText(next));
  // privater Modus: kein Fehler
  const priv = fakeBrowser({ storeThrows: true, initialWx: wxEdsf() });
  assert.doesNotThrow(() => ui.boot(priv.win));
  await settle();
  assert.ok(teaserText(priv).includes('Start 237 m'));
});

test('boot: Gewichtsfeld beim DR400 – Tippen rechnet nach 700 ms, «1.050» gilt, Wechsel zu einem Muster ohne Feld', async (t) => {
  const env = startBrowser(t, { initialWx: wxEdsf() });
  await settle();
  const el = env.mass.querySelector('input');
  assert.ok(el, 'Feld fehlt');
  assert.equal(el.value, '1100', 'Höchstgewicht im Feld');
  el.typed('1.050');
  env.mass.listeners.input({ target: el });
  assert.ok(teaserText(env).includes('Start 237 m'), 'vor der Ruhezeit unverändert');
  const tm = env.timeouts[env.timeouts.length - 1];
  assert.equal(tm.ms, ui.MASS_DEBOUNCE_MS);
  tm.fn();
  assert.equal(teaserText(env), 'Robin DR400/200R · 1.050 kg · Piste 29 Rollstrecke: Start 209 m · Landung 164 m');
  // ungültig: Fehlertext am Feld, keine Zahlen
  el.typed('1.05');
  env.mass.listeners.change({ target: el });
  assert.equal(env.mass.querySelector('.perf-mass-err').textContent, ui.TEXT.massNotInt);
  assert.equal(el.getAttribute('aria-invalid'), 'true');
  assert.equal(teaserText(env), 'Start- und Landestrecke · Robin DR400/200R Gewicht ungültig – keine Berechnung');
  // Muster ohne Feld: Satz statt Feld, Höchstgewicht
  choose(env, 'arcusm');
  await settle();
  assert.equal(env.mass.querySelector('input'), null);
  assert.ok(shown(env).includes('Abfluggewicht: 800 kg – das AFM hat nur diese Starttabelle.'));
  assert.equal(teaserText(env), 'Arcus M · Piste 29 Rollstrecke: Start 303 m · Landung –');
});
