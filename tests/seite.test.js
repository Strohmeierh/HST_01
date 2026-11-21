// Tests für Teile von index.html (EDSF-Seite), Stand 21.11.2026:
// – Schnittstelle window.EDSF_WX für den Start-/Landestreckenrechner (edsfWx, renderWetter, renderFallback)
// – Kopfknopf «Briefing» (wie LSZK seit 20.11.2026; das Detail-Fenster bleibt «KI-Briefing»)
// – Seitenwind-Farben des Pistendiagramms in kt (wie LSZK seit 18.11.2026: grün bis 5 kt, gelb bis 10 kt, sonst rot)
// – DABS-Liste im KI-Briefing: Zeiten mit «LT», beendete Einträge grau mit «· beendet», «(n beendet)», «Keine weiteren …»
// – Einbindung des Rechners (Box nach der Ampel, Skripte ?v=, GoatCounter am Ende, Sichtschutz der Flugzeughalle unverändert)
// – Flugzeughalle: Alter und Statuspunkt aus data/cam-status.json unter dem Schlüssel «halle», ohne Adresse in der Seite;
//   Secret HALLE_SRC nur im Statusschritt des Workflows (21.11.2026). Den Statusjob selbst (scripts/update_cam_status.py)
//   prüft der Pyodide-Test tools\halle\status_test.html im lokalen Projektordner (hier gibt es kein Python).
// Die Funktionen stehen in index.html: Der Test schneidet sie heraus und ruft sie mit gestellter Uhr auf (wie die
// LSZK-Tests, z. B. tests/fgzo-chip.test.js im Repo LSZK-Webcams).
// Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function cut(from, to) {
  const a = SRC.indexOf(from);
  if (a < 0 || SRC.indexOf(from, a + 1) >= 0) throw new Error('Anker in index.html fehlt oder ist nicht eindeutig: ' + from);
  const b = SRC.indexOf(to, a);
  if (b < 0) throw new Error('Endanker in index.html fehlt: ' + to);
  return SRC.slice(a, b);
}

const MIN = 60000;
// Messzeit des Beispieldatensatzes: 20.11.2026, 10:40 UTC (11:40 Uhr in Hütten); «jetzt» 5 min später
const T0 = Date.UTC(2026, 10, 20, 10, 40, 0);
const NOW = T0 + 5 * MIN;
class FakeDate extends Date { static now() { return NOW; } }

// gauge-data.txt (Cumulus MX) vom 20.11.2026, 10:40 UTC, gekürzt auf die Felder, die Seite und Rechner lesen
function gauge(over) {
  return Object.assign({
    timeUTC: '2026,11,20,10,40,00', date: '2026.11.20 11:40', dateFormat: 'y.m.d h:m', SensorContactLost: '0',
    tempunit: 'C', windunit: 'km/h', pressunit: 'hPa', rainunit: 'mm', cloudbaseunit: 'ft',
    temp: '5,6', tempTL: '4,2', tempTH: '5,9', hum: '85', dew: '3,3',
    press: '1010,0', presstrendval: '1.9', rfall: '0.6', rrate: '0.0', rrateTM: '0.0',
    wlatest: '48', wspeed: '26', wgust: '48', bearing: '270', avgbearing: '269', bearingTxt: undefined,
    cloudbasevalue: '3850', UV: '   - -'
  }, over);
}

/* ── Wetterteil aus index.html: Schnittstelle, Kacheln, Pistendiagramm, Rückfall ── */
const WX_CODE = cut('    function aiThousands(n)', '    // Höhenbänder aus DABS/dipul') +
  cut('    /* Feste Schnittstelle für weitere Module der Seite', '    /* ── Open-Meteo: Trend nächste 12 h');
const WX_MAKE = new Function('window', 'document', 'briefing', 'renderBriefing', 'Date', 'console', WX_CODE +
  '\nreturn { edsfNum: edsfNum, edsfTimeMs: edsfTimeMs, edsfWx: edsfWx, edsfWxEmpty: edsfWxEmpty, edsfPerfUpdate: edsfPerfUpdate,' +
  ' renderWetter: renderWetter, renderFallback: renderFallback, buildRunwayDiagram: buildRunwayDiagram, STALE: EDSF_WX_STALE_MIN };');

// Seite nachgebaut: window mit optionalem EdsfPerf, document nur mit #sunrise-bar
function page(perf) {
  const calls = [];
  const win = {};
  if (perf !== false) {
    win.EdsfPerf = { update: (wx) => { calls.push({ wx, current: win.EDSF_WX }); if (perf === 'throw') throw new Error('kaputt'); } };
  }
  const warns = [];
  const cons = { warn: (...a) => warns.push(a.join(' ')) };
  win.console = cons;
  const doc = { getElementById: (id) => (id === 'sunrise-bar' ? { innerHTML: '', textContent: '' } : null) };
  const fns = WX_MAKE(win, doc, {}, () => {}, FakeDate, cons);
  return { win, calls, warns, fns };
}
const W = page(false).fns;

const EMPTY = {
  src: null, srcLabel: null, time: null, ageMin: null, stale: true, windKt: null, windDir: null, gustKt: null,
  tempC: null, dewC: null, humPct: null, qnhHpa: null, rainMmH: null, rainTodayMm: null
};

test('EDSF_WX: Datensatz der Station EDSF – Felder, Einheiten, Komma- und Punktzahlen', () => {
  const wx = W.edsfWx(gauge(), NOW);
  assert.deepEqual(wx, {
    src: 'edsf', srcLabel: 'Station EDSF', time: T0, ageMin: 5, stale: false,
    windKt: 26 / 1.852, windDir: 269, gustKt: 48 / 1.852,
    tempC: 5.6, dewC: 3.3, humPct: 85, qnhHpa: 1010, rainMmH: 0, rainTodayMm: 0.6
  });
  // Feldnamen fest (Plan 20.11.2026), keine weiteren
  assert.deepEqual(Object.keys(wx).sort(), Object.keys(EMPTY).sort());
  // windKt ungerundet (14,04 kt), nicht auf ganze kt
  assert.ok(Math.abs(wx.windKt - 14.038876889848812) < 1e-12, String(wx.windKt));
  assert.equal(W.STALE, 45);
});

