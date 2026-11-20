// Tests für die Kurzzeile unter der Briefing-Ampel der EDSF-Seite (perf/perf-ui.js: renderParts). Sie zeigt Muster,
// Piste und die Rollstrecke für Start und Landung; die Farbe der Zahl folgt dem schlimmsten Fall der Karte (rot:
// Rollstrecke länger als verfügbar, amber: nur die Strecke über 15 m). Fehlt die Landung im AFM: «Landung –». Rechnet
// das Muster nach Faustregel (Eurostar): eigenes Element «Faustregel» nach dem Kopf (Prüfung 20.11.2026: so bleibt die
// Kurzzeile am iPhone zweizeilig). Keine Vorbehaltszeilen; Zahlen nur, wenn die Karte Pistenblöcke zeigt. Eine Rechnung
// (core.compute höchstens einmal), zwei Darstellungen.
// Die Lage der Box in index.html prüft tests/seite.test.js, den Browserteil tests/perf-ui.test.js.
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
const LIST = ui.parseIndex(readJson('perf/aircraft/index.json')).list;
const clone = (o) => JSON.parse(JSON.stringify(o));

const NOW = Date.UTC(2026, 10, 20, 10, 45);
const MIN = 60000;
const SR_RED = 'Rollstrecke länger als verfügbar';
const SR_AMBER = 'Strecke über 15 m länger als verfügbar';

function wxEdsf(over) {
  return Object.assign({
    src: 'edsf', srcLabel: 'Station EDSF', time: NOW - 5 * MIN, ageMin: 5, stale: false,
    windKt: 26 / 1.852, windDir: 269, gustKt: 48 / 1.852, tempC: 5.6, dewC: 3.3, humPct: 85, qnhHpa: 1010, rainMmH: 0, rainTodayMm: 0.6
  }, over);
}
// afmTag: false ausdrücklich, damit diese Tests nicht von der ausgelieferten Stellung TEASER_AFM_TAG abhängen
function ctxOf(wx, over) {
  return Object.assign({ dataState: 'ready', list: LIST, aircraft: DR400, airfield: AF, wx, nowMs: NOW, detailsOpen: false, afmTag: false }, over);
}
const parts = (wx, over) => ui.renderParts(ctxOf(wx, over));
function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
const visible = (html) => html.replace(/<span class="perf-sr">[^<]*<\/span>/g, '');
// Elemente des Flex-Behälters als [Klasse, sichtbarer Text, HTML]; ausserhalb der Elemente steht nichts
function items(teaser) {
  const out = [];
  let depth = 0, start = 0, m;
  const re = /<(\/?)span\b[^>]*>/g;
  while ((m = re.exec(teaser))) {
    if (!m[1]) {
      if (depth === 0) start = m.index;
      depth++;
    } else if (--depth === 0) {
      const html = teaser.slice(start, re.lastIndex);
      out.push([/^<span class="([^"]+)"/.exec(html)[1], text(visible(html)).trim(), html]);
    }
  }
  assert.equal(depth, 0, 'span nicht geschlossen: ' + teaser);
  assert.equal(out.map((x) => x[2]).join(''), teaser, 'Text ausserhalb der Elemente: ' + teaser);
  return out;
}
const pairs = (teaser) => items(teaser).map((x) => [x[0], x[1]]);
function airfield(len, over) {
  const af = clone(AF);
  af.runways.forEach((r) => { r.takeoffAvailable.value = len; r.landingAvailable.value = len; });
  return Object.assign(af, over);
}

