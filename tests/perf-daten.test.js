// Daten wörtlich (Stand 20.11.2026): Die EDSF-Datendateien werden Zelle für Zelle gegen eine unabhängige Zweitabschrift der
// AFM-Werte geprüft (tests/fixtures/afm-abschrift.json: Tabellen vom Prüfer am Seitenbild abgetippt, Massen und Zuschläge
// aus den AFM-Texten, Pisten aus dem Blatt «Verfügbare Bahnlänge EDSF») und Text für Text gegen tests/fixtures/texte.json.
// Geprüft werden die ganzen Tabellenobjekte (Achsen, Ablesung, Std, Ausgaben, Hindernis, Zellen), Gewichte, Korrekturen
// (Windfaktoren, Zuschläge, Faustregel, Nässe) und die Pisten. Vorlage: Repo LSZK-Webcams, tests/perf.test.js
// («Daten: alle Tabellenwerte wörtlich», «alle Texte … wörtlich»). Wer eine Datendatei ändert, muss die Abschrift bewusst
// (am Seitenbild) nachführen. Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'perf', 'perf.js'));
function readJson(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  return { buf, data: JSON.parse(buf.toString('utf8')) };
}
const A = readJson('tests/fixtures/afm-abschrift.json').data;
const TEXTE = readJson('tests/fixtures/texte.json').data;
const INDEX = readJson('perf/aircraft/index.json').data;
const AF = readJson('perf/airfields/edsf.json').data;
const AC = {};
['dr400', 'hk36r', 'ev97', 'arcusm'].forEach((id) => { AC[id] = readJson('perf/aircraft/' + id + '.json').data; });

// Pfund aus kg, auf ganze lb gerundet (die Handbücher von HK36R, Arcus M und Eurostar nennen nur kg)
const lb = (kg) => Math.round(kg / core.LB_KG);
const OUT_M = [{ id: 'groundRoll', unit: 'm' }, { id: 'overObstacle', unit: 'm' }];
const OBST = { value: 50, unit: 'ft' };
function axis(quantity, unit, values, more) {
  return Object.assign({ quantity, unit, values, read: 'linear', below: 'lowest', above: 'none' }, more || {});
}
function grid(axes, cells) { return { type: 'grid', axes, outputs: OUT_M, obstacle: OBST, cells }; }
// Korrekturen ohne die Texte (die prüft der Test der Texte)
function numbersOf(corrections) {
  return corrections.map((c) => { const o = Object.assign({}, c); delete o.labelDe; delete o.refDe; return o; });
}

test('Daten: JSON ohne BOM, Abschriften vorhanden und vollständig', () => {
  ['perf/aircraft/dr400.json', 'perf/aircraft/hk36r.json', 'perf/aircraft/ev97.json', 'perf/aircraft/arcusm.json', 'perf/aircraft/index.json',
    'perf/airfields/edsf.json', 'tests/fixtures/afm-abschrift.json', 'tests/fixtures/texte.json'].forEach((rel) => {
    const { buf } = readJson(rel);
    assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), rel + ' hat ein BOM');
  });
  assert.deepEqual(Object.keys(A).filter((k) => k[0] !== '_').sort(), ['arcusm', 'dr400', 'edsf', 'ev97', 'hk36r']);
  // Zellen der Abschrift: DR400 4 × 9, HK36R 4 × 3 × 4 = 48, Arcus M 5 × 4 = 20, Eurostar 2 Punkte
  const n = (x) => (Array.isArray(x) && typeof x[0] === 'number' ? 1 : Object.values(x).reduce((s, y) => s + n(y), 0));
  assert.equal(n(A.dr400.start) + n(A.dr400.landung), 36);
  assert.equal(Object.values(A.hk36r.zeilen).reduce((s, byT) => s + Object.values(byT).length * 4, 0), 48);
  assert.equal(A.arcusm.rollstrecke.flat().length + A.arcusm.startstrecke.flat().length, 40);
});