test('EDSF_WX: Zahlen als Text mit Komma oder Punkt, alles andere null (nie 0 als Platzhalter)', () => {
  const num = W.edsfNum;
  [['5,6', 5.6], ['0.6', 0.6], ['1010,0', 1010], ['-2,5', -2.5], ['+3', 3], [' 7 ', 7], ['0', 0], ['0,0', 0], ['26', 26],
    [7, 7], [0, 0], [-1.5, -1.5]].forEach(([v, exp]) => assert.equal(num(v), exp, JSON.stringify(v)));
  ['', ' ', '---', '   - -', '5,6,7', '1.010,0', '1,010.0', '5,', ',5', 'abc', '5 6', '1e3', '0x10', 'NaN', 'Infinity',
    undefined, null, NaN, Infinity, -Infinity, true, false, {}, [], ['5']].forEach((v) => {
    assert.equal(num(v), null, JSON.stringify(v) + ' (' + typeof v + ')');
  });
  // Ein fehlender oder unlesbarer Wert erscheint als null, die übrigen bleiben
  const wx = W.edsfWx(gauge({ temp: '---', press: undefined, wspeed: '', wgust: 'x', dew: null, hum: '   - -', rrate: undefined, rfall: '' }), NOW);
  assert.deepEqual([wx.tempC, wx.qnhHpa, wx.windKt, wx.gustKt, wx.dewC, wx.humPct, wx.rainMmH, wx.rainTodayMm],
    [null, null, null, null, null, null, null, null]);
  assert.deepEqual([wx.src, wx.stale, wx.windDir], ['edsf', false, 269]);
  // gemessen 0 bleibt 0
  const z = W.edsfWx(gauge({ wspeed: '0', wgust: '0', temp: '0,0', rrate: '0', rfall: '0' }), NOW);
  assert.deepEqual([z.windKt, z.gustKt, z.tempC, z.rainMmH, z.rainTodayMm], [0, 0, 0, 0, 0]);
  // Regen: Rate mit Komma, Tagessumme mit Punkt
  const r = W.edsfWx(gauge({ rrate: '1,2', rfall: '3.4' }), NOW);
  assert.deepEqual([r.rainMmH, r.rainTodayMm], [1.2, 3.4]);
});

test('EDSF_WX: Windrichtung aus avgbearing; 0 oder fehlend heisst keine Richtung (null)', () => {
  const dir = (v) => W.edsfWx(gauge({ avgbearing: v }), NOW).windDir;
  assert.equal(dir('269'), 269);
  assert.equal(dir('360'), 360);
  assert.equal(dir('1'), 1);
  ['0', '000', '0,0', 0, undefined, null, '', '---'].forEach((v) => assert.equal(dir(v), null, JSON.stringify(v)));
  // nicht bearing (Momentanwert), sondern avgbearing
  assert.equal(W.edsfWx(gauge({ bearing: '90', avgbearing: '269' }), NOW).windDir, 269);
  // unplausible Richtung bleibt eine Zahl: Der Rechenkern meldet sie als unplausibel, statt ohne Richtung zu rechnen
  assert.equal(dir('400'), 400);
});

test('EDSF_WX: SensorContactLost «1» – keine Station, alle Werte null; kein Objekt ebenso', () => {
  assert.deepEqual(W.edsfWx(gauge({ SensorContactLost: '1' }), NOW), EMPTY);
  assert.deepEqual(W.edsfWx(gauge({ SensorContactLost: 1 }), NOW), EMPTY);
  assert.equal(W.edsfWx(gauge({ SensorContactLost: '0' }), NOW).src, 'edsf');
  assert.equal(W.edsfWx(gauge({ SensorContactLost: undefined }), NOW).src, 'edsf');
  [null, undefined, [], 'x', 42, [gauge()]].forEach((d) => assert.deepEqual(W.edsfWx(d, NOW), EMPTY, JSON.stringify(d)));
  assert.deepEqual(W.edsfWxEmpty(), EMPTY);
  assert.notEqual(W.edsfWxEmpty(), W.edsfWxEmpty(), 'jedes Mal ein neues Objekt');
});

test('EDSF_WX: Messzeit aus timeUTC, Alter und stale (ab 45 min oder ohne lesbare Zeit)', () => {
  const at = (ageMin, over) => W.edsfWx(gauge(over), T0 + ageMin * MIN);
  assert.deepEqual([at(0).ageMin, at(0).stale], [0, false]);
  assert.deepEqual([at(44.99).stale, at(45).stale, at(45.01).stale, at(600).stale], [false, true, true, true]);
  assert.equal(at(-10).ageMin, -10, 'Zeit in der Zukunft: Alter negativ (der Rechner prüft das selbst)');
  assert.equal(at(-10).stale, false);
  // Sekunden dürfen fehlen; Monat und Tag ohne führende Null
  assert.equal(W.edsfTimeMs('2026,11,20,10,40'), T0);
  assert.equal(W.edsfTimeMs('2026,1,5,7,3,9'), Date.UTC(2026, 0, 5, 7, 3, 9));
  assert.equal(W.edsfTimeMs(' 2026,11,20,10,40,00 '), T0);
  // unlesbar: keine Zeit, stale, aber Station und Werte bleiben
  ['2026,13,20,10,40,00', '2026,0,20,10,40,00', '2026,11,31,10,40,00', '2026,2,29,10,40,00', '2026,11,20,24,00,00',
    '2026,11,20,10,60,00', '2026,11,20,10,40,60', '2026,11,0,10,40,00', '2026-11-20T10:40:00Z', '2026,11,20', 'x', '',
    '2026,11,20,10,40,00,00', null, undefined, 1763635200000].forEach((v) => {
    assert.equal(W.edsfTimeMs(v), null, JSON.stringify(v));
    const wx = W.edsfWx(gauge({ timeUTC: v }), NOW);
    assert.deepEqual([wx.src, wx.time, wx.ageMin, wx.stale, wx.tempC], ['edsf', null, null, true, 5.6], JSON.stringify(v));
  });
  assert.equal(W.edsfTimeMs('2028,2,29,0,0,0'), Date.UTC(2028, 1, 29), 'Schalttag');
  // date (Ortszeit der Station) zählt für die Schnittstelle nicht
  assert.equal(W.edsfWx(gauge({ timeUTC: undefined, date: '2026.11.20 11:40' }), NOW).time, null);
});

test('renderWetter: setzt EDSF_WX und meldet es dem Rechner einmal, nach dem Schreiben der Kacheln', () => {
  const p = page();
  const el = { innerHTML: '' };
  p.fns.renderWetter(el, gauge());
  assert.equal(p.calls.length, 1);
  assert.deepEqual(p.calls[0].wx, W.edsfWx(gauge(), NOW));
  assert.equal(p.calls[0].wx, p.win.EDSF_WX, 'übergeben wird window.EDSF_WX');
  assert.ok(el.innerHTML.includes('Wetterstation EDSF:') && el.innerHTML.includes('Regenrate'), 'Kacheln geschrieben');
  // Sensorausfall: Schnittstelle leer, Kacheln wie bisher
  const q = page();
  q.fns.renderWetter({ innerHTML: '' }, gauge({ SensorContactLost: '1' }));
  assert.deepEqual(q.calls[0].wx, EMPTY);
  // Ein Fehler im Rechner stört die Wetteranzeige nicht (Warnung in der Konsole)
  const r = page('throw');
  const el2 = { innerHTML: '' };
  assert.doesNotThrow(() => r.fns.renderWetter(el2, gauge()));
  assert.ok(el2.innerHTML.includes('Wetterstation EDSF:'));
  assert.equal(r.warns.length, 1);
  assert.ok(r.warns[0].startsWith('EdsfPerf.update:'));
  // Ohne Rechner (Skript nicht geladen): nur die Schnittstelle
  const s = page(false);
  s.fns.renderWetter({ innerHTML: '' }, gauge());
  assert.equal(s.win.EDSF_WX.src, 'edsf');
});

