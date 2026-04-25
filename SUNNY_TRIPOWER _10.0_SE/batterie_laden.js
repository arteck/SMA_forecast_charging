// ====================================================================================
//  ioBroker Script: Manuelles Batterie-Laden (Tibber-gesteuert & manuell)
//  Version: 2.1 | Erneuert: 2026-03
//
//  Funktionsübersicht:
//   - Manuelles Starten/Stoppen der Batterieladung via Datenpunkt-Button
//   - Tibber-gesteuertes automatisches Laden ab einer konfigurierten Stunde
//   - PV-Überschussladung: Ladeleistung = PV - Verbrauch
//   - Netzladung: Laden mit fixer Maximalleistung (batterieLadenManuellForce)
//   - Automatischer Ladestopp bei erreichtem SOC-Ziel
//   - Schreibt Protokoll-Index 99 in Tibber-Datenpunkt (für Hauptscript-Koordination)
// ====================================================================================

// @ts-nocheck
'use strict';

// ------------------------------------------------------------------------------------
//  KONFIGURATION
// ------------------------------------------------------------------------------------

/** @type {object} Alle verwendeten Datenpunkte */
const DP = {
    // WR Kommunikationsregister
    fedInSpntCom:   'modbus.0.holdingRegisters.3.40151_Kommunikation',
    fedInPwrAtCom:  'modbus.0.holdingRegisters.3.40149_Wirkleistungvorgabe',
    // SHM Alternative (auskommentiert):
    // fedInSpntCom: 'modbus.1.holdingRegisters.2.40151_Kommunikation',
    // fedInPwrAtCom: 'modbus.1.holdingRegisters.2.40149_Wirkleistungvorgabe',

    // Trigger
    triggerDP:      'modbus.0.inputRegisters.3.30193_Systemzeit_als_trigger',

    // Batterie
    spntComCheck:   '0_userdata.0.strom.40151_Kommunikation_Check',
    bydSOC:         'bydhvs.0.State.SOC',

    // Manuelles Laden Steuerung
    ladenStart:     '0_userdata.0.strom.batterieLadenManuellStart',     // Button: Laden starten
    ladenForce:     '0_userdata.0.strom.batterieLadenManuellForce',     // Flag: mit Netzstrom laden
    ladenForceWatt: '0_userdata.0.strom.batterieLadenManuellForceWatt', // Wert: Ladeleistung bei Netzladung
    ladenWert:      '0_userdata.0.strom.batterieLadenManuellWert',      // Istwert: aktuell gesetzte Ladeleistung

    // PV & Verbrauch
    pvLeistungAktuell:  '0_userdata.0.strom.PV_Leistung_aktuell',      // in kW
    momentanVerbrauch:  'alias.0.usv.pv.Momentan_Verbrauch_W',         // in W

    // Tibber Koordination
    tibberNutzenManuell:        '0_userdata.0.strom.tibber.extra.tibberNutzenManuell',
    tibberNutzenManuellHH:      '0_userdata.0.strom.tibber.extra.tibberNutzenManuellHH',
    tibberNutzenManuellProzent: '0_userdata.0.strom.tibber.extra.tibberNutzenManuellProzent',
    tibberProtokoll:            '0_userdata.0.strom.tibber.extra.tibberProtokoll',
    tibberBatterieladungJetzt:  '0_userdata.0.strom.tibber.extra.Batterieladung_jetzt',
    tibberBatterieladungSoll:   '0_userdata.0.strom.tibber.extra.Batterieladung_soll',
};

/** @type {object} Anlagenparameter (an eigene Anlage anpassen) */
const CFG = {
    batteryLadePowerMax:    5000,   // Maximale Ladeleistung in W
    verbrauchReserve:       100,    // Puffer auf den Verbrauch in W (vermeidet Netzbezug)
    socLimitLangsamLaden:   90,     // Ab diesem SOC (%) wird die Ladeleistung gedrosselt
    ladeleistungLangsam:    1000,   // Gedrosselte Ladeleistung in W (letzte ~10%)
    wrKommAn:               802,    // WR Kommunikation aktiv
    wrKommAus:              803,    // WR Kommunikation inaktiv
    debug:                  false,  // Debug-Logging aktivieren
};

