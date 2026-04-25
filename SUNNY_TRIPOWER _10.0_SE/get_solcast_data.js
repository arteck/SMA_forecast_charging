// ====================================================================================
//  ioBroker Script: Solcast PV-Prognose Abruf & Datenpunkt-Verwaltung
//  Version: 2.0 | Erneuert: 2026-03
//
//  Funktionsübersicht:
//   - Solcast API Abruf (bis zu 10 Gratis-Requests/Tag) für 1 oder 2 PV-Seiten
//   - Prognose-Werte: realistisch / vorsichtig (10P) / optimistisch (90P)
//   - Datenpunkte: heute + morgen je 48 × 30-min-Slots (power, power90)
//   - Gesamtberechnung beider Seiten (gesamt-DP)
//   - Tagesertrag-Summierung in kWh (today_kW / tomorrow_kW)
//   - InfluxDB-Export für Grafana-Diagramme (optional)
//   - VIS Material-Design Bar-Chart JSON-Graph
//   - Prognosebasiertes Aktivieren/Deaktivieren der Batterieladesteuerung
//
//  Solcast-Prognose-Typen:
//   pv_estimate   = Realist  (Standardwert, 50. Perzentile)
//   pv_estimate10 = Vorsicht (10. Perzentile – 90% Chance auf höhere Leistung)
//   pv_estimate90 = Optimist (90. Perzentile – Best-Case Szenario)
// ====================================================================================

// @ts-nocheck
'use strict';

// ------------------------------------------------------------------------------------
//  KONFIGURATION  ← hier alle Anpassungen vornehmen
// ------------------------------------------------------------------------------------

/** @type {object} Solcast API Zugangsdaten & PV-Anlagen-Konfiguration */
const CFG = {
    // Solcast API
    apiKey:         'xxx',   // Solcast API Key
    baseUrl:        'https://api.solcast.com.au/rooftop_sites/',

    // PV-Seite 1 (z.B. Süddach, Garten – Sonne vormittags)
    seite1:         'garten',                   // Name frei wählbar → Datenpunkt-Suffix
    seite1Key:      'xxxx',      // Solcast Rooftop-Site-ID

    // PV-Seite 2 (z.B. Norddach, Straße – Sonne nachmittags)
    // Leer lassen ('') wenn nur eine PV-Seite vorhanden
    seite2:         'strasse',
    seite2Key:      'xxxx',

    // Gesamtdatenpunkt-Name (Summe beider Seiten)
    // Muss in ladenNachPrognose übereinstimmen wenn geändert
    gesamt:         'gesamt',

    // Prognose-Modus pro Seite: 0=realistisch | 1=vorsichtig (10P) | 2=optimistisch (90P)
    prognose1:      1,      // Seite 1: vorsichtig
    prognose2:      0,      // Seite 2: realistisch

    // Datenpunkte einmalig anlegen:
    // summeDpAnlegen auf true setzen, Script einmal starten, dann wieder auf false!
    summeDpAnlegen: false,

    // InfluxDB Export (für Grafana)
    influxAktiv:    true,               // false = kein Export
    influxInstanz:  'influxdb.0',
    influxGesamt:   'pvforecast.0.summary.power',
    influxSeite1:   'pvforecast.0.plants.garten.power',
    influxSeite2:   'pvforecast.0.plants.strasse.power',

    // Schwellenwert: unter pvMin kWh → Prognosebasiertes Laden deaktivieren
    pvMin:          25,                 // kWh

    // JavaScript-Instanz (muss ASTRO-Zeit-Generierung aktiviert haben)
    javascriptInstanz: 'javascript.0',

    // Interner Zeitstempel ab dem "heute" endet und "morgen" beginnt
    abbrechenBei:   '00:00',           // nicht ändern
};

/** @type {object} Datenpunkt-Basispfade */
const DP = {
    base:           '0_userdata.0.strom.pvforecast',
    today:          '0_userdata.0.strom.pvforecast.today',
    tomorrow:       '0_userdata.0.strom.pvforecast.tomorrow',
    userDataBase:   '0_userdata.0',
    tibberBase:     '0_userdata.0.strom.tibber.',
    pvTodayGesamt:  '0_userdata.0.strom.pvforecast.today.gesamt.',
    battLadenUhrzeitStart: '0_userdata.0.strom.batterieLadenUhrzeitStart',
};