test('Daten wörtlich: Robin DR400 – vier Tabellen (je 3 × 3), Achsen, Std, Gewichte, Windfaktoren, Gras', () => {
  const d = A.dr400, ac = AC.dr400;
  const axes = [axis('pressureAltitude', 'ft', d.zpFt), axis('temperatureDeviation', 'degC', d.abweichungC, { stdTempC: d.stdTempC })];
  assert.deepEqual(ac.mass, { kg: d.massKg[0], lb: lb(d.massKg[0]) });
  assert.deepEqual([ac.schema, ac.massLanding], [3, undefined]);
  [['takeoff', 'start'], ['landing', 'landung']].forEach(([ph, key]) => {
    const ch = ac.charts[ph];
    assert.deepEqual(ch.table, grid(axes, d[key][String(d.massKg[0])]), ph + ' ' + d.massKg[0] + ' kg');
    assert.deepEqual(ch.lowerWeights.map((e) => [e.mass, e.table]),
      d.massKg.slice(1).map((kg) => [{ kg, lb: lb(kg) }, grid(axes, d[key][String(kg)])]), ph + ' leichtere Tabellen');
    assert.deepEqual([ch.massRead, ch.base], ['linear', { surface: d.tabelleBelag, surfaceCondition: 'dry' }], ph);
    assert.deepEqual(numbersOf(ch.corrections), [
      { kind: 'headwind', type: 'factorTable', unit: 'kt', points: d.gegenwindFaktoren, above: 'highest' },
      { kind: 'surface', type: 'percentOfEach', surface: 'grass', surfaceCondition: 'dry', percent: d.grasProzentJeStrecke, minimum: false }
    ], ph + ' Korrekturen');
  });
});

test('Daten wörtlich: Super Dimona HK36R – Starttabelle 4 × 3 × 4 aus den Tabellenzeilen des AFM, Gras mindestens 20 %, keine Landung', () => {
  const h = A.hk36r, ac = AC.hk36r;
  // AFM-Zeile je Gegenwind und OAT, Spalten je Druckhöhe Rollstrecke (s1) und Strecke über 15 m (s2) → [Druckhöhe][OAT][Gegenwind]
  const cells = h.druckhoeheM.map((pa, i) => h.oatC.map((t) => h.gegenwindKt.map((hw) => {
    const row = h.zeilen[String(hw)][String(t)];
    return [row[2 * i], row[2 * i + 1]];
  })));
  assert.deepEqual(ac.charts.takeoff.table, grid([axis('pressureAltitude', 'm', h.druckhoeheM), axis('temperature', 'degC', h.oatC),
    axis('headwind', 'kt', h.gegenwindKt, { above: 'highest' })], cells));
  assert.deepEqual(ac.mass, { kg: h.massKg, lb: lb(h.massKg) });
  assert.deepEqual([ac.charts.takeoff.lowerWeights, ac.charts.takeoff.massRead, ac.massLanding], [undefined, undefined, undefined]);
  assert.deepEqual(ac.charts.takeoff.base, { surface: h.tabelleBelag, surfaceCondition: 'dry' });
  assert.deepEqual(numbersOf(ac.charts.takeoff.corrections), [
    { kind: 'surface', type: 'addPercentOf', surface: 'grass', surfaceCondition: 'dry', percent: h.grasProzentRollstrecke, of: 'groundRoll', minimum: h.grasMindestens }
  ]);
  assert.equal(h.landung, 'fehlt');
  assert.deepEqual([Object.keys(ac.charts.landing).sort(), ac.charts.landing.absent], [['absent', 'reasonDe'], true]);
});

test('Daten wörtlich: Arcus M – Starttabelle 5 × 4 (Rollstrecke und Startstrecke), Gras ca. 20 %, keine Landung', () => {
  const a = A.arcusm, ac = AC.arcusm;
  const cells = a.druckhoeheM.map((pa, i) => a.oatC.map((t, j) => [a.rollstrecke[i][j], a.startstrecke[i][j]]));
  assert.deepEqual(ac.charts.takeoff.table, grid([axis('pressureAltitude', 'm', a.druckhoeheM), axis('temperature', 'degC', a.oatC)], cells));
  assert.deepEqual(ac.mass, { kg: a.massKg, lb: lb(a.massKg) });
  assert.deepEqual([ac.charts.takeoff.lowerWeights, ac.charts.takeoff.massRead, ac.massLanding], [undefined, undefined, undefined]);
  assert.deepEqual(ac.charts.takeoff.base, { surface: a.tabelleBelag, surfaceCondition: 'dry' });
  assert.deepEqual(numbersOf(ac.charts.takeoff.corrections), [
    { kind: 'surface', type: 'addPercentOf', surface: 'grass', surfaceCondition: 'dry', percent: a.grasProzentRollstrecke, of: 'groundRoll', minimum: a.grasMindestens }
  ]);
  assert.equal(a.landung, 'fehlt');
  assert.deepEqual([Object.keys(ac.charts.landing).sort(), ac.charts.landing.absent], [['absent', 'reasonDe'], true]);
});