// ------------------------------------------------------------------------------------
//  ZUSTANDSVARIABLEN
// ------------------------------------------------------------------------------------

let _wirdGeladen        = false;    // true = Ladevorgang läuft gerade
let _battLaden          = false;    // true = Laden soll aktiv sein (aus DP oder manuell)
let _processingAktiv    = false;    // Guard: verhindert parallele processingLaden()-Aufrufe (Race Condition)
let _stopLaeuft         = false;    // Guard: verhindert doppelten processingOff()-Aufruf

// ------------------------------------------------------------------------------------
//  INITIALISIERUNG (beim Scriptstart Zustände zurücksetzen)
// ------------------------------------------------------------------------------------

setState(DP.ladenStart,     false,  true);
setState(DP.ladenForce,     false,  true);
setState(DP.ladenWert,      0,      true);

// ------------------------------------------------------------------------------------
//  HAUPTTRIGGER
// ------------------------------------------------------------------------------------

/**
 * Wird bei jedem WR-Trigger-Tick ausgeführt.
 * Prüft ob Laden gestartet, fortgesetzt oder gestoppt werden soll.
 *
 * Ablauf:
 *  1. Manueller Stopp (Button wurde auf false gesetzt)
 *  2. Tibber-Automatik: Ladestart zur konfigurierten Stunde
 *  3. Manueller Start: Button wurde von außen auf true gesetzt
 *  4. Laufende Ladung: SOC-Ziel prüfen, sonst Ladeleistung berechnen
 */
on({ id: DP.triggerDP, change: 'ne' }, function () {
    _battLaden = getState(DP.ladenStart).val ?? false;

    const battSOC           = getState(DP.bydSOC).val ?? 0;
    const tibberManuell     = getState(DP.tibberNutzenManuell).val ?? false;
    const tibberStartStunde = getState(DP.tibberNutzenManuellHH).val ?? -1;
    const battSOCZiel       = getState(DP.tibberNutzenManuellProzent).val ?? 100;
    const aktuelleStunde    = getHH();

    if (CFG.debug) {
        console.info('[Laden] Tick: battLaden=' + _battLaden + ' | wirdGeladen=' + _wirdGeladen +
            ' | SOC=' + battSOC + '% | Ziel=' + battSOCZiel + '% | Stunde=' + aktuelleStunde);
    }

    // 1. Laufender Ladevorgang: Button wurde von außen deaktiviert → sofort stoppen
    if (_wirdGeladen && !_battLaden) {
        _stopLaeuft = false;    // Trigger-Stop: immer erlaubt (überschreibt Event-Handler-Guard)
        processingOff('Trigger: Button deaktiviert');
        return;
    }

    // 2. Tibber-Automatik: Laden zur konfigurierten Stunde starten
    if (!_wirdGeladen && tibberManuell && tibberStartStunde === aktuelleStunde) {
        console.info('[Laden] Tibber-Automatik: Starte Laden um ' + aktuelleStunde + ':00 Uhr');
        _battLaden      = true;
        _wirdGeladen    = true;
        setState(DP.ladenStart,     true,                       true);  // Button: Laden aktiv
        setState(DP.ladenForce,     true,                       true);  // Flag: Netzladung erlaubt
        setState(DP.ladenForceWatt, CFG.batteryLadePowerMax,    true);  // Ladeleistung: Maximum
    }

    // 3. Manueller Start: Button wurde von außen auf true gesetzt, aber _wirdGeladen noch false
    //    (z.B. direkt über VIS-Button ohne Tibber-Automatik)
    if (!_wirdGeladen && _battLaden) {
        console.info('[Laden] Manueller Start erkannt');
        _wirdGeladen = true;
    }

    // 4. Laden aktiv: SOC-Ziel prüfen oder Ladeleistung berechnen & senden
    if (_battLaden && _wirdGeladen) {
        if (battSOC >= battSOCZiel) {
            // Ziel-SOC erreicht → Laden direkt beenden (kein setState → kein Doppel-Event)
            console.info('[Laden] SOC-Ziel erreicht (' + battSOC + '% >= ' + battSOCZiel + '%) → Stoppe');
            processingOff('SOC-Ziel erreicht');
        } else if (!_processingAktiv) {
            // Guard: verhindert parallele Aufrufe bei schnellen Ticks
            _processingAktiv = true;
            setTimeout(function () {
                processingLaden();
                _processingAktiv = false;
            }, 600);
        } else {
            if (CFG.debug) console.warn('[Laden] Überspringe Tick – processingLaden läuft noch');
        }
    }
});