// ------------------------------------------------------------------------------------
//  LAUFZEITVARIABLEN
// ------------------------------------------------------------------------------------

// @ts-ignore
const moment        = require('moment');
const TIME_OPTIONS  = { hour12: false, hour: '2-digit', minute: '2-digit' };
const SLOTS_PER_DAY = 48;       // 24h × 2 (30-min-Intervalle)

let _tickerAbholung = 0;        // Zähler: wie oft heute schon abgeholt wurde
let _errorMrk       = false;    // Flag: letzter Request war fehlerhaft
let _aufrufUrl      = '';       // Letzte Request-URL (für Error-Retry)
let _aufrufSeite    = '';       // Letzte abgerufene Seite (für Error-Retry)

// ------------------------------------------------------------------------------------
//  SCHEDULES (Abruf-Zeitplan)
// ------------------------------------------------------------------------------------

/** Zähler bei Sonnenuntergang zurücksetzen */
schedule({ astro: 'sunset' }, () => {
    _tickerAbholung = 0;
});

/**
 * Sonnenaufgang: Datenpunkte initialisieren und ersten Tagesabruf starten.
 * Wird nur ausgeführt wenn Sonnenaufgang nach 06:00 Uhr (Winterschutz).
 */
schedule({ astro: 'sunrise' }, () => {
    const hh = getHH();
    initialPV();

    if (hh > 6) {
        _requestBeideSeiten('Sonnenaufgang');
        _tickerAbholung++;
    }
});

/** 06:01 Uhr: Frühester Abruf für Tageswerte (Fallback wenn Sonnenaufgang vor 06:00) */
schedule('1 6 * * *', () => {
    if (_tickerAbholung < 1) {
        _requestSeite(CFG.seite2Key, CFG.seite2.length > 0 ? CFG.seite2 : CFG.seite1, '06:01 Fallback');
    }
});

/**
 * 07:01, 09:01, 10:01 Uhr: Seite 2 aktualisieren (nachmittags-PV).
 * Nur wenn Sonnenaufgang bereits war und Seite 2 konfiguriert ist.
 * Solcast: 10 kostenlose Requests/Tag → gezielter Einsatz.
 */
schedule('1 7,9,10 * * *', () => {
    if (CFG.seite2.length === 0) return;

    const sunup = _getSunriseHour();
    if (getHH() >= sunup) {
        _requestSeite(CFG.seite2Key, CFG.seite2, '07/09/10 Uhr Seite2');
        _tickerAbholung++;
    }
});

/** 08:02, 12:02, 13:02, 15:02 Uhr: Seite 1 aktualisieren (vormittags-PV). */
schedule('2 8,12,13,15 * * *', () => {
    const sunup = _getSunriseHour();
    if (getHH() >= sunup) {
        _requestSeite(CFG.seite1Key, CFG.seite1, '08/12/13/15 Uhr Seite1');
        _tickerAbholung++;
    }
});

/** Alle 5/10/15 Minuten: Error-Retry falls letzter Request fehlgeschlagen. */
schedule('5,10,15 * * * *', () => {
    if (_errorMrk) {
        toLog(`[PV] ERROR-Retry: ${_aufrufSeite} (Versuch ${_tickerAbholung})`, true);
        requestData(_aufrufUrl, _aufrufSeite);
        _tickerAbholung++;
    }
});

// ------------------------------------------------------------------------------------
//  API ABRUF
// ------------------------------------------------------------------------------------

/**
 * Ruft beide PV-Seiten sequentiell ab (seite2 zuerst, dann seite1).
 * @param {string} [grund=''] - Bezeichnung für das Log
 */
function _requestBeideSeiten(grund) {
    if (CFG.seite2.length > 0) {
        _requestSeite(CFG.seite2Key, CFG.seite2, grund + ' Seite2');
    }
    _requestSeite(CFG.seite1Key, CFG.seite1, grund + ' Seite1');
}

/**
 * Baut die URL zusammen und startet den HTTP-Request.
 * @param {string} siteKey   - Solcast Rooftop-Site-ID
 * @param {string} seite     - Seiten-Name für Datenpunkt-Routing
 * @param {string} [grund=''] - Bezeichnung für das Log
 */