test('Kurzzeile mit Ergebnis: Kopf und Rollstrecke je Muster (Referenzfall, Handrechnung)', () => {
  assert.deepEqual(pairs(parts(wxEdsf()).teaser), [
    ['perf-t-head', 'Robin DR400/200R · Piste 29'], ['perf-t-row', 'Rollstrecke: Start 237 m · Landung 171 m']]);
  assert.deepEqual(pairs(parts(wxEdsf(), { aircraft: HK36R }).teaser), [
    ['perf-t-head', 'Super Dimona HK36R · Piste 29'], ['perf-t-row', 'Rollstrecke: Start 130 m · Landung –']]);
  assert.deepEqual(pairs(parts(wxEdsf(), { aircraft: EV97 }).teaser), [
    ['perf-t-head', 'Eurostar SLW-Sport · Piste 29'], ['perf-t-tag perf-t-rule', 'Faustregel'], ['perf-t-row', 'Rollstrecke: Start 309 m · Landung 242 m']]);
  assert.deepEqual(pairs(parts(wxEdsf(), { aircraft: ARCUS }).teaser), [
    ['perf-t-head', 'Arcus M · Piste 29'], ['perf-t-row', 'Rollstrecke: Start 303 m · Landung –']]);
  // eingegebenes Gewicht im Kopf (nur beim DR400, nur wenn es vom Höchstgewicht abweicht)
  assert.equal(items(parts(wxEdsf(), { massText: '1050' }).teaser)[0][1], 'Robin DR400/200R · 1.050 kg · Piste 29');
  assert.equal(items(parts(wxEdsf(), { massText: '1100' }).teaser)[0][1], 'Robin DR400/200R · Piste 29');
  // windstill und ohne Richtung: beide Pisten, Wort im Kopf
  assert.deepEqual(pairs(parts(wxEdsf({ windKt: 0.6 })).teaser), [
    ['perf-t-head', 'Robin DR400/200R · windstill'], ['perf-t-row', 'Rollstrecke: Start 300 m · Landung 217 m']]);
  assert.equal(items(parts(wxEdsf({ windDir: null, windKt: 2 }), { aircraft: EV97 }).teaser)[0][1], 'Eurostar SLW-Sport · ohne Windrichtung');
  assert.equal(items(parts(wxEdsf({ windDir: 200, windKt: 12 }), { aircraft: HK36R }).teaser)[0][1], 'Super Dimona HK36R · Wind quer');
});

test('Farben nach dem schlimmsten Fall der Karte: rot (Rollstrecke), amber (über 15 m), mit Hinweiswort für Screenreader', () => {
  // 250 m verfügbar: DR400 Start 237/466, Landung 171/404 → beide amber
  let p = parts(wxEdsf(), { airfield: airfield(250) });
  assert.ok(p.teaser.includes('<b class="perf-amber">237&nbsp;m</b><span class="perf-sr"> (' + SR_AMBER + ')</span>'), p.teaser);
  assert.ok(p.teaser.includes('<b class="perf-amber">171&nbsp;m</b>'), p.teaser);
  assert.ok(p.body.includes('<span class="perf-amber">466&nbsp;m</span>'), 'Karte amber');
  // 200 m: Start rot (Rollstrecke 237 > 200), Landung amber (171 ≤ 200, 404 > 200)
  p = parts(wxEdsf(), { airfield: airfield(200) });
  assert.ok(p.teaser.includes('<b class="perf-red">237&nbsp;m</b><span class="perf-sr"> (' + SR_RED + ')</span>'), p.teaser);
  assert.ok(p.teaser.includes('<b class="perf-amber">171&nbsp;m</b><span class="perf-sr"> (' + SR_AMBER + ')</span>'), p.teaser);
  assert.ok(p.body.includes('<span class="perf-red">237&nbsp;m</span>') && p.body.includes('Start: Rollstrecke länger als verfügbar.'));
  // Landung fehlt: ohne Farbe, nie rot
  p = parts(wxEdsf(), { aircraft: HK36R, airfield: airfield(200) });
  assert.ok(p.teaser.includes('<b class="perf-amber">130&nbsp;m</b>') && p.teaser.includes('Landung –'), p.teaser);
  assert.ok(!/perf-red[^<]*<\/b>[^·]*Landung/.test(p.teaser));
  // genug Platz: keine Farbe, kein Hinweiswort
  p = parts(wxEdsf());
  assert.ok(!p.teaser.includes('perf-red') && !p.teaser.includes('perf-amber') && !p.teaser.includes('perf-sr'), p.teaser);
});

test('Mehrere Pisten mit verschiedenen Strecken: grösste Rollstrecke mit «bis»', () => {
  // Piste 11 als Hartbelag (Tabellenbelag des DR400, ohne Graszuschlag): windstill 261 m, Piste 29 Gras 300 m
  const af = clone(AF);
  af.runways[0].surface = 'paved';
  const p = parts(wxEdsf({ windKt: 0.6 }), { airfield: af });
  assert.equal(items(p.teaser)[1][1], 'Rollstrecke: Start bis 300 m · Landung bis 217 m');
  assert.ok(text(p.body).includes('Piste 11 · ohne Windkorrektur Rollstrecke über 15 m verfügbar Start 261 m'), text(p.body));
});

test('«Landung –»: title und Screenreader-Text erklären, kein «kein Wert»', () => {
  [HK36R, ARCUS].forEach((ac) => {
    const it = items(parts(wxEdsf(), { aircraft: ac }).teaser);
    const row = it[1][2];
    assert.ok(row.includes('<span class="perf-nw" title="Das AFM nennt keine Landestrecke">Landung –<span class="perf-sr"> (Das AFM nennt keine Landestrecke)</span></span>'), row);
    assert.ok(!row.includes('perf-nov') && !row.includes('kein Wert'));
  });
  // Ein Wert, der fehlt, heisst weiter «kein Wert» (Gegenwind über 40 kt beim DR400)
  const it = items(parts(wxEdsf({ windDir: 290, windKt: 45 })).teaser);
  assert.equal(it[1][1], 'Rollstrecke: Start kein Wert · Landung kein Wert');
});

test('Kurzzeile ohne Ergebnis: keine Zahlen, Text je Zustand, Kopf mit Muster sobald geladen', () => {
  const cases = [
    [parts(wxEdsf(), { dataState: 'loading', aircraft: null }), 'perf-t-load', 'Start- und Landestrecke', ui.TEXT.loading],
    [parts(wxEdsf(), { dataState: 'error', aircraft: null }), 'perf-t-state', 'Start- und Landestrecke', 'Daten nicht verfügbar – keine Berechnung'],
    [parts(undefined), 'perf-t-state', 'Start- und Landestrecke · Robin DR400/200R', 'Keine aktuellen Messwerte – keine Berechnung'],
    [parts(wxEdsf({ src: null })), 'perf-t-state', 'Start- und Landestrecke · Robin DR400/200R', 'Keine aktuellen Messwerte – keine Berechnung'],
    [parts(wxEdsf({ stale: true })), 'perf-t-state', 'Start- und Landestrecke · Robin DR400/200R', 'Messwerte veraltet – keine Berechnung'],
    [parts(wxEdsf({ time: NOW + 10 * MIN })), 'perf-t-state', 'Start- und Landestrecke · Robin DR400/200R', 'Messzeit unplausibel – keine Berechnung'],
    [parts(wxEdsf({ qnhHpa: null })), 'perf-t-state', 'Start- und Landestrecke · Robin DR400/200R', 'Messwert fehlt – keine Berechnung'],
    [parts(wxEdsf(), { massText: '1.05' }), 'perf-t-state', 'Start- und Landestrecke · Robin DR400/200R', 'Gewicht ungültig – keine Berechnung'],
    [parts(wxEdsf({ qnhHpa: 850 })), 'perf-t-state', 'Start- und Landestrecke · Robin DR400/200R', 'Messwert unplausibel – keine Berechnung'],
    [parts(wxEdsf({ tempC: 31 })), 'perf-t-state', 'Start- und Landestrecke · Robin DR400/200R', 'Über dem Tabellenbereich des AFM – kein Wert'],
    [parts(wxEdsf({ windDir: null, windKt: 6 }), { aircraft: EV97 }), 'perf-t-state', 'Start- und Landestrecke · Eurostar SLW-Sport', 'Windrichtung fehlt – keine Berechnung']
  ];
  cases.forEach(([p, cls, head, state]) => {
    assert.deepEqual(pairs(p.teaser), [['perf-t-head', head], [cls, state]], state);
    assert.ok(!/\d&nbsp;m/.test(p.teaser) && !p.teaser.includes('perf-t-row'), state + ': Zahlen');
    assert.ok(!p.body.includes('perf-grid'), state + ': Karte mit Pistenblöcken');
  });
  // Rechenfehler (Version ungleich)
  const v = core.VERSION;
  try {
    core.VERSION = v + 1;
    assert.deepEqual(pairs(parts(wxEdsf()).teaser), [['perf-t-head', 'Start- und Landestrecke'], ['perf-t-state', 'Rechenfehler – keine Berechnung']]);
  } finally {
    core.VERSION = v;
  }
});