test('renderFallback: Wetterdaten nicht ladbar – EDSF_WX leer, Rechner informiert, Anzeige wie bisher', () => {
  const p = page();
  p.win.EDSF_WX = W.edsfWx(gauge(), NOW);
  const el = { innerHTML: '' };
  p.fns.renderFallback(el);
  assert.deepEqual(p.win.EDSF_WX, EMPTY);
  assert.equal(p.calls.length, 1);
  assert.deepEqual(p.calls[0].wx, EMPTY);
  assert.ok(el.innerHTML.includes('Wetterdaten konnten nicht geladen werden.'));
  // Ein kaputter Datensatz (null) lässt renderWetter werfen; loadWetter fängt das mit renderFallback ab
  const q = page();
  assert.throws(() => q.fns.renderWetter({ innerHTML: '' }, null));
  q.fns.renderFallback({ innerHTML: '' });
  assert.deepEqual(q.calls.map((c) => c.wx), [EMPTY]);
  assert.ok(/\.then\(function\(d\) \{ renderWetter\(el, d\); \}\)\r?\n\s*\.catch\(function\(\)  \{ renderFallback\(el\); \}\);/.test(SRC),
    'loadWetter: Fehler in renderWetter landen in renderFallback');
});

/* ── Seitenwind-Farben des Pistendiagramms ── */
const GREEN = '#10b981', YELLOW = '#f59e0b', RED = '#ef4444';
// Farbe der Zeile «Seitenwindkomponente» bzw. «Böen quer» im SVG
function crossColor(svg) {
  const m = /fill="(#[0-9a-f]{6})">(\d+) km\/h \/ (\d+) kt<\/text><\/svg>|fill="(#[0-9a-f]{6})">(\d+) km\/h \/ (\d+) kt<\/text><text[^>]*>Böen/.exec(svg);
  const all = [...svg.matchAll(/fill="(#[0-9a-f]{6})">(\d+) km\/h \/ (\d+) kt/g)];
  assert.ok(all.length >= 2, svg);
  return { color: all[1][1], kmh: +all[1][2], kt: +all[1][3], m };
}
function gustColor(svg) {
  const m = /fill="(#[0-9a-f]{6})">Böen quer: (\d+) km\/h \/ (\d+) kt<\/text>/.exec(svg);
  return m ? { color: m[1], kmh: +m[2], kt: +m[3] } : null;
}

test('Pistendiagramm: Seitenwind grün bis 5 kt, gelb bis 10 kt, rot darüber – nach dem angezeigten, gerundeten kt-Wert', () => {
  // Wind genau quer zur Piste 11 (aus 200°): Seitenwind = Mittelwind
  const cases = [
    [9, 5, GREEN], [10, 5, GREEN], [11, 6, YELLOW], [12, 6, YELLOW], [19, 10, YELLOW], [20, 11, RED], [30, 16, RED], [0, 0, GREEN]
  ];
  cases.forEach(([kmh, kt, col]) => {
    const c = crossColor(W.buildRunwayDiagram(200, kmh, 0));
    assert.deepEqual([c.kmh, c.kt, c.color], [kmh, kt, col], kmh + ' km/h');
  });
  // Früher galten 5 und 10 als km/h: 8 km/h (4 kt) war gelb, 15 km/h (8 kt) rot
  assert.equal(crossColor(W.buildRunwayDiagram(200, 8, 0)).color, GREEN);
  assert.equal(crossColor(W.buildRunwayDiagram(200, 15, 0)).color, YELLOW);
  // Böen quer mit denselben Schwellen
  [[10, 5, GREEN], [11, 6, YELLOW], [19, 10, YELLOW], [20, 11, RED], [48, 26, RED]].forEach(([kmh, kt, col]) => {
    const g = gustColor(W.buildRunwayDiagram(200, 5, kmh));
    assert.deepEqual([g.kmh, g.kt, g.color], [kmh, kt, col], 'Böe ' + kmh + ' km/h');
  });
  assert.equal(gustColor(W.buildRunwayDiagram(200, 5, 0)), null, 'ohne Böe keine Zeile');
  // Wind längs der Piste: kein Seitenwind, grün; Pfeil und Beschriftung in der Farbe des Seitenwinds
  const along = W.buildRunwayDiagram(110, 40, 60);
  assert.equal(crossColor(along).color, GREEN);
  const svg = W.buildRunwayDiagram(200, 26, 0);
  assert.ok(svg.includes('stroke="' + RED + '" stroke-width="2.5" marker-end="url(#whead)"'), 'Pfeil rot bei 14 kt quer');
});

/* ── DABS-Liste im KI-Briefing ── */
const AI_CODE = cut('    function escHtml(s) {', '    /* ── KI-Briefing (data/ai_status.json') +
  cut('    var AI_SEEN_KEY = ', '    var ai = { data: undefined') +
  cut('    function aiHas(map, k)', '    function aiSlotHM(d, gen)') +
  cut('    function aiDabsHtml(x, now)', '    // ED-R 132 Heuberg');
const aiDabsHtml = new Function(AI_CODE + '\nreturn aiDabsHtml;')();
const DNOW = new Date(Date.UTC(2026, 10, 20, 9, 30));        // 10:30 Uhr in Hütten
function dabs(treffer, over) {
  return Object.assign({
    ok: true, datum: '2026-11-20', version: 2, stand_utc: '2026-11-20T07:45:00+00:00', eintraege_total: 9,
    filter: 'Fluggebiet Hochrhein–Schaffhausen–Birrfeld–Jurasüdfuss–La Chaux-de-Fonds–Ajoie–Basel mit 10 km Marge',
    treffer
  }, over);
}
function hit(over) {
  return Object.assign({ gebiet: 'LS-R7', notam: 'W1234/26', zeit: '14:00–16:00', unten: '1500m', oben: 'FL130', text: 'Schiessen', karte: true, unsicher: false }, over);
}
const rows = (html) => [...html.matchAll(/<div class="(ai-row[^"]*)">(.*?)<\/div>/g)].map((m) => [m[1], m[2]]);
const srcLine = (html) => /<div class="brf-src">(.*?)<\/div>$/.exec(html)[1];
// Kopfzeile seit 21.11.: Tag, für den das DABS gilt, Version und Ausgabe (Version 2 vom 20.11. 08:45 LT)
const KOPF = ['ai-row', '<b>Gültig für heute, Fr 20.11.</b> · Version 2, herausgegeben 08:45 LT'];

test('DABS: Zeiten mit «LT», Kopf mit Gültigkeitstag und Ausgabe, «LT = Lokalzeit» (wie LSZK f1c0369)', () => {
  const html = aiDabsHtml(dabs([hit(), hit({ zeit: '09:00–10:00 LT' }), hit({ zeit: '0730 UTC' }), hit({ zeit: 'Zeit unlesbar' }),
    hit({ zeit: '22:00–02:00 (+1)' }), hit({ zeit: '08:00–09:00, 14:00–15:00' })]), DNOW);
  assert.deepEqual(rows(html)[0], KOPF);
  const r = rows(html).slice(1);
  assert.ok(r[0][1].includes('</b> 14:00–16:00 LT · '), r[0][1]);
  assert.ok(r[1][1].includes('</b> 09:00–10:00 LT · '), 'kein doppeltes LT: ' + r[1][1]);
  assert.ok(r[2][1].includes('</b> 0730 UTC · '), 'UTC bleibt UTC');
  assert.ok(r[3][1].includes('</b> Zeit unlesbar · '), 'unlesbare Zeit ohne LT');
  assert.ok(r[4][1].includes('</b> 22:00–02:00 (+1) LT · '), r[4][1]);
  assert.ok(r[5][1].includes('</b> 08:00–09:00, 14:00–15:00 LT · '), r[5][1]);
  const s = srcLine(html);
  assert.ok(s.startsWith('6 von 9 Einträgen · Fluggebiet'), s);
  assert.ok(!s.includes('Stand'), 'Version und Ausgabe stehen im Kopf, nicht mehr in der Fusszeile: ' + s);
  assert.ok(s.includes(' · neue Versionen um 09:00, 13:00 und 16:00 LT · LT = Lokalzeit · <a href="https://www.skybriefing.com/o/dabs?today"'), s);
  assert.ok(!html.includes('(Zeiten in Lokalzeit)'));
});

test('DABS: beendete Einträge grau mit «· beendet», Zähler «(n beendet)», «Keine weiteren …» wenn nur beendete (wie LSZK aea4b85)', () => {
  let html = aiDabsHtml(dabs([hit(), hit({ gebiet: 'LS-D3', zeit: '08:00–09:00 LT', beendet: true })]), DNOW);
  let r = rows(html);
  assert.deepEqual(r.map((x) => x[0]), ['ai-row', 'ai-row', 'ai-row ai-done']);
  assert.deepEqual(r[0], KOPF);
  assert.ok(r[2][1].startsWith('<b>LS-D3 · W1234/26</b> 08:00–09:00 LT · beendet · 1.500m MSL bis FL130'), r[2][1]);
  assert.ok(!r[1][1].includes('beendet'));
  assert.ok(srcLine(html).startsWith('2 von 9 Einträgen (1 beendet) · '), srcLine(html));
  assert.ok(!html.includes('Keine weiteren'));
  // nur beendete: Zeile «Keine weiteren DABS-Einträge im Filter.» nach der Liste
  html = aiDabsHtml(dabs([hit({ beendet: true, zeit: '07:00–08:00' }), hit({ beendet: true })]), DNOW);
  r = rows(html);
  assert.deepEqual(r.map((x) => x[0]), ['ai-row', 'ai-row ai-done', 'ai-row ai-done', 'ai-row']);
  assert.equal(r[3][1], 'Keine weiteren DABS-Einträge im Filter.');
  assert.ok(srcLine(html).startsWith('2 von 9 Einträgen (2 beendet) · '));
  // keine Treffer, aber Einträge anderswo: wie bisher, nicht «DABS leer»
  html = aiDabsHtml(dabs([]), DNOW);
  assert.deepEqual(rows(html), [KOPF, ['ai-row', 'Keine DABS-Einträge im Filter.']]);
  assert.ok(srcLine(html).startsWith('0 von 9 Einträgen · '));
  assert.ok(!html.includes('Keine Einträge im DABS'));
  // nur true zählt als beendet
  html = aiDabsHtml(dabs([hit({ beendet: 'true' }), hit({ beendet: 1 })]), DNOW);
  assert.deepEqual(rows(html).map((x) => x[0]), ['ai-row', 'ai-row', 'ai-row']);
  assert.ok(!html.includes('beendet'));
  // ohne eintraege_total kein Zähler, auch nicht «beendet»
  html = aiDabsHtml(dabs([hit({ beendet: true })], { eintraege_total: undefined }), DNOW);
  assert.ok(!srcLine(html).includes('Einträgen') && !srcLine(html).includes('beendet'), srcLine(html));
  // Texte maskiert, auch Zeit und Gebiet
  html = aiDabsHtml(dabs([hit({ gebiet: '<img src=x>', zeit: '10:00<b>', text: '"&\'' , beendet: true })]), DNOW);
  assert.ok(!html.includes('<img') && !html.includes('10:00<b>') && html.includes('&lt;img src=x&gt;') && html.includes('10:00&lt;b&gt; LT'), html);
  // nicht auswertbar und nicht von heute wie bisher
  assert.ok(aiDabsHtml(dabs([hit()], { ok: false }), DNOW).includes('DABS nicht auswertbar'));
  assert.ok(aiDabsHtml(dabs([hit()], { datum: '2026-11-19' }), DNOW).includes('nicht von heute'));
});

/* ── 21.11.2026: Gültigkeitstag, leeres DABS, Heuberg ohne Schiessen, «Nicht fliegbar», «in Wolken», Pflichthinweis ── */
const LEER = '<div class="ai-status" style="border-left-color:#10b981"><div class="ai-st-row"><span class="brf-dot" style="background:#10b981">' +
  '</span><span>Keine Einträge im DABS – keine Einschränkung durch das DABS.</span></div></div>';

test('DABS leer (0 Einträge): Kopf, grüne Zeile «keine Einschränkung durch das DABS», Fusszeile ohne Zähler und Filter', () => {
  // wie am 21.11.: Version 1 vom Vortag, beide Abschnitte «There are no planned activities»
  const v1 = { datum: '2026-11-20', version: 1, stand_utc: '2026-11-19T14:31:00+00:00', eintraege_total: 0, leer: true };
  const html = aiDabsHtml(dabs([], v1), DNOW);
  assert.deepEqual(rows(html), [['ai-row', '<b>Gültig für heute, Fr 20.11.</b> · Version 1, herausgegeben am Vortag (19.11. 15:31 LT)']]);
  assert.equal(html.split(LEER).length - 1, 1, html);
  assert.equal(srcLine(html), 'neue Versionen um 09:00, 13:00 und 16:00 LT · LT = Lokalzeit · ' +
    '<a href="https://www.skybriefing.com/o/dabs?today" target="_blank" rel="noopener noreferrer">Original-DABS (PDF)</a>');
  assert.ok(!html.includes('Keine DABS-Einträge im Filter') && !html.includes('0 von 0'));
  // dieselbe Version am selben Tag ausgegeben: nur die Uhrzeit
  assert.ok(aiDabsHtml(dabs([], { eintraege_total: 0 }), DNOW).includes('<b>Gültig für heute, Fr 20.11.</b> · Version 2, herausgegeben 08:45 LT</div>'));
  // 0 Einträge, aber Treffer im Datensatz (widersprüchlich): die Treffer zählen, keine grüne Zeile
  const w = aiDabsHtml(dabs([hit()], { eintraege_total: 0 }), DNOW);
  assert.ok(!w.includes('Keine Einträge im DABS') && w.includes('<b>LS-R7 · W1234/26</b>'), w);
  // ohne Zahl (älterer Datensatz, Text, null): nie «leer»
  [undefined, null, '0', NaN].forEach((t) => assert.ok(!aiDabsHtml(dabs([], { eintraege_total: t, leer: true }), DNOW).includes('Keine Einträge im DABS'), String(t)));
  // «keine Einschränkung» nur, wenn das DABS selbst leer meldet (leer === true vom Job, Befund 1 des Prüfers):
  // 0 Einträge ohne diese Meldung oder leer als Text/Zahl -> neutrale Zeile wie bisher
  [{}, { leer: false }, { leer: 'true' }, { leer: 1 }].forEach((o) => {
    const h = aiDabsHtml(dabs([], Object.assign({ eintraege_total: 0 }, o)), DNOW);
    assert.ok(!h.includes('Keine Einträge im DABS') && h.includes('Keine DABS-Einträge im Filter.'), JSON.stringify(o) + ' ' + h);
  });
  // Filtertext maskiert
  const f = aiDabsHtml(dabs([], { filter: '<img src=x onerror=alert(1)>' }), DNOW);
  assert.ok(!f.includes('<img') && f.includes('&lt;img src=x onerror=alert(1)&gt;'), f);
  // nicht auswertbar oder nicht von heute: weder Kopf noch grüne Zeile
  [{ ok: false }, { datum: '2026-11-19' }, { stand_utc: 'kaputt' }].forEach((o) => {
    const h = aiDabsHtml(dabs([], Object.assign({ eintraege_total: 0 }, o)), DNOW);
    assert.ok(!h.includes('Gültig für') && !h.includes('Keine Einträge im DABS'), JSON.stringify(o) + ' ' + h);
  });
});