function _requestSeite(siteKey, seite, grund) {
    _aufrufUrl   = `${siteKey}/forecasts?format=json&api_key=${CFG.apiKey}`;
    _aufrufSeite = seite;
    toLog(`[PV] Hole Prognose: ${seite}${grund ? ' (' + grund + ')' : ''}`, true);
    requestData(_aufrufUrl, seite);
}

/**
 * Führt den eigentlichen HTTP-GET gegen die Solcast API durch.
 * Bei Fehler: _errorMrk setzen für automatischen Retry.
 * Bei Erfolg: Raw-Response speichern und datenErzeugen() aufrufen.
 *
 * @param {string} seiteUrl - URL-Suffix (SiteKey + Parameter)
 * @param {string} seite    - Seiten-Name für Datenpunkt-Routing
 */
function requestData(seiteUrl, seite) {
    const url = `${CFG.baseUrl}${seiteUrl}`;
    _errorMrk = false;

    httpGet(url, { timeout: 9000, responseType: 'text' }, (err, response) => {
        if (err) {
            _errorMrk = true;
            console.error(`[PV] HTTP-Fehler bei ${seite}: ${err}`);
            return;
        }

        try {
            const jsonData = JSON.parse(response.data);
            setState(`${DP.base}.response`, JSON.stringify(jsonData), true);
            datenErzeugen(jsonData.forecasts, seite);
        } catch (parseErr) {
            _errorMrk = true;
            console.error(`[PV] JSON-Parse-Fehler bei ${seite}: ${parseErr}`);
        }
    });
}

// ------------------------------------------------------------------------------------
//  DATENVERARBEITUNG
// ------------------------------------------------------------------------------------

/**
 * Verarbeitet die Solcast API-Antwort und schreibt die Werte in die Datenpunkte.
 * Unterscheidet automatisch ob ein Slot zu "heute" oder "morgen" gehört.
 *
 * @param {Array}  array - Solcast forecasts-Array
 * @param {string} seite - Seiten-Name ('garten' oder 'strasse')
 */
function datenErzeugen(array, seite) {
    if (!array || array.length === 0) {
        console.warn(`[PV] Kein Daten-Array für ${seite}`);
        return;
    }

    try {
        // 1. API-Antwort in interne Listenstruktur umwandeln
        const list = array.map(entry => {
            const endtime   = Date.parse(entry.period_end);
            const startTime = new Date(endtime - 1800000); // 30 min zurück
            return {
                starttime:  startTime / 1000,
                endtime:    endtime / 1000,
                wert1:      Math.round(_prognoseWert(entry, CFG.prognose1) * 1000),  // W
                wert2:      Math.round(_prognoseWert(entry, CFG.prognose2) * 1000),
            };
        });

        // Startzeit des ersten API-Slots (für Einstiegspunkt im DP-Index)
        const firstSlotTime = new Date(list[0].starttime * 1000)
            .toLocaleTimeString('de-DE', TIME_OPTIONS);

        // 500ms warten damit initialPV()-Datenpunkte sicher existieren
        setTimeout(() => _schreibeDaten(list, seite, firstSlotTime), 500);

    } catch (err) {
        console.error(`[PV] datenErzeugen Fehler: ${err}`);
    }
}

/**
 * Extrahiert den gewünschten Prognosewert aus einem Solcast-Eintrag.
 * @param {object} entry    - Einzelner Solcast forecast-Eintrag
 * @param {number} modus    - 0=realistisch | 1=vorsichtig | 2=optimistisch
 * @returns {number} Leistung in kW
 */
function _prognoseWert(entry, modus) {
    switch (modus) {
        case 1:  return entry.pv_estimate10;
        case 2:  return entry.pv_estimate90;
        default: return entry.pv_estimate;
    }
}

/**
 * Schreibt die verarbeiteten Prognose-Slots in die ioBroker-Datenpunkte.
 * Erkennt automatisch den Übergang heute/morgen anhand '00:00' Uhrzeit.
 *
 * @param {Array}  list          - Interne Slot-Liste (starttime, wert1, wert2)
 * @param {string} seite         - Aktive Seite ('garten' oder 'strasse')
 * @param {string} firstSlotTime - Uhrzeit des ersten Slots (HH:MM) zum Index-Einstieg
 */
function _schreibeDaten(list, seite, firstSlotTime) {
    // Einstiegspunkt im DP-Array finden (API liefert ggf. ab einer anderen Uhrzeit)
    let startIndex = 0;
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
        const dpTime = getState(`${DP.today}.${seite}.${i}.startTime`).val;
        if (dpTime === firstSlotTime) {
            startIndex = i;
            break;
        }
    }

    let heute        = true;    // Wechsel auf false nach '00:00' Slot
    let posiA        = startIndex - 1;
    let schonGebucht = false;

    for (let listenDP = 0; listenDP < list.length; listenDP++) {
        if (!list[listenDP]) break;

        const slotStart = new Date(list[listenDP].starttime * 1000)
            .toLocaleTimeString('de-DE', TIME_OPTIONS);

        // Mitternacht erkannt → ab jetzt "morgen"-Datenpunkte beschreiben
        if (slotStart === CFG.abbrechenBei) {
            if (schonGebucht) break;    // zweite Mitternacht = Ende
            heute        = false;
            posiA        = -1;
            schonGebucht = true;
        }

        posiA++;

        const tag = heute ? DP.today : DP.tomorrow;

        const dpSeite1  = `${tag}.${CFG.seite1}.${posiA}.`;
        const dpSeite2  = CFG.seite2.length > 0 ? `${tag}.${CFG.seite2}.${posiA}.` : null;
        const dpGesamt  = `${tag}.${CFG.gesamt}.${posiA}.`;

        const wert1 = list[listenDP].wert1;
        const wert2 = list[listenDP].wert2;

        let wertGes1 = 0;
        let wertGes2 = 0;

        if (seite === CFG.seite1) {
            setState(dpSeite1 + 'power',   wert1, true);
            setState(dpSeite1 + 'power90', wert2, true);
            const andereSeite1 = dpSeite2 ? (getState(dpSeite2 + 'power').val   ?? 0) : 0;
            const andereSeite2 = dpSeite2 ? (getState(dpSeite2 + 'power90').val ?? 0) : 0;
            wertGes1 = wert1 + andereSeite1;
            wertGes2 = wert2 + andereSeite2;
        } else if (seite === CFG.seite2 && dpSeite2) {
            setState(dpSeite2 + 'power',   wert1, true);
            setState(dpSeite2 + 'power90', wert2, true);
            const andereSeite1 = getState(dpSeite1 + 'power').val   ?? 0;
            const andereSeite2 = getState(dpSeite1 + 'power90').val ?? 0;
            wertGes1 = wert1 + andereSeite1;
            wertGes2 = wert2 + andereSeite2;
        }

        // Gesamt-DP: parseInt() um Dezimalstellen zu entfernen (Wert ist bereits in W)
        setState(dpGesamt + 'power',   Math.round(wertGes1), true);
        setState(dpGesamt + 'power90', Math.round(wertGes2), true);
    }

    // Graph und Tagessummen nach Datenschreiben aktualisieren
    genGraphAnlegen(true);   // heute
    genGraphAnlegen(false);  // morgen

    setState(`${DP.base}.lastUpdated`, { val: moment().valueOf(), ack: true });
    toLog(`[PV] Prognose ${seite} geschrieben`, true);
}

// ------------------------------------------------------------------------------------
//  DATENPUNKTE INITIALISIEREN
// ------------------------------------------------------------------------------------

/**
 * Initialisiert Datenpunkte für alle Seiten (heute + morgen).
 * Wird täglich bei Sonnenaufgang aufgerufen.
 * Legt Datenpunkte nur an wenn summeDpAnlegen=true, setzt sonst nur power/power90 auf 0.
 */
async function initialPV() {
    await seiteAnlegen(CFG.seite1);
    if (CFG.seite2.length > 0) await seiteAnlegen(CFG.seite2);
    await seiteAnlegen(CFG.gesamt);
}

/**
 * Legt alle 48 Slots für heute und morgen einer Seite an.
 * Startzeit und Endzeit werden nur bei summeDpAnlegen=true erzeugt (einmalig).
 * power und power90 werden bei jedem Aufruf auf 0 initialisiert.
 *
 * @param {string} seite - Seiten-Name (seite1 | seite2 | gesamt)
 */
async function seiteAnlegen(seite) {
    for (const tag of [DP.today, DP.tomorrow]) {
        const istToday = (tag === DP.today);
        await _slotsAnlegen(tag, seite, istToday);
    }

    if (CFG.summeDpAnlegen) {
        await dPAnlegen(seite);
    }
}