// ------------------------------------------------------------------------------------
//  LADEFUNKTIONEN
// ------------------------------------------------------------------------------------

/**
 * Berechnet die optimale Ladeleistung und sendet sie an den WR.
 *
 * Modi:
 *  - PV-Überschuss (mitStromLaden=false): Ladeleistung = PV - Verbrauch - Reserve
 *  - Netzladung    (mitStromLaden=true):  Ladeleistung = Wert aus ladenForceWatt-DP
 *
 * Oberhalb CFG.socLimitLangsamLaden: Drosselung auf CFG.ladeleistungLangsam (Zellschonung).
 * Bei ladenMax = 0 (kein PV-Überschuss): kein WR-Schreibzugriff.
 */
function processingLaden() {
    const verbrauch     = (getState(DP.momentanVerbrauch).val ?? 0) + CFG.verbrauchReserve;
    const pvWatt        = (getState(DP.pvLeistungAktuell).val ?? 0) * 1000;  // kW → W
    const mitStromLaden = getState(DP.ladenForce).val ?? false;
    const battMaxLaden  = getState(DP.ladenForceWatt).val ?? CFG.batteryLadePowerMax;
    const battSOC       = getState(DP.bydSOC).val ?? 0;

    let ladenMax;

    if (mitStromLaden) {
        // Netzladung: fixe Leistung aus Datenpunkt
        ladenMax = Math.min(battMaxLaden, CFG.batteryLadePowerMax);  // Sicherheitsbegrenzung
    } else {
        // PV-Überschussladung: nur was die PV über dem Verbrauch liefert
        ladenMax = pvWatt - verbrauch;
        if (ladenMax < 10) ladenMax = 0;    // Kleinstwert unterdrücken (Messrauschen)
    }

    // Letzte ~10%: Ladeleistung drosseln für Zellschonung
    if (ladenMax > 0 && battSOC >= CFG.socLimitLangsamLaden) {
        ladenMax = Math.min(ladenMax, CFG.ladeleistungLangsam);
    }

    if (CFG.debug) {
        console.info('[Laden] Modus: ' + (mitStromLaden ? 'Netz' : 'PV-Überschuss') +
            ' | PV=' + pvWatt + ' W | Verbrauch=' + verbrauch + ' W' +
            ' | SOC=' + battSOC + '% | ladenMax=' + ladenMax + ' W');
    }

    // Kein Überschuss vorhanden: WR nicht unnötig beschreiben
    if (ladenMax === 0) {
        if (CFG.debug) console.warn('[Laden] Kein PV-Überschuss – kein WR-Schreibzugriff');
        setState(DP.ladenWert, 0, true);
        return;
    }

    ladungStart(ladenMax);
    setState(DP.ladenWert, ladenMax, true);
}