test('DABS-Kopf: Wochentag, Vortag, älter, ohne Version; Sommerzeit', () => {
  const kopf = (over, now) => rows(aiDabsHtml(dabs([hit()], over), now || DNOW))[0][1];
  assert.equal(kopf({ stand_utc: '2026-11-18T14:31:00+00:00', version: 1 }), '<b>Gültig für heute, Fr 20.11.</b> · Version 1, herausgegeben 18.11. 15:31 LT');
  assert.equal(kopf({ version: undefined }), '<b>Gültig für heute, Fr 20.11.</b> · herausgegeben 08:45 LT');
  assert.equal(kopf({ version: 'x' }), '<b>Gültig für heute, Fr 20.11.</b> · herausgegeben 08:45 LT');
  // Sonntag 22.11., Version 1 am Samstag 15:45 LT
  assert.equal(kopf({ datum: '2026-11-22', version: 1, stand_utc: '2026-11-21T14:45:00+00:00' }, new Date(Date.UTC(2026, 10, 22, 7, 0))),
    '<b>Gültig für heute, So 22.11.</b> · Version 1, herausgegeben am Vortag (21.11. 15:45 LT)');
  // Sommerzeit: Montag 1.6.2026, Version 1 am 31.5. 15:40 LT (13:40 UTC)
  assert.equal(kopf({ datum: '2026-06-01', version: 1, stand_utc: '2026-05-31T13:40:00+00:00' }, new Date(Date.UTC(2026, 5, 1, 4, 30))),
    '<b>Gültig für heute, Mo 01.06.</b> · Version 1, herausgegeben am Vortag (31.05. 15:40 LT)');
});

test('Heuberg: nur aktiv / nicht aktiv, nichts zum Schiessen; Link zu den Schiesswarnungen bleibt', () => {
  const aiHbA = new Function(AI_CODE + cut('    function aiHmOk(s)', '    function aiHbB(b, now)') + '\nreturn aiHbA;')();
  const a = (heute) => aiHbA({ ok: true, heute }, DNOW);
  assert.deepEqual(a({ datum: '2026-11-20', kein_schiessen: true, unsicher: false }), { txt: 'nicht aktiv gemeldet', lvl: 0, nichtAktiv: true });
  assert.equal(a({ datum: '2026-11-20', kein_schiessen: true, unsicher: true }).txt, 'nicht aktiv gemeldet (Angabe unsicher)');
  assert.equal(a({ datum: '2026-11-20', von: '12:00', bis: '16:00', unsicher: false }).txt, 'aktiv ab 12:00 (bis 16:00)');
  // ausser Kommentaren, der Adresse, dem Feldnamen und dem Linktext kommt «Schiess…» nirgends mehr vor
  const ohne = SRC.replace(/(^|\s)\/\/ [^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace("'https://www.stetten-akm.de/gemeinde/stetten-und-bundeswehr/aktuelle-schiesswarnungen'", '')
    .replace('ah.kein_schiessen', '').replace('>Schiesswarnungen Heuberg</a>', '');
  assert.ok(!/schiess/i.test(ohne), 'sichtbarer Text zum Schiessen: ' + (/.{60}schiess.{30}/i.exec(ohne) || [''])[0]);
  assert.ok(SRC.includes("'Quellen: <a href=\"' + HB_LINKS.a + '\" target=\"_blank\" rel=\"noopener noreferrer\">Schiesswarnungen Heuberg</a> · ' +"));
  assert.ok(SRC.includes("a: 'https://www.stetten-akm.de/gemeinde/stetten-und-bundeswehr/aktuelle-schiesswarnungen',"));
  assert.ok(!SRC.includes('A aus der Schiesswarnung, B aus NOTAM') && !SRC.includes('(kein Schiessen)'));
});

test('«Flugwetter: Nicht fliegbar» statt «schlecht»; Anzeige «in Wolken»; roter Hinweis «ersetzt keine Flugplanung»', () => {
  assert.ok(SRC.includes("schlecht: { label: 'Nicht fliegbar', color: '#ef4444' }"));
  assert.ok(SRC.includes("'<span>Flugwetter: ' + (lg ? lg.label : '–') + '</span>"));
  // Tooltip/Screenreader im Satz klein: «Briefing, Flugwetter nicht fliegbar, Stand …»
  assert.ok(SRC.includes("label += ', Flugwetter ' + AI_LAGE[st.lage].label.toLowerCase();"));
  assert.ok(!SRC.includes("label: 'schlecht'"));
  const aiDe = new Function(cut('    var AI_DE_M = ', '    // seitenweit genutzt') + '\nreturn aiDe;')();
  [['Platz in Wolke, Basis um 880 m MSL.', 'Platz in Wolken, Basis um 880 m MSL.'],
   ['In Wolke, Hornberg nicht erkennbar.', 'In Wolken, Hornberg nicht erkennbar.'],
   ['Passwang in Wolke', 'Passwang in Wolken'], ['Belchen in Wolken.', 'Belchen in Wolken.'],
   ['Kamera in der Wolke.', 'Kamera in der Wolke.'], ['in Wolkendecke', 'in Wolkendecke'], ['Basis 1150 m MSL', 'Basis 1.150 m MSL']
  ].forEach(([i, o]) => assert.equal(aiDe(i), o));
  const note = /<div class="brf-note">\s*<strong>KI-generiert[\s\S]*?<\/div>/.exec(SRC)[0];   // Fuss des KI-Fensters
  assert.ok(/<\/strong>[^<]*eigene Beobachtung\.\s*<span class="ai-pflicht">Diese Information ersetzt keine Flugplanung\.<\/span>\s*<\/div>$/.test(note), note);
  assert.ok(SRC.includes('.brf-note .ai-pflicht { display: block; margin-top: 4px; color: #f87171; font-weight: 700; }'));
});

/* ── Kopfknopf, Einbindung, unveränderte Teile ── */
test('Kopfknopf heisst «Briefing» (Text, title, aria-label); das Detail-Fenster bleibt «KI-Briefing»', () => {
  assert.ok(SRC.includes('<button class="top-btn ai-btn" id="ai-toggle" type="button" onclick="openAiModal()" aria-haspopup="dialog" title="Briefing">'));
  assert.ok(/\n[ \t]*Briefing<span class="ai-time" id="ai-time"><\/span>/.test(SRC), 'sichtbarer Text im Knopf');
  // title und aria-label setzt das Skript aus label (Zustand und Stand hängen sich an)
  assert.ok(SRC.includes("var st = aiState(), now = new Date(), time = '', label = 'Briefing';"));
  assert.ok(SRC.includes('btn.title = label;') && SRC.includes("btn.setAttribute('aria-label', label);"));
  assert.ok(!/>\s*KI-Briefing<span class="ai-time"/.test(SRC));
  assert.ok(!SRC.includes('title="KI-Briefing"') && !SRC.includes("label = 'KI-Briefing'"));
  assert.ok(SRC.includes('<span id="ai-modal-title">KI-Briefing</span>'), 'Detail-Fenster unverändert');
});

test('Rechner eingebunden: Box einmal direkt nach der Ampel, Karte darin für EDSF, Skripte ?v= am Ende vor GoatCounter', () => {
  const bar = SRC.indexOf('<div id="briefing-bar"');
  const box = SRC.indexOf('<details class="perf-box" id="perf-box" style="display:none;">');
  const panel = SRC.indexOf('<div class="wx-panel" id="wx-panel">');
  assert.ok(bar > 0 && box > bar && panel > box, 'Reihenfolge Ampel, Box, Wetter-Panel');
  assert.ok(/<div id="briefing-bar"[^>]*><\/div>\r?\n\r?\n\s*<!-- Start-\/Landestrecke/.test(SRC), 'Box direkt nach der Ampel');
  ['id="perf-box"', 'id="perf-card"', 'id="perf-content"', 'id="perf-teaser-text"', 'id="perf-teaser"'].forEach((id) => {
    assert.equal(SRC.split(id).length - 1, 1, id + ' genau einmal');
  });
  const card = SRC.slice(box, SRC.indexOf('</details>', box));
  assert.ok(card.includes('<div class="wx-card" id="perf-card" data-airfield="edsf">'));
  assert.ok(card.includes('<span class="perf-t-body" id="perf-teaser-text"></span>'));
  assert.ok(!/id="perf-card"[^>]*style=/.test(SRC), 'Karte ohne display:none (die Box steuert die Sichtbarkeit)');
  const m1 = SRC.match(/<script defer src="perf\/perf\.js\?v=(\d+)"><\/script>/);
  const m2 = SRC.match(/<script defer src="perf\/perf-ui\.js\?v=(\d+)"><\/script>/);
  assert.ok(m1 && m2, 'Skript-Einbindung fehlt');
  assert.equal(m1[1], m2[1]);
  assert.equal(Number(m2[1]), require(path.join(ROOT, 'perf', 'perf-ui.js')).VERSION);
  const gc = SRC.indexOf('<!-- GoatCounter: cookielose Aufruf-Statistik (strohmeierh.goatcounter.com) -->');
  assert.ok(SRC.indexOf(m1[0]) < SRC.indexOf(m2[0]) && SRC.indexOf(m2[0]) < gc, 'erst Kern, dann Anzeige, dann GoatCounter');
  // GoatCounter unverändert am Ende (Vergleich mit LF: im Repo liegt die Datei mit LF, im Arbeitsbaum unter Windows
  // mit core.autocrlf als CRLF)
  assert.ok(SRC.replace(/\r\n/g, '\n').trimEnd().endsWith(
    "<script>window.goatcounter = { path: function (p) { return '/HST_01' + p; } };</script>\n" +
    '  <script data-goatcounter="https://strohmeierh.goatcounter.com/count"\n' +
    '          async src="//gc.zgo.at/count.js"></script>\n\n</body>\n</html>'), SRC.slice(-400));
});

test('index.html: einheitliche Zeilenenden (nur CRLF oder nur LF), ohne BOM; Flugzeughalle (Sichtschutz) unverändert vorhanden', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'index.html'));
  assert.notEqual(buf[0], 0xef, 'BOM');
  let lfOnly = 0, crlf = 0, crOnly = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) { if (i > 0 && buf[i - 1] === 13) crlf++; else lfOnly++; }
    else if (buf[i] === 13 && buf[i + 1] !== 10) crOnly++;
  }
  assert.equal(crOnly, 0, 'einzelnes CR');
  assert.ok((crlf > 3000 && lfOnly === 0) || (lfOnly > 3000 && crlf === 0), 'gemischte Zeilenenden: CRLF ' + crlf + ', LF ' + lfOnly);
  assert.ok(SRC.includes("var KEY = 'edsf-halle-key';"));
  assert.ok(SRC.includes("ct: 'wPfgeJWO7fFOZaSvLmlGb7dh/T9HQ+h6MgTNEMsE5AVGgcRTMAeWrwj5Md/RiLmUbEtZhzkx82iSqxPbPta4TGR89kJzytawt9G/JVwVm+bTWPSz3fhMYWYyMl9U09lplLyyGdg7r3qhIsr7ydM7pozPY7lp40xi2AOtHQ=='"));
  // Inline-Skripte bleiben syntaktisch gültig
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(SRC))) { n++; assert.doesNotThrow(() => new Function(m[1]), 'Skript ' + n); }
  assert.ok(n >= 2);
});

/* ── Flugzeughalle: Alter und Statuspunkt ohne Adresse (21.11.2026) ──
   Die Bildadresse steht nicht in der Seite (verschlüsselt seit 16.11.2026). Der Status-Job kennt sie aus dem GitHub-Secret
   HALLE_SRC und schreibt den Status unter dem Schlüssel «halle» nach data/cam-status.json; die Karte liest ihn über
   data-status-key, gesperrt wie entsperrt. Die Statusfunktionen werden aus index.html herausgeschnitten und mit einer
   nachgebauten Karte aufgerufen (Uhr gestellt, Image nur protokolliert). */
const CAM_CODE = cut('    function pad(n) {', '    var visible = new Set();');
function camWorld() {
  const created = [];
  class FakeImage { constructor() { created.push(this); } }
  const api = new Function('Image', 'Date', 'fetch', CAM_CODE +
    '\nreturn { statusKey: statusKey, applyStatusToCam: applyStatusToCam, needsReload: needsReload, loadImg: loadImg,' +
    ' setStatus: function (s) { camStatus = s; } };')(FakeImage, FakeDate, () => { throw new Error('kein Netz im Test'); });
  return { api, created };
}
function classes(init) {
  const s = new Set(init);
  return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c), list: () => [...s].sort() };
}
function camCard(attrs) {
  const ts = { textContent: 'alt', title: '' };
  const dot = { classList: classes(['status-dot', 'age-unknown']) };
  const container = { classList: classes(['media-container', 'loaded']) };
  const card = { querySelector: (sel) => (sel === '.cam-timestamp' ? ts : (sel === '.status-dot' ? dot : null)) };
  const img = {
    attrs: Object.assign({}, attrs), dataset: {}, style: {}, classList: classes(['live-cam']), src: 'data:',
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    setAttribute(n, v) { this.attrs[n] = v; },
    closest(sel) { return sel === '.cam-card' ? card : (sel === '.media-container' ? container : null); }
  };
  return { img, ts, dot };
}
const HALLE_CARD = cut('      <div class="cam-card" id="halle-card">', '    <h2 class="section-title">Umgebung</h2>');