/**
 * Erzeugt die 48 Zeitslots (0–47) für einen Tag und eine Seite.
 * Zeitreihe beginnt immer um 00:30 und endet um 00:00 des nächsten Tages.
 *
 * @param {string}  tagDP   - Basispfad (today oder tomorrow)
 * @param {string}  seite   - Seiten-Name
 * @param {boolean} isToday - true = startTime beginnt bei 00:30, false = identisch
 */
async function _slotsAnlegen(tagDP, seite, isToday) {
    const dp = `${tagDP}.${seite}.`;
    let ind  = 0;

    for (let hour = 0; hour <= 24; hour++) {
        const minStart = (hour === 0) ? 30 : 0;    // erster Slot: 00:30
        for (let minute = minStart; minute < 60; minute += 30) {
            if (ind >= SLOTS_PER_DAY) break;

            const base = `${dp}${ind}.`;
            const h    = hour === 24 ? 0 : hour;   // 24:00 → 00:00

            if (CFG.summeDpAnlegen) {
                // startTime nur einmalig anlegen
                createUserStates(DP.userDataBase, false,
                    [base + 'startTime', { name: 'Gültigkeitsbeginn', type: 'string', read: true, write: false, role: 'state' }],
                    () => setStateAsync(base + 'startTime', formatTime(h - 1 < 0 ? 23 : h - 1, minute === 0 ? 30 : 0), true)
                );
                createUserStates(DP.userDataBase, false,
                    [base + 'endTime', { name: 'Gültigkeitsende', type: 'string', read: true, write: false, role: 'state' }],
                    () => setStateAsync(base + 'endTime', formatTime(h, minute), true)
                );
            }

            // power und power90 immer anlegen / auf 0 zurücksetzen
            createUserStates(DP.userDataBase, false,
                [base + 'power', { name: 'Leistung (W)', type: 'number', read: true, write: false, role: 'value', def: 0, unit: 'W' }],
                () => setStateAsync(base + 'power', 0, true)
            );
            createUserStates(DP.userDataBase, false,
                [base + 'power90', { name: 'Leistung 90P (W)', type: 'number', read: true, write: false, role: 'value', def: 0, unit: 'W' }],
                () => setStateAsync(base + 'power90', 0, true)
            );

            ind++;
        }
        if (ind >= SLOTS_PER_DAY) break;
    }
}

/**
 * Legt einmalige Gesamt-Datenpunkte an (lastUpdated, response, kWh-Summen, Graphen).
 * Nur aufrufen wenn summeDpAnlegen=true.
 *
 * @param {string} seite - Seiten-Name
 */
async function dPAnlegen(seite) {
    const base = `${DP.base}.`;

    const states = [
        [base + 'lastUpdated',  { name: 'Letztes Update',   type: 'number', read: true, write: false, role: 'value.time', def: 0 }],
        [base + 'response',     { name: 'API Rohantwort',   type: 'string', read: true, write: false, role: 'state',      def: '' }],
        [`${DP.today}.${seite}.today_kW`,       { name: 'Tagesertrag heute',  type: 'number', read: true, write: false, role: 'value', def: 0, unit: 'kWh' }],
        [`${DP.tomorrow}.${seite}.tomorrow_kW`, { name: 'Tagesertrag morgen', type: 'number', read: true, write: false, role: 'value', def: 0, unit: 'kWh' }],
        [`${DP.today}.JSONGraph`,    { name: 'Diagrammdaten heute',  type: 'string', read: true, write: false, role: 'json', def: '{}' }],
        [`${DP.tomorrow}.JSONGraph`, { name: 'Diagrammdaten morgen', type: 'string', read: true, write: false, role: 'json', def: '{}' }],
    ];

    for (const [key, meta] of states) {
        createUserStates(DP.userDataBase, true, [key, meta], () => {});
    }
}

// ------------------------------------------------------------------------------------
//  GRAPH & TAGESSUMMEN
// ------------------------------------------------------------------------------------

/**
 * Berechnet Tagessummen (kWh) und erzeugt den VIS Material-Design Balken-Graph.
 * Schreibt optional Messwerte in InfluxDB.
 *
 * @param {boolean} today - true = heute | false = morgen
 */
function genGraphAnlegen(today) {
    const tagDP      = today ? DP.today    : DP.tomorrow;
    const kWhKey     = today ? 'today_kW'  : 'tomorrow_kW';

    const graphData   = [];
    const graphLabels = [];

    let sumGesamt = 0;
    let sumSeite1 = 0;
    let sumSeite2 = 0;

    for (let i = 0; i < SLOTS_PER_DAY; i++) {
        const dpGes   = `${tagDP}.${CFG.gesamt}.${i}.`;
        const dpS1    = `${tagDP}.${CFG.seite1}.${i}.`;
        const dpS2    = CFG.seite2.length > 0 ? `${tagDP}.${CFG.seite2}.${i}.` : null;

        const startTime   = getState(dpGes + 'startTime').val ?? '';
        const powerGesamt = getState(dpGes + 'power').val     ?? 0;
        const powerS1     = getState(dpS1  + 'power').val     ?? 0;
        const powerS2     = dpS2 ? (getState(dpS2 + 'power').val ?? 0) : 0;

        sumGesamt += powerGesamt;
        sumSeite1 += powerS1;
        sumSeite2 += powerS2;

        // Für den Graph: nur volle Stunden (bessere Lesbarkeit), nur wenn Ertrag > 0
        if (powerGesamt > 0 && startTime.endsWith(':00')) {
            graphLabels.push(startTime);
            const kW = Math.round(powerGesamt / 10) / 100;  // W → kW, 2 Dezimalstellen
            graphData.push(kW);

            if (CFG.influxAktiv) {
                influxDdOutput(CFG.influxGesamt, startTime, kW);
                influxDdOutput(CFG.influxSeite1, startTime, Math.round(powerS1 / 10) / 100);
                if (dpS2) influxDdOutput(CFG.influxSeite2, startTime, Math.round(powerS2 / 10) / 100);
            }
        }
    }

    // Tagessummen in kWh (÷2 weil 30-min-Slots, ÷1000 W→kW, gerundet auf 2 Stellen)
    const toKwh = (sumW) => Math.round((sumW / 2 / 1000) * 100) / 100;

    setState(`${tagDP}.${CFG.seite1}.${kWhKey}`, toKwh(sumSeite1), true);
    if (CFG.seite2.length > 0) {
        setState(`${tagDP}.${CFG.seite2}.${kWhKey}`, toKwh(sumSeite2), true);
    }
    setState(`${tagDP}.${CFG.gesamt}.${kWhKey}`, toKwh(sumGesamt), true);

    genGraph(graphLabels, graphData, tagDP);
}

// ------------------------------------------------------------------------------------
//  VIS GRAPH
// ------------------------------------------------------------------------------------

/**
 * Erzeugt das JSON für einen VIS Material-Design Balken-Graph und schreibt ihn in den DP.
 * Dokumentation: https://github.com/Scrounger/ioBroker.vis-materialdesign
 *
 * @param {Array}  labels   - X-Achsenbeschriftungen (Uhrzeiten)
 * @param {Array}  data     - Datenwerte in kW
 * @param {string} tagDP    - Ziel-Datenpunkt-Pfad (today oder tomorrow)
 */
async function genGraph(labels, data, tagDP) {
    const graphConfig = {
        data:               data,
        type:               'bar',
        legendText:         'PV',
        displayOrder:       1,
        color:              '#fffd00',
        tooltip_AppendText: 'kW',
        datalabel_show:     true,
        datalabel_rotation: 300,
        datalabel_color:    '#cccccc',
        datalabel_fontSize: 14,
        barIsStacked:       true,
        barStackId:         1,
        yAxis_id:           0,
        yAxis_position:     'left',
        yAxis_show:         true,
        yAxis_appendix:     'kW',
        yAxis_step:         5,
        yAxis_max:          13.1,       // 13.1 kW Anlagen-Maximum (anpassen!)
        yAxis_maximumDigits: 3,
    };

    setState(`${tagDP}.JSONGraph`, {
        val: JSON.stringify({ graphs: [graphConfig], axisLabels: labels }, null, 2),
        ack: true,
    });
}

// ------------------------------------------------------------------------------------
//  INFLUXDB EXPORT
// ------------------------------------------------------------------------------------

/**
 * Schreibt einen Messwert mit Zeitstempel in InfluxDB.
 * Der Zeitstempel wird aus dem aktuellen Datum + der übergebenen Uhrzeit konstruiert.
 *
 * @param {string} measurementDP - InfluxDB Measurement Datenpunkt-ID
 * @param {string} startTime     - Uhrzeit im Format HH:MM
 * @param {number} powerKw       - Leistung in kW
 */
async function influxDdOutput(measurementDP, startTime, powerKw) {
    const now  = new Date();
    const date = `${now.getFullYear()}-${_pad(now.getMonth() + 1)}-${_pad(now.getDate())} ${startTime}:00`;
    await addToInfluxDB(measurementDP, moment(date).valueOf(), powerKw);
}

/**
 * Sendet einen Wert mit Zeitstempel an InfluxDB via sendToAsync.
 *
 * @param {string} measurementDP - InfluxDB Measurement Datenpunkt-ID
 * @param {number} timestamp     - Unix-Timestamp in ms
 * @param {number} value         - Messwert
 */
async function addToInfluxDB(measurementDP, timestamp, value) {
    try {
        await sendToAsync(CFG.influxInstanz, 'storeState', {
            id: measurementDP,
            state: { ts: timestamp, val: value, ack: true, from: 'system.adapter.javascript' },
        });
    } catch (err) {
        console.warn(`[PV] InfluxDB Fehler (${measurementDP}): ${err}`);
    }
}

// ------------------------------------------------------------------------------------
//  HILFSFUNKTIONEN
// ------------------------------------------------------------------------------------

/**
 * Formatiert Stunde und Minute als zweistelligen HH:MM String.
 * @param {number} hour   - Stunde (0-23)
 * @param {number} minute - Minute (0, 30)
 * @returns {string} z.B. '09:30'
 */
function formatTime(hour, minute) {
    return `${_pad(hour)}:${_pad(minute)}`;
}

/**
 * Fügt führende Null hinzu wenn Zahl < 10.
 * @param {number} n
 * @returns {string}
 */
function _pad(n) {
    return n < 10 ? '0' + n : String(n);
}

/**
 * Liest die Sonnenaufgangs-Stunde aus dem javascript-Instanz-Datenpunkt.
 * @returns {number} Stunde des Sonnenaufgangs (0-23)
 */
function _getSunriseHour() {
    const sunup = getState(`${CFG.javascriptInstanz}.variables.astro.sunrise`).val ?? '06:00';
    return parseInt(sunup.slice(0, 2), 10);
}

// ------------------------------------------------------------------------------------
//  EVENT-HANDLER
// ------------------------------------------------------------------------------------

/**
 * Reagiert auf Änderungen des Tagesertrags (today_kW im gesamt-DP).
 * Aktiviert oder deaktiviert das prognosebasierte Batterieladen automatisch:
 *  - Unter CFG.pvMin kWh → Prognose-Laden deaktivieren (zu wenig PV erwartet)
 *  - Ab CFG.pvMin kWh   → Prognose-Laden aktivieren
 * Wird nicht ausgeführt wenn manuelles Zeitladen aktiv ist.
 */
on({ id: DP.pvTodayGesamt + 'today_kW', change: 'any' }, (obj) => {
    const kwhToday              = obj.state.val ?? 0;
    const zeitLadenAktiv        = getState(DP.battLadenUhrzeitStart).val ?? false;
    const prognoseDP            = DP.tibberBase + 'extra.prognoseNutzenAutomatisch';
    const wolken                = getState('brightsky.0.daily.00.day.cloud_cover').val;

    if (zeitLadenAktiv) return;     // manuelles Zeitladen hat Vorrang

    if (kwhToday > 0 && kwhToday < CFG.pvMin) {
        setState(prognoseDP, false, true);
        console.info(`[PV] Prognose ${kwhToday} kWh < ${CFG.pvMin} kWh → Prognose-Laden deaktiviert`);
    } else if (kwhToday >= CFG.pvMin) {
        setState(prognoseDP, true, true);
        console.info(`[PV] Prognose ${kwhToday} kWh ≥ ${CFG.pvMin} kWh → Prognose-Laden aktiviert`);
    }

    if (wolken > 80) {
        setState(prognoseDP, false, true);
        console.info(`[PV] Prognose ${kwhToday} kWh < ${CFG.pvMin} kWh → Prognose-Laden deaktiviert. Wolkenwert ${wolken} % `);    
    }

});