test('Eine Rechnung: core.compute je renderParts genau einmal (ab Messwerten) bzw. nie; Kurzzeile = grösste Rollstrecke der Karte', () => {
  const orig = core.compute;
  let n = 0;
  try {
    core.compute = function () { n++; return orig.apply(this, arguments); };
    [DR400, HK36R, EV97, ARCUS].forEach((ac) => [wxEdsf(), wxEdsf({ windKt: 0.6 }), wxEdsf({ rainMmH: 1 })].forEach((wx) => {
      n = 0;
      const p = parts(wx, { aircraft: ac });
      assert.equal(n, 1, ac.id);
      // Zahlen der Kurzzeile stehen in der Karte als Rollstrecke
      const nums = [...p.teaser.matchAll(/<b[^>]*>([\d.]+)&nbsp;m<\/b>/g)].map((m) => m[1]);
      nums.forEach((x) => assert.ok(p.body.includes('<td>' + x + '&nbsp;m</td>') || p.body.includes('">' + x + '&nbsp;m</span></td>'), ac.id + ' ' + x));
    }));
    n = 0;
    parts(wxEdsf({ stale: true }));
    parts(wxEdsf(), { dataState: 'loading', aircraft: null });
    parts(wxEdsf(), { massText: 'x' });
    assert.equal(n, 0, 'ohne Messwerte, beim Laden oder mit ungültigem Gewicht keine Rechnung');
  } finally {
    core.compute = orig;
  }
});

test('Schalter «Richtwert AFM»: ausgeliefert aus; eingeschaltet nach dem Kopf, nie bei der Faustregel', () => {
  assert.equal(ui.TEASER_AFM_TAG, false);
  const on = (ac, wx) => pairs(ui.renderParts(Object.assign(ctxOf(wx || wxEdsf(), { aircraft: ac }), { afmTag: true })).teaser);
  assert.deepEqual(on(DR400).map((x) => x[0]), ['perf-t-head', 'perf-t-tag', 'perf-t-row']);
  assert.equal(on(DR400)[1][1], 'Richtwert AFM');
  assert.deepEqual(on(HK36R).map((x) => x[0]), ['perf-t-head', 'perf-t-tag', 'perf-t-row']);
  assert.deepEqual(on(EV97).map((x) => x[0]), ['perf-t-head', 'perf-t-tag perf-t-rule', 'perf-t-row'], 'Faustregel ohne «Richtwert AFM»');
  assert.equal(on(EV97)[1][1], 'Faustregel');
  // ohne Angabe im Kontext gilt die ausgelieferte Stellung
  const p = ui.renderParts({ dataState: 'ready', list: LIST, aircraft: DR400, airfield: AF, wx: wxEdsf(), nowMs: NOW });
  assert.equal(p.teaser.includes('perf-t-tag'), ui.TEASER_AFM_TAG);
});

test('Element «Faustregel»: nur beim Eurostar mit Ergebnis, direkt nach dem Kopf, gelb, title und Screenreader gleich', () => {
  const TAG = '<span class="perf-t-tag perf-t-rule" title="Faustregel UK CAA, nicht aus dem AFM">Faustregel' +
    '<span class="perf-sr"> UK CAA, nicht aus dem AFM</span></span>';
  [wxEdsf(), wxEdsf({ windKt: 0.6 }), wxEdsf({ windDir: null, windKt: 2 }), wxEdsf({ rainMmH: 2 })].forEach((wx) => {
    const it = items(parts(wx, { aircraft: EV97 }).teaser);
    assert.deepEqual(it.map((x) => x[0]), ['perf-t-head', 'perf-t-tag perf-t-rule', 'perf-t-row']);
    assert.equal(it[1][2], TAG);
    assert.ok(it[2][1].startsWith('Rollstrecke: Start '), it[2][1]);
  });
  // Screenreader liest «Faustregel UK CAA, nicht aus dem AFM» wie der title
  assert.equal(text(TAG).trim(), ui.TEASER.ruleTitle);
  // ohne Ergebnis kein Element, andere Muster nie
  assert.ok(!parts(wxEdsf({ stale: true }), { aircraft: EV97 }).teaser.includes('perf-t-rule'));
  [DR400, HK36R, ARCUS].forEach((ac) => assert.ok(!parts(wxEdsf(), { aircraft: ac }).teaser.includes('perf-t-rule'), ac.id));
  assert.ok(ui.CSS.includes('.perf-t-tag.perf-t-rule { color: #fcd34d; font-weight: 600; }'));
});

test('Mehrere Pisten, eine ohne Wert: «kein Wert» statt Zahl (jede Piste muss einen Wert haben); «Landung –» nur, wenn sie überall fehlt', () => {
  // Piste 11 mit einem Belag ohne Korrektur in den Daten: dort kein Wert; windstill werden beide Pisten gerechnet
  const af = clone(AF);
  af.runways[0].surface = 'beton';
  let p = parts(wxEdsf({ windKt: 0.6 }), { airfield: af });
  assert.equal(p.kind, 'result');
  assert.ok(text(block(p.body, '11')).includes('Start: keine Belagskorrektur in den Daten – kein Wert.'), text(p.body));
  assert.ok(text(block(p.body, '29')).includes('Start 300 m 590 m 760 m'));
  assert.equal(items(p.teaser)[1][1], 'Rollstrecke: Start kein Wert · Landung kein Wert');
  // Landung nur auf einer Piste «nicht im AFM» (künstlich, über die Rechnung gestellt): «kein Wert», nicht «–»
  const orig = core.compute;
  try {
    core.compute = function () {
      const r = orig.apply(this, arguments);
      if (r.ok) r.runways[0].landing = { ok: false, reason: 'not-in-afm', absent: true, availableM: 760, wind: null, factors: [], m: null, exceeds: null };
      return r;
    };
    p = parts(wxEdsf({ windKt: 0.6 }));
    assert.equal(items(p.teaser)[1][1], 'Rollstrecke: Start 300 m · Landung kein Wert');
  } finally {
    core.compute = orig;
  }
});

function block(html, id) {
  const start = html.indexOf('<section class="perf-block" aria-label="Piste ' + id + '">');
  return start < 0 ? null : html.slice(start, html.indexOf('</section>', start) + 10);
}

test('Maskierung: Marke in Name und Pistenkennung erscheint nie roh in der Kurzzeile', () => {
  const ac = clone(EV97);
  ac.label = '<img src=x onerror=alert(1)>';
  const af = clone(AF);
  af.runways[1].id = '29"><b>';
  const p = parts(wxEdsf(), { aircraft: ac, airfield: af });
  assert.ok(!p.teaser.includes('<img') && !p.teaser.includes('"><b>'), p.teaser);
  assert.ok(p.teaser.includes('&lt;img src=x onerror=alert(1)&gt;') && p.teaser.includes('29&quot;&gt;&lt;b&gt;'), p.teaser);
  items(p.teaser);
});

test('CSS der Kurzzeile wie LSZK: gleiche Aussenmasse wie die Ampel (1600 px), kein Dreieck, Umbruch statt Überlauf', () => {
  const css = ui.CSS;
  ['.perf-box { max-width: 1600px; margin: 0 auto 16px; }', '.perf-teaser::-webkit-details-marker { display: none; }',
    '.perf-t-body > span { min-width: 0; }', '.perf-sr { position: absolute; width: 1px; height: 1px;'].forEach((s) => {
    assert.ok(css.includes(s), s);
  });
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(/#briefing-bar \{\r?\n\s*display: none; max-width: 1600px; margin: 0 auto 16px;/.test(page), 'Ampel 1600 px');
});