test('Flugzeughalle: Karte ohne Adresse, nur data-status-key «halle»; Secret nur im Schritt «Refresh cam status»', () => {
  assert.ok(HALLE_CARD.includes('<img class="live-cam" data-status-key="halle" src="data:image/gif;base64,'), HALLE_CARD);
  assert.ok(!/data-src|data-locksrc|wsrv|https?:|\.jpe?g|href=/i.test(HALLE_CARD), 'Adresse oder Adressattribut in der Hallenkarte');
  assert.ok(HALLE_CARD.includes('<span class="status-dot age-unknown"></span>') && !HALLE_CARD.includes('Keine Altersprüfung'), HALLE_CARD);
  assert.deepEqual(SRC.match(/<[a-z]+\b[^<>]*\bdata-status-key="[^"]*"/g).map((t) => /data-status-key="([^"]*)"/.exec(t)[1]), ['halle'],
    'nur das Bild der Halle hat einen eigenen Statusschlüssel');
  // Workflow: das Secret genau einmal, nur im Statusschritt; einziger Auslöser workflow_dispatch (keine Läufe aus Pull Requests)
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'update-cam-status.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal((wf.match(/secrets\.HALLE_SRC/g) || []).length, 1, 'das Secret genau einmal');
  assert.equal((wf.match(/^\s*HALLE_SRC:/gm) || []).length, 1, 'genau eine Umgebungsvariable HALLE_SRC');
  assert.ok(wf.includes('      - name: Refresh cam status\n        env:\n          HALLE_SRC: ${{ secrets.HALLE_SRC }}\n        run: python scripts/update_cam_status.py\n'), wf);
  assert.ok(/^on:\n  workflow_dispatch:\n\n/m.test(wf) && (wf.match(/^on:/gm) || []).length === 1, 'Auslöser');
  const py = fs.readFileSync(path.join(ROOT, 'scripts', 'update_cam_status.py'), 'utf8');
  assert.ok(py.includes('HALLE_KEY = "halle"') && py.includes('HALLE_ENV = "HALLE_SRC"') && py.includes('targets.append((HALLE_KEY, halle, HALLE_KEY))'));
});

test('Flugzeughalle: Alter und Punkt aus «halle» – gesperrt ohne Bild, entsperrt mit Bild; andere Kameras wie bisher über die Adresse', () => {
  const { api, created } = camWorld();
  const hall = camCard({ 'data-status-key': 'halle' });
  assert.equal(api.statusKey(hall.img), 'halle');
  // ohne Eintrag: grau, keine Zeit
  api.setStatus({});
  api.applyStatusToCam(hall.img);
  assert.deepEqual([hall.ts.textContent, hall.dot.classList.list()], ['', ['age-unknown', 'status-dot']]);
  // Eintrag unter einer Adresse zählt für die Halle nicht
  api.setStatus({ 'https://wsrv.nl/?url=x.example/cam.jpg': { lastChange: NOW - 2 * MIN } });
  api.applyStatusToCam(hall.img);
  assert.equal(hall.ts.textContent, '');
  // frisch, gelb ab 10 min, rot ab 30 min; Titel mit dem Zeitpunkt
  [[7, [], 'vor 7 min'], [15, ['age-yellow'], 'vor 15 min'], [35, ['age-red'], 'vor 35 min'], [125, ['age-red'], 'vor 2 h 5 min']].forEach(([m, cls, txt]) => {
    api.setStatus({ halle: { hash: 'h', lastChange: NOW - m * MIN, source: 'origin' } });
    api.applyStatusToCam(hall.img);
    assert.equal(hall.ts.textContent, txt, m + ' min');
    assert.deepEqual(hall.dot.classList.list(), ['status-dot'].concat(cls).sort(), m + ' min');
    assert.ok(hall.ts.title.startsWith('Letzter Bildwechsel: 20.11.2026 '), hall.ts.title);
  });
  // gesperrt (kein data-src): loadImg lädt kein Bild, setzt aber Alter und Punkt; nachladen bleibt fällig (der Punkt folgt jedem Abruf)
  api.setStatus({ halle: { hash: 'h', lastChange: NOW - 3 * MIN, source: 'bot' } });
  hall.ts.textContent = 'alt';
  api.loadImg(hall.img, NOW);
  assert.deepEqual([created.length, hall.ts.textContent, hall.img.dataset.loadedChange], [0, 'vor 3 min', undefined]);
  assert.equal(api.needsReload(hall.img), true);
  // entsperrt (reveal setzt data-src): Bild laden, als geladen merken unter «halle»; neu laden erst nach einem Bildwechsel
  hall.img.setAttribute('data-src', 'https://wsrv.nl/?url=x.example/halle.jpg');
  assert.equal(api.statusKey(hall.img), 'halle', 'der eigene Schlüssel gilt auch entsperrt');
  api.loadImg(hall.img, NOW);
  assert.equal(created.length, 1);
  assert.ok(created[0].src.startsWith('https://wsrv.nl/?url=x.example/halle.jpg&w=900&h=506&fit=cover&output=webp&q=75'), created[0].src);
  created[0].onload();
  assert.equal(hall.img.dataset.loadedChange, String(NOW - 3 * MIN));
  assert.equal(api.needsReload(hall.img), false);
  api.setStatus({ halle: { hash: 'h2', lastChange: NOW - 1 * MIN, source: 'bot' } });
  assert.equal(api.needsReload(hall.img), true);
  // andere Kamera: Schlüssel bleibt die Adresse (data-src), ein Eintrag «halle» gilt für sie nicht
  const cam = camCard({ 'data-src': 'https://wsrv.nl/?url=www.example.org/cam/cam91.jpg' });
  assert.equal(api.statusKey(cam.img), 'https://wsrv.nl/?url=www.example.org/cam/cam91.jpg');
  api.setStatus({ halle: { lastChange: NOW - 1 * MIN }, 'https://wsrv.nl/?url=www.example.org/cam/cam91.jpg': { lastChange: NOW - 12 * MIN } });
  api.applyStatusToCam(cam.img);
  assert.deepEqual([cam.ts.textContent, cam.dot.classList.list()], ['vor 12 min', ['age-yellow', 'status-dot']]);
  // Bild ohne Schlüssel (weder data-src noch data-status-key): nichts geändert
  const none = camCard({});
  api.applyStatusToCam(none.img);
  assert.deepEqual([none.ts.textContent, none.dot.classList.list()], ['alt', ['age-unknown', 'status-dot']]);
});

/* Ganzer Kamerablock im Ablauf (nach der Integrationsprobe des Prüfers vom 21.11.2026): erste Statusrunde, Sichtbarkeit
   (IntersectionObserver), Takt von refreshCams, Entsperren wie reveal(); DOM, fetch, Takt und Uhr nachgebaut. */
const CAM_BLOCK = (() => {
  const lf = SRC.replace(/\r\n/g, '\n');
  const from = '    /* ── Kamera-Refresh', to = "    (function() {\n      var bar = document.getElementById('sunrise-bar');";
  const a = lf.indexOf(from), b = lf.indexOf(to, a);
  if (a < 0 || b < 0 || lf.indexOf(from, a + 1) >= 0) throw new Error('Kamerablock in index.html nicht gefunden');
  return lf.slice(a, b);
})();
const PUB_KEY = 'https://wsrv.nl/?url=www.example.org/cam/cam91.jpg';
function camBlock(clock) {
  class TickDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } }
  function card(attrs) {
    const header = { dot: { classList: classes(['status-dot']) }, ts: null };
    header.querySelector = (sel) => (sel === '.cam-timestamp' ? header.ts : (sel === '.status-dot' ? header.dot : null));
    header.insertBefore = (span) => { header.ts = span; };
    header.appendChild = (span) => { header.ts = span; };
    const container = { classList: classes(['media-container']) };
    const c = { querySelector: header.querySelector };
    const img = {
      tagName: 'IMG', attrs: Object.assign({}, attrs), dataset: {}, style: {}, classList: classes(['live-cam']), src: 'data:',
      getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
      setAttribute(n, v) { this.attrs[n] = v; },
      closest(sel) { return sel === '.cam-card' ? c : (sel === '.media-container' ? container : null); }
    };
    return { img, header };
  }
  const hall = card({ 'data-status-key': 'halle' });
  hall.header.dot.classList.add('age-unknown');
  const pub = card({ 'data-src': PUB_KEY });
  const created = [], pending = [], intervals = [];
  let status = {}, ioCb = null;
  class FakeImage { constructor() { created.push(this); } }
  class IO { constructor(cb) { ioCb = cb; } observe() {} }
  const document = {
    hidden: false,
    getElementById: () => null,
    createElement: () => ({ className: '', textContent: '', title: '' }),
    querySelectorAll: (sel) => (sel === '.cam-header' ? [hall.header, pub.header] : (sel === 'img.live-cam' ? [hall.img, pub.img] : [])),
    addEventListener: () => {}
  };
  const fetchFn = () => new Promise((res) => pending.push(() => res({ ok: true, json: () => JSON.parse(JSON.stringify(status)) })));
  const env = { Image: FakeImage, Date: TickDate, fetch: fetchFn, IntersectionObserver: IO, document, setInterval: (f) => intervals.push(f),
    ai: { loadedAt: clock.now }, loadAi: () => {} };
  const api = {};
  new Function(...Object.keys(env), CAM_BLOCK + '\nthis.loadImg = loadImg;').call(api, ...Object.values(env));
  return {
    hall, pub, created,
    setStatus(s) { status = s; },
    async flush() { while (pending.length) { pending.shift()(); await new Promise((r) => setImmediate(r)); } },
    see(el) { ioCb([{ isIntersecting: true, target: el }]); },
    tick() { intervals.forEach((f) => f()); },
    // wie reveal() im Abschnitt «Flugzeughalle»
    unlock() { hall.img.setAttribute('data-src', 'https://wsrv.nl/?url=x.example/h.jpg'); hall.img.dataset.initialized = '1'; api.loadImg(hall.img, clock.now); }
  };
}
const shownCam = (c) => [c.header.ts.textContent, c.header.dot.classList.list().join(' ')];

test('Flugzeughalle im Ablauf: gesperrt erste Runde und Takt; Entsperren, Bildwechsel, Ladefehler, gemerkter Schlüssel', async () => {
  const clock = { now: NOW };
  // gesperrt: Zeit und Punkt aus «halle», kein Bild, der Punkt folgt jedem Takt
  const w = camBlock(clock);
  w.setStatus({ halle: { lastChange: clock.now - 3 * MIN }, [PUB_KEY]: { lastChange: clock.now - 12 * MIN } });
  await w.flush();
  assert.deepEqual(shownCam(w.hall), ['vor 3 min', 'status-dot'], 'erste Runde: Halle');
  assert.deepEqual(shownCam(w.pub), ['vor 12 min', 'age-yellow status-dot'], 'erste Runde: andere Kamera');
  assert.equal(w.hall.img.dataset.loadedChange, undefined, 'gesperrte Halle: nichts als geladen gemerkt');
  w.see(w.hall.img);
  w.see(w.pub.img);
  assert.deepEqual(w.created.map((i) => i.src.split('&')[0]), [PUB_KEY], 'sichtbar: nur die andere Kamera lädt ein Bild');
  w.created[0].onload();
  clock.now += 20 * MIN;
  w.tick(); await w.flush();
  assert.deepEqual([shownCam(w.hall), w.created.length], [['vor 23 min', 'age-yellow status-dot'], 1], 'Takt ohne Bildwechsel');
  w.setStatus({ halle: { lastChange: clock.now - 1 * MIN }, [PUB_KEY]: { lastChange: clock.now - 32 * MIN } });
  w.tick(); await w.flush();
  assert.deepEqual(shownCam(w.hall), ['vor 1 min', 'status-dot'], 'Takt mit Bildwechsel');
  w.setStatus({ [PUB_KEY]: { lastChange: clock.now - 32 * MIN } });
  w.tick(); await w.flush();
  assert.deepEqual(shownCam(w.hall), ['', 'age-unknown status-dot'], 'Eintrag fehlt (kein Secret): grau, ohne Zeit');
  // entsperrt nach der ersten Runde: Bild laden, danach nur nach einem Bildwechsel neu
  const v = camBlock(clock);
  v.setStatus({ halle: { lastChange: clock.now - 3 * MIN } });
  await v.flush();
  v.see(v.hall.img);
  v.unlock();
  assert.equal(v.created.length, 1, 'Entsperren lädt das Bild');
  v.created[0].onload();
  assert.equal(v.hall.img.dataset.loadedChange, String(clock.now - 3 * MIN), 'als geladen gemerkt unter «halle»');
  clock.now += 2 * MIN; v.tick(); await v.flush();
  assert.deepEqual([v.created.length, v.hall.header.ts.textContent], [1, 'vor 5 min'], 'Takt ohne Bildwechsel: nicht neu laden');
  v.setStatus({ halle: { lastChange: clock.now - 0.5 * MIN } });
  v.tick(); await v.flush();
  assert.equal(v.created.length, 2, 'Takt mit Bildwechsel: genau ein neues Bild');
  // Ladefehler beim ersten Bild nach dem Entsperren: der nächste Takt versucht es neu
  const x = camBlock(clock);
  x.setStatus({ halle: { lastChange: clock.now - 3 * MIN } });
  await x.flush();
  x.see(x.hall.img);
  x.unlock();
  x.created[0].onerror();
  clock.now += 2 * MIN; x.tick(); await x.flush();
  assert.equal(x.created.length, 2, 'nach dem Ladefehler neuer Versuch');
  // gemerkter Schlüssel: Entsperren vor der ersten Statusrunde; danach kein unnötiges Nachladen
  const y = camBlock(clock);
  y.setStatus({ halle: { lastChange: clock.now - 3 * MIN } });
  y.unlock();
  y.created[0].onload();
  await y.flush();
  y.see(y.hall.img);
  clock.now += 1 * MIN; y.tick(); await y.flush();
  assert.deepEqual([y.created.length, y.hall.img.dataset.loadedChange], [1, String(clock.now - 4 * MIN)], 'gemerkter Schlüssel');
});