test('Daten wörtlich: Eurostar SLW-Sport – Punkte für Gras, Faustregel 10/10 und 5/5 %, Nässe beim Start × 1,15', () => {
  const e = A.ev97, ac = AC.ev97;
  const pt = (values) => ({ type: 'point', conditions: { pressureAltitudeFt: 0, temperatureC: 15 }, outputs: OUT_M, obstacle: OBST, values });
  const rules = (r) => [
    { kind: 'altitudeRule', percentPer1000ft: r.prozentJe1000ft },
    { kind: 'temperatureRule', percentPer10C: r.prozentJe10C, reference: 'isa' }
  ];
  assert.deepEqual(ac.mass, { kg: e.massKg, lb: lb(e.massKg) });
  assert.deepEqual(ac.charts.takeoff.table, pt(e.startGras));
  assert.deepEqual(ac.charts.landing.table, pt(e.landungGras));
  assert.deepEqual(numbersOf(ac.charts.takeoff.corrections), rules(e.faustregelStart).concat([
    { kind: 'factor', when: 'wet', surface: 'grass', factor: e.naesseFaktorStart, minimum: false }
  ]));
  assert.deepEqual(numbersOf(ac.charts.landing.corrections), rules(e.faustregelLandung));
  ['takeoff', 'landing'].forEach((ph) => {
    assert.deepEqual(ac.charts[ph].base, { surface: e.tabelleBelag, surfaceCondition: 'dry' }, ph);
    assert.deepEqual([ac.charts[ph].lowerWeights, ac.charts[ph].massRead], [undefined, undefined], ph);
  });
  assert.equal(core.POINT_MAX_PA_FT, e.faustregelBisFt);
});

test('Daten wörtlich: Platz EDSF – Höhe 2885 ft, Pisten 11 und 29 rechtweisend 110° / 290°, Gras, je 760 m Start und Landung', () => {
  const p = A.edsf;
  assert.deepEqual([AF.schema, AF.icao, AF.elevation], [2, 'EDSF', { value: p.elevationFt, unit: 'ft' }]);
  assert.deepEqual(AF.runways, p.pisten.map((r) => ({ id: r.id, bearingTrue: r.rechtweisend, surface: r.belag,
    takeoffAvailable: { value: r.startM, unit: 'm' }, landingAvailable: { value: r.landungM, unit: 'm' } })));
});

// Zeichenketten einer Datei mit Pfad, z. B. «charts.takeoff.notesDe[0]»
function strings(o, p, out) {
  if (typeof o === 'string') out[p] = o;
  else if (Array.isArray(o)) o.forEach((v, i) => strings(v, p + '[' + i + ']', out));
  else if (o && typeof o === 'object') Object.keys(o).forEach((k) => strings(o[k], p ? p + '.' + k : k, out));
  return out;
}

test('Daten: alle Texte der Flugzeug-, Listen- und Platzdateien wörtlich (Abschrift tests/fixtures/texte.json)', () => {
  // Wer eine Datei ändert, muss die Abschrift bewusst nachführen; ein neues Muster der Auswahl braucht ebenfalls eine.
  const files = INDEX.aircraft.map((e) => 'perf/aircraft/' + e.file).concat(['perf/aircraft/index.json', 'perf/airfields/edsf.json']);
  assert.deepEqual(Object.keys(TEXTE).sort(), files.slice().sort(), 'Abschrift je Datei');
  files.forEach((f) => assert.deepEqual(strings(readJson(f).data, '', {}), TEXTE[f], f));
  // die Kennzeichnung «nicht aus dem AFM» der Faustregel und die fehlenden Landestrecken stehen in den Texten
  const ev = TEXTE['perf/aircraft/ev97.json'];
  assert.ok(ev.readingRuleDe.includes('UK CAA Safety Sense Leaflet 7') && ev.readingRuleDe.includes('nicht aus dem Handbuch'));
  ['charts.takeoff.corrections[0].refDe', 'charts.takeoff.corrections[1].refDe', 'charts.landing.corrections[0].refDe', 'charts.landing.corrections[1].refDe']
    .forEach((k) => assert.ok(ev[k].includes('nicht aus dem Handbuch'), k));
  ['perf/aircraft/hk36r.json', 'perf/aircraft/arcusm.json'].forEach((f) => assert.ok(TEXTE[f]['charts.landing.reasonDe'].includes('keine Landestrecke'), f));
});
