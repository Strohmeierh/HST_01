/* Start- und Landestreckenrechner – Rechenkern ohne DOM (Datenschema 2 und 3).
   Rechnet nach den AFM-Tabellen in perf/aircraft/*.json für die Pisten in perf/airfields/*.json.
   Grundsatz: lieber kein Wert als ein falscher oder zu optimistischer. Jede Rundung geht zur längeren Strecke.
   Gerechnet wird nur die Piste mit Gegenwind; bei Windstille, fehlender Richtung (bis 3 kt) oder genau querem
   Wind alle Pisten ohne Windkorrektur. Rückenwind wird nicht gerechnet.
   Die Daten deklarieren ihr Schema, der Kern kennt eine Whitelist: Unbekanntes ergibt keinen Wert.
   Ablesung je Tabellenachse nach ihrer Regel (read): «linear» interpoliert zwischen den Tabellenwerten, «nextHigher»
   nimmt den nächsthöheren; unter dem kleinsten Tabellenwert gilt dieser, über dem grössten gibt es keinen Wert (einzige
   Ausnahme: die Gegenwindachse, E2). Die Druckhöhe geht auf ganze ft aufgerundet in die Tabelle.
   Abfluggewicht (freiwillig, input.massKg): Haupttabelle = Höchstgewicht, charts.takeoff.lowerWeights = tiefere
   Gewichte. charts.takeoff.massRead «linear»: zwischen zwei Starttabellen linear interpoliert; sonst (ohne Angabe
   oder «nextHigher») die Tabelle für das nächsthöhere Gewicht. Unter der kleinsten Tabelle gilt diese, ohne Angabe
   das Höchstgewicht. Ohne weitere Landetabellen rechnet die Landung mit ihrer einen Tabelle (maximales Landegewicht).
   Je gerechneter Piste zusätzlich der Start mit jeder Starttabelle und daraus «Start möglich bis …» (takeoffLimit; bei
   «linear» auf ganze kg genau).
   Schema 3 (nur Flugzeugdaten, seit VERSION 8) erlaubt zusätzlich, Schema 2 rechnet unverändert wie VERSION 7:
   E1 Druckhöhenachse in m: die aufgerundeten ganzen ft × 0,3048, auf ganze m aufgerundet.
   E2 Gegenwind als Tabellenachse (nur «linear», ab 0 kt, über dem grössten Tabellenwind dessen Wert; die Werte
      entlang dieser Achse steigen nicht). Dann keine Gegenwind-Regel und keine 50-%-Grenze (Werte des AFM).
   E3 Temperatur als Abweichung von der Standardtemperatur der Tabelle (stdTempC je Druckhöhenzeile; zwischen den
      Zeilen nach der Ablesung der Druckhöhe, unter der tiefsten Zeile deren Wert).
   E4 Gegenwind-Faktortabelle: linear zwischen den Punkten, über dem letzten dessen Faktor; der Faktor wird auf drei
      Dezimalen aufgerundet und auf beide Strecken angewandt.
   E5 Belagszuschlag in Prozent auf jede Strecke (percentOfEach); «minimum» (Text «mindestens») bei Belagsregeln.
   E6 Landung fehlt im AFM (charts.landing.absent): die Landung hat keinen Wert, sonst ändert sich nichts.
   E7 Landung nach Gewicht: lowerWeights und massRead auch bei der Landung, massLanding = maximales Landegewicht.
      Landegewicht = Eingabe, höchstens das maximale Landegewicht; ohne Eingabe dieses.
   E8 Faustregel-Punkt (nicht aus dem AFM): Tabellenpunkt 0 ft / 15 °C mit Zuschlägen je 1000 ft Druckhöhe und je
      10 °C über ISA auf dieser Druckhöhe, direkt nach dem Tabellenwert; keine Gutschrift unter 0 ft oder unter ISA,
      über 10'000 ft kein Wert.
   Reihenfolge je Phase: Tabelle (Ablesung, Gewicht) → Faustregeln → Gegenwind → Belag → AFM-Faktoren → (ft → m) →
   auf ganze m aufgerundet.
   Browser: window.PerfCore (dasselbe Objekt auch als window.LszkPerfCore). Node: module.exports.
   VERSION gleich dem ?v= in index.html und in perf/perf-ui.js halten. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.PerfCore = root.LszkPerfCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 9;

  var EPS = 1e-9;
  var FT_M = 0.3048;
  var LB_KG = 0.45359237;
  var CALM_BELOW_KT = 1;        // Mittelwind darunter: windstill, alle Pisten ohne Windkorrektur
  var NODIR_MAX_KT = 3;         // ohne Windrichtung bis hier alle Pisten ohne Windkorrektur, darüber kein Wert
  var MAX_HEADWIND_KT = 40;     // Gegenwind darüber: kein Wert (das AFM nennt keine Obergrenze)
  var MAX_WIND_CREDIT = 0.5;    // verkürzt der Wind eine Strecke um mehr als die Hälfte: kein Wert (nicht bei E2)
  var MAX_LOWER_WEIGHTS = 8;    // höchstens so viele weitere Tabellen je Phase
  var MASS_TOL_KG = 1;          // gedruckte kg und gedruckte Pfund einer Tabelle dürfen höchstens so weit auseinanderliegen
  var POINT_MAX_PA_FT = 10000;  // Faustregel-Punkt (E8): Druckhöhe darüber ergibt keinen Wert
  var ISA_SEA_LEVEL_C = 15;     // Standardatmosphäre: 15 °C auf Meereshöhe …
  var ISA_LAPSE_C_PER_1000FT = 1.98;   // … und 1,98 °C weniger je 1000 ft

  // Plausible Eingabebereiche, ausserhalb: invalid-input
  var INPUT_RANGES = {
    tempC: [-60, 60],
    qnhHpa: [900, 1100],
    windKt: [0, 100],
    windDirTrue: [0, 360]
  };

  // Whitelist des Datenschemas. Platzdaten: Schema 2. Flugzeugdaten: Schema 2 oder 3 (3 = mit den Erweiterungen E1–E8).
  var SCHEMA = 2;
  var SCHEMA_EXT = 3;
  var SCHEMAS = [SCHEMA, SCHEMA_EXT];
  var PHASES = ['takeoff', 'landing'];
  // Achsen: units = Einheiten mit Wertebereich (unitsExt: dasselbe ab Schema 3), reads = Ableseregeln, above = Regel
  // über dem grössten Tabellenwert; ext: Achse nur ab Schema 3.
  var AXES = {
    pressureAltitude: { units: { ft: [-2000, 20000] }, unitsExt: { ft: [-2000, 20000], m: [-600, 6000] }, reads: ['nextHigher', 'linear'], above: ['none'] },
    temperature: { units: { degC: [-60, 60] }, reads: ['nextHigher', 'linear'], above: ['none'] },
    headwind: { ext: true, units: { kt: [0, 100] }, reads: ['linear'], above: ['highest'] },
    temperatureDeviation: { ext: true, units: { degC: [-60, 60] }, reads: ['nextHigher', 'linear'], above: ['none'] }
  };
  var MASS_READS = ['nextHigher', 'linear'];    // Ablesung über die Tabellen verschiedener Gewichte (charts.*.massRead)
  var OUTPUT_IDS = ['groundRoll', 'overObstacle'];
  var TABLE_MAX = { ft: 30000, m: 9000 };       // Tabellenwerte: 0 < Wert ≤ Grenze der Einheit
  var OBSTACLE_FT = 50;                         // die Anzeige schreibt «über 15 m»
  var CORRECTION_KINDS = ['headwind', 'surface', 'factor'];
  var CORRECTION_KINDS_EXT = ['headwind', 'surface', 'factor', 'altitudeRule', 'temperatureRule'];
  var FACTOR_WHEN = ['wet', 'always'];
  var SURFACE_CONDITIONS = ['dry'];
  var SURFACE_TYPES = ['addPercentOf'];
  var SURFACE_TYPES_EXT = ['addPercentOf', 'percentOfEach'];
  var POINT_CONDITION_KEYS = 'pressureAltitudeFt,temperatureC';   // Faustregel-Punkt: genau diese Bedingungen …
  var POINT_PA_FT = 0;                                            // … 0 ft Druckhöhe …
  var POINT_TEMP_C = 15;                                          // … und 15 °C
  var ABSENT_FORBIDDEN = ['table', 'corrections', 'lowerWeights', 'massRead', 'base'];

  // Plausibilitätsgrenzen der Daten (fail-closed)
  var LIMITS = {
    perKt: [1, 50],               // Windregel «… je per kt»
    windPercentMax: 100,          // 0 < |percent| ≤ 100
    absolutePerKtMax: 50,         // 0 < |amount| / per ≤ 50 (Tabelleneinheit je kt)
    surfacePercentMax: 200,       // Belagszuschlag 0 < percent ≤ 200
    factorMax: 3,                 // 1 < Faktor ≤ 3, höchstens drei Dezimalen
    availableM: [100, 6000],
    elevationFt: [-1500, 15000],
    bearingDeg: [1, 360],
    windTableKt: [0, 100],        // Gegenwind-Faktortabelle (E4): kt der Punkte
    stdTempC: [-60, 60],          // Standardtemperatur der Tabelle (E3)
    rulePercentMax: 50            // Faustregel (E8): 0 < Prozent ≤ 50
  };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isStr(v) { return typeof v === 'string' && v.length > 0; }
  function inList(list, v) { return list.indexOf(v) >= 0; }
  function inRange(v, r) { return isNum(v) && v >= r[0] && v <= r[1]; }
  function inOpenClosed(v, max) { return isNum(v) && v > 0 && v <= max; }   // 0 < v ≤ max
  // Auf ganze Meter aufrunden; ein Gleitkommarest über einer ganzen Zahl (231,00000000000003) rundet nicht auf
  function ceilMeters(x) { return Math.ceil(x - EPS); }

  /* ── Druckhöhe ─────────────────────────────────────────────── */
  function pressureAltitudeFt(elevFt, qnhHpa) {
    return elevFt + 145442.16 * (1 - Math.pow(qnhHpa / 1013.25, 0.190263));
  }

  // Druckhöhe in ganzen m für Tabellen in m (E1): ft × 0,3048, aufgerundet. Gerechnet als ft × 3048 / 10000 wie die
  // Umrechnung der Strecken; bei ganzen ft ist das Ergebnis exakt (der Quotient ist eine ganze Zahl oder liegt mindestens
  // 1/10000 daneben, weit über dem Gleitkommafehler). Ohne −0.
  function pressureAltitudeM(ft) {
    var m = Math.ceil(ft * 3048 / 10000);
    return m === 0 ? 0 : m;
  }

  // Standardatmosphäre auf der Druckhöhe (ft)
  function isaTempC(paFt) { return ISA_SEA_LEVEL_C - ISA_LAPSE_C_PER_1000FT * paFt / 1000; }

  /* ── Validierung der Daten (fail-closed) ───────────────────── */
  function tableUnit(t) {
    return t && Array.isArray(t.outputs) && t.outputs[0] ? t.outputs[0].unit : null;
  }

  function isPoint(t) { return isObj(t) && t.type === 'point'; }
  function isAbsent(ch) { return isObj(ch) && ch.absent === true; }

  // Erste Achse einer Grösse (null: keine); hasAxis prüft nur, ob es sie gibt
  function findAxis(t, quantity) {
    if (!isObj(t) || !Array.isArray(t.axes)) return null;
    for (var k = 0; k < t.axes.length; k++) if (isObj(t.axes[k]) && t.axes[k].quantity === quantity) return t.axes[k];
    return null;
  }
  function hasAxis(t, quantity) { return findAxis(t, quantity) !== null; }

  // Ausgaben einer Tabelle (Gitter oder Punkt): genau groundRoll und overObstacle in derselben bekannten Einheit, dazu das
  // Hindernis 50 ft. Gibt die Position je Ausgabe zurück, oder null, wenn die Tabelle so nicht weiter geprüft werden kann.
  function checkOutputs(t, path, err) {
    if (!Array.isArray(t.outputs) || t.outputs.length !== OUTPUT_IDS.length) { err(path + '.outputs falsch'); return null; }
    var pos = {};
    var unit = tableUnit(t);
    if (!has(TABLE_MAX, unit)) err(path + '.outputs: Einheit unbekannt');
    t.outputs.forEach(function (o, n) {
      if (!isObj(o) || !inList(OUTPUT_IDS, o.id) || has(pos, o.id)) { err(path + '.outputs[' + n + '] unbekannt'); return; }
      if (o.unit !== unit) err(path + '.outputs[' + n + '].unit verschieden');
      pos[o.id] = n;
    });
    if (!has(pos, 'groundRoll') || !has(pos, 'overObstacle') || !has(TABLE_MAX, unit)) return null;
    if (!isObj(t.obstacle) || t.obstacle.value !== OBSTACLE_FT || t.obstacle.unit !== 'ft') err(path + '.obstacle unbekannt');
    return pos;
  }

  function validateTable(t, path, err, ext) {
    if (!isObj(t)) { err(path + ': fehlt'); return; }
    if (ext && t.type === 'point') { validatePointTable(t, path, err); return; }
    if (t.type !== 'grid') err(path + '.type unbekannt');
    if (!Array.isArray(t.axes) || t.axes.length < 1) { err(path + '.axes fehlt'); return; }
    var seen = {};
    var axesOk = true;
    t.axes.forEach(function (ax, k) {
      var p = path + '.axes[' + k + ']';
      if (!isObj(ax)) { err(p + ' fehlt'); axesOk = false; return; }
      var def = typeof ax.quantity === 'string' && has(AXES, ax.quantity) ? AXES[ax.quantity] : null;
      if (!def || (def.ext && !ext)) { err(p + '.quantity unbekannt'); axesOk = false; return; }
      if (seen[ax.quantity]) err(p + '.quantity doppelt');
      seen[ax.quantity] = true;
      var units = ext && def.unitsExt ? def.unitsExt : def.units;
      var unitOk = typeof ax.unit === 'string' && has(units, ax.unit);
      if (!unitOk) err(p + '.unit unbekannt');
      // bei unbekannter Einheit der Bereich der ersten Einheit (wie VERSION 7)
      var range = unitOk ? units[ax.unit] : def.units[Object.keys(def.units)[0]];
      if (!inList(def.reads, ax.read)) err(p + '.read unbekannt');
      if (ax.below !== 'lowest') err(p + '.below unbekannt');
      if (!inList(def.above, ax.above)) err(p + '.above unbekannt');
      if (ax.stdTempC !== undefined && ax.quantity !== 'temperatureDeviation') err(p + '.stdTempC nur bei temperatureDeviation');
      if (!Array.isArray(ax.values) || ax.values.length < 1) { err(p + '.values fehlt'); axesOk = false; return; }
      for (var i = 0; i < ax.values.length; i++) {
        if (!inRange(ax.values[i], range) || (i > 0 && !(ax.values[i] > ax.values[i - 1]))) {
          err(p + '.values nicht streng steigend oder ausserhalb ' + range.join('…'));
          axesOk = false;
          return;
        }
      }
      if (ax.read === 'linear' && ax.values.length < 2) { err(p + '.values: Interpolation braucht zwei Werte'); axesOk = false; }
      // Gegenwind ab 0 kt: sonst gälte ohne Wind (unter dem kleinsten Tabellenwind) die kürzere Strecke mit Wind
      if (ax.quantity === 'headwind' && ax.values[0] !== 0) { err(p + '.values: Gegenwind beginnt nicht bei 0 kt'); axesOk = false; }
    });
    // Temperaturabweichung (E3): braucht die Druckhöhenachse derselben Tabelle, schliesst die Temperaturachse aus
    if (seen.temperatureDeviation) {
      var dv = findAxis(t, 'temperatureDeviation'), pAx = findAxis(t, 'pressureAltitude');
      var dp = path + '.axes[' + t.axes.indexOf(dv) + ']';
      if (seen.temperature) { err(path + '.axes: temperature und temperatureDeviation zusammen'); axesOk = false; }
      if (!pAx) { err(dp + ': temperatureDeviation ohne pressureAltitude'); axesOk = false; }
      else if (!stdTempsOk(dv.stdTempC, pAx.values)) { err(dp + '.stdTempC falsch'); axesOk = false; }
    }
    var pos = checkOutputs(t, path, err);
    if (!pos) return;
    if (!axesOk) return;
    var unit = tableUnit(t);
    if (!shapeOk(t.cells, t.axes, 0, t.outputs.length, TABLE_MAX[unit])) { err(path + '.cells Form oder Wert falsch'); return; }
    var dims = t.axes.map(function (ax) { return ax.values.length; });
    var down = t.axes.map(function (ax) { return ax.quantity === 'headwind'; });
    var bad = false;
    forEachIndex(dims, function (idx) {
      if (bad) return;
      var c = cellAt(t.cells, idx);
      if (!(c[pos.overObstacle] >= c[pos.groundRoll])) { bad = true; err(path + '.cells: Strecke über Hindernis kürzer als Rollstrecke'); return; }
      // Nächsthöherer Wert und Interpolation sind nur konservativ, wenn die Tabelle in keiner Achse fällt; entlang der
      // Gegenwindachse (E2) darf sie dagegen nicht steigen (mehr Gegenwind, nicht längere Strecke)
      for (var k = 0; k < dims.length && !bad; k++) {
        if (idx[k] + 1 >= dims[k]) continue;
        var nidx = idx.slice(); nidx[k]++;
        var n = cellAt(t.cells, nidx);
        for (var o = 0; o < c.length; o++) {
          if (down[k] ? !(n[o] <= c[o]) : !(n[o] >= c[o])) { bad = true; err(path + '.cells nicht monoton'); return; }
        }
      }
    });
  }

  // Standardtemperaturen der Tabelle (E3): je Druckhöhenzeile eine, im Bereich, mit der Höhe nicht steigend
  function stdTempsOk(std, paValues) {
    if (!Array.isArray(std) || !Array.isArray(paValues) || std.length !== paValues.length) return false;
    for (var i = 0; i < std.length; i++) {
      if (!inRange(std[i], LIMITS.stdTempC) || (i > 0 && !(std[i] <= std[i - 1]))) return false;
    }
    return true;
  }

  /* Faustregel-Punkt (E8): ein Wertepaar für genau 0 ft Druckhöhe und 15 °C, ohne Achsen und Zellen. Die Zuschläge für
     Druckhöhe und Temperatur stehen als Korrekturen altitudeRule und temperatureRule in derselben Phase. */
  function validatePointTable(t, path, err) {
    if (t.axes !== undefined || t.cells !== undefined) err(path + ': Punkt-Tabelle ohne axes und cells');
    var c = t.conditions;
    if (!isObj(c) || Object.keys(c).sort().join(',') !== POINT_CONDITION_KEYS || c.pressureAltitudeFt !== POINT_PA_FT || c.temperatureC !== POINT_TEMP_C) {
      err(path + '.conditions nicht genau 0 ft und 15 °C');
    }
    var pos = checkOutputs(t, path, err);
    if (!pos) return;
    var v = t.values, max = TABLE_MAX[tableUnit(t)];
    var ok = Array.isArray(v) && v.length === t.outputs.length;
    for (var i = 0; ok && i < v.length; i++) if (!inOpenClosed(v[i], max)) ok = false;
    if (!ok) { err(path + '.values Form oder Wert falsch'); return; }
    if (!(v[pos.overObstacle] >= v[pos.groundRoll])) err(path + '.values: Strecke über Hindernis kürzer als Rollstrecke');
  }

  function shapeOk(node, axes, depth, nOut, max) {
    var i;
    if (depth === axes.length) {
      if (!Array.isArray(node) || node.length !== nOut) return false;
      for (i = 0; i < node.length; i++) if (!inOpenClosed(node[i], max)) return false;
      return true;
    }
    if (!Array.isArray(node) || node.length !== axes[depth].values.length) return false;
    for (i = 0; i < node.length; i++) if (!shapeOk(node[i], axes, depth + 1, nOut, max)) return false;
    return true;
  }

  function forEachIndex(dims, fn) {
    var total = 1, k;
    for (k = 0; k < dims.length; k++) total *= dims[k];
    var idx = dims.map(function () { return 0; });
    for (var n = 0; n < total; n++) {
      fn(idx.slice());
      for (k = dims.length - 1; k >= 0; k--) {
        idx[k]++;
        if (idx[k] < dims[k]) break;
        idx[k] = 0;
      }
    }
  }

  function cellAt(cells, idx) {
    var c = cells;
    for (var k = 0; k < idx.length; k++) c = c[idx[k]];
    return c;
  }

  function threeDecimals(v) { return Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6; }

  /* Korrekturen einer Phase. opt.ext: Schema 3; opt.point: die Tabelle ist ein Faustregel-Punkt (E8); opt.windAxis: die
     Tabelle hat eine Gegenwindachse (E2, dann keine Gegenwind-Regel). */
  function validateCorrections(list, unit, path, err, opt) {
    if (!Array.isArray(list)) { err(path + ' fehlt'); return; }
    var headwind = 0;
    var surfaces = {};
    var rules = { altitudeRule: 0, temperatureRule: 0 };
    list.forEach(function (c, n) {
      var p = path + '[' + n + ']';
      if (!isObj(c) || !inList(opt.ext ? CORRECTION_KINDS_EXT : CORRECTION_KINDS, c.kind)) { err(p + '.kind unbekannt'); return; }
      if (c.kind === 'headwind') {
        headwind++;
        if (opt.windAxis) err(p + ': Gegenwind steht in der Tabelle, keine Gegenwind-Regel erlaubt');
        if (c.unit !== 'kt') err(p + '.unit unbekannt');
        if (opt.ext && c.type === 'factorTable') { validateFactorTable(c, p, err); return; }
        if (!inRange(c.per, LIMITS.perKt)) err(p + '.per ausserhalb ' + LIMITS.perKt.join('–') + ' kt');
        if (c.type === 'percentPer') {
          // Gegenwind verkürzt: percent < 0, Betrag höchstens 100
          if (!inOpenClosed(isNum(c.percent) ? -c.percent : NaN, LIMITS.windPercentMax)) err(p + '.percent falsch');
        } else if (c.type === 'absolutePer') {
          if (!(isNum(c.amount) && c.amount < 0)) err(p + '.amount falsch');
          if (c.amountUnit !== unit) err(p + '.amountUnit nicht gleich der Tabelleneinheit');
          if (isNum(c.amount) && inRange(c.per, LIMITS.perKt) && !inOpenClosed(-c.amount / c.per, LIMITS.absolutePerKtMax)) err(p + '.amount je kt ausserhalb');
        } else {
          err(p + '.type unbekannt');
        }
      } else if (c.kind === 'surface') {
        if (!inList(opt.ext ? SURFACE_TYPES_EXT : SURFACE_TYPES, c.type)) err(p + '.type unbekannt');
        if (!isStr(c.surface)) err(p + '.surface fehlt');
        else if (surfaces[c.surface]) err(p + '.surface doppelt');
        else surfaces[c.surface] = true;
        if (!inList(SURFACE_CONDITIONS, c.surfaceCondition)) err(p + '.surfaceCondition unbekannt');
        if (!inOpenClosed(c.percent, LIMITS.surfacePercentMax)) err(p + '.percent ausserhalb 0–' + LIMITS.surfacePercentMax + ' %');
        // percentOfEach (E5) gilt für jede Strecke für sich: ohne «of»
        if (opt.ext && c.type === 'percentOfEach') {
          if (c.of !== undefined) err(p + '.of bei percentOfEach nicht erlaubt');
        } else if (c.of !== 'groundRoll') {
          err(p + '.of unbekannt');
        }
        if (c.minimum !== undefined) {
          if (!opt.ext) err(p + '.minimum nur ab Schema 3');
          else if (typeof c.minimum !== 'boolean') err(p + '.minimum unbekannt');
        }
      } else if (c.kind === 'factor') {
        if (!inList(FACTOR_WHEN, c.when)) err(p + '.when unbekannt');
        if (!(isNum(c.factor) && c.factor > 1 && c.factor <= LIMITS.factorMax && threeDecimals(c.factor))) err(p + '.factor ausserhalb (1, ' + LIMITS.factorMax + '] oder mehr als drei Dezimalen');
        if (typeof c.minimum !== 'boolean') err(p + '.minimum fehlt');
        if (!isStr(c.labelDe) || !isStr(c.refDe)) err(p + '.labelDe oder refDe fehlt');
        if (c.when === 'wet' && !isStr(c.surface)) err(p + '.surface fehlt');
        if (c.when === 'always' && c.surface !== undefined) err(p + '.surface bei «always» nicht erlaubt');
      } else {
        // Faustregel (E8): nur zum Faustregel-Punkt
        rules[c.kind]++;
        if (!opt.point) err(p + ': Faustregel nur mit Punkt-Tabelle');
        if (c.kind === 'altitudeRule') {
          if (!inOpenClosed(c.percentPer1000ft, LIMITS.rulePercentMax)) err(p + '.percentPer1000ft ausserhalb 0–' + LIMITS.rulePercentMax + ' %');
        } else {
          if (!inOpenClosed(c.percentPer10C, LIMITS.rulePercentMax)) err(p + '.percentPer10C ausserhalb 0–' + LIMITS.rulePercentMax + ' %');
          if (c.reference !== 'isa') err(p + '.reference unbekannt');
        }
        if (!isStr(c.labelDe) || !isStr(c.refDe)) err(p + '.labelDe oder refDe fehlt');
      }
    });
    if (headwind > 1) err(path + ': Gegenwind-Regel doppelt');
    if (rules.altitudeRule > 1 || rules.temperatureRule > 1) err(path + ': Faustregel doppelt');
    if (opt.point && (rules.altitudeRule < 1 || rules.temperatureRule < 1)) err(path + ': Punkt-Tabelle verlangt altitudeRule und temperatureRule');
  }

  /* Gegenwind-Faktortabelle (E4): Punkte [kt, Faktor], der erste [0, 1], kt streng steigend, Faktoren in (0, 1] nicht
     steigend mit höchstens drei Dezimalen; über dem letzten Punkt dessen Faktor (above «highest»). */
  function validateFactorTable(c, p, err) {
    if (c.above !== 'highest') err(p + '.above unbekannt');
    var pts = c.points;
    if (!Array.isArray(pts) || pts.length < 2) { err(p + '.points falsch'); return; }
    for (var i = 0; i < pts.length; i++) {
      var q = pts[i];
      var ok = Array.isArray(q) && q.length === 2 && inRange(q[0], LIMITS.windTableKt) &&
        isNum(q[1]) && q[1] > 0 && q[1] <= 1 && threeDecimals(q[1]);
      if (ok && i === 0) ok = q[0] === 0 && q[1] === 1;
      if (ok && i > 0) ok = q[0] > pts[i - 1][0] && q[1] <= pts[i - 1][1];
      if (!ok) { err(p + '.points[' + i + '] falsch'); return; }
    }
  }

  /* Weitere Tabellen für tiefere Gewichte (charts.<Phase>.lowerWeights, optional; bei der Landung nur ab Schema 3).
     Die Haupttabelle (charts.<Phase>.table) gilt für das Höchstgewicht der Phase (mass, bei der Landung massLanding,
     sonst mass). Die weiteren Tabellen stehen absteigend nach Gewicht, alle darunter, mit denselben Achsen, Ausgaben und
     derselben Einheit, und sind in keiner Zelle länger als die nächstschwerere Tabelle. Nur dann ist die Ablesung
     «Tabelle für das nächsthöhere Gewicht» konservativ und die Strecke steigt mit dem Gewicht (auch interpoliert). Jede
     Tabelle nennt ihre Quelle (ref.figure und ref.page, nicht leer; der Rechenweg zeigt sie für die gewählte Tabelle)
     und hat einen Titel (title, Zeichenkette). Nicht zum Faustregel-Punkt. */
  function validateLowerWeights(ch, ph, mass, path, err, ext) {
    var list = ch.lowerWeights;
    if (list === undefined) return;
    var p = path + '.lowerWeights';
    if (ph !== 'takeoff' && !ext) { err(p + ' nur beim Start erlaubt'); return; }
    if (isPoint(ch.table)) { err(p + ' bei Punkt-Tabelle nicht erlaubt'); return; }
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_LOWER_WEIGHTS) { err(p + ' falsch'); return; }
    if (!isObj(mass) || !isNum(mass.kg) || !isNum(mass.lb)) return;     // «mass unbekannt» ist schon gemeldet
    var prevKg = mass.kg, prevLb = mass.lb, prevTable = ch.table;
    for (var i = 0; i < list.length; i++) {
      var e = list[i], q = p + '[' + i + ']';
      if (!isObj(e) || !isObj(e.mass) || !(isNum(e.mass.kg) && e.mass.kg > 0) || !(isNum(e.mass.lb) && e.mass.lb > 0)) { err(q + '.mass unbekannt'); return; }
      if (!(e.mass.kg < prevKg) || !(e.mass.lb < prevLb)) { err(q + '.mass nicht absteigend unter dem Höchstgewicht'); return; }
      if (Math.abs(e.mass.lb * LB_KG - e.mass.kg) > MASS_TOL_KG) err(q + '.mass: kg und lb passen nicht zusammen');
      if (!isObj(e.ref) || !isStr(e.ref.figure) || !isStr(e.ref.page)) err(q + '.ref fehlt');
      if (typeof e.title !== 'string') err(q + '.title fehlt');
      var bad = false;
      validateTable(e.table, q + '.table', function (m) { bad = true; err(m); }, ext);
      if (bad) return;
      if (JSON.stringify(e.table.axes) !== JSON.stringify(ch.table.axes) || JSON.stringify(e.table.outputs) !== JSON.stringify(ch.table.outputs)) {
        err(q + '.table: Achsen oder Ausgaben anders als in der Haupttabelle');
        return;
      }
      var dims = e.table.axes.map(function (ax) { return ax.values.length; });
      var longer = false;
      forEachIndex(dims, function (idx) {
        var lo = cellAt(e.table.cells, idx), hi = cellAt(prevTable.cells, idx);
        for (var o = 0; o < lo.length; o++) if (!(lo[o] <= hi[o])) longer = true;
      });
      if (longer) { err(q + '.table.cells: länger als die nächstschwerere Tabelle'); return; }
      prevKg = e.mass.kg; prevLb = e.mass.lb; prevTable = e.table;
    }
  }

  // Text einer Ausnahme; wirft selbst nie (auch nicht bei einer Ausnahme mit Fallen)
  function errText(e) {
    try { return String(e && e.message || e); } catch (e2) { return 'unbekannter Fehler'; }
  }

  // Die Prüfungen werfen nie: auch ein Objekt mit Fallen (Getter, die werfen) ergibt nur «bad-data».
  function safeValidate(fn, obj, what) {
    try {
      return fn(obj);
    } catch (e) {
      return { ok: false, errors: [what + ' nicht lesbar: ' + errText(e)] };
    }
  }
  function validateAircraft(ac) { return safeValidate(validateAircraftUnsafe, ac, 'Flugzeugdaten'); }
  function validateAirfield(af) { return safeValidate(validateAirfieldUnsafe, af, 'Platzdaten'); }

  function validateAircraftUnsafe(ac) {
    var errors = [];
    function err(m) { errors.push(m); }
    if (!isObj(ac)) return { ok: false, errors: ['Flugzeugdaten fehlen'] };
    var schema = ac.schema;
    var ext = schema === SCHEMA_EXT;
    if (!inList(SCHEMAS, schema)) err('schema unbekannt');
    if (!isStr(ac.id)) err('id fehlt');
    if (!isStr(ac.label)) err('label fehlt');
    if (!isObj(ac.mass) || !(isNum(ac.mass.kg) && ac.mass.kg > 0) || !(isNum(ac.mass.lb) && ac.mass.lb > 0)) err('mass unbekannt');
    var massL = validateMassLanding(ac, ext, err);
    if (!isObj(ac.sources)) err('sources fehlt');
    if (!isObj(ac.charts)) {
      err('charts fehlt');
    } else {
      PHASES.forEach(function (ph) {
        var ch = ac.charts[ph];
        var p = 'charts.' + ph;
        if (!isObj(ch)) { err(p + ' fehlt'); return; }
        // Phase fehlt im AFM (E6): nur die Landung, nur ab Schema 3
        if (ch.absent !== undefined) {
          if (ext && ph === 'landing') { validateAbsent(ch, p, ac, err); return; }
          err(p + '.absent ' + (ext ? 'nur bei der Landung erlaubt' : 'nur ab Schema 3'));
        }
        if (!isStr(ch.source) || !isObj(ac.sources) || !has(ac.sources, ch.source) || !isObj(ac.sources[ch.source])) err(p + '.source unbekannt');
        if (!isObj(ch.base) || !isStr(ch.base.surface) || !inList(SURFACE_CONDITIONS, ch.base.surfaceCondition)) err(p + '.base unbekannt');
        var tableBad = false;
        validateTable(ch.table, p + '.table', function (m) { tableBad = true; err(m); }, ext);
        // Die Korrekturen werden genau einmal gelesen (wie in VERSION 7)
        var corr = ch.corrections;
        var t = ch.table;
        validateCorrections(corr, tableUnit(t), p + '.corrections', err,
          { ext: ext, point: ext && isPoint(t), windAxis: ext && hasAxis(t, 'headwind') });
        // Ist die Haupttabelle schon fehlerhaft, bleibt es bei deren Meldung (das Ergebnis ist ohnehin bad-data); ebenso
        // bei ungültigem maximalem Landegewicht (schon gemeldet)
        if (ph === 'landing' && !massL.known) return;
        var phMass = ph === 'landing' ? massL.mass : ac.mass;
        if (!tableBad) validateLowerWeights(ch, ph, phMass, p, err, ext);
        validateMassRead(ch, ph, phMass, p, err, ext);
      });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /* Maximales Landegewicht (E7, freiwillig, nur ab Schema 3): massLanding { kg, lb }, nicht über dem Höchstgewicht (mass),
     kg und lb höchstens 1 kg auseinander. Gibt { mass, known } zurück: mass = Gewicht, für das die Landetabelle gilt
     (massLanding, sonst mass); known false, wenn massLanding ungültig ist (dann prüft die Landung keine Tabellengewichte). */
  function validateMassLanding(ac, ext, err) {
    var ml = ac.massLanding;
    if (ml === undefined) return { mass: ac.mass, known: true };
    if (!ext) { err('massLanding nur ab Schema 3'); return { mass: ac.mass, known: true }; }
    if (!isObj(ml) || !(isNum(ml.kg) && ml.kg > 0) || !(isNum(ml.lb) && ml.lb > 0)) { err('massLanding unbekannt'); return { mass: null, known: false }; }
    var m = ac.mass;
    if (isObj(m) && isNum(m.kg) && isNum(m.lb) && (ml.kg > m.kg || ml.lb > m.lb)) err('massLanding über dem Höchstgewicht');
    if (Math.abs(ml.lb * LB_KG - ml.kg) > MASS_TOL_KG) err('massLanding: kg und lb passen nicht zusammen');
    return { mass: ml, known: true };
  }

  /* Landung fehlt im AFM (E6): { absent: true, reasonDe }. Beschreibende Felder (title, ref, notesDe …) sind erlaubt,
     Rechenfelder nicht; eine Quelle, wenn angegeben, muss es geben. Ohne Landung kein maximales Landegewicht. */
  function validateAbsent(ch, p, ac, err) {
    if (ch.absent !== true) err(p + '.absent unbekannt');
    if (!isStr(ch.reasonDe)) err(p + '.reasonDe fehlt');
    ABSENT_FORBIDDEN.forEach(function (k) {
      if (ch[k] !== undefined) err(p + '.' + k + ' bei fehlender Landung nicht erlaubt');
    });
    if (ch.source !== undefined && (!isStr(ch.source) || !isObj(ac.sources) || !has(ac.sources, ch.source) || !isObj(ac.sources[ch.source]))) err(p + '.source unbekannt');
    if (ac.massLanding !== undefined) err('massLanding bei fehlender Landung nicht erlaubt');
  }

  /* Ablesung über die Tabellen verschiedener Gewichte (charts.<Phase>.massRead, freiwillig): «nextHigher» oder «linear»;
     bei der Landung nur ab Schema 3. Bei «linear» sind alle Tabellengewichte ganze kg: «Start möglich bis …» wird auf
     ganze kg gesucht. */
  function validateMassRead(ch, ph, mass, path, err, ext) {
    if (ch.massRead === undefined) return;
    var p = path + '.massRead';
    if (ph !== 'takeoff' && !ext) { err(p + ' nur beim Start erlaubt'); return; }
    if (!inList(MASS_READS, ch.massRead)) { err(p + ' unbekannt'); return; }
    if (ch.massRead !== 'linear') return;
    var kgs = [isObj(mass) ? mass.kg : NaN];
    if (Array.isArray(ch.lowerWeights)) {
      ch.lowerWeights.forEach(function (e) { kgs.push(isObj(e) && isObj(e.mass) ? e.mass.kg : NaN); });
    }
    if (!kgs.every(function (k) { return isNum(k) && Math.floor(k) === k; })) err(p + ': Tabellengewichte nicht ganze kg');
  }

  function validateAirfieldUnsafe(af) {
    var errors = [];
    function err(m) { errors.push(m); }
    if (!isObj(af)) return { ok: false, errors: ['Platzdaten fehlen'] };
    if (af.schema !== SCHEMA) err('schema unbekannt');
    if (!isStr(af.icao)) err('icao fehlt');
    if (!isObj(af.elevation) || !inRange(af.elevation.value, LIMITS.elevationFt) || af.elevation.unit !== 'ft') err('elevation unbekannt');
    if (!Array.isArray(af.runways) || af.runways.length < 1) {
      err('runways fehlt');
    } else {
      var ids = {};
      af.runways.forEach(function (r, n) {
        var p = 'runways[' + n + ']';
        if (!isObj(r)) { err(p + ' fehlt'); return; }
        if (!isStr(r.id) || ids[r.id]) err(p + '.id fehlt oder doppelt');
        else ids[r.id] = true;
        if (!inRange(r.bearingTrue, LIMITS.bearingDeg)) err(p + '.bearingTrue falsch');
        if (r.bearingMag !== undefined && !inRange(r.bearingMag, LIMITS.bearingDeg)) err(p + '.bearingMag falsch');
        if (!isStr(r.surface)) err(p + '.surface fehlt');
        ['takeoffAvailable', 'landingAvailable'].forEach(function (k) {
          var v = r[k];
          if (!isObj(v) || !inRange(v.value, LIMITS.availableM) || v.unit !== 'm') err(p + '.' + k + ' unbekannt');
        });
      });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /* ── Eingaben ──────────────────────────────────────────────── */
  // { tempC, qnhHpa, windDirTrue (Grad rechtweisend, woher; null = unbestimmt), windKt (10-min-Mittel), runwayWet }
  function checkInput(input) {
    var bad = [];
    if (!isObj(input)) return [{ field: 'input', value: null }];
    ['tempC', 'qnhHpa', 'windDirTrue', 'windKt'].forEach(function (f) {
      var v = input[f];
      if (f === 'windDirTrue' && v === null) return;
      if (!inRange(v, INPUT_RANGES[f])) bad.push({ field: f, value: v });
    });
    if (typeof input.runwayWet !== 'boolean') bad.push({ field: 'runwayWet', value: input.runwayWet });
    // Abfluggewicht in kg, freiwillig: fehlt es (undefined oder null), gilt das Höchstgewicht
    if (input.massKg !== undefined && input.massKg !== null && !(isNum(input.massKg) && input.massKg > 0)) bad.push({ field: 'massKg', value: input.massKg });
    return bad;
  }

  /* ── Tabellenablesung ──────────────────────────────────────────
     Je Achse nach ihrer Regel (read); für beide Regeln gilt unter dem kleinsten Wert der kleinste (es wird nicht
     hochgerechnet), über dem grössten gibt es keinen Wert (Gegenwindachse: dessen Wert), genau auf einem Tabellenwert
     dieser.
     nextHigher: erster Wert ≥ Eingabe.
     linear:     zwischen zwei Tabellenwerten linear, mit demselben Gewicht für beide Ausgaben.
     Mehrere interpolierte Achsen der Reihe nach, die letzte Achse zuerst: bei Druckhöhe × Temperatur zuerst die
     Temperatur in beiden Höhenzeilen, dann die Höhe (gleiches Ergebnis wie bilinear).
     inputs: { pressureAltitude (ganze ft), temperature (°C), headwind (kt, nur für eine Gegenwindachse) }. Eine
     Druckhöhenachse in m liest pressureAltitudeM(ft), eine Achse temperatureDeviation T − Std(Druckhöhe).
     corners: die verwendeten Tabellenzellen (eine, zwei, vier …) mit ihren Achsenwerten, für den Rechenweg. */
  function lookupTable(table, inputs) {
    if (isPoint(table)) return lookupPoint(table, inputs);
    var axes = [], above = [];
    for (var k = 0; k < table.axes.length; k++) {
      var ax = table.axes[k];
      var src = axisInput(table, ax, inputs);
      if (src.missing) return { ok: false, above: [], missing: ax.quantity };
      if (src.skip) continue;                   // Temperaturabweichung bei Druckhöhe über der Tabelle: die Druckhöhe meldet es
      var v = src.v;
      var vals = ax.values;
      var last = vals.length - 1;
      if (v > vals[last]) {
        if (ax.above === 'highest') {
          // Gegenwindachse: über dem grössten Tabellenwind dessen Wert (die Strecke fällt mit dem Wind, das ist konservativ)
          axes.push({ quantity: ax.quantity, read: ax.read, input: v, index: last, value: vals[last], belowLowest: false, interpolated: false, unit: ax.unit, aboveHighest: true });
          continue;
        }
        var ab = { quantity: ax.quantity, unit: ax.unit, value: v, max: vals[last] };
        if (src.std) { ab.tempC = src.std.tempC; ab.stdTempC = src.std.stdTempC; ab.maxTempC = src.std.stdTempC + vals[last]; }
        above.push(ab);
        continue;
      }
      var j = 0;
      while (vals[j] < v) j++;                  // erster Wert ≥ Eingabe (unter dem kleinsten: 0)
      var a = { quantity: ax.quantity, read: ax.read, input: v, index: j, value: vals[j], belowLowest: v < vals[0], interpolated: false };
      if (ax.read === 'linear' && v > vals[0] && vals[j] !== v) {
        a.interpolated = true;
        a.lowerIndex = j - 1;
        a.lower = vals[j - 1];
        a.upper = vals[j];
        a.num = v - vals[j - 1];                // Gewicht = num / den
        a.den = vals[j] - vals[j - 1];
        a.weight = a.num / a.den;
      }
      a.unit = ax.unit;
      if (ax.quantity === 'headwind') a.aboveHighest = false;
      if (src.std) a.std = src.std;
      axes.push(a);
    }
    if (above.length) return { ok: false, above: above };
    var nOut = table.outputs.length;
    // Wert an der Eingabe ab Achse k im Teilbaum node; untere vor oberer Zelle, damit corners geordnet ist
    function valueAt(node, k) {
      if (k === axes.length) return node.slice(0, nOut);
      var a = axes[k];
      if (!a.interpolated) return valueAt(node[a.index], k + 1);
      var lo = valueAt(node[a.lowerIndex], k + 1);
      var hi = valueAt(node[a.index], k + 1);
      // a + (v − a0)·(b − a)/(a1 − a0): erst multiplizieren, dann teilen
      return lo.map(function (x, n) { return x + a.num * (hi[n] - x) / a.den; });
    }
    var raw = valueAt(table.cells, 0);
    var values = {};
    table.outputs.forEach(function (o, n) { values[o.id] = raw[n]; });
    // Ecken: je interpolierter Achse untere und obere Zelle, sonst die gewählte
    var corners = [{ indices: [], axisValues: [] }];
    axes.forEach(function (a) {
      var next = [];
      corners.forEach(function (c) {
        var picks = a.interpolated ? [[a.lowerIndex, a.lower], [a.index, a.upper]] : [[a.index, a.value]];
        picks.forEach(function (pk) {
          next.push({ indices: c.indices.concat([pk[0]]), axisValues: c.axisValues.concat([pk[1]]) });
        });
      });
      corners = next;
    });
    corners.forEach(function (c) {
      var cell = cellAt(table.cells, c.indices);
      c.values = {};
      table.outputs.forEach(function (o, n) { c.values[o.id] = cell[n]; });
    });
    var idx = axes.map(function (a) { return a.index; });
    return {
      ok: true, axes: axes, values: values, corners: corners,
      interpolated: axes.some(function (a) { return a.interpolated; }),
      indices: idx, axisValues: axes.map(function (a) { return a.value; }), quantities: axes.map(function (a) { return a.quantity; })
    };
  }

  // Eingabe einer Achse: { v } oder { missing: true } oder { skip: true } (Temperaturabweichung, wenn die Druckhöhe über
  // der Tabelle liegt: dann meldet nur die Druckhöhe «über dem Bereich»). Bei der Temperaturabweichung zusätzlich std.
  function axisInput(table, ax, inputs) {
    var q = ax.quantity;
    if (q === 'pressureAltitude') return paInput(ax, inputs);
    if (q === 'temperature' || q === 'headwind') return isNum(inputs[q]) ? { v: inputs[q] } : { missing: true };
    if (q === 'temperatureDeviation') {
      var paAx = findAxis(table, 'pressureAltitude');
      if (!paAx || !isNum(inputs.temperature)) return { missing: true };
      var pa = paInput(paAx, inputs);
      if (pa.missing) return pa;
      var st = stdTempAt(paAx, ax.stdTempC, pa.v);
      if (!st) return { skip: true };
      st.tempC = inputs.temperature;
      return { v: inputs.temperature - st.stdTempC, std: st };
    }
    return { missing: true };
  }

  // Druckhöhe für eine Achse: ganze ft, bei einer Achse in m pressureAltitudeM (E1)
  function paInput(ax, inputs) {
    var ft = inputs.pressureAltitude;
    if (!isNum(ft)) return { missing: true };
    return { v: ax.unit === 'm' ? pressureAltitudeM(ft) : ft };
  }

  /* Standardtemperatur der Tabelle auf der Druckhöhe pa (E3, in der Einheit der Druckhöhenachse): gelesen wie die
     Druckhöhenachse. «linear»: zwischen zwei Zeilen linear (erst multiplizieren, dann teilen); «nextHigher»: der Wert der
     Zeile, die abgelesen wird. Unter der tiefsten Zeile deren Wert; über der höchsten null (kein Wert). */
  function stdTempAt(paAx, std, pa) {
    var vals = paAx.values, last = vals.length - 1;
    if (pa > vals[last]) return null;
    var j = 0;
    while (vals[j] < pa) j++;
    var r = {
      tempC: null, stdTempC: std[j], pressureAltitude: pa, unit: paAx.unit, read: paAx.read,
      belowLowest: pa < vals[0], interpolated: false, index: j, value: vals[j],
      lowerIndex: null, lower: null, upper: null, lowerStdC: null, upperStdC: null, num: null, den: null, weight: null
    };
    if (paAx.read === 'linear' && pa > vals[0] && vals[j] !== pa) {
      r.interpolated = true;
      r.lowerIndex = j - 1;
      r.lower = vals[j - 1];
      r.upper = vals[j];
      r.lowerStdC = std[j - 1];
      r.upperStdC = std[j];
      r.num = pa - vals[j - 1];
      r.den = vals[j] - vals[j - 1];
      r.weight = r.num / r.den;
      r.stdTempC = std[j - 1] + r.num * (std[j] - std[j - 1]) / r.den;
    }
    return r;
  }

  // Ablesung des Faustregel-Punkts (E8): der Tabellenwert selbst; über POINT_MAX_PA_FT kein Wert
  function lookupPoint(table, inputs) {
    var pa = inputs.pressureAltitude;
    if (!isNum(pa)) return { ok: false, above: [], missing: 'pressureAltitude' };
    if (pa > POINT_MAX_PA_FT) return { ok: false, above: [{ quantity: 'pressureAltitude', unit: 'ft', value: pa, max: POINT_MAX_PA_FT }] };
    var values = {}, cv = {};
    table.outputs.forEach(function (o, n) { values[o.id] = table.values[n]; cv[o.id] = table.values[n]; });
    return {
      ok: true, point: true, conditions: { pressureAltitudeFt: POINT_PA_FT, temperatureC: POINT_TEMP_C },
      axes: [], values: values, corners: [{ indices: [], axisValues: [], values: cv }],
      interpolated: false, indices: [], axisValues: [], quantities: []
    };
  }

  /* ── Pistenwahl aus dem Mittelwind ─────────────────────────── */
  function windForRunway(inp, bearingTrue) {
    if (inp.windKt < CALM_BELOW_KT) return { mode: 'calm', along: null, componentKt: null, kind: 'none', kt: 0, computed: true, reason: null };
    if (inp.windDirTrue === null) {
      if (inp.windKt <= NODIR_MAX_KT) return { mode: 'nodir', along: null, componentKt: null, kind: 'none', kt: 0, computed: true, reason: null };
      return { mode: 'no-direction', along: null, componentKt: null, kind: 'none', kt: 0, computed: false, reason: 'no-direction' };
    }
    var along = Math.round(Math.cos((inp.windDirTrue - bearingTrue) * Math.PI / 180) * 1e9) / 1e9;
    if (along === 0) along = 0;                 // −0 vermeiden
    if (along < 0) {
      return { mode: 'dir', along: along, componentKt: inp.windKt * -along, kind: 'tailwind', kt: 0, computed: false, reason: 'tailwind' };
    }
    var comp = inp.windKt * along;
    var kt = Math.max(0, Math.floor(comp + EPS));
    return { mode: 'dir', along: along, componentKt: comp, kind: kt > 0 ? 'headwind' : 'none', kt: kt, computed: true, reason: null };
  }

  function findRule(list, kind) {
    for (var i = 0; i < list.length; i++) if (list[i].kind === kind) return list[i];
    return null;
  }

  function findSurfaceRule(list, surface) {
    for (var i = 0; i < list.length; i++) if (list[i].kind === 'surface' && list[i].surface === surface) return list[i];
    return null;
  }

  // Ergebnis des Winds einer Phase (Grundform: kein Wind angerechnet)
  function windBase(kt) {
    return {
      kt: kt, applied: false, type: null, percent: null, perKt: null, per: null, reduction: null, noRule: false,
      inTable: false, factor: null, factorRaw: null, points: null, aboveHighest: false
    };
  }

  /* Gegenwind-Faktortabelle (E4) bei kt > 0: linear zwischen den Punkten (in Tausendsteln, erst multiplizieren, dann
     teilen), auf ganze Tausendstel aufgerundet (zur längeren Strecke); über dem letzten Punkt dessen Faktor.
     points: die verwendeten Punkte (einer oder zwei). */
  function windFactor(points, kt) {
    var last = points.length - 1;
    if (kt >= points[last][0]) {
      return { f1000: Math.round(points[last][1] * 1000), raw: points[last][1], points: [points[last].slice()], aboveHighest: kt > points[last][0] };
    }
    var j = 0;
    while (points[j][0] < kt) j++;
    if (points[j][0] === kt) return { f1000: Math.round(points[j][1] * 1000), raw: points[j][1], points: [points[j].slice()], aboveHighest: false };
    var a = points[j - 1], b = points[j];
    var a1000 = Math.round(a[1] * 1000), b1000 = Math.round(b[1] * 1000);
    var raw1000 = a1000 + (kt - a[0]) * (b1000 - a1000) / (b[0] - a[0]);
    return { f1000: Math.ceil(raw1000 - EPS), raw: raw1000 / 1000, points: [a.slice(), b.slice()], aboveHighest: false };
  }

  /* Faustregel (E8) auf die Werte des Punkts: zuerst Druckhöhe, dann Temperatur. Keine Gutschrift unter 0 ft (auch die
     ISA-Temperatur wird mit höchstens 15 °C gerechnet) und keine unter ISA. ctx: { paTableFt, tempC }. */
  function applyRules(list, gr, ob, ctx) {
    if (!ctx || !isNum(ctx.paTableFt) || !isNum(ctx.tempC)) throw new Error('Faustregel ohne Druckhöhe oder Temperatur');
    var alt = findRule(list, 'altitudeRule'), tmp = findRule(list, 'temperatureRule');
    if (!alt || !tmp) throw new Error('Faustregel fehlt');
    var paC = Math.max(0, ctx.paTableFt);
    var a100k = 100000 + alt.percentPer1000ft * paC;            // Faktor × 100000
    var g1 = gr * a100k / 100000, o1 = ob * a100k / 100000;
    var isa = isaTempC(paC);
    var dT = Math.max(0, ctx.tempC - isa);
    var t1k = 1000 + tmp.percentPer10C * dT;                     // Faktor × 1000
    var g2 = g1 * t1k / 1000, o2 = o1 * t1k / 1000;
    return {
      groundRoll: g2, overObstacle: o2,
      rules: [
        { kind: 'altitudeRule', percentPer1000ft: alt.percentPer1000ft, pressureAltitudeFt: ctx.paTableFt, creditedFt: paC,
          factor: a100k / 100000, labelDe: alt.labelDe, refDe: alt.refDe, after: { groundRoll: g1, overObstacle: o1 } },
        { kind: 'temperatureRule', percentPer10C: tmp.percentPer10C, reference: tmp.reference, tempC: ctx.tempC, isaC: isa,
          aboveIsaC: dT, factor: t1k / 1000, labelDe: tmp.labelDe, refDe: tmp.refDe, after: { groundRoll: g2, overObstacle: o2 } }
      ]
    };
  }

  /* ── Eine Phase (Start oder Landung) auf einer Piste, in der Tabelleneinheit ──
     ctx: { paTableFt, tempC }, nur für die Faustregel (E8) nötig. */
  function computePhase(chart, lk, rwy, wind, runwayWet, availableM, ctx) {
    var unit = tableUnit(chart.table);
    var gr = lk.values.groundRoll, ob = lk.values.overObstacle;
    var inTable = hasAxis(chart.table, 'headwind');
    var res = {
      ok: false, reason: null, limitKt: null, unit: unit, availableM: availableM,
      lookup: lk, table: { groundRoll: gr, overObstacle: ob },
      rules: [], ruleOfThumb: false, afterRules: null,
      wind: windBase(wind.kt),
      afterWind: null, surface: null, factors: [], wetFactorMissing: false,
      final: null, meters: null, m: null, exceeds: null
    };
    function none(reason, limitKt) {
      res.reason = reason;
      if (limitKt !== undefined) res.limitKt = limitKt;
      return res;
    }
    // Faustregel (E8) direkt nach dem Tabellenwert; alles Weitere rechnet ab diesen Werten
    if (isPoint(chart.table)) {
      var rr = applyRules(chart.corrections, gr, ob, ctx);
      res.ruleOfThumb = true;
      res.rules = rr.rules;
      gr = rr.groundRoll;
      ob = rr.overObstacle;
    }
    res.afterRules = { groundRoll: gr, overObstacle: ob };
    var kt = wind.kt;
    if (inTable) {
      // Gegenwind steht in der Tabelle (E2): schon abgelesen, keine Korrektur und keine 50-%-Grenze
      res.wind.inTable = true;
      (lk.axes || []).forEach(function (a) { if (a.quantity === 'headwind' && a.aboveHighest === true) res.wind.aboveHighest = true; });
    }
    if (kt > MAX_HEADWIND_KT) return none('headwind-limit', MAX_HEADWIND_KT);
    var grW = gr, obW = ob;
    if (kt > 0 && !inTable) {
      var hw = findRule(chart.corrections, 'headwind');
      var w = res.wind;
      if (!hw) {
        w.noRule = true;                        // ohne Regel keine Gutschrift (konservativ)
      } else if (hw.type === 'percentPer') {
        var p = Math.floor(Math.abs(hw.percent) * kt / hw.per + EPS);
        grW = gr * (100 - p) / 100;
        obW = ob * (100 - p) / 100;
        w.applied = true; w.type = 'percentPer'; w.percent = p; w.per = hw.per;
      } else if (hw.type === 'factorTable') {
        var wf = windFactor(hw.points, kt);
        grW = gr * wf.f1000 / 1000;
        obW = ob * wf.f1000 / 1000;
        w.applied = true; w.type = 'factorTable'; w.factor = wf.f1000 / 1000; w.factorRaw = wf.raw; w.points = wf.points;
        w.aboveHighest = wf.aboveHighest;
      } else {
        var r = Math.floor(Math.abs(hw.amount) * kt / hw.per + EPS);
        grW = gr - r;
        obW = ob - r;
        w.applied = true; w.type = 'absolutePer'; w.perKt = Math.abs(hw.amount); w.per = hw.per; w.reduction = r;
      }
      // Verkürzt der Wind eine der beiden Strecken um mehr als die Hälfte: kein Wert (genau 50 % erlaubt)
      if (gr - grW > MAX_WIND_CREDIT * gr + EPS || ob - obW > MAX_WIND_CREDIT * ob + EPS) return none('wind-credit-limit');
    }
    res.afterWind = { groundRoll: grW, overObstacle: obW };
    // Belag: addPercentOf = Prozent der (interpolierten) Tabellen-Rollstrecke nach den Faustregeln auf beide Strecken;
    // percentOfEach (E5) = jede Strecke × (100 + Prozent) / 100
    var grS = grW, obS = obW;
    if (rwy.surface !== chart.base.surface) {
      var sr = findSurfaceRule(chart.corrections, rwy.surface);
      if (!sr) return none('no-surface-rule');
      if (sr.type === 'percentOfEach') {
        grS = grW * (100 + sr.percent) / 100;
        obS = obW * (100 + sr.percent) / 100;
        res.surface = {
          surface: sr.surface, type: 'percentOfEach', percent: sr.percent, minimum: sr.minimum === true, base: null, inc: null,
          factor: (100 + sr.percent) / 100, incEach: { groundRoll: grS - grW, overObstacle: obS - obW }, after: { groundRoll: grS, overObstacle: obS }
        };
      } else {
        var inc = sr.percent * gr / 100;
        grS = grW + inc;
        obS = obW + inc;
        res.surface = {
          surface: sr.surface, type: 'addPercentOf', percent: sr.percent, minimum: sr.minimum === true, base: gr, inc: inc,
          factor: null, incEach: { groundRoll: inc, overObstacle: inc }, after: { groundRoll: grS, overObstacle: obS }
        };
      }
    }
    var grF = grS, obF = obS;
    // Faktoren in der Reihenfolge der Datei: «always» immer, «wet» nur auf nasser Piste mit passendem Belag
    chart.corrections.forEach(function (c) {
      if (c.kind !== 'factor') return;
      var applies = c.when === 'always' || (c.when === 'wet' && runwayWet === true && rwy.surface === c.surface);
      if (!applies) return;
      var f1000 = Math.round(c.factor * 1000);
      grF = grF * f1000 / 1000;
      obF = obF * f1000 / 1000;
      res.factors.push({ factor: c.factor, when: c.when, minimum: c.minimum, labelDe: c.labelDe, refDe: c.refDe, after: { groundRoll: grF, overObstacle: obF } });
    });
    res.wetFactorMissing = runwayWet === true && !res.factors.some(function (f) { return f.when === 'wet'; });
    var grM = unit === 'ft' ? grF * 3048 / 10000 : grF;
    var obM = unit === 'ft' ? obF * 3048 / 10000 : obF;
    var mGr = ceilMeters(grM);
    var mOb = ceilMeters(obM);
    // Schlussprobe
    if (!(isNum(grF) && isNum(obF) && grF > 0 && obF > 0 && obF >= grF &&
          isNum(mGr) && isNum(mOb) && mGr > 0 && mOb >= mGr)) return none('internal');
    res.final = { groundRoll: grF, overObstacle: obF };
    res.meters = { groundRoll: grM, overObstacle: obM };
    res.m = { groundRoll: mGr, overObstacle: mOb };
    res.exceeds = { groundRoll: mGr > availableM, overObstacle: mOb > availableM };
    res.ok = true;
    return res;
  }

  // Landung fehlt im AFM (E6): kein Wert, gleiche Felder wie eine Phase ohne Wert
  function absentPhase(ch, availableM) {
    return {
      ok: false, reason: 'not-in-afm', absent: true, reasonDe: ch.reasonDe, limitKt: null, unit: null, availableM: availableM,
      lookup: null, table: null, rules: [], ruleOfThumb: false, afterRules: null, wind: null, afterWind: null, surface: null,
      factors: [], wetFactorMissing: false, final: null, meters: null, m: null, exceeds: null
    };
  }

  /* ── Gewicht: Tabellen je Phase und «Start möglich bis» ──── */
  // Maximales Landegewicht (E7): massLanding, sonst mass
  function landingMass(aircraft) { return aircraft.massLanding !== undefined ? aircraft.massLanding : aircraft.mass; }

  // Tabellen einer Phase absteigend nach Gewicht: zuerst die Haupttabelle (Höchstgewicht der Phase), dann lowerWeights.
  // Fehlt die Landung (E6): keine Tabelle.
  function phaseTables(aircraft, ph) {
    var ch = aircraft.charts[ph];
    if (ph === 'landing' && isAbsent(ch)) return [];
    var m = ph === 'landing' ? landingMass(aircraft) : aircraft.mass;
    var list = [{ kg: m.kg, lb: m.lb, table: ch.table, ref: ch.ref, title: ch.title }];
    (ch.lowerWeights || []).forEach(function (e) {
      list.push({ kg: e.mass.kg, lb: e.mass.lb, table: e.table, ref: e.ref, title: e.title });
    });
    return list;
  }
  function takeoffTables(aircraft) { return phaseTables(aircraft, 'takeoff'); }
  function landingTables(aircraft) { return phaseTables(aircraft, 'landing'); }

  // Tabelle für das nächsthöhere Gewicht: die leichteste Tabelle mit Gewicht ≥ Eingabe. Unter der leichtesten Tabelle
  // gilt diese (es wird nicht hochgerechnet), ohne Eingabe die schwerste. Gewichte über dem Höchstgewicht fängt compute ab.
  function pickTakeoffTable(tables, massKg) {
    var idx = 0;
    if (massKg !== null) for (var i = 0; i < tables.length; i++) if (tables[i].kg >= massKg) idx = i;
    return idx;
  }

  // Ablesung über die Tabellen einer Phase: «linear» nur mit ausdrücklicher Angabe in den Daten
  function massReadOf(aircraft, ph) { return aircraft.charts[ph || 'takeoff'].massRead === 'linear' ? 'linear' : 'nextHigher'; }

  /* Tabelle(n) für ein Gewicht: upper = Tabelle für das nächsthöhere Gewicht (wie pickTakeoffTable). Bei «linear»
     und einem Gewicht echt zwischen zwei Tabellen zusätzlich lower = die nächstleichtere Tabelle und das Gewicht
     dazwischen (num / den, in kg). Auf einer Tabelle, unter der leichtesten und ohne Eingabe: nur upper. */
  function massBracket(tables, massKg, read) {
    var hi = pickTakeoffTable(tables, massKg);
    var res = { upper: hi, lower: null, num: null, den: null, weight: null };
    if (read === 'linear' && massKg !== null && hi < tables.length - 1 && tables[hi].kg > massKg) {
      res.lower = hi + 1;                       // tables[hi + 1].kg < massKg, sonst wäre hi + 1 gewählt
      res.num = massKg - tables[hi + 1].kg;
      res.den = tables[hi].kg - tables[hi + 1].kg;
      res.weight = res.num / res.den;
    }
    return res;
  }

  // Für die Anzeige: Starttabelle(n) eines Musters für ein Gewicht (null = Höchstgewicht), wie compute sie wählt
  function takeoffMassBracket(aircraft, massKg) {
    return massBracket(takeoffTables(aircraft), massKg === undefined ? null : massKg, massReadOf(aircraft, 'takeoff'));
  }

  /* Landegewicht (E7): die Eingabe, höchstens das maximale Landegewicht; ohne Eingabe dieses. Mit nur einer Landetabelle
     (ohne lowerWeights) wie VERSION 7 immer das maximale Landegewicht. capped: die Eingabe liegt darüber (nur bei mehreren
     Landetabellen). bracketKg: Gewicht für die Wahl der Landetabelle (null = maximales Landegewicht). */
  function landingUse(aircraft, massKg, tableCount) {
    var ml = landingMass(aircraft);
    if (massKg === null || tableCount < 2) return { kg: ml.kg, capped: false, bracketKg: null };
    var capped = massKg > ml.kg;
    return { kg: capped ? ml.kg : massKg, capped: capped, bracketKg: capped ? ml.kg : massKg };
  }

  // Für die Anzeige: Landetabelle(n) für ein Gewicht (null = maximales Landegewicht); null, wenn die Landung fehlt
  function landingMassBracket(aircraft, massKg) {
    if (isAbsent(aircraft.charts.landing)) return null;
    var tables = landingTables(aircraft);
    var u = landingUse(aircraft, massKg === undefined ? null : massKg, tables.length);
    return massBracket(tables, u.bracketKg, massReadOf(aircraft, 'landing'));
  }

  /* Ablesung für ein Gewicht: ohne lower die Tabelle upper, sonst beide Tabellen gleich abgelesen und dazwischen linear
     im Gewicht (erst multiplizieren, dann teilen). Achsen und Ausgaben sind in allen Tabellen einer Phase gleich
     (validateLowerWeights), ein Wert über dem Tabellenbereich trifft also beide. */
  function massLookup(tables, br, axisInputs) {
    var hi = lookupTable(tables[br.upper].table, axisInputs);
    if (br.lower === null || !hi.ok) return hi;
    var lo = lookupTable(tables[br.lower].table, axisInputs);
    if (!lo.ok) return lo;
    var values = {};
    Object.keys(hi.values).forEach(function (k) {
      values[k] = lo.values[k] + br.num * (hi.values[k] - lo.values[k]) / br.den;
    });
    return {
      ok: true, axes: hi.axes, values: values, corners: hi.corners, interpolated: true,
      indices: hi.indices, axisValues: hi.axisValues, quantities: hi.quantities,
      mass: {
        kg: tables[br.lower].kg + br.num, upperKg: tables[br.upper].kg, lowerKg: tables[br.lower].kg,
        num: br.num, den: br.den, weight: br.weight, upper: hi, lower: lo
      }
    };
  }

  // Chart mit einer anderen Tabelle, sonst gleich (Quelle, Belag der Tabelle, Korrekturen); die Daten bleiben unverändert
  function chartWithTable(chart, table) {
    return { source: chart.source, base: chart.base, corrections: chart.corrections, table: table };
  }

  /* «Start möglich» heisst: Wert vorhanden, Rollstrecke und Strecke über 15 m ≤ verfügbare Startstrecke.
     list: Ergebnis je Starttabelle (absteigend nach Gewicht), ti: Index der gewählten Tabelle.
     state: 'possible'    mit der gewählten Tabelle möglich
            'no-value'    die gewählte Tabelle ergibt keinen Wert: keine Aussage
            'limit'       nicht möglich, aber mit einer leichteren Tabelle: maxKg
            'wet-unknown' wie 'limit', aber die Piste ist nass und das AFM nennt keinen Nässewert: keine Aussage «möglich»
            'none'        auch mit der leichtesten Tabelle nicht möglich (lightestKg)
            'lowest'      nicht möglich, und es gibt keine leichtere Tabelle
            'unknown'     nicht möglich, und eine leichtere Tabelle ergibt keinen Wert, keine ist möglich
     maxPossibleKg: schwerste Tabelle überhaupt, mit der der Start möglich ist. null, wenn keine möglich ist, und null
     ohne Aussage, wenn dieses «möglich» bei nasser Piste ohne Nässewert des AFM gerechnet ist (wetFactorMissing; so bei
     'wet-unknown' und bei 'possible' auf nasser Piste ohne Nässewert). */
  function takeoffLimit(list, ti) {
    var cur = list[ti];
    var res = { state: 'no-value', tableKg: cur.kg, maxKg: null, lightestKg: list[list.length - 1].kg, maxPossibleKg: null };
    for (var k = 0; k < list.length; k++) {
      if (list[k].possible) { res.maxPossibleKg = list[k].wetFactorMissing ? null : list[k].kg; break; }
    }
    if (!cur.ok) return res;
    if (cur.possible) { res.state = 'possible'; return res; }
    if (ti === list.length - 1) { res.state = 'lowest'; return res; }
    var noValue = false;
    for (var i = ti + 1; i < list.length; i++) {
      if (!list[i].ok) { noValue = true; continue; }
      if (list[i].possible) {
        if (list[i].wetFactorMissing) { res.state = 'wet-unknown'; return res; }
        res.state = 'limit';
        res.maxKg = list[i].kg;
        return res;
      }
    }
    res.state = noValue ? 'unknown' : 'none';
    return res;
  }

  /* «Start möglich bis …» bei massRead «linear», auf ganze kg. m: Gewicht der Rechnung (Eingabe, sonst Höchstgewicht),
     cur: Start mit m, at(kg): Start mit kg (gleiche Kette). Gesucht wird von unter m abwärts bis zur leichtesten
     Tabelle; darunter gilt deren Wert, eine Suche brächte nichts. Zustände wie takeoffLimit:
     'possible', 'no-value', 'limit' (maxKg: schwerstes ganzes Gewicht unter m, mit dem der Start möglich ist),
     'wet-unknown', 'none' (auch mit lightestKg nicht), 'lowest' (m nicht über der leichtesten Tabelle),
     'unknown' (kein Gewicht möglich, ab noValueFromKg abwärts ergibt sich kein Wert).
     maxPossibleKg: schwerstes ganzes Gewicht bis zum Höchstgewicht, mit dem der Start möglich ist (null wie bei
     takeoffLimit, auch bei nasser Piste ohne Nässewert des AFM). */
  function takeoffLimitLinear(cur, m, maxKg, lightestKg, at) {
    var res = { state: 'no-value', tableKg: null, maxKg: null, lightestKg: lightestKg, maxPossibleKg: null, noValueFromKg: null };
    function possible(p) { return p.ok && !p.exceeds.groundRoll && !p.exceeds.overObstacle; }
    for (var k = maxKg; k >= lightestKg; k--) {
      var q = k === m ? cur : at(k);
      if (possible(q)) { res.maxPossibleKg = q.wetFactorMissing ? null : k; break; }
    }
    if (!cur.ok) return res;
    if (possible(cur)) { res.state = 'possible'; return res; }
    if (!(m > lightestKg)) { res.state = 'lowest'; return res; }
    for (var kg = Math.ceil(m) - 1; kg >= lightestKg; kg--) {
      var p = at(kg);
      if (!p.ok) {
        if (res.noValueFromKg === null) res.noValueFromKg = kg;
        continue;
      }
      if (possible(p)) {
        if (p.wetFactorMissing) { res.state = 'wet-unknown'; return res; }
        res.state = 'limit';
        res.maxKg = kg;
        return res;
      }
    }
    res.state = res.noValueFromKg !== null ? 'unknown' : 'none';
    return res;
  }

  // «über dem Tabellenbereich» je Grösse und Einheit zusammenfassen: das kleinste überschrittene Maximum (bei der
  // Temperaturabweichung der Eintrag mit der tiefsten höchsten Temperatur)
  function mergeAbove(list, a) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.quantity !== a.quantity || b.unit !== a.unit) continue;
      if (has(a, 'maxTempC')) {
        if (a.maxTempC < b.maxTempC) list[i] = copyAbove(a);
      } else if (a.max < b.max) {
        b.max = a.max;
      }
      return;
    }
    list.push(copyAbove(a));
  }
  function copyAbove(a) {
    var c = { quantity: a.quantity, unit: a.unit, value: a.value, max: a.max };
    if (has(a, 'maxTempC')) { c.tempC = a.tempC; c.stdTempC = a.stdTempC; c.maxTempC = a.maxTempC; }
    return c;
  }

  /* ── Hauptfunktion ─────────────────────────────────────────── */
  function compute(aircraft, airfield, input) {
    try {
      return computeUnsafe(aircraft, airfield, input);
    } catch (e) {
      return { ok: false, error: { code: 'internal', message: errText(e) } };
    }
  }

  function computeUnsafe(aircraft, airfield, input) {
    var va = validateAircraft(aircraft);
    var vf = validateAirfield(airfield);
    if (!va.ok || !vf.ok) return { ok: false, error: { code: 'bad-data', errors: va.errors.concat(vf.errors) } };
    var bad = checkInput(input);
    if (bad.length) return { ok: false, error: { code: 'invalid-input', fields: bad } };
    var inp = { tempC: input.tempC, qnhHpa: input.qnhHpa, windDirTrue: input.windDirTrue, windKt: input.windKt, runwayWet: input.runwayWet };
    var massKg = input.massKg === undefined || input.massKg === null ? null : input.massKg;
    if (massKg !== null && massKg > aircraft.mass.kg) {
      return { ok: false, error: { code: 'above-mass', massKg: massKg, maxKg: aircraft.mass.kg }, input: inp };
    }
    var tables = takeoffTables(aircraft);
    var read = massReadOf(aircraft, 'takeoff');
    var br = massBracket(tables, massKg, read);
    var ti = br.upper;
    var charts = { takeoff: chartWithTable(aircraft.charts.takeoff, tables[ti].table), landing: null };
    // Landung: fehlt sie (E6), keine; sonst Landegewicht und Landetabelle(n) (E7; mit einer Tabelle wie VERSION 7)
    var landingAbsent = isAbsent(aircraft.charts.landing);
    var lTables = [], lRead = null, lUse = null, lBr = null;
    if (!landingAbsent) {
      lTables = landingTables(aircraft);
      lRead = massReadOf(aircraft, 'landing');
      lUse = landingUse(aircraft, massKg, lTables.length);
      lBr = massBracket(lTables, lUse.bracketKg, lRead);
      charts.landing = lTables.length > 1 ? chartWithTable(aircraft.charts.landing, lTables[lBr.upper].table) : aircraft.charts.landing;
    }
    var pa = pressureAltitudeFt(airfield.elevation.value, inp.qnhHpa);
    // Druckhöhe für die Tabellen auf ganze ft aufgerundet (zur längeren Strecke, gleich wie angezeigt), für Tabellen in m
    // daraus in ganzen m aufgerundet (E1)
    var paTable = Math.ceil(pa - EPS);
    var paTableM = pressureAltitudeM(paTable);
    // Gegenwind 0: Ablesung ohne Wind; Tabellen mit Gegenwindachse (E2) lesen je Piste noch einmal mit deren Gegenwind
    var axisInputs = { pressureAltitude: paTable, temperature: inp.tempC, headwind: 0 };
    var lookups = { takeoff: null, landing: null };
    var above = [];
    PHASES.forEach(function (ph) {
      if (ph === 'landing' && landingAbsent) return;
      var lk = ph === 'takeoff' ? massLookup(tables, br, axisInputs) : massLookup(lTables, lBr, axisInputs);
      lookups[ph] = lk;
      if (!lk.ok) {
        if (lk.missing) throw new Error('Eingabe für Achse fehlt: ' + lk.missing);
        lk.above.forEach(function (a) { mergeAbove(above, a); });
      }
    });
    if (above.length) {
      return {
        ok: false, error: { code: 'above-range', above: above }, input: inp, pressureAltitudeFt: pa, pressureAltitudeTableFt: paTable,
        pressureAltitudeTableM: paTableM
      };
    }
    var ctx = { paTableFt: paTable, tempC: inp.tempC };
    var windInT = hasAxis(charts.takeoff.table, 'headwind');
    var windInL = !landingAbsent && hasAxis(charts.landing.table, 'headwind');
    var lightest = tables[tables.length - 1];
    var mode = null;
    var runways = airfield.runways.map(function (rwy) {
      var w = windForRunway(inp, rwy.bearingTrue);
      mode = w.mode;
      var out = {
        id: rwy.id, bearingTrue: rwy.bearingTrue, bearingMag: rwy.bearingMag, surface: rwy.surface,
        computed: w.computed, reason: w.reason, wind: w, takeoff: null, landing: null, takeoffByMass: null, takeoffLimit: null
      };
      if (w.computed) {
        // Eingaben der Ablesung für diese Piste (mit ihrem Gegenwind; nur Gegenwindachsen lesen ihn)
        var rIn = { pressureAltitude: paTable, temperature: inp.tempC, headwind: w.kt };
        out.takeoff = computePhase(charts.takeoff, windInT ? massLookup(tables, br, rIn) : lookups.takeoff, rwy, w, inp.runwayWet, rwy.takeoffAvailable.value, ctx);
        if (landingAbsent) {
          out.landing = absentPhase(aircraft.charts.landing, rwy.landingAvailable.value);
        } else {
          out.landing = computePhase(charts.landing, windInL ? massLookup(lTables, lBr, rIn) : lookups.landing, rwy, w, inp.runwayWet, rwy.landingAvailable.value, ctx);
        }
        // Start mit einer Tabelle bzw. einem Gewicht mit derselben Kette (Wind, Belag, Faktoren, Nässe)
        var phaseWith = function (lk, table) {
          return computePhase(chartWithTable(aircraft.charts.takeoff, table), lk, rwy, w, inp.runwayWet, rwy.takeoffAvailable.value, ctx);
        };
        // Start je Starttabelle und daraus «möglich bis» (bei «linear» als Übersicht im Rechenweg)
        out.takeoffByMass = tables.map(function (t, i) {
          var p = out.takeoff;
          if (i !== ti || br.lower !== null) {
            var lk = lookupTable(t.table, rIn);
            if (!lk.ok) return { kg: t.kg, ok: false, reason: 'no-lookup', m: null, possible: false, wetFactorMissing: false };
            p = phaseWith(lk, t.table);
          }
          // Möglich: Wert vorhanden, beide Strecken innerhalb der verfügbaren Länge (heute folgt das eine aus dem anderen,
          // weil die Strecke über 15 m nie kürzer ist als die Rollstrecke; die doppelte Bedingung hält auch ohne das)
          var possible = p.ok && !p.exceeds.groundRoll && !p.exceeds.overObstacle;
          return { kg: t.kg, ok: p.ok, reason: p.reason, m: p.m, possible: possible, wetFactorMissing: p.wetFactorMissing };
        });
        if (read === 'linear') {
          var atKg = function (kg) {
            var b = massBracket(tables, kg, read);
            var lk = massLookup(tables, b, rIn);
            if (!lk.ok) return { ok: false, reason: 'no-lookup', m: null, exceeds: null, wetFactorMissing: false };
            return phaseWith(lk, tables[b.upper].table);
          };
          out.takeoffLimit = takeoffLimitLinear(out.takeoff, massKg === null ? aircraft.mass.kg : massKg, aircraft.mass.kg, lightest.kg, atKg);
          out.takeoffLimit.tableKg = tables[ti].kg;
        } else {
          out.takeoffLimit = takeoffLimit(out.takeoffByMass, ti);
        }
      }
      return out;
    });
    var interpKg = br.lower !== null;
    var massLandingUsed = null;
    if (!landingAbsent) {
      var ml = landingMass(aircraft), lLightest = lTables[lTables.length - 1], lInterp = lBr.lower !== null;
      massLandingUsed = {
        inputKg: massKg, kg: lUse.kg, capped: lUse.capped, maxKg: ml.kg, maxLb: ml.lb, read: lRead,
        tableKg: lTables[lBr.upper].kg, tableLb: lTables[lBr.upper].lb, tableIndex: lBr.upper, tableCount: lTables.length,
        tableRef: lTables[lBr.upper].ref, tableTitle: lTables[lBr.upper].title,
        interpolated: lInterp,
        lowerKg: lInterp ? lTables[lBr.lower].kg : null, lowerIndex: lInterp ? lBr.lower : null,
        lowerRef: lInterp ? lTables[lBr.lower].ref : null, lowerTitle: lInterp ? lTables[lBr.lower].title : null,
        lightestKg: lLightest.kg, belowLowest: massKg !== null && lUse.kg < lLightest.kg,
        tablesKg: lTables.map(function (t) { return t.kg; })
      };
    }
    return {
      ok: true, error: null, input: inp, pressureAltitudeFt: pa, pressureAltitudeTableFt: paTable, pressureAltitudeTableM: paTableM,
      mode: mode, lookups: lookups, runways: runways,
      // inputKg null: kein Gewicht eingegeben, gerechnet mit dem Höchstgewicht. table*: Starttabelle für das
      // nächsthöhere Gewicht; bei Interpolation im Gewicht (interpolated) zusätzlich die nächstleichtere (lower*).
      mass: {
        inputKg: massKg, maxKg: aircraft.mass.kg, maxLb: aircraft.mass.lb, read: read,
        tableKg: tables[ti].kg, tableLb: tables[ti].lb, tableIndex: ti, tableCount: tables.length,
        tableRef: tables[ti].ref, tableTitle: tables[ti].title,
        interpolated: interpKg,
        lowerKg: interpKg ? tables[br.lower].kg : null, lowerIndex: interpKg ? br.lower : null,
        lowerRef: interpKg ? tables[br.lower].ref : null, lowerTitle: interpKg ? tables[br.lower].title : null,
        lightestKg: lightest.kg, belowLowest: massKg !== null && massKg < lightest.kg,
        tablesKg: tables.map(function (t) { return t.kg; })
      },
      // Landung (E7): Landegewicht und Landetabelle(n) wie mass beim Start; null, wenn die Landung fehlt (E6)
      massLandingUsed: massLandingUsed,
      landingAbsent: landingAbsent,
      ruleOfThumb: isPoint(charts.takeoff.table) || (!landingAbsent && isPoint(charts.landing.table)),
      computedCount: runways.filter(function (r) { return r.computed; }).length
    };
  }

  return {
    VERSION: VERSION,
    SCHEMA: SCHEMA,
    SCHEMA_EXT: SCHEMA_EXT,
    SCHEMAS: SCHEMAS,
    EPS: EPS,
    FT_M: FT_M,
    LB_KG: LB_KG,
    CALM_BELOW_KT: CALM_BELOW_KT,
    NODIR_MAX_KT: NODIR_MAX_KT,
    MAX_HEADWIND_KT: MAX_HEADWIND_KT,
    MAX_WIND_CREDIT: MAX_WIND_CREDIT,
    POINT_MAX_PA_FT: POINT_MAX_PA_FT,
    ISA_LAPSE_C_PER_1000FT: ISA_LAPSE_C_PER_1000FT,
    INPUT_RANGES: INPUT_RANGES,
    LIMITS: LIMITS,
    PHASES: PHASES,
    pressureAltitudeFt: pressureAltitudeFt,
    pressureAltitudeM: pressureAltitudeM,
    ceilMeters: ceilMeters,
    MASS_READS: MASS_READS,
    validateAircraft: validateAircraft,
    validateAirfield: validateAirfield,
    checkInput: checkInput,
    lookupTable: lookupTable,
    windForRunway: windForRunway,
    takeoffTables: takeoffTables,
    landingTables: landingTables,
    pickTakeoffTable: pickTakeoffTable,
    takeoffMassBracket: takeoffMassBracket,
    landingMassBracket: landingMassBracket,
    compute: compute,
    // nur für Tests: Auswertung «möglich bis» aus einer Liste je Starttabelle bzw. auf ganze kg
    _takeoffLimit: takeoffLimit,
    _takeoffLimitLinear: takeoffLimitLinear,
    // nur für Tests: eine Phase direkt rechnen (Schlussprobe ist mit geprüften Daten nicht erreichbar)
    _computePhase: computePhase
  };
}));