/**
 * Stoppt den manuellen Ladevorgang und setzt alle Flags zurück.
 * Durch _stopLaeuft-Guard wird ein Doppelaufruf (Trigger + Event-Handler) verhindert.
 *
 * @param {string} [grund=''] - Optionale Begründung für das Log
 */
function processingOff(grund) {
    // Guard: verhindert Doppelaufruf durch gleichzeitigen Trigger- und Event-Handler-Aufruf
    if (_stopLaeuft) {
        if (CFG.debug) console.warn('[Laden] processingOff bereits aktiv – übersprungen');
        return;
    }
    _stopLaeuft = true;

    const logMsg = 'Stoppe manuelle Batterieladung' + (grund ? ' (' + grund + ')' : '');
    console.info('[Laden] ' + logMsg);
    toLog(logMsg, true);

    ladungStop();

    _battLaden          = false;
    _wirdGeladen        = false;
    _processingAktiv    = false;

    // Flag-Datenpunkte zurücksetzen – kein setState(ladenStart) hier, da dies
    // erneut den on-Handler triggern würde → Endlosschleife vermeiden
    setState(DP.ladenForce,             false,  true);
    setState(DP.tibberNutzenManuell,    false,  true);  // Tibber-Manuell-Flag zurücksetzen
    setState(DP.ladenWert,              0,      true);

    // Guard zurücksetzen mit kurzer Verzögerung (nach Event-Handler-Durchlauf)
    setTimeout(function () { _stopLaeuft = false; }, 1000);
}

// ------------------------------------------------------------------------------------
//  WR KOMMUNIKATION
// ------------------------------------------------------------------------------------

/**
 * Aktiviert die WR-Kommunikation und setzt die Ladeleistungsvorgabe.
 * Schreibt Protokoll-Index 99 damit das Hauptscript die Übersteuerung erkennt.
 *
 * @param {number} watt - Ladeleistung in W (positiver Wert, wird intern für WR negiert)
 */
function ladungStart(watt) {
    setState(DP.fedInSpntCom,   CFG.wrKommAn,   false); // WR Kommunikation aktivieren
    setState(DP.spntComCheck,   CFG.wrKommAn,   true);

    const wattNegativ = watt > 0 ? watt * -1 : watt;   // WR erwartet negative Werte für Laden

    setState(DP.tibberProtokoll,            99,             true);  // Hauptscript: manuell übersteuert
    setState(DP.fedInPwrAtCom,              wattNegativ,    false); // Wirkleistungsvorgabe an WR
    setState(DP.tibberBatterieladungJetzt,  wattNegativ,    true);
    setState(DP.tibberBatterieladungSoll,   wattNegativ,    true);

    if (CFG.debug) {
        console.info('[Laden] WR Befehl: Kommunikation=' + CFG.wrKommAn + ' | Leistung=' + wattNegativ + ' W');
    }
}

/**
 * Deaktiviert die WR-Kommunikation.
 * Der WR übernimmt danach wieder die eigenständige Regelung.
 */
function ladungStop() {
    setState(DP.fedInSpntCom,   CFG.wrKommAus,  false);
    setState(DP.spntComCheck,   CFG.wrKommAus,  true);

    if (CFG.debug) {
        console.info('[Laden] WR Kommunikation deaktiviert (' + CFG.wrKommAus + ')');
    }
}

// ------------------------------------------------------------------------------------
//  EVENT-HANDLER
// ------------------------------------------------------------------------------------

/**
 * Reagiert auf externes Deaktivieren des Lade-Buttons (z.B. aus VIS).
 * Der _stopLaeuft-Guard verhindert Doppelaufruf falls der Trigger-Handler
 * processingOff() in der gleichen Tick-Runde bereits aufgerufen hat.
 */
on({ id: DP.ladenStart, change: 'ne', val: false }, function () {
    if (CFG.debug) console.warn('[Laden] ladenStart-Event: Button auf false gesetzt');
    processingOff('Event: ladenStart=false');
});