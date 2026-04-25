<<<<<<< HEAD
// ====================================================================================
//  ioBroker Script: PV-Batterie-Management mit Tibber & PV-Prognose
//  Version: 2.0 | Erneuert: 2026-03
//
//  Funktionsübersicht:
//   - SMA Wechselrichter Steuerung über Modbus (Lade-/Entladeleistung)
//   - Tibber Echtzeit-Preisoptimierung (Laden bei Niedrigpreisen, Entladen bei Hochpreisen)
//   - PV-Prognose basiertes Laden (Solar-Überschussnutzung)
//   - BYD HVS Batterie-SOC Monitoring
//   - EVCC Fahrzeug-Ladeintegration
//   - Klimaanlagen-Verbrauchsberücksichtigung
//   - Notladung bei kritischem SOC
//   - Schneemodus für bedeckte PV-Module
// ====================================================================================

// @ts-nocheck
'use strict';

// ------------------------------------------------------------------------------------
//  KONFIGURATION
// ------------------------------------------------------------------------------------

/** @type {object} Datenpunkte */
const DP = {
    userDataBase:   '0_userdata.0',
    tibberBase:     '0_userdata.0.strom.tibber.',

    pvForecastToday:     '0_userdata.0.strom.pvforecast.today.gesamt.',
    pvForecastTomorrow:  '0_userdata.0.strom.pvforecast.tomorrow.gesamt.',
    pvLastUpdated:       '0_userdata.0.strom.pvforecast.lastUpdated',

    spntComCheck:        '0_userdata.0.strom.40151_Kommunikation_Check',
    momentanVerbrauch:   '0_userdata.0.strom.Momentan_Verbrauch',
    pvLeistungAktuell:   '0_userdata.0.strom.PV_Leistung_aktuell',
    tomorrowKw:          '0_userdata.0.strom.pvforecast.tomorrow.gesamt.tomorrow_kW',

    battLadenUhrzeit:    '0_userdata.0.strom.batterieLadenUhrzeit',
    battLadenUhrzeitStart: '0_userdata.0.strom.batterieLadenUhrzeitStart',
    battLadenManuellStart: '0_userdata.0.strom.batterieLadenManuellStart',
    battLadenManuellForce: '0_userdata.0.strom.batterieLadenManuellForce',

    // Tibber Extra Datenpunkte (Suffix zu tibberBase)
    tibberPreisJetzt:    '0_userdata.0.strom.tibber.extra.tibberPreisJetzt',
    tibberPvForcast:     '0_userdata.0.strom.tibber.extra.tibberPvForcast',

    // BYD Batterie direkter SOC
    bydDirectSOC:        'bydhvs.0.State.SOC',

    // EVCC Fahrzeugladepunkt
    evccConnected:   'evcc.0.loadpoint.1.status.connected',
    evccChargePower: 'evcc.0.loadpoint.1.status.chargePower',
    evccModus:       'evcc.0.loadpoint.1.status.mode',

    // Wetter (brightsky / DWD) – Temperaturprognose für Klima-Planung
    wetterTempHeuteMax:   'brightsky.0.daily.00.temperature_max',  // Max-Temperatur heute
    wetterTempMorgenMax:  'brightsky.0.daily.01.temperature_max',  // Max-Temperatur morgen

    // Whirlpool
    whirlpoolLeistung:    'zigbee2mqtt.0.0xd885acfffeef48c4.load_power',  // Whirlpool-Verbrauch in W
};

/** @type {object} Modbus Kommunikationsregister (Wechselrichter) */
const communicationRegisters = {
    fedInSpntCom:   'modbus.0.holdingRegisters.3.40151_Kommunikation',
    fedInPwrAtCom:  'modbus.0.holdingRegisters.3.40149_Wirkleistungvorgabe',
    // SHM Alternative (auskommentiert):
    // fedInSpntCom: 'modbus.1.holdingRegisters.2.40151_Kommunikation',
    // fedInPwrAtCom: 'modbus.1.holdingRegisters.2.40149_Wirkleistungvorgabe',
};

/** @type {object} Modbus Eingangsregister (Messwerte) */
const inputRegisters = {
    batSoC:                  'modbus.0.inputRegisters.3.30845_Batterie_Prozent',
    powerOut:                'modbus.0.inputRegisters.3.30867_Aktuelle_Netzeinspeisung',
    netzbezug:               'modbus.0.inputRegisters.3.30865_Aktueller_Netzbezug',
    triggerDP:               'modbus.0.inputRegisters.3.30193_Systemzeit_als_trigger',
    betriebszustandBatterie: 'modbus.0.inputRegisters.3.30955_Batterie_Zustand',
    battOut:                 'modbus.0.inputRegisters.3.31395_Momentane_Batterieentladung',
    battIn:                  'modbus.0.inputRegisters.3.31393_Momentane_Batterieladung',
    dc1:                     'modbus.0.inputRegisters.3.30773_DC-Leistung_1',
    dc2:                     'modbus.0.inputRegisters.3.30961_DC-Leistung_2',
    dcZaun:                  'modbus.2.inputRegisters.3.30773_DC-Leistung_1',
    powerAC:                 'modbus.0.inputRegisters.3.30775_AC-Leistung',
};

/** @type {object} Anlagenanlagenparameter (an die eigene Anlage anpassen) */
const CFG = {
    // WR Kommunikationswerte
    initComAus:             803,        // Kommunikation deaktivieren
    initComAn:              802,        // Kommunikation aktivieren

    // Batterie
    minDischarge:           0,          // Minimale Entladeleistung in W (0 = keine Begrenzung)
    batteryCapacity:        12800,      // Netto-Kapazität der Batterie in Wh (BYD HVS, 2.56 kWh/Modul)
    batteryTarget:          100,        // Gewünschtes Ladeziel in % (100 für Li-Ion, ~85 für Blei)
    batteryLadePowerMax:    5000,       // Maximale Ladeleistung in W
    lastPercentageLoadWith: 1500,       // Ladeleistung für die letzten 8% in W (Zellschonung, erhöht für zuverlässige Vollladung)
    bydSOCEmergency:        5,          // Notladung auslösen wenn SOC unter x %
    wrEfficiency:           0.93,       // WR-Effizienz (Li-Ion ~0.93, Blei ~0.80)
    lossFactor:             0.75,       // Gesamtsystemverlust in % (Lade + Entladen kombiniert)

    // Hausverbrauch
    baseLoad:               850,        // Grundlast des Hauses in W

    // PV Korrektur
    powerReduzierung:       0,          // Manuelle Reduzierung der PV-Prognose (bewölkt) in W
    power90Reduzierung:     0,          // Manuelle Reduzierung der PV-Prognose (wolkenlos) in W
    sundownReduzierungStunden: 2,       // Ladezeit am Abend um x Stunden kürzen (erhöht → mehr Druck zum frühen Volladen)

    // Tibber Preisschwellen
    startCharge:            0.1881,     // Eigenverbrauchspreis / Ladeschwelle in EUR/kWh
    maxHHOhnePV:            '23:59',    // Fallback-Sonnenaufgang wenn keine PV-Stunden (nicht ändern)

    // SMA EnergyMeter / Sunny Home Manager
    smaEm:                  'sma-em.0.xxxxx',  // Instanzname, leer lassen wenn nicht vorhanden

    // Fahrzeug (EVCC)
    considerVehicle:        true,       // Fahrzeugladung in Verbrauchsberechnung einbeziehen
    maxVehicleConsum:       4000,       // Maximaler Fahrzeugladestrom in W (Plausibilitätsprüfung)

    // Klimaanlage
    mitKlimaanlage:         true,                                               // Klimaanlage berücksichtigen?
    klimaVerbrauchDP:       'sonoff.0.gosund-1.ENERGY_Power',                   // Klimaanlage-Verbrauch DP (Momentmessung)
    klimaDP:                'esphome.0.xxxxx.Climate.xxxx.mode',   // Klimaanlage Status-DP schlafzimmer
    klimaDP2:               'esphome.0.xxxxx.Climate.xxxx.mode',   // Klimaanlage Status-DP mieter
    // Planungswerte: werden für Prognose/Tagesbedarf genutzt wenn Klima läuft oder morgen warm wird.
    klimaPlanungsLastW:     1500,   // Typischer Klimaverbrauch für Planung in W (Nennleistung ~1500W)
    klimaPlanungsStunden:   8,      // Typische Laufzeit pro Tag in Stunden (Sommer, relevant für Tagesbedarf)
    klimaTempSchwelle:      23,     // Ab dieser Außentemperatur (°C) wird Klima-Zuschlag in Planung eingerechnet
    klimaStartStunde:       12,     // Früheste Stunde ab der die Klima läuft (0–23) – davor kein Klima-Zuschlag
};

// Abgeleitete Konstanten (nicht ändern)
const _stop_discharge   = aufrunden(4, CFG.startCharge * (1 / CFG.lossFactor));  // Entladeschwelle: Ladepreis / Verlustfaktor
const _pwrAtCom_def     = CFG.batteryLadePowerMax * (253 / 230);                  // Max. Ladeleistung bei 253V = ~5500W

// ------------------------------------------------------------------------------------
//  ZUSTANDSVARIABLEN (Laufzeitdaten, nicht konfigurieren)
// ------------------------------------------------------------------------------------

let _debug                      = false;

// Messwerte
let _dc_now                     = 0;    // PV-Leistung aktuell in W
let _einspeisung                = 0;    // Netzeinspeisung in W
let _battOut                    = 0;    // Batterieentladung in W
let _battIn                     = 0;    // Batterieladung in W
let _netzbezug                  = 0;    // Netzbezug in W
let _verbrauchJetzt             = 0;    // Hausverbrauch aktuell in W
let _batsoc                     = 0;    // Batterie-SOC vom WR in %
let _bydDirectSOC               = 0;    // Batterie-SOC direkt von BYD in %
let _vehicleConsum              = 0;    // Fahrzeugladeleistung in W (nur pv-Modus, für PV-Überschuss-Check)
let _vehicleConsumTotal         = 0;    // Fahrzeugladeleistung in W (alle Modi, für _hausVerbrauch / batlefthrs)
let _isVehicleConn              = false;
let _istKlimaAn                 = 0;
let _istKlimaAn2                = 0;    // Klimaanlage 2 Status (number > 0 = läuft, kein eigener Verbrauchseintrag)
let _klimaLoad                  = 0;
let _klimaLoadPlanung           = 0;    // Planungswert: CFG.klimaPlanungsLastW wenn Klima heute läuft ODER morgen warm wird
let _tempMorgenMax              = 0;    // Außentemperatur morgen (brightsky), für vorausschauende Klima-Planung
let _tomorrow_kW                = 0;

// Steuerung
let _SpntCom                    = CFG.initComAus;
let _lastSpntCom                = 0;
let _lastpwrAtCom               = 0;
let _batteryLadePower           = CFG.batteryLadePowerMax;
let _max_pwr                    = CFG.minDischarge;
let _maxchrg                    = CFG.minDischarge;
let _mrkBattNotladung           = 0;
let _tick                       = 0;
let _tibber_active_idx          = 0;
let _today                      = new Date();

// Feature-Flags (werden aus Datenpunkten gelesen)
let _tibberNutzenSteuerung      = false;    // Tibber-Preisbasiertes Laden aktiv
let _tibberNutzenAutomatisch    = false;    // Tibber automatisch (aus DP)
let _prognoseNutzenSteuerung    = true;     // PV-Prognose-Laden aktiv
let _prognoseNutzenAutomatisch  = true;     // Prognose automatisch (aus DP)
let _batterieLadenUebersteuernManuell = false;
let _snowmode                   = false;    // Schneemodus: ignoriert PV-Prognose
let _nurEntladestunden          = false;    // Nur Entladezeiten verwenden
let _istLadezeit                = false;    // Aktuell PV-Ladezeit aktiv
let _istEntladezeit             = false;    // Aktuell Entladezeit aktiv
let _notLadung                  = false;    // Notladung aktiv

// Zeitberechnungen
let _sunup                      = '00:00';
let _sunupAstro                 = '00:00';
let _sundown                    = '00:00';
let _sundownAstro               = '00:00';
let _sunupTodayAstro            = '00:00';
let _hhJetzt                    = getHH();

// PV-Prognose Arrays (werden bei Änderung neu geladen)
let _pvforecastTodayArray       = [];
let _pvforecastTomorrowArray    = [];
let _entladeZeitenArray         = [];
let _lastPvLadeZeitenArrayJson  = '';   // Cache: letzter gesendeter Wert für pvLadeZeitenArray

// Tibber
let _tibberPreisJetzt           = 0;

// ------------------------------------------------------------------------------------
//  DATENPUNKTE ERSTELLEN (einmalig beim Start, existierende werden nicht überschrieben)
// ------------------------------------------------------------------------------------

/** Erstellt alle benötigten Benutzer-Datenpunkte */
function initUserDatapoints() {
    const tibberBase    = 'strom.tibber.';
    const udp           = DP.userDataBase;

    const states = [
        [tibberBase + 'debug',                          { name: 'Debug-Modus',                          type: 'boolean', read: true,  write: true,  role: 'state',  def: false }],
        [tibberBase + 'extra.PV_Abschluss',             { name: 'PV Abschluss ermittelt bis Uhrzeit',   type: 'string',  read: true,  write: false, role: 'value',  def: '--:--' }],
        [tibberBase + 'extra.schwellenwert_Entladung',  { name: 'Stoppe Entladung bei Preis von',        type: 'number',  read: true,  write: false, role: 'value',  unit: 'ct', def: 0 }],
        [tibberBase + 'extra.schwellenwert_Ladung',     { name: 'Starte Ladung mit Strom bei Preis von', type: 'number',  read: true,  write: false, role: 'value',  unit: 'ct', def: 0 }],
        [tibberBase + 'extra.Batterieladung_jetzt',     { name: 'Batterieladung jetzt',                  type: 'number',  read: true,  write: false, role: 'value',  unit: 'W',  def: 0 }],
        [tibberBase + 'extra.Batterieladung_soll',      { name: 'Batterieladung soll',                   type: 'number',  read: true,  write: false, role: 'value',  unit: 'W',  def: 0 }],
        [tibberBase + 'extra.Batterielaufzeit',         { name: 'Batterielaufzeit laut SOC',             type: 'string',  read: true,  write: false, role: 'value',  unit: 'h' }],
        [tibberBase + 'extra.BatterieRestladezeit',     { name: 'Batterierestladezeit',                  type: 'number',  read: true,  write: false, role: 'value',  unit: 'h',  def: 0 }],
        [tibberBase + 'extra.tibberNutzenAutomatisch',  { name: 'Mit Tibber laden erlauben',             type: 'boolean', read: true,  write: true,  role: 'state',  def: true }],
        [tibberBase + 'extra.tibberNutzenManuell',      { name: 'Tibber Preise manuell nutzen',          type: 'boolean', read: true,  write: true,  role: 'state',  def: false }],
        [tibberBase + 'extra.tibberNutzenManuellHH',    { name: 'Tibber manuell ab Stunde',              type: 'number',  read: true,  write: true,  role: 'value',  def: 0 }],
        [tibberBase + 'extra.tibberProtokoll',          { name: 'Tibber aktiver Modus Index',            type: 'number',  read: true,  write: false, role: 'value',  def: 0 }],
        [tibberBase + 'extra.entladeZeitenArray',       { name: 'Entladezeiten als Array',               type: 'array',   read: true,  write: false, role: 'json' }],
        [tibberBase + 'extra.ladeZeitenArray',          { name: 'Lade- und Nachladezeiten als Array',    type: 'array',   read: true,  write: false, role: 'json' }],
        [tibberBase + 'extra.pvLadeZeitenArray',        { name: 'PV-Ladezeiten als Array',               type: 'array',   read: true,  write: false, role: 'json' }],
        [tibberBase + 'extra.PV_Prognose',              { name: 'PV-Prognose gesamt',                    type: 'number',  read: true,  write: false, role: 'value',  unit: 'kWh', def: 0 }],
        [tibberBase + 'extra.PV_Prognose_kurz',         { name: 'PV-Prognose verkürzt (ab jetzt)',       type: 'number',  read: true,  write: false, role: 'value',  unit: 'kWh', def: 0 }],
        [tibberBase + 'extra.prognoseNutzenAutomatisch',{ name: 'Prognosebasiertes Laden',               type: 'boolean', read: true,  write: true,  role: 'state',  def: true }],
        [tibberBase + 'extra.PV_Schneebedeckt',         { name: 'PV mit Schnee bedeckt (Schneemodus)',   type: 'boolean', read: true,  write: true,  role: 'state',  def: false }],
        [tibberBase + 'extra.nutzeNurEntladezeiten',    { name: 'Nur Entladezeiten nutzen',              type: 'boolean', read: true,  write: true,  role: 'state',  def: false }],
        ['strom.batterieLadenManuellStart',             { name: 'Manuelles Laden starten',               type: 'boolean', read: true,  write: true,  role: 'state',  def: false }],
        ['strom.batterieLadenManuellForce',             { name: 'Manuelles Laden erzwingen',             type: 'boolean', read: true,  write: true,  role: 'state',  def: false }],
        ['strom.40151_Kommunikation_Check',             { name: 'WR Kommunikationsstatus',               type: 'number',  read: true,  write: false, role: 'value',  def: 803 }],
        ['strom.Momentan_Verbrauch',                    { name: 'Momentanverbrauch',                     type: 'number',  read: true,  write: false, role: 'value',  unit: 'kW', def: 0 }],
        ['strom.PV_Leistung_aktuell',                   { name: 'PV-Leistung aktuell (DC1+DC2)',         type: 'number',  read: true,  write: false, role: 'value',  unit: 'kW', def: 0 }],
    ];

    for (const [key, meta] of states) {
        createUserStates(udp, false, [key, meta], () => {});
    }

    // Schwellenwerte initial setzen
    setState(DP.tibberBase + 'extra.schwellenwert_Entladung', _stop_discharge, true);
    setState(DP.tibberBase + 'extra.schwellenwert_Ladung', CFG.startCharge, true);
}

// ------------------------------------------------------------------------------------
//  INITIALISIERUNG
// ------------------------------------------------------------------------------------

_debug              = getState(DP.tibberBase + 'debug').val ?? false;
_tibberPreisJetzt   = getState(DP.tibberPreisJetzt).val ?? 0;
_tibberNutzenAutomatisch    = false;
_prognoseNutzenAutomatisch  = true;

initUserDatapoints();

setState(communicationRegisters.fedInSpntCom, CFG.initComAus);
setState(DP.spntComCheck, CFG.initComAus, true);
setState(DP.tibberBase + 'extra.tibberProtokoll', 0, true);

console.info('=============================================================');
console.info(' PV-Batterie-Management Script gestartet | Debug: ' + _debug);
console.info(' Tibber-Preis  : ' + _tibberPreisJetzt + ' EUR/kWh' +
             ' | Tibber-Steuerung: ' + (_tibberNutzenAutomatisch ? 'AN' : 'AUS') +
             ' | Prognose: ' + (_prognoseNutzenAutomatisch ? 'AN' : 'AUS'));
console.info(' Ladeschwelle  : ' + CFG.startCharge + ' EUR/kWh');
console.info(' Entladeschwelle: ' + _stop_discharge + ' EUR/kWh');
console.info('=============================================================');

if (_tibberPreisJetzt <= _stop_discharge && _dc_now <= _verbrauchJetzt && _tibberNutzenSteuerung) {
    console.warn('INFO: Preis unter Schwelle beim Start – Begrenzung aktiv');
}

// PV-Daten initial laden
(async () => {
    const pvDaten            = await holePVDatenAb();
    _pvforecastTodayArray    = pvDaten.pvforecastTodayArray;
    _pvforecastTomorrowArray = pvDaten.pvforecastTomorrowArray;
})();

// ------------------------------------------------------------------------------------
//  HAUPTVERARBEITUNGSSCHLEIFE
// ------------------------------------------------------------------------------------

/**
 * Wird bei jedem WR-Trigger-Tick aufgerufen (z.B. alle 10-30s je nach Modbus-Intervall).
 * Führt Laderegel-Logik aus und sendet Sollwerte an den Wechselrichter.
 */
async function processing() {
    _tick++;

    // Watchdog: alle ~5 Minuten Protokoll zurücksetzen damit WR-Reset greift (WR auf 10 min Reset konfiguriert)
    if (_tick >= 30 && !_batterieLadenUebersteuernManuell) {
        if (_tibberNutzenSteuerung || _prognoseNutzenSteuerung) {
            setState(DP.spntComCheck, Math.floor(Math.random() * 100) + 1, true);
            setState(DP.tibberBase + 'extra.tibberProtokoll', 0, true);
            _tibber_active_idx = 0;
        }
        _tick = 0;
    }

    // PV-Ertrag Fenster berechnen (sortiert nach Uhrzeit, gefiltert auf relevante Stunden)
    const pvfc = await getPvErtrag();

    // PV Abschluss-Uhrzeit (letztes Eintrag-Zeitfenster)
    const pvBis = pvfc.length > 0 ? pvfc[pvfc.length - 1][4] : '--:--';
    setState(DP.tibberBase + 'extra.PV_Abschluss', pvBis, true);

    // Prüfe ob aktuell PV-Ladezeit
    _istLadezeit    = false;
    _istEntladezeit = false;

    for (const slot of pvfc) {
        if (compareTime(slot[3], slot[4], 'between')) {
            _istLadezeit = true;
            if (_debug) console.warn('-->> PV-Ladezeit erkannt: ' + slot[3] + ' - ' + slot[4]);
        }
    }

    // Fallback: PV liefert aktuell Strom aber kein geplantes Ladefenster (z.B. kurze Sonnenstunde)
    if (pvfc.length < 2 && _dc_now > 0) {
        _istLadezeit = true;
    }

    // Hilfswerte
    let toSundownhr                 = 0;
    let sundownReduzierung          = CFG.sundownReduzierungStunden; // Basiswert – wird in _processPvPrognoseLogik dynamisch erhöht
    const batterieLadenUhrzeit      = getState(DP.battLadenUhrzeit).val;
    const batterieLadenUhrzeitStart = getState(DP.battLadenUhrzeitStart).val;
    const battStatus                = getState(inputRegisters.betriebszustandBatterie).val;

    _batteryLadePower = CFG.batteryLadePowerMax;
    if (_battIn > 0) _batteryLadePower = _battIn; // aktuelle Ladeleistung wenn vorhanden

    if (_tibberNutzenSteuerung) {
        _tibberPreisJetzt = getState(DP.tibberPreisJetzt).val ?? 0;
    }

    _tomorrow_kW = getState(DP.tomorrowKw).val ?? 0;

    // Lademenge und Restladezeit berechnen
    const restlademenge = Math.max(
        Math.ceil((_batteryCapacityEffektiv() * (CFG.batteryTarget - _batsoc) / 100) * (1 / CFG.wrEfficiency)), 0
    );
    const restladezeit  = aufrunden(2, restlademenge / _batteryLadePower);
    setState(DP.tibberBase + 'extra.BatterieRestladezeit', restladezeit, true);

    if (_debug) {
        _logDebugStatus(battStatus, restladezeit, restlademenge);
    }

    // Initialisierung Leistungswerte
    _max_pwr  = CFG.minDischarge;
    _maxchrg  = CFG.minDischarge;

    // Bereinigter Hausverbrauch: Auto-Ladung herausrechnen (EVCC regelt selbst, egal ob PV oder Netz)
    // _vehicleConsumTotal erfasst den echten Ladestrom in allen Modi (pv / now / minpv)
    // → verhindert dass Nacht-Netzladung des Autos batlefthrs und Tibber-Planung verfälscht
    const _hausVerbrauch = Math.max(_verbrauchJetzt - _vehicleConsumTotal, CFG.baseLoad);

    // Vorab-Ladeleistung: wenn PV > bereinigter Verbrauch und Batterie nicht voll
    // _vehicleConsum herausrechnen: EVCC nimmt nur was übrig bleibt, kein Konflikt mit Batterie
    if (_dc_now > (_verbrauchJetzt - _vehicleConsum) && _batsoc < 100) {
        _max_pwr = (_dc_now - (_verbrauchJetzt - _vehicleConsum)) * -1;
    }

    const nowHour = _hhJetzt + ':' + _today.getMinutes();

    // Klimaanlage Berücksichtigung
    _klimaLoad        = 0;
    _klimaLoadPlanung = 0;
    if (CFG.mitKlimaanlage) {
        _istKlimaAn  = getState(CFG.klimaDP).val;   // number: > 0 = läuft
        _istKlimaAn2 = getState(CFG.klimaDP2).val;  // number: > 0 = läuft

        const istIrgendEineKlimaAn = _istKlimaAn > 0 || _istKlimaAn2 > 0;

        // Momentwert: nur für Echtzeit PV-Überschuss-Check (verbrauchOhneAuto, pvNettoUeberschuss)
        // Bedingung: Klima läuft UND PV reicht gerade nicht → Klima-Verbrauch kommt aus Netz/Batterie
        if (istIrgendEineKlimaAn && _dc_now < _verbrauchJetzt) {
            _klimaLoad = getState(CFG.klimaVerbrauchDP).val;
        }

        // Temperatur heute/morgen lesen (brightsky / DWD)
        _tempMorgenMax = getState(DP.wetterTempMorgenMax).val ?? 0;
        const tempHeuteMax = getState(DP.wetterTempHeuteMax).val ?? 0;

        // Planungswert für TAGESPLANUNG (Sonnenaufgang, PV-Slots, Tagesbedarf):
        //  a) Klima läuft gerade                → Tagplanung mit Klima-Zuschlag
        //  b) Heute wird/ist heiß               → Tagplanung mit Klima-Zuschlag
        //  c) Morgen wird heiß                  → Sonnenaufgang morgen mit Klima-Zuschlag
        // NICHT für Nachtladung – Tibber-Nachtladung wird grundsätzlich nicht genutzt.
        const klimaLaeuftHeute = istIrgendEineKlimaAn;
        const klimaWirdHeute   = tempHeuteMax   >= CFG.klimaTempSchwelle;

        if (klimaLaeuftHeute || klimaWirdHeute) {
            _klimaLoadPlanung = CFG.klimaPlanungsLastW;
        }

        if (_debug) {
            console.info(
                'Klima: läuft=' + istIrgendEineKlimaAn +
                ' | tempHeute=' + tempHeuteMax + '°C' +
                ' | tempMorgen=' + _tempMorgenMax + '°C' +
                ' | Schwelle=' + CFG.klimaTempSchwelle + '°C' +
                ' | klimaLoadPlanung=' + _klimaLoadPlanung + ' W' +
                ' | Grund: ' + (klimaLaeuftHeute ? 'Klima läuft' : '') +
                              (klimaWirdHeute  ? ' heiß heute'  : '') 
            );
        }
    }

    // Batterielaufzeit berechnen – Auto-Verbrauch herausrechnen (EVCC regelt selbst im pv-Modus)
    // _hausVerbrauch = max(_verbrauchJetzt - _vehicleConsum, CFG.baseLoad)
    const batlefthrs = aufrunden(2,
        (_batsoc * _batteryCapacityEffektiv() / 100) / (_hausVerbrauch / Math.sqrt(CFG.lossFactor))
    );
    setState(DP.tibberBase + 'extra.Batterielaufzeit', getMinHours(batlefthrs), true);

    // PV-Energiemengen berechnen (ganzer Tag)
    const hrsToRun  = 24;
    let pvwhToday   = _sumPvWhArray(_pvforecastTodayArray, hrsToRun * 2);
    let pvwhTomorrow = _sumPvWhArray(_pvforecastTomorrowArray, 48);

    setState(DP.tibberBase + 'extra.PV_Prognose', aufrunden(2, pvwhToday), true);

    if (_debug) {
        console.info('Batterielaufzeit: ' + batlefthrs + ' h');
        console.info('PV Prognose heute: ~' + aufrunden(2, pvwhToday / 1000) + ' kWh');
        console.info('PV Prognose morgen: ~' + aufrunden(2, pvwhTomorrow / 1000) + ' kWh');
    }

    // Sonnenauf- und Untergang aus Prognose ableiten
    _sundown = _sundownAstro;
    _sunup   = _sunupTodayAstro;
    let nextDay = false;

    if (!_snowmode) {
        if (_pvforecastTodayArray.length > 0) {
            if (pvfc.length > 0) _sundown = pvfc[pvfc.length - 1][4];

            for (let su = 0; su < 48; su++) {
                if (_pvforecastTodayArray[su][2] >= (CFG.baseLoad + _klimaLoadPlanung)) {
                    _sunup = _pvforecastTodayArray[su][0];
                    break;
                }
            }
        }

        // Morgen-Sonnenaufgang wenn wir nach dem heutigen sind
        if (_pvforecastTomorrowArray.length > 0 && _hhJetzt > parseInt(_sunup.slice(0, 2))) {
            for (let su = 0; su < 48; su++) {
                if (_pvforecastTomorrowArray[su][2] >= (CFG.baseLoad + _klimaLoadPlanung)) {
                    _sunup = _pvforecastTomorrowArray[su][0];
                    nextDay = true;
                    break;
                }
            }
        }
    }

    const hrsToNextSunup    = Number(await zeitDifferenzInStunden(nowHour, _sunup, nextDay));
    nextDay     = _hhJetzt > parseInt(_sundown.slice(0, 2));
    toSundownhr = Number(await zeitDifferenzInStunden(nowHour, _sundown, nextDay));

    if (_debug) {
        console.info('Nachtfenster (Berechnung): ' + _sundown + ' - ' + _sunup);
        console.warn('Bis Sonnenaufgang: ' + hrsToNextSunup + ' h | Bis Untergang: ' + toSundownhr + ' h');
        console.warn('PV Ladefenster: ' + pvfc.length + ' Slots');
    }

    // Verkürzte PV-Prognose (nur von jetzt bis Untergang)
    if (compareTime(_sunupTodayAstro, _sundownAstro, 'between') && toSundownhr > 0) {
        pvwhToday = 0;
        for (const slot of pvfc) {
            pvwhToday += slot[0];
        }
        pvwhToday = aufrunden(2, pvwhToday / 2);
        setState(DP.tibberBase + 'extra.PV_Prognose_kurz', pvwhToday, true);

        if (_debug) console.info('PV Prognose verkürzt: ~' + aufrunden(2, pvwhToday / 1000) + ' kWh');
    }

    const curbatwh  = aufrunden(2, (_batteryCapacityEffektiv() / 100) * _batsoc);
    let pvWh        = pvwhToday;
    if (compareTime(_sundown, '00:00', 'between')) pvWh = pvwhTomorrow; // nach Untergang: morgen-Wert nutzen

    // Winter-Fallback: kaum Sonnenstunden → setze Sonnenaufgang auf Mitternacht für korrekte Entladeberechnung
    if (pvwhToday * CFG.wrEfficiency < _batteryCapacityEffektiv() && restladezeit > pvfc.length / 2) {
        _sunup = CFG.maxHHOhnePV;
        if (_debug) console.error('Keine ausreichenden Ladestunden → sunup gesetzt auf: ' + _sunup);
    }

    let lefthrs = Math.ceil(batlefthrs * 2); // * 2 weil Tibber in 30-min-Slots rechnet

    // ====================  TIBBER-SEKTION  ====================
    if (_tibberNutzenSteuerung) {
        await _processTibberLogik(pvfc, pvWh, pvwhToday, batlefthrs, hrsToNextSunup,
            toSundownhr, lefthrs, restlademenge, curbatwh, _hausVerbrauch);
    } else {
        _tibber_active_idx = await entladezeitEntscheidung();
        await tibber_active_auswertung();
    }

    // ==================  PV PROGNOSE SEKTION  ==================

    // Übersteuern nach Uhrzeit: Prognose deaktivieren wenn manuell ab bestimmter Zeit + PV-Überschuss
    if (batterieLadenUhrzeitStart && _hhJetzt >= batterieLadenUhrzeit && _dc_now > _verbrauchJetzt) {
        if (_debug) console.warn('-->> Manuell nach Uhrzeit übersteuert');
        setState(DP.tibberBase + 'extra.prognoseNutzenAutomatisch', false, true);
        _prognoseNutzenSteuerung = false;
    }

    if (_prognoseNutzenSteuerung && _dc_now > 0) {
        await _processPvPrognoseLogik(pvfc, toSundownhr, sundownReduzierung, restlademenge);
    }

    // Netzrückkopplungskorrektur
    if ((_max_pwr - _netzbezug) > 0) {
        _max_pwr = _max_pwr - _netzbezug;
    }
    if (_max_pwr !== 0) {
        _max_pwr = _max_pwr * -1;
    }

    _maxchrg = aufrunden(0, _max_pwr);

    if (_lastpwrAtCom !== _maxchrg) {
        setState(DP.spntComCheck, Math.floor(Math.random() * 100) + 1, true); // WR-Reset-Trigger
    }

    if (_debug) {
        console.error('-->> Verlasse processing: SpntCom=' + _SpntCom + ' max_pwr=' + _max_pwr + ' idx=' + _tibber_active_idx);
    }

    sendToWR(_SpntCom, _maxchrg);
}

// ------------------------------------------------------------------------------------
//  TIBBER LOGIK (Preisoptimiertes Laden & Entladen)
// ------------------------------------------------------------------------------------

/**
 * Verarbeitet die Tibber-Preislogik:
 * Ermittelt Lade-/Entladezeiten basierend auf Tibber-Preisen und PV-Prognose.
 *
 * @param {Array}  pvfc         - PV-Ertrags-Array der aktuellen Fenster
 * @param {number} pvWh         - Erwartete PV-Energie (heute oder morgen)
 * @param {number} pvwhToday    - PV-Energie heute ab jetzt
 * @param {number} batlefthrs   - Batterielaufzeit in Stunden
 * @param {number} hrsToNextSunup - Stunden bis zum nächsten Sonnenaufgang
 * @param {number} toSundownhr  - Stunden bis Sonnenuntergang
 * @param {number} lefthrs      - Verbleibende Stunden (für Entladeplanung)
 * @param {number} restlademenge - Noch benötigte Lademenge in Wh
 * @param {number} curbatwh     - Aktuelle Batterieladung in Wh
 * @param {number} hausVerbrauch - Bereinigter Hausverbrauch ohne Auto und Klima in W
 */
async function _processTibberLogik(pvfc, pvWh, pvwhToday, batlefthrs, hrsToNextSunup,
                                    toSundownhr, lefthrs, restlademenge, curbatwh, hausVerbrauch) {

    const tibberPreisHeute      = getState(DP.tibberPvForcast).val;
    const tibberPoiAll          = await sortArrayByCurrentHour(tibberPreisHeute, true, _hhJetzt);
    const tibberPoihighSorted   = await sortArrayByCurrentHour(tibberPreisHeute, false, '00');

    let tibberPoilow            = await tibberPoilowErmittlung(tibberPoihighSorted);

    if (_debug) console.info('Tibber Preisslots: ' + tibberPoiAll.length);

    // --- Nachladeplanung ---
    let starteLadungTibber  = false;
    let ladeZeitenArray     = [];
    let prclow              = [];   // Slots unter Ladeschwelle
    let prchigh             = [];   // Slots über Entladeschwelle

    if (batlefthrs < hrsToNextSunup) {
        // Preise klassifizieren
        for (const slot of tibberPoiAll) {
            if (slot[0] <= CFG.startCharge)     prclow.push(slot);
            if (slot[0] > _stop_discharge)      prchigh.push(slot);
        }
        prclow.sort((a, b) => a[0] - b[0]); // aufsteigend nach Preis

        // Nachladebedarf: Tibber-Nachtladung wird nicht genutzt → nur baseLoad relevant.
        // Klima läuft tagsüber, Tibber nachts → schließen sich aus → _klimaLoadPlanung hier irrelevant.
        let nachladeMengeWh = (prchigh.length * (CFG.baseLoad / 2)) / CFG.wrEfficiency;

        if (hrsToNextSunup < 24 && !_snowmode) {
            nachladeMengeWh -= pvwhToday * CFG.wrEfficiency;
        }
        nachladeMengeWh = Math.max(aufrunden(2, nachladeMengeWh), 0);

        let nachladeStunden = aufrunden(2,
            Math.max(restlademenge / (CFG.batteryLadePowerMax * CFG.wrEfficiency), 0) * 2
        );
        nachladeStunden = Math.min(nachladeStunden, prclow.length);

        if (_debug) {
            console.info('Nachladestunden: ' + nachladeStunden +
                ' | curbatwh: ' + curbatwh +
                ' | NachladeMenge: ' + nachladeMengeWh + ' Wh' +
                ' | Hochpreis-Slots: ' + prchigh.length);
        }

        // Tagesbedarf für Nachladeplanung: nur baseLoad×24 – Tibber-Nachtladung nicht genutzt,
        // Klima-Zuschlag nur für Tagesplanung (PV) relevant, nicht für Nachtladen.
        const tagesbedarfWh = CFG.baseLoad * 24 * CFG.wrEfficiency;

        // Nachladezeit in Ladezeitarray einfügen wenn nötig
        if (nachladeStunden > 0 && pvWh < tagesbedarfWh) {
            if (aufrunden(2, nachladeMengeWh - curbatwh) > 0) {
                for (let i = 0; i < Math.round(nachladeStunden); i++) {
                    if (_debug) {
                        console.warn('Nachladezeit: ' + prclow[i][1] + '-' + prclow[i][2] +
                            ' @ ' + prclow[i][0] + ' EUR/kWh (' +
                            aufrunden(2, nachladeMengeWh - curbatwh) + ' Wh nötig)');
                    }
                    if (compareTime(prclow[i][1], prclow[i][2], 'between')) {
                        tibberPoilow.push(prclow[i]);
                        starteLadungTibber  = true;
                        _tibber_active_idx  = 1;
                        if (_debug) console.warn('-->> Nachladezeit aktiv');
                        break;
                    }
                }
            }
        }
    }

    // --- Entladeplanung ---
    _entladeZeitenArray     = [];
    let entladeZeitenArrayVis = [];

    const tibberPoihigh = await filterZeitSunup(tibberPoiAll, _sunup);  // bis Sonnenaufgang filtern

    if (_debug) console.info('Tibber Hochpreis-Slots (bis Sunup): ' + tibberPoihigh.length);

    if (lefthrs > 0 && lefthrs > tibberPoihigh.length) lefthrs = tibberPoihigh.length;

    // Situations-Erkennung für Entladezeiten
    // hausVerbrauch statt _verbrauchJetzt: Auto-Ladung soll keine falsche "kein PV"-Erkennung auslösen

    // Verbleibende Klima-Laufzeit ab jetzt bis Sonnenuntergang:
    // Klima startet frühestens um klimaStartStunde → Stunden ab jetzt bis zum Start abziehen.
    // Beispiel: jetzt 8 Uhr, Start 12 Uhr, Untergang 19 Uhr → 7h bis Untergang, 4h bis Start → 3h Klima
    //           jetzt 14 Uhr, Start 12 Uhr, Untergang 19 Uhr → 5h bis Untergang → min(8, 5) = 5h Klima
    const stundenBisKlimaStart = Math.max(0, CFG.klimaStartStunde - parseInt(_hhJetzt));
    const klimaStundenHeute    = Math.max(0, Math.min(CFG.klimaPlanungsStunden, toSundownhr - stundenBisKlimaStart));

    if (_dc_now < hausVerbrauch && !starteLadungTibber) {
        if (_debug) {
            console.info('PV heute: ' + pvwhToday + ' Wh | Bedarf bis Untergang: ' +
                (CFG.baseLoad * toSundownhr + _klimaLoadPlanung * klimaStundenHeute) * CFG.wrEfficiency + ' Wh' +
                ' | klimaStundenHeute: ' + klimaStundenHeute + 'h (Start: ' + CFG.klimaStartStunde + ':00, jetzt: ' + _hhJetzt + ')');
        }

        // Entladung aktiv wenn Akku > 0 und Preis hoch genug
        if (!_nurEntladestunden && batlefthrs > 0 && _tibberPreisJetzt > _stop_discharge && _dc_now > 0) {
            _tibber_active_idx = 21;
        }

        // Zwischenzeit: PV reicht für den Tag aber gerade keine Produktion
        // Klima-Anteil: nur ab klimaStartStunde bis Sonnenuntergang
        const pvBedarfBisUntergang =
            (CFG.baseLoad * toSundownhr + _klimaLoadPlanung * klimaStundenHeute)
            * CFG.wrEfficiency;

        if (!_nurEntladestunden &&
            pvwhToday > pvBedarfBisUntergang &&
            _tibberPreisJetzt <= _stop_discharge &&
            _dc_now < 1) {
            _tibber_active_idx = 20;
        }
    }

    // Entladezeiten befüllen
    for (let d = 0; d < lefthrs; d++) {
        if (tibberPoihigh[d][0] > _stop_discharge) {
            _entladeZeitenArray.push(tibberPoihigh[d]);
        }
    }

    if (_debug) console.warn('Entladezeiten: ' + JSON.stringify(_entladeZeitenArray));

    // Entladezeiten sortieren und Vis-Array aufbereiten
    if (_entladeZeitenArray.length > 0) {
        const sorted = await sortHourToSunup(
            await sortArrayByCurrentHour(_entladeZeitenArray, true, _hhJetzt), _sunup
        );
        _entladeZeitenArray     = sorted.arrOut;
        entladeZeitenArrayVis   = sorted.arrOutOnlyHH;

        if (batlefthrs > 0 && _dc_now < _verbrauchJetzt && !starteLadungTibber) {
            if (pvwhToday * CFG.wrEfficiency > _batteryCapacityEffektiv() && !_nurEntladestunden) {
                // Batterie reicht bis Sonnenaufgang
                if (batlefthrs >= hrsToNextSunup && _sunup !== CFG.maxHHOhnePV) {
                    if (compareTime(nowHour, addMinutesToTime(_sunup, 30), 'between')) {
                        if (_debug) console.warn('Entladezeit reicht bis Sonnenaufgang');
                        _istEntladezeit = true;
                        _tibber_active_idx = 22;
                        entladeZeitenArrayVis = [[0.0, '99:99', '--:--']];
                    }
                }
            }

            if (!_istEntladezeit) {
                _tibber_active_idx = await entladezeitEntscheidung();
                if (_tibber_active_idx === 23) {
                    entladeZeitenArrayVis = [[0.0, '--:--', '--:--']];
                }
            }
        }
    }

    setState(DP.tibberBase + 'extra.entladeZeitenArray', entladeZeitenArrayVis, true);

    // Nachtladung prüfen (Akku < 100%, kein PV, Preis günstig)
    // Hinweis: Tibber-Nachtladung wird in dieser Anlage nicht genutzt.
    // _klimaLoadPlanung wird hier NICHT eingerechnet – Klima läuft nachts nicht,
    // und für den nächsten heißen Tag wird tagsüber über PV geladen.
    if (_tibberPreisJetzt <= CFG.startCharge && _batsoc < 100 && _dc_now < 1) {
        const tagesbedarfNachtWh = CFG.baseLoad * 24 * CFG.wrEfficiency;
        if (pvWh < tagesbedarfNachtWh) {
            starteLadungTibber = true;
        }
        if (_debug) {
            console.info('pvWh: ' + pvWh + ' | Tagesbedarf (nur baseLoad): ' + tagesbedarfNachtWh +
                ' Wh | starteLadungTibber: ' + starteLadungTibber);
        }
    }

    // Ladezeitarray zusammenführen und deduplizieren
    tibberPoilow            = await doppelteRausAusArray(tibberPoilow);
    const ladeZeitenArrayMerged = await sortArrayByCurrentHour(
        ladeZeitenArray.concat(tibberPoilow), false, '00'
    );
    ladeZeitenArray         = ladeZeitenArrayMerged;

    // Ladung starten wenn Zeitfenster aktiv
    if (starteLadungTibber) {
        for (const slot of ladeZeitenArray) {
            if (compareTime(slot[1], slot[2], 'between')) {
                if (_debug) console.error('Starte Ladung (Tibber): ' + slot[1] + '-' + slot[2] + ' @ ' + slot[0] + ' EUR/kWh');
                _tibber_active_idx = 5;
                break;
            }
        }
    }

    setState(DP.tibberBase + 'extra.ladeZeitenArray', ladeZeitenArray, true);

    if (_debug) {
        console.info('Restladezeit: ' + restladezeit + ' h' +
            ' | Entladezeiten: ' + _entladeZeitenArray.length +
            ' | Ladezeiten: ' + ladeZeitenArray.length);
    }

    // Entladung stoppen wenn Preis unter Schwelle
    if (_tibberPreisJetzt <= _stop_discharge) {
        if (_istEntladezeit && pvfc.length < 1) {
            if (_debug) {
                console.warn('Stoppe Entladung: Preis ' + _tibberPreisJetzt +
                    ' EUR/kWh unter Schwelle ' + aufrunden(2, _stop_discharge));
            }
            if (_tibber_active_idx !== 22) _tibber_active_idx = 3;
        }
    }

    // Ladung stoppen wenn Zeitfenster kürzer als Restladezeit
    if (_tibber_active_idx === 5 && tibberPoilow.length > 0 && tibberPoilow.length / 2 < restladezeit) {
        if (_debug) console.error('Stoppe Ladung (Zeitfenster zu kurz)');
        _tibber_active_idx = 4;
    }

    if (_debug) {
        console.warn('-->> vor Auswertung: SpntCom=' + _SpntCom + ' idx=' + _tibber_active_idx);
    }

    await tibber_active_auswertung();
}

// ------------------------------------------------------------------------------------
//  PV PROGNOSE LOGIK
// ------------------------------------------------------------------------------------

/**
 * Steuert die PV-Überschuss-Laderegelung.
 * Berechnet die optimale Ladeleistung basierend auf verbleibender Ladezeit und -menge.
 *
 * @param {Array}  pvfc              - PV-Ertrags-Slots
 * @param {number} toSundownhr       - Stunden bis Sonnenuntergang
 * @param {number} sundownReduzierung - Stunden die vom Ende abgezogen werden
 * @param {number} restlademenge     - Noch zu ladende Energiemenge in Wh
 */
async function _processPvPrognoseLogik(pvfc, toSundownhr, sundownReduzierung, restlademenge) {
    // ---- Netzladen erkennen: Batterie lädt aus dem Netz (kein PV-Überschuss) ----
    // Kriterium: Netzbezug vorhanden UND Batterie lädt UND PV liefert weniger als Verbrauch
    // In diesem Fall greifen die PV-Optimierungen NICHT – Tibber steuert bereits (idx 1/5)
    const istNetzladen = (_netzbezug > 50) && (_battIn > 0) && (_dc_now < _verbrauchJetzt);

    if (_debug && istNetzladen) {
        console.warn('-->> Netzladen aktiv (Netzbezug=' + _netzbezug + ' W, BattIn=' + _battIn + ' W) – PV-Optimierungen deaktiviert');
    }

    // ---- Dynamische sundownReduzierung: je weniger SOC, desto größer der Ladedruck ----
    // Basis: CFG.sundownReduzierungStunden, Bonus: bis zu 2h extra bei niedrigem SOC.
    // Wenn Klimaanlage läuft: zusätzlicher Aufschlag von +1.5h auf die SOC-Stufe,
    // damit der Akku bis Tagesende zuverlässig voll wird – ohne sofortige Vollladung.
    // Die Energie wird weiterhin gleichmäßig über die verbleibende Zeit verteilt.
    // Gilt NICHT bei Netzladen (Tibber steuert dort).
    const istKlimaAnPv  = CFG.mitKlimaanlage && (_istKlimaAn > 0 || _istKlimaAn2 > 0);
    const klimaBonus    = istKlimaAnPv ? 1.5 : 0;  // Klima-Aufschlag auf den SOC-Stufen-Bonus
    let dynamicReduzierung = sundownReduzierung;
    if (!istNetzladen) {
        if (_batsoc < 50)       dynamicReduzierung = sundownReduzierung + 2   + klimaBonus;
        else if (_batsoc < 70)  dynamicReduzierung = sundownReduzierung + 1   + klimaBonus;
        else if (_batsoc < 85)  dynamicReduzierung = sundownReduzierung + 0.5 + klimaBonus;
        else                    dynamicReduzierung = sundownReduzierung        + klimaBonus;

        if (istKlimaAnPv && _debug) {
            console.warn('-->> Klima läuft: klimaBonus=' + klimaBonus + ' h addiert → dynamicReduzierung=' + dynamicReduzierung.toFixed(2) + ' h (SOC=' + _batsoc + '%)');
        }

        // Sicherheit: reduzierte Zeit muss mindestens 0.5h betragen
        const minVerbleibend = 0.5;
        if (toSundownhr - dynamicReduzierung < minVerbleibend) {
            dynamicReduzierung = Math.max(toSundownhr - minVerbleibend, 0);
        }
    }

    if (_debug) {
        console.error('--> PV-Prognose-Steuerung aktiv');
        console.info('PV-Abschluss: ' + (pvfc.length > 0 ? pvfc[pvfc.length - 1][4] : '--:--'));
        console.info('Ladezeit verfügbar: ' + pvfc.length + ' Slots | Reduktion (dynamisch): ' + dynamicReduzierung + ' h | SOC: ' + _batsoc + ' % | Netzladen: ' + istNetzladen + ' | Klima: ' + istKlimaAnPv);
    }

    // ---- Volllade-Boost: Zeit ist knapp und Akku noch nicht voll → volle Leistung ----
    // Greift wenn weniger Zeit verbleibt als die konfigurierte Reduzierung + 1h Puffer.
    // Nur aktiv wenn KEIN Netzladen läuft (sonst überschreibt es die Tibber-Netzladung)
    const boostSchwelle = CFG.sundownReduzierungStunden + 1;
    const boostAktiv = !istNetzladen && _batsoc < 99 && toSundownhr <= boostSchwelle && toSundownhr > 0 && _istLadezeit;
    if (boostAktiv) {
        _max_pwr = CFG.batteryLadePowerMax;
        _SpntCom = CFG.initComAn;
        if (_debug) console.warn('-->> VOLLLADE-BOOST aktiv (nur noch ' + toSundownhr.toFixed(1) + ' h bis Untergang, SOC=' + _batsoc + '%, Klima=' + istKlimaAnPv + ')');
        setState(DP.tibberBase + 'extra.Batterieladung_soll', _max_pwr, true);
        // Weiter in normale Logik → wird ggf. durch echten PV-Überschuss limitiert
    }

    if (_batsoc < 100 && _istLadezeit) {
        if (restlademenge > CFG.lastPercentageLoadWith) {
            // Normale Ladung: Energie gleichmäßig über verbleibende PV-Zeit verteilen
            let toSundownhrReduziert = toSundownhr;
            if (toSundownhr > dynamicReduzierung) toSundownhrReduziert = toSundownhr - dynamicReduzierung;

            _max_pwr = Math.max(
                Math.round(restlademenge / toSundownhrReduziert),
                CFG.lastPercentageLoadWith
            );
        } else {
            // Letzte ~8%: nur tatsächlichen PV-Überschuss nutzen
            // Kein Fix auf lastPercentageLoadWith – bei PV < Verbrauch regelt
            // der dc_now < verbrauchOhneAuto Zweig weiter unten korrekt
            _max_pwr = Math.round(_dc_now - _verbrauchJetzt);
        }


        // Sonst: nimm was der erste PV-Slot anbietet
        if (restlademenge === 0 && pvfc.length > 0) {
            _max_pwr = Math.ceil(pvfc[0][0]);
        }

        if (_debug) console.info('Ermittelte _max_pwr: ' + _max_pwr + ' W');

        _max_pwr = Math.ceil(Math.min(Math.max(_max_pwr, 0), CFG.batteryLadePowerMax));
        setState(DP.tibberBase + 'extra.Batterieladung_soll', _max_pwr, true);

        let verbrauchOhneAuto = _verbrauchJetzt;
        if (CFG.considerVehicle) verbrauchOhneAuto = _verbrauchJetzt - _vehicleConsum;

        // Klimaanlage läuft: deren Verbrauch 1× herausrechnen, damit der PV-Überschuss-Check
        // nicht fälschlich abbricht wenn Klima ~1500W zieht (besonders kritisch bei SOC > 90%)
        // klimaDP / klimaDP2 liefern number: > 0 = läuft – klimaVerbrauch wird nur 1× berücksichtigt
        const istKlimaAktiv  = CFG.mitKlimaanlage && _istKlimaAn > 0;
        const istKlima2Aktiv = CFG.mitKlimaanlage && _istKlimaAn2 > 0;
        const istIrgendEineKlimaAn = istKlimaAktiv || istKlima2Aktiv;
        if (istIrgendEineKlimaAn) verbrauchOhneAuto = verbrauchOhneAuto - _klimaLoad;
        if (_debug && istIrgendEineKlimaAn) console.warn('-->> Klima läuft (1=' + istKlimaAktiv + ', 2=' + istKlima2Aktiv + '): verbrauchOhneAuto korrigiert um ' + _klimaLoad + ' W (1×) → ' + verbrauchOhneAuto + ' W');

        if (_dc_now < verbrauchOhneAuto && _tibber_active_idx === 0) {
            _max_pwr = CFG.minDischarge; // Keine PV (bereinigt): nicht laden
        }

        _SpntCom = CFG.initComAn;

        if (_dc_now < verbrauchOhneAuto) {
            // Prognose hat getäuscht – aktuell nicht genug Sonne
            if (_debug) console.warn('-->> Nicht genug Sonne – breche ab');

            if (_tibberNutzenSteuerung) {
                if (_nurEntladestunden && _tibber_active_idx !== 5) {
                    _tibber_active_idx = 6;
                    _tibber_active_idx = await entladezeitEntscheidung(_tibber_active_idx);
                }
                if (!_nurEntladestunden && _tibber_active_idx === 3) {
                    _tibber_active_idx = 23;
                }
                await tibber_active_auswertung();
            } else {
                _SpntCom = CFG.initComAus; // Ohne Tibber: Entladung erlaubt

                if (_vehicleConsum > 1) {
                    _SpntCom = CFG.initComAn; // Fahrzeug lädt: Sperrung aktiv
                    if (_debug) console.warn('-->> Fahrzeug lädt – Sperrung aktiv');
                }
            }
        } else {
            if (_debug) console.warn('-->> PV-Überschuss vorhanden: ' + _max_pwr + ' W');

            // Echte PV ist kleiner als berechneter Soll-Wert → limitieren
            if (_max_pwr > (_dc_now - verbrauchOhneAuto) && _max_pwr > CFG.minDischarge) {
                _max_pwr = _dc_now - verbrauchOhneAuto;

                if (_tibber_active_idx === 5 && _tibberNutzenSteuerung) {
                    _max_pwr = CFG.batteryLadePowerMax; // Nachladezeit: volle Leistung
                }

                if (_debug) console.warn('-->> Limitiert auf PV-Überschuss: ' + _max_pwr + ' W');
            }
        }
    }

    // Letzten % langsam laden (oberhalb 92% SOC – erst dann drosseln für Zellschonung)
    // Nicht bei Netzladen – Tibber steuert die Ladeleistung dort selbst
    // PV-Check klimabereinigt: Klima-Verbrauch 1× herausrechnen wenn mindestens eine Klima läuft
    if (!istNetzladen && _batsoc > 92 && _battIn > 0 && _istLadezeit) {
        const istKlimaAktiv  = CFG.mitKlimaanlage && _istKlimaAn > 0;
        const istKlima2Aktiv = CFG.mitKlimaanlage && _istKlimaAn2 > 0;
        const istIrgendEineKlimaAn = istKlimaAktiv || istKlima2Aktiv;
        // klimaVerbrauch wird nur 1× berücksichtigt, egal ob eine oder beide Klimas laufen
        const pvNettoUeberschuss = _dc_now - _verbrauchJetzt + (istIrgendEineKlimaAn ? _klimaLoad : 0);
        if (_max_pwr > CFG.lastPercentageLoadWith) _max_pwr = CFG.lastPercentageLoadWith;
        if (_max_pwr < CFG.lastPercentageLoadWith && pvNettoUeberschuss > 0) _max_pwr = CFG.lastPercentageLoadWith;
        if (_debug) console.warn('-->> Limitiert auf Endladeleistung: ' + _max_pwr + ' W (pvNettoUeberschuss=' + pvNettoUeberschuss + ' W, Klima1=' + istKlimaAktiv + ', Klima2=' + istKlima2Aktiv + ')');
    }

    if (_debug) console.error('-->> Verlasse PV-Prognose: max_pwr=' + _max_pwr + ' | Netzbezug=' + _netzbezug);
}

// ------------------------------------------------------------------------------------
//  WR KOMMUNIKATION
// ------------------------------------------------------------------------------------

/**
 * Sendet Soll-Werte an den SMA Wechselrichter via Modbus.
 * Prüft ob eine tatsächliche Änderung vorliegt um unnötige Schreibzugriffe zu vermeiden.
 *
 * @param {number} commWR   - Kommunikationsregister-Wert (802=An, 803=Aus)
 * @param {number} pwrAtCom - Wirkleistungsvorgabe in W (negativ = laden)
 */
async function sendToWR(commWR, pwrAtCom) {
    const commNow = await getStateAsync(DP.spntComCheck);
    setState(DP.tibberBase + 'extra.tibberProtokoll', _tibber_active_idx, true);

    // Notladung: sofort WR deaktivieren
    if (_tibber_active_idx === 88) {
        if (commWR === CFG.initComAn || commWR === CFG.initComAus) {
            setState(communicationRegisters.fedInSpntCom, commWR);
            setState(DP.spntComCheck, commWR, true);
        }
        return;
    }

    if (_debug) console.error('sendToWR: manuellÜbersteuert=' + _batterieLadenUebersteuernManuell);

    if (!_batterieLadenUebersteuernManuell) {
        if (_tibberNutzenSteuerung || _prognoseNutzenSteuerung) {
            const wertGeaendert = _lastpwrAtCom !== pwrAtCom ||
                                  commWR !== commNow.val       ||
                                  commWR !== _lastSpntCom;

            if (wertGeaendert) {
                if (commWR === CFG.initComAn || commWR === CFG.initComAus) {
                    if (_debug) {
                        console.error('>> WR Befehl: Kommunikation=' + commWR + ' | Leistung=' + pwrAtCom + ' W');
                    }
                    setState(communicationRegisters.fedInPwrAtCom, pwrAtCom);
                    setState(communicationRegisters.fedInSpntCom, commWR);
                    setState(DP.spntComCheck, commWR, true);
                }
                setState(DP.tibberBase + 'extra.Batterieladung_jetzt', pwrAtCom, true);
            }

            if (_debug) {
                console.warn('SpntCom: ' + commWR + ' (vorher: ' + _lastSpntCom + ') | Leistung: ' + pwrAtCom + ' W (vorher: ' + _lastpwrAtCom + ') | idx: ' + _tibber_active_idx);
                console.info('------------------------------------------------------------------------');
            }
        }
    }

    _lastSpntCom    = commWR;
    _lastpwrAtCom   = pwrAtCom;
}

// ------------------------------------------------------------------------------------
//  VORVERARBEITUNG (Daten lesen, Flags setzen, Notladung prüfen)
// ------------------------------------------------------------------------------------

/**
 * Wird bei jedem Trigger-Tick aufgerufen.
 * Liest alle aktuellen Messwerte, setzt Feature-Flags und ruft processing() auf.
 */
async function vorVerarbeitung() {
    _today = new Date();
    const tomorrow = new Date(_today.getFullYear(), _today.getMonth(), _today.getDate() + 1);

    // Astro-Zeiten berechnen
    _sundownAstro    = _formatAstro('sunsetStart');
    _sunupTodayAstro = _formatAstro('sunriseEnd');
    _sunupAstro      = _formatAstro('sunriseEnd', tomorrow);

    // Messwerte einlesen
    _dc_now          = await berechnePV();
    _verbrauchJetzt  = await berechneVerbrauch();
    _hhJetzt         = getHH();
    _bydDirectSOC    = Math.min(getState(DP.bydDirectSOC).val ?? 0, 100);
    _batsoc          = Math.min(getState(inputRegisters.batSoC).val ?? 0, 100);

    // Konfigurationsflags aus Datenpunkten lesen
    _debug                          = getState(DP.tibberBase + 'debug').val ?? false;
    _snowmode                       = getState(DP.tibberBase + 'extra.PV_Schneebedeckt').val ?? false;
    _nurEntladestunden              = getState(DP.tibberBase + 'extra.nutzeNurEntladezeiten').val ?? false;
    _tibberNutzenAutomatisch        = getState(DP.tibberBase + 'extra.tibberNutzenAutomatisch').val ?? false;
    _prognoseNutzenAutomatisch      = getState(DP.tibberBase + 'extra.prognoseNutzenAutomatisch').val ?? true;

    _tibberNutzenSteuerung          = _tibberNutzenAutomatisch;
    _prognoseNutzenSteuerung        = _prognoseNutzenAutomatisch;

    // Manuelle Übersteuerungen
    const tibberNutzenManuell       = getState(DP.tibberBase + 'extra.tibberNutzenManuell').val ?? false;
    const tibberNutzenManuellHH     = getState(DP.tibberBase + 'extra.tibberNutzenManuellHH').val ?? 0;
    _batterieLadenUebersteuernManuell = getState(DP.battLadenManuellStart).val ?? false;

    const manuellAktiv = _batterieLadenUebersteuernManuell ||
        (tibberNutzenManuell && (_hhJetzt === tibberNutzenManuellHH || _hhJetzt === tibberNutzenManuellHH + 1));

    if (manuellAktiv) {
        _tibberNutzenSteuerung    = false;
        _prognoseNutzenSteuerung  = false;
        _lastSpntCom              = 98; // Kennung: manuell
        _tick                     = 0;
        if (_debug) console.warn('>> Manuelle Übersteuerung aktiv');
    }

    if (_debug) {
        console.info('tibberAuto=' + _tibberNutzenAutomatisch + ' | prognoseAuto=' + _prognoseNutzenAutomatisch);
    }

    // Notladung prüfen (hat höchste Priorität)
    _notLadung = await notLadungCheck();

    if (_notLadung) {
        _tibber_active_idx = 88;
        sendToWR(CFG.initComAus, 0);
    } else {
        await processing();
    }

    if (_debug) {
        console.info('tibberSteuerung=' + _tibberNutzenSteuerung + ' | prognoseSteuerung=' + _prognoseNutzenSteuerung);
    }
}

// ------------------------------------------------------------------------------------
//  HILFSFUNKTIONEN
// ------------------------------------------------------------------------------------

/**
 * Prüft ob eine Notladung der Batterie erforderlich ist.
 * Kriterien: BYD SOC unter Notladelimit UND WR meldet SOC=0 UND kein PV-Überschuss.
 * @returns {boolean}
 */
async function notLadungCheck() {
    if (_dc_now < _verbrauchJetzt) {
        if (_bydDirectSOC < CFG.bydSOCEmergency && _batsoc === 0) {
            if (_mrkBattNotladung !== _bydDirectSOC) {
                const msg = '⚡ NOTLADUNG: Batterie bei ' + _bydDirectSOC + '% um ' + _hhJetzt + ':00 Uhr';
                console.error(msg);
                toLog(msg, true);
                _mrkBattNotladung = _bydDirectSOC;
            }
            return true;
        }
    }
    return false;
}

/**
 * Berechnet die aktuelle PV-Leistung (DC1 + DC2 + Zaun) und schreibt sie in den Datenpunkt.
 * Nachts wird 0 zurückgegeben (Performance-Optimierung).
 * @returns {Promise<number>} PV-Leistung in W
 */
async function berechnePV() {
    let pVJetzt = 0;

    const isNight = compareTime(_sundownAstro, '00:00', 'between') ||
                    compareTime('00:00', _sunupAstro, 'between');

    if (!isNight) {
        const [dc1, dc2, dcZaun] = await Promise.all([
            getStateAsync(inputRegisters.dc1),
            getStateAsync(inputRegisters.dc2),
            getStateAsync(inputRegisters.dcZaun),
        ]);

        const dcZaunVal = Math.max(0, dcZaun.val ?? 0);

        pVJetzt = (dc1.val ?? 0) + (dc2.val ?? 0) + dcZaunVal;
    }

    if (pVJetzt < 2) pVJetzt = 0; // Messrauschen unterdrücken

    // Datenpunkt in kW aktualisieren
    setState(DP.pvLeistungAktuell, pVJetzt > 0 ? aufrunden(2, pVJetzt / 1000) : 0, true);

    return Number(pVJetzt);
}


/**
 * Berechnet den aktuellen Hausverbrauch aus Netz + PV + Batterie.
 * Schreibt den Verbrauch (ohne Fahrzeug) in den Datenpunkt.
 * @returns {Promise<number>} Hausverbrauch in W (gerundet)
 */
async function berechneVerbrauch() {
    // SMA EnergyMeter: Einspeisung direkt vom EM lesen wenn konfiguriert
    if (CFG.smaEm.length > 0) {
        inputRegisters.powerOut = CFG.smaEm + '.psurplus';
    }

    _einspeisung    = aufrunden(2, getState(inputRegisters.powerOut).val ?? 0);

    const [battOutState, battInState, netzbezugState] = await Promise.all([
        getStateAsync(inputRegisters.battOut),
        getStateAsync(inputRegisters.battIn),
        getStateAsync(inputRegisters.netzbezug),
    ]);
    _battOut    = battOutState.val ?? 0;
    _battIn     = battInState.val ?? 0;
    _netzbezug  = netzbezugState.val ?? 0;

    // Fahrzeugladung ermitteln
    _vehicleConsum      = 0; // Nur pv-Modus: für PV-Überschuss-Berechnung / verbrauchOhneAuto
    _vehicleConsumTotal = 0; // Alle Modi:    für _hausVerbrauch / batlefthrs (Netz- UND PV-Laden)

    if (CFG.considerVehicle) {
        _isVehicleConn = getState(DP.evccConnected).val ?? false;
        if (_isVehicleConn) {
            const rawConsum = getState(DP.evccChargePower).val ?? 0;
            const evccModus = getState(DP.evccModus).val;

            // _vehicleConsumTotal: echter Ladestrom egal ob Netz oder PV
            // → damit _hausVerbrauch / batlefthrs nicht durch Auto-Netzladung verfälscht werden
            if (rawConsum >= 0 && rawConsum <= CFG.maxVehicleConsum) {
                _vehicleConsumTotal = rawConsum;
            }

            // _vehicleConsum: nur im PV-Modus als Eigenverbrauch werten
            // → für verbrauchOhneAuto in PV-Überschuss-Check
            if (evccModus === 'pv' && rawConsum >= 0 && rawConsum <= CFG.maxVehicleConsum) {
                _vehicleConsum = rawConsum;
            }
            // evccModus !== 'pv' → _vehicleConsum bleibt 0 (Netzladen nicht als PV-Eigenverbrauch)
        }
        // !_isVehicleConn → beide Variablen bleiben 0
    }

    // Verbrauch = PV + Batterie-Out + Netzbezug − Einspeisung − Batterie-In
    const verbrauchJetzt = (_dc_now + _battOut + _netzbezug) - (_einspeisung + _battIn);

    // Vis-Datenpunkt: Verbrauch ohne Fahrzeug und ohne Whirlpool in kW
    //const _whirlpoolLeistung = getState(DP.whirlpoolLeistung)?.val ?? 0;
    //setState(DP.momentanVerbrauch, aufrunden(2, (verbrauchJetzt - _vehicleConsumTotal - _whirlpoolLeistung) / 1000), true);
    
    setState(DP.momentanVerbrauch, aufrunden(2, (verbrauchJetzt - _vehicleConsumTotal) / 1000), true);

    return aufrunden(0, verbrauchJetzt);
}

/**
 * Entscheidet ob eine Entladezeit aktiv sein soll.
 * Setzt _istEntladezeit und gibt den entsprechenden Index zurück.
 *
 * @param {number} [idxIn=0] - Eingehender Index (z.B. 6 für erzwungene Nur-Entladezeit)
 * @returns {Promise<number>} tibber_active_idx
 */
async function entladezeitEntscheidung(idxIn = 0) {
    let idx = idxIn;
    _istEntladezeit = false;

    if (_debug) {
        console.info('entladezeitEntscheidung: ' + _entladeZeitenArray.length +
            ' Slots | nurEntladen=' + _nurEntladestunden);
    }

    if (_nurEntladestunden && _tibberNutzenSteuerung) {
        for (const slot of _entladeZeitenArray) {
            idx = 6;
            if (compareTime(slot[1], slot[2], 'between')) {
                if (_debug) console.warn('Entladezeit gefunden: ' + slot[1] + '-' + slot[2]);
                _istEntladezeit = true;
                idx = 2;
                break;
            }
        }
    } else {
        idx = 23;
        _entladeZeitenArray = [];
        _istEntladezeit = true;
    }

    if (_debug) console.info('entladezeitEntscheidung: Ergebnis=' + idx + ' (vorher=' + idxIn + ')');

    return idx;
}

/**
 * Setzt SpntCom und max_pwr anhand des tibber_active_idx.
 *
 * Index-Bedeutung:
 *  0  = Neutral/Initialisierung
 *  1  = Nachladezeit (günstige Stunden)
 *  2  = Entladezeit aktiv
 *  3  = Entladung stoppen (Preisschwelle unterschritten)
 * 33  = wie 3, intern ausgelöst
 *  4  = Ladung stoppen (Zeitfenster kürzer als Restladezeit)
 *  5  = Ladung starten
 *  6  = Entladung stoppen (nur Entladestunden-Modus)
 * 20  = PV reicht, Zwischenzeit ohne Produktion, Preis unter Schwelle
 * 21  = Entladezeit: Akku > 0, Preis hoch genug
 * 22  = Entladezeit reicht aus bis Sonnenaufgang
 * 23  = Keine Entladezeit (alle Preise unter Schwelle, Akku hat Ladung)
 * 88  = Notladung
 * 99  = Manuelles Laden (externes Script)
 */
function tibber_active_auswertung() {
    _max_pwr = CFG.minDischarge;

    switch (_tibber_active_idx) {
        case 0:
            // Letzten bekannten Zustand wiederherstellen (WR-Watchdog)
            if (_dc_now < 2) {
                const lastIdx = getState(DP.tibberBase + 'extra.tibberProtokoll').val;
                _tibber_active_idx = (lastIdx === 0) ? 33 : lastIdx;
                if (!_tibberNutzenSteuerung) _tibber_active_idx = 2;
                tibber_active_auswertung();
                break;
            }
            if (!_istLadezeit) _SpntCom = CFG.initComAn;
            break;

        case 1:     // Nachladezeit
            _SpntCom = CFG.initComAn;
            _max_pwr = _batsoc > 90
                ? CFG.lastPercentageLoadWith * -1
                : _pwrAtCom_def * -1;
            break;

        case 2:     // Entladezeit
        case 20:    // Zwischenzeit, PV reicht für Tag
        case 21:    // Entladezeit, Akku > 0
        case 22:    // Entladezeit reicht bis Sonnenaufgang
        case 23:    // Keine Entladezeit
            _SpntCom = CFG.initComAus;
            break;

        case 3:     // Entladung stoppen (Preis)
        case 33:    // Entladung stoppen (intern)
        case 4:     // Ladung stoppen (Zeitfenster)
            _SpntCom = CFG.initComAn;
            break;

        case 5:     // Ladung starten
            _SpntCom = CFG.initComAn;
            _max_pwr = _batsoc > 90
                ? CFG.lastPercentageLoadWith * -1
                : _pwrAtCom_def * -1;
            break;

        case 6:     // Entladung stoppen (nur Entladestunden)
            _SpntCom = CFG.initComAn;
            _max_pwr = CFG.minDischarge;
            break;

        default:
            _SpntCom = CFG.initComAus;
            break;
    }
}

// ------------------------------------------------------------------------------------
//  PV-DATEN VERARBEITUNG
// ------------------------------------------------------------------------------------

/**
 * Berechnet die relevanten PV-Ertrags-Zeitfenster (Slots wo PV > Grundlast).
 * Nur Slots in der Zukunft (pvendtime <= jetzt) werden berücksichtigt.
 * @returns {Promise<Array>} Array mit [leistung1, leistung2, dauer, startzeit, endzeit]
 */
async function getPvErtrag() {
    const pvfc      = [];
    const minPower  = CFG.baseLoad + _klimaLoadPlanung;

    if (_pvforecastTodayArray.length > 0) {
        for (let p = 0; p < 48; p++) {
            const [pvstarttime, pvendtime, wert1, wert2] = _pvforecastTodayArray[p];

            if (wert1 > minPower || wert2 > minPower) {
                if (compareTime(pvendtime, null, '<=', null)) {
                    pvfc.push([wert1, wert2, 30, pvstarttime, pvendtime]);
                }
            }
        }
    }

    const pvfcJson = JSON.stringify(pvfc);
    if (pvfcJson !== _lastPvLadeZeitenArrayJson) {
        setState(DP.tibberBase + 'extra.pvLadeZeitenArray', pvfc, true);
        _lastPvLadeZeitenArrayJson = pvfcJson;
    }
    return pvfc;
}

/**
 * Liest alle 48 PV-Prognose-Datenpunkte für heute und morgen parallel aus.
 * Reduziert deutlich die Ladezeit durch parallele Datenpunkt-Abfragen.
 * @returns {Promise<{pvforecastTodayArray: Array, pvforecastTomorrowArray: Array}>}
 */
async function holePVDatenAb() {
    /**
     * Liest 48 PV-Prognose-Slots von einem Basispfad.
     * @param {string} basePath
     * @returns {Promise<Array>}
     */
    async function readPvSlots(basePath) {
        const promises = [];
        for (let p = 0; p < 48; p++) {
            promises.push(Promise.all([
                getStateAsync(basePath + p + '.startTime'),
                getStateAsync(basePath + p + '.endTime'),
                getStateAsync(basePath + p + '.power'),
                getStateAsync(basePath + p + '.power90'),
            ]));
        }
        const results = await Promise.all(promises);
        return results.map(([startTime, endTime, powerObj, power90Obj]) => {
            let power   = powerObj?.val   ?? 0;
            let power90 = power90Obj?.val ?? 0;
            power   = Math.max(power   - CFG.powerReduzierung,   0);
            power90 = Math.max(power90 - CFG.power90Reduzierung, 0);
            return [startTime.val, endTime.val, power, power90];
        });
    }

    const [pvforecastTodayArray, pvforecastTomorrowArray] = await Promise.all([
        readPvSlots(DP.pvForecastToday),
        readPvSlots(DP.pvForecastTomorrow),
    ]);

    return { pvforecastTodayArray, pvforecastTomorrowArray };
}

// ------------------------------------------------------------------------------------
//  TIBBER ARRAY-HILFSFUNKTIONEN
// ------------------------------------------------------------------------------------

/**
 * Filtert den Tibber-Array auf Slots bis zum Sonnenaufgang und sortiert nach Preis (absteigend).
 * @param {Array}  arrZeit - Tibber-Preis-Array
 * @param {string} sunup   - Sonnenaufgang im Format HH:MM
 * @returns {Promise<Array>}
 */
async function filterZeitSunup(arrZeit, sunup) {
    const sunupHH   = parseInt(sunup.split(':')[0], 10);
    const newArray  = [];

    for (const slot of arrZeit) {
        newArray.push(slot);
        if (parseInt(slot[1].split(':')[0], 10) === sunupHH) break;
    }

    newArray.sort((a, b) => b[0] - a[0]); // höchster Preis zuerst
    return newArray;
}

/**
 * Sortiert/Filtert Entladezeiten bis Sonnenaufgang.
 * Gibt zwei Arrays zurück: alle Slots und nur die vollen Stunden (für Vis).
 * @param {Array}  zeiten - Sortierte Zeitslots
 * @param {string} sunup  - Sonnenaufgang HH:MM
 * @returns {Promise<{arrOut: Array, arrOutOnlyHH: Array}>}
 */
async function sortHourToSunup(zeiten, sunup) {
    const sunupHour = parseInt(sunup.split(':')[0], 10);
    const arrOut    = [];
    const arrOutOnlyHH = [];

    for (const slot of zeiten) {
        const [hh, min] = slot[1].split(':').map(Number);
        arrOut.push(slot);
        if (min === 0) arrOutOnlyHH.push(slot);
        if (hh === sunupHour + 1) break;
    }

    arrOut.sort((a, b) => b[0] - a[0]); // höchster Preis zuerst
    return { arrOut, arrOutOnlyHH };
}

/**
 * Sortiert einen Tibber-Array nach Uhrzeit und positioniert ab der aktuellen Stunde.
 * @param {Array}   zeiten       - Tibber-Preis-Array
 * @param {boolean} toEnd        - true: ab jetzt sortieren (zukünftige Slots zuerst)
 * @param {string|number} currentHour - Aktuelle Stunde als Zahl oder HH-String
 * @returns {Promise<Array>}
 */
async function sortArrayByCurrentHour(zeiten, toEnd, currentHour) {
    const sorted = [...zeiten].sort((a, b) => {
        const [hA, mA] = a[1].split(':').map(Number);
        const [hB, mB] = b[1].split(':').map(Number);
        return hA !== hB ? hA - hB : mA - mB;
    });

    if (!toEnd) return sorted;

    const startIdx = sorted.findIndex(item => {
        const [h, m] = item[1].split(':').map(Number);
        return h > currentHour || (h === Number(currentHour) && m >= 30);
    });

    return startIdx >= 0
        ? sorted.slice(startIdx).concat(sorted.slice(0, startIdx))
        : sorted;
}

/**
 * Ermittelt alle Tibber-Slots mit Preis ≤ Ladeschwelle (aufsteigend sortiert).
 * @param {Array} arraySorted - Tibber-Preis-Array (nach Zeit sortiert)
 * @returns {Promise<Array>}
 */
async function tibberPoilowErmittlung(arraySorted) {
    const sorted = [...arraySorted].sort((a, b) => a[0] - b[0]);
    return sorted.filter(slot => slot[0] <= CFG.startCharge);
}

/**
 * Entfernt doppelte Einträge aus einem Array (basierend auf JSON-Serialisierung).
 * @param {Array} arr
 * @returns {Promise<Array>}
 */
async function doppelteRausAusArray(arr) {
    const seen = new Set();
    return arr.filter(item => {
        const key = JSON.stringify(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ------------------------------------------------------------------------------------
//  ALLGEMEINE HILFSFUNKTIONEN
// ------------------------------------------------------------------------------------

/**
 * Rundet eine Zahl auf die angegebene Anzahl Nachkommastellen.
 * Verwendet "round half away from zero" (kaufmännisches Runden).
 * @param {number} stellen - Anzahl Dezimalstellen
 * @param {number} zahl    - Zu rundende Zahl
 * @returns {number}
 */
function aufrunden(stellen, zahl) {
    // @ts-ignore
    return +(Math.round(Number(zahl) + 'e+' + Number(stellen)) + 'e-' + Number(stellen));
}

/**
 * Berechnet die Zeitdifferenz in Stunden zwischen zwei Uhrzeiten (HH:MM).
 * @param {string}  zeit1    - Startzeit HH:MM
 * @param {string}  zeit2    - Endzeit HH:MM
 * @param {boolean} nextDay  - true wenn Endzeit am nächsten Tag liegt
 * @returns {Promise<number>} Differenz in Stunden (dezimal, gerundet auf 2 Stellen)
 */
async function zeitDifferenzInStunden(zeit1, zeit2, nextDay) {
    const [h1, m1] = zeit1.split(':').map(Number);
    const [h2, m2] = zeit2.split(':').map(Number);

    let min1 = h1 * 60 + m1;
    let min2 = h2 * 60 + m2;

    if (nextDay) min2 += 24 * 60;

    const diff = Math.abs(min2 - min1);
    return aufrunden(2, diff / 60);
}

/**
 * Formatiert eine Dezimalstunden-Angabe als HH:MM String.
 * @param {number} timeInHours - Zeit in Stunden (z.B. 2.5 → '02:30')
 * @returns {string}
 */
function getMinHours(timeInHours) {
    const hours   = Math.floor(timeInHours);
    const minutes = Math.round((timeInHours - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Addiert Minuten zu einer Uhrzeit im HH:MM Format.
 * @param {string} timeStr       - Ausgangszeit HH:MM
 * @param {number} minutesToAdd  - Zu addierende Minuten
 * @returns {string} Neue Uhrzeit im HH:MM Format
 */
function addMinutesToTime(timeStr, minutesToAdd) {
    const [h, m] = timeStr.split(':').map(Number);
    const date   = new Date();
    date.setHours(h, m + minutesToAdd, 0, 0);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Gibt die aktuelle Stunde als Zahl zurück.
 * ioBroker-Funktion getHH() liefert Stunde als Zahl.
 * @returns {number}
 */
// getHH() ist eine ioBroker-Builtin-Funktion

/**
 * Berechnet die effektive nutzbare Batteriekapazität.
 * Verwendet für alle Berechnungen (SOC-Kalibrierung möglich).
 * @returns {number} Kapazität in Wh
 */
function _batteryCapacityEffektiv() {
    return CFG.batteryCapacity;
}

/**
 * Summiert PV-Energiemengen eines Arrays über eine bestimmte Anzahl Slots.
 * @param {Array}  arr      - PV-Prognose-Array
 * @param {number} maxSlots - Maximale Anzahl zu summierender Slots
 * @returns {number} Summe in Wh
 */
function _sumPvWhArray(arr, maxSlots) {
    if (!arr || arr.length === 0) return 0;
    let total = 0;
    const limit = Math.min(maxSlots, arr.length);
    for (let i = 0; i < limit; i++) {
        total += (arr[i][2] ?? 0) / 2; // /2 weil 30-min-Slots → kWh → Wh
    }
    return total;
}

/**
 * Formatiert ein Astro-Datum als HH:MM String.
 * @param {string} astroEvent - ioBroker Astro-Eventname
 * @param {Date}   [date]     - Optionales Datum (Standard: heute)
 * @returns {string}
 */
function _formatAstro(astroEvent, date) {
    const d = date ? getAstroDate(astroEvent, date) : getAstroDate(astroEvent);
    return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Gibt einen formatierten Debug-Status in die ioBroker Log aus.
 * @param {number} battStatus   - WR Batterie-Statusregister-Wert
 * @param {number} restladezeit - Restladezeit in h
 * @param {number} restlademenge - Restlademenge in Wh
 */
function _logDebugStatus(battStatus, restladezeit, restlademenge) {
    const battStatusText = {
        2291: 'Standby',
        3664: 'Notladebetrieb',
        2292: 'Laden',
        2293: 'Entladen',
    }[battStatus] || 'Aus';

    console.info('--- DEBUG TICK ' + _tick + ' ---');
    console.info('Verbrauch jetzt:     ' + _verbrauchJetzt + ' W');
    console.info('Einspeisung:         ' + aufrunden(2, _einspeisung) + ' W');
    console.info('PV Produktion:       ' + _dc_now + ' W');
    console.info('Batterie SOC:        ' + _batsoc + ' %');
    console.info('Batterie Status:     ' + battStatusText + ' (' + battStatus + ')');
    console.info('Restladezeit:        ' + restladezeit + ' h');
    console.info('Restlademenge:       ' + restlademenge + ' Wh');
    console.info('Ladeleistung akt.:   ' + _batteryLadePower + ' W');
    console.info('Nacht (Astro):       ' + _sundownAstro + ' - ' + _sunupAstro);
}

// ------------------------------------------------------------------------------------
//  EVENT-HANDLER & SCHEDULES
// ------------------------------------------------------------------------------------

/** Protokoll zurücksetzen wenn "nur Entladezeiten" geändert wird */
on({ id: DP.tibberBase + 'extra.nutzeNurEntladezeiten', change: 'ne' }, async () => {
    setState(DP.tibberBase + 'extra.tibberProtokoll', 0, true);
});

/** Letzten Kommunikationsstand zurücksetzen wenn Tibber-Automatik deaktiviert wird */
on({ id: DP.tibberBase + 'extra.tibberNutzenAutomatisch', change: 'ne', val: false }, async () => {
    _lastSpntCom = 97;
});

/** WR auf Aus setzen wenn Prognose-Automatik deaktiviert wird */
on({ id: DP.tibberBase + 'extra.prognoseNutzenAutomatisch', change: 'ne', val: false }, async () => {
    _lastSpntCom = 97;
    setState(communicationRegisters.fedInSpntCom, CFG.initComAus);
    setState(DP.spntComCheck, CFG.initComAus, true);
    setState(DP.tibberBase + 'extra.tibberProtokoll', 0, true);
});

/** Gute-Nacht-Routine: Prognose-Automatik reaktivieren, Zeitladen deaktivieren */
on({ id: '0_userdata.0.wohnung.rollo.steuerung.gutenNacht', change: 'ne', val: true }, () => {
    setState(DP.tibberBase + 'extra.prognoseNutzenAutomatisch', true, true);
    setState(DP.battLadenUhrzeitStart, false, true);
});

/** Haupttrigger: WR Systemzeit-Trigger → verarbeitung starten */
on({ id: inputRegisters.triggerDP, change: 'ne' }, async (obj) => {
    setState('0_userdata.0.strom.aktualisierung', obj.state.ts, true);
    setTimeout(async () => {
        await vorVerarbeitung();
    }, 500);
});

/** PV-Prognosedaten neu laden wenn sich lastUpdated ändert */
on({ id: DP.pvLastUpdated, change: 'ne' }, async () => {
    const pvDaten               = await holePVDatenAb();
    _pvforecastTodayArray       = pvDaten.pvforecastTodayArray;
    _pvforecastTomorrowArray    = pvDaten.pvforecastTomorrowArray;
    _lastPvLadeZeitenArrayJson  = ''; // Cache invalidieren → nächster Tick schreibt sofort
    if (_debug) console.info('PV-Prognosedaten aktualisiert');
});

/** Mitternacht: heute → morgen rotieren */
schedule('0 0 * * *', async () => {
    _pvforecastTodayArray    = _pvforecastTomorrowArray;
    _pvforecastTomorrowArray = [];
    _lastPvLadeZeitenArrayJson = ''; // Cache invalidieren → Tagswechsel erzwingt neues Schreiben
});
=======
// @ts-ignore
const userDataDP            = '0_userdata.0';
const tibberStromDP         = 'strom.tibber.';
const tibberDP              = userDataDP + '.' + tibberStromDP;
const pvforecastTodayDP     = userDataDP + '.strom.pvforecast.today.gesamt.';
const pvforecastTomorrowDP  = userDataDP + '.strom.pvforecast.tomorrow.gesamt.';
const spntComCheckDP        = userDataDP + '.strom.40151_Kommunikation_Check'; 
const tomorrow_kWDP         = userDataDP + '.strom.pvforecast.tomorrow.gesamt.tomorrow_kW';
const tibberPreisJetztDP    = tibberDP + 'extra.tibberPreisJetzt';
const tibberPvForcastDP     = tibberDP + 'extra.tibberPvForcast';

const batterieLadenUhrzeitDP        = userDataDP + '.strom.batterieLadenUhrzeit';
const batterieLadenUhrzeitStartDP   = userDataDP + '.strom.batterieLadenUhrzeitStart';
const batterieLadenManuellStartDP   = userDataDP + '.strom.batterieLadenManuellStart';
const batterieLadenManuellForceDP   = userDataDP + '.strom.batterieLadenManuellForce';

const pvUpdateDP                    = userDataDP + '.strom.pvforecast.lastUpdated';

const momentan_VerbrauchDP          = userDataDP + '.strom.Momentan_Verbrauch';
const pv_Leistung_aktuellDP         = userDataDP + '.strom.PV_Leistung_aktuell';

const bydDirectSOCDP                = 'bydhvs.0.State.SOC';                 // battSOC netto direkt von der Batterie

// debug
let _debug = getState(tibberDP + 'debug').val == null ? false : getState(tibberDP + 'debug').val;

//-------------------------------------------------------------------------------------
const _InitCom_Aus              = 803;
const _InitCom_An               = 802;

const _batteryCapacity          = 12800;                                // Netto Batterie Kapazität in Wh BYD 2.56 pro Modul
const _batteryTarget            = 100;                                  // Gewünschtes Ladeziel der Regelung (e.g., 85% for lead-acid, 100% for Li-Ion)
const _lastPercentageLoadWith   = -800;                                 // letzten 5 % laden mit xxx Watt
const _baseLoad                 = 850;                                  // Grundverbrauch in Watt
const _wr_efficiency            = 0.93;                                 // Batterie- und WR-Effizienz (e.g., 0.9 for Li-Ion, 0.8 for PB)
const _bydSOCEmergency          = 5;                                    // Notladung anstossen bei SOC kleiner als
const _mindischrg               = 0;                                    // min entlade W entweder 0 oder -1
const _batteryLadePowerMax      = 5000;                                 // max Batterie ladung 
const _lossfactor               = 0.75;                                 // System gesamtverlust in % (Lade+Entlade Effizienz)
const _pwrAtCom_def             = _batteryLadePowerMax * (253 / 230);   // max power bei 253V = 5500 W
const _sma_em                   = 'sma-em.0.3015242334';                // Name der SMA EnergyMeter/HM2 Instanz bei installierten SAM-EM Adapter, leer lassen wenn nicht vorhanden
let   _batteryLadePower         = _batteryLadePowerMax;                 // Ladeleistung laufend der Batterie in W
const _loadfact                 = 1 / _lossfactor;                      // 1,33
let   _istLadezeit              = false;                                // ladezeit gefunden merker
let   _istEntladezeit           = false;                                // Entladezeit gefunden merker
let   _nurEntladestunden        = false;                                // nutze nur entladestuden 
let   _netzbezug                = 0;

// manuelles reduzieren der PV um x Watt
let     _powerReduzierung           = 0;                                    // manuelles reduzieren der pv prognose pro stunde bewölkt
let     _power90Reduzierung         = 0;                                    // manuelles reduzieren der pv prognose pro stunde ohne wolken
const   _sundownReduzierungStunden  = 0;                                    // ladedauer verkürzen um x Stunden nach hinten

// Klimaanlagesteuerung dazu ist ein Wetteradapter notwendig der die Temperatur liefert
// die ladezeit wird dann laut verbrauch berechnet
const   _mitKlimaanlage           = false;                                            // soll die Klimaanlage berücksichtig werden
const   _wetterTemperaturDP       = 'openweathermap.0.forecast.day0.temperatureMax';  // beispiel hier openweathermap
const   _klimaVerbrauch           = 1500;                                             // manuell ermitteltes Wert wie viel Watt die Klimaanlage zieht 
let     _klimaLoad                = 0;                                                // manuell ermitteltes Wert wie viel Watt die Klimaanlage zieht 
const   _tempWetterSoll           = 23;                                               // referenz Wert ab da soll die klima mit berücksichtig werden
const   _klimaDP                  = 'esphome.0.C4D8D50BCE6E.Climate.3365136539.mode';                            // DP der klimaanlage zum check ob diese läuft
let     _istKlimaAn               = 0;                                                // läuft die klima bei mir 0 = aus
const   _reduzierungStundenKlima  = 2;                                                // ladedauer verkürzen um x Stunden nach hinten wenn klima an 

// tibber Preis Bereich
let   _snowmode                 = false;                                        // manuelles setzen des Schneemodus, dadurch wird in der Nachladeplanung die PV Prognose ignoriert, z.b. bei Schneebedeckten PV Modulen und der daraus resultierenden falschen Prognose
let   _start_charge             = 0.1881;                                       // Eigenverbrauchspreis
const _stop_discharge           = aufrunden(4, _start_charge * _loadfact);      // 0.19 * 1.33 = 0.2533 €
const _maxHHOhnePV             = '23:59';

// Fahrzeug mit berücksichtigen in Verbrauchsrechnung EVCC Adapter benötigt
const _considerVehicle   = false;                                                // soll fahrzeug mit berücksichtigt werden .. dazu muss evcc installiert sein
const _max_VehicleConsum = 4000;                                                // max Wert wenn Fahrzeug lädt
let   _isVehicleConn     = false;
let   _vehicleConsum     = 0;

const isVehicleConnDP    = 'evcc.0.loadpoint.1.status.connected';                // ist Fahrzeug gerade an der Ladeseule DP
const vehicleConsumDP    = 'evcc.0.loadpoint.1.status.chargePower';              // angaben in W
const evccModusDP        = 'evcc.0.loadpoint.1.status.mode';                     // lademodus

const communicationRegisters = {   
    fedInSpntCom: 'modbus.0.holdingRegisters.3.40151_Kommunikation',                  
    fedInPwrAtCom: 'modbus.0.holdingRegisters.3.40149_Wirkleistungvorgabe',
}

const inputRegisters = {
    batSoC: 'modbus.0.inputRegisters.3.30845_Batterie_Prozent',
    powerOut: 'modbus.0.inputRegisters.3.30867_Aktuelle_Netzeinspeisung',
    netzbezug: 'modbus.0.inputRegisters.3.30865_Aktueller_Netzbezug',
    triggerDP: 'modbus.0.inputRegisters.3.30193_Systemzeit_als_trigger',
    betriebszustandBatterie: 'modbus.0.inputRegisters.3.30955_Batterie_Zustand',
    battOut: 'modbus.0.inputRegisters.3.31395_Momentane_Batterieentladung',
    battIn: 'modbus.0.inputRegisters.3.31393_Momentane_Batterieladung',
    dc1: 'modbus.0.inputRegisters.3.30773_DC-Leistung_1',
    dc2: 'modbus.0.inputRegisters.3.30961_DC-Leistung_2',
    powerAC: 'modbus.0.inputRegisters.3.30775_AC-Leistung',
}

// ----------------------------- copy ab hier

let _dc_now                     = 0;
let _einspeisung                = 0;
let _battOut                    = 0;
let _battIn                     = 0;

let _SpntCom                    = _InitCom_Aus;
let _verbrauchJetzt             = 0;
let _lastSpntCom                = 0;
let _lastpwrAtCom               = 0;
let _bydDirectSOC               = 0;
let _mrkBattNotladung           = 0;
let _batsoc                     = 0;
let _max_pwr                    = _mindischrg;
let _maxchrg                    = _mindischrg;
let _tick                       = 0;
let _tibber_active_idx          = 0;
let _today                      = new Date();

let _pvforecastTodayArray       = [];
let _pvforecastTomorrowArray    = [];

let _notLadung                  = false;


// für tibber
let _tibberNutzenSteuerung      = false;                 //      soll tibber genutzt werden
let _tibberNutzenAutomatisch    = _tibberNutzenSteuerung;
let _tibberPreisJetzt           = getState(tibberPreisJetztDP).val;

// für prognose
let _prognoseNutzenSteuerung            = true;         //      wird _tibberNutzenAutomatisch benutzt (dyn. Strompreis)
let _prognoseNutzenAutomatisch          = _prognoseNutzenSteuerung; //wird _prognoseNutzenAutomatisch benutzt
let _batterieLadenUebersteuernManuell   = false;
let _tomorrow_kW                        = 0;
let _entladeZeitenArray                 = [];

let _sunup              = '00:00';
let _sunupAstro         = '00:00';
let _sundown            = '00:00';
let _sundownAstro       = '00:00';
let _sunupTodayAstro    = '00:00';
let _hhJetzt            = getHH();

createUserStates(userDataDP, false, [tibberStromDP + 'debug', { 'name': 'debug', 'type': 'boolean', 'read': true, 'write': true, 'role': 'state', 'def': false }], function () {
    setState(tibberDP + 'debug', _debug, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.PV_Abschluss', { 'name': 'PV Abschluss ermittelt bis Uhrzeit', 'type': 'string', 'read': true, 'write': false, 'role': 'value', 'def': '00:00' }], function () {
    setState(tibberDP + 'extra.PV_Abschluss', '--:--', true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.schwellenwert_Entladung', { 'name': 'stoppe Entladung bei Preis von', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'unit': 'ct', 'def': 0 }], function () {
    setState(tibberDP + 'extra.schwellenwert_Entladung', _stop_discharge, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.schwellenwert_Ladung', { 'name': 'starte Ladung mit Strom bei Preis von', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'unit': 'ct', 'def': 0 }], function () {
    setState(tibberDP + 'extra.schwellenwert_Ladung', _start_charge, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.Batterieladung_jetzt', { 'name': 'Batterieladung jetzt', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'unit': 'W', 'def': 0 }], function () {
    setState(tibberDP + 'extra.Batterieladung_jetzt', 0, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.Batterieladung_soll', { 'name': 'Batterieladung soll', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'unit': 'W', 'def': 0 }], function () {
    setState(tibberDP + 'extra.Batterieladung_soll', 0, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.Batterielaufzeit', { 'name': 'Batterielaufzeit laut SOC', 'type': 'string', 'read': true, 'write': false, 'role': 'value', 'unit': 'h'}], function () {
    setState(tibberDP + 'extra.Batterielaufzeit', '00:00', true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.BatterieRestladezeit', { 'name': 'Batterierestladezeit laut Batterieladung_jetzt', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0, 'unit': 'h'}], function () {
    setState(tibberDP + 'extra.BatterieRestladezeit', 0, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.tibberNutzenAutomatisch', { 'name': 'mit tibber laden erlauben', 'type': 'boolean', 'read': true, 'write': true, 'role': 'state', 'def': true }], function () {
    setState(tibberDP + 'extra.tibberNutzenAutomatisch', _tibberNutzenAutomatisch, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.tibberNutzenManuell', { 'name': 'nutze Tibber Preise manuell', 'type': 'boolean', 'read': true, 'write': true, 'role': 'state', 'def': false }], function () {
    setState(tibberDP + 'extra.tibberNutzenManuell', false, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.tibberProtokoll', { 'name': 'Tibberprotokoll', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0 }], function () {
    setState(tibberDP + 'extra.tibberProtokoll', 0, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.entladeZeitenArray', { 'name': 'entladezeiten als array', 'type': 'array', 'read': true, 'write': false, 'role': 'json' }], function () {
    setState(tibberDP + 'extra.entladeZeitenArray', [], true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.ladeZeitenArray', { 'name': 'lade- und nachladezeiten als array', 'type': 'array', 'read': true, 'write': false, 'role': 'json' }], function () {
    setState(tibberDP + 'extra.ladeZeitenArray', [], true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.pvLadeZeitenArray', { 'name': 'PV Ladezeiten als array', 'type': 'array', 'read': true, 'write': false, 'role': 'json' }], function () {
    setState(tibberDP + 'extra.pvLadeZeitenArray', [], true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.PV_Prognose', { 'name': 'PV_Prognose', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'unit': 'kWh', 'def': 0 }], function () {
    setState(tibberDP + 'extra.PV_Prognose', 0, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.PV_Prognose_kurz', { 'name': 'PV_Prognose_kurz', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'unit': 'kWh', 'def': 0 }], function () {
    setState(tibberDP + 'extra.PV_Prognose_kurz', 0, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.prognoseNutzenAutomatisch', { 'name': 'prognose Basiertes Laden ', 'type': 'boolean', 'read': true, 'write': true, 'role': 'state', 'def': true }], function () {
    setState(tibberDP + 'extra.prognoseNutzenAutomatisch', _prognoseNutzenAutomatisch, true);
});

// zum manuellen übersteuern
createUserStates(userDataDP, false, ['strom.batterieLadenManuellStart', { 'name': 'starte manuelles Laden der Batterie', 'type': 'boolean', 'read': true, 'write': true, 'role': 'state', 'def': false }], function () {
    setState(batterieLadenManuellStartDP, false, true);
});
createUserStates(userDataDP, false, ['strom.batterieLadenManuellForce', { 'name': 'manuelles Laden der Batterie erzwingen', 'type': 'boolean', 'read': true, 'write': true, 'role': 'state', 'def': false }], function () {
    setState(batterieLadenManuellForceDP, false, true);
});
createUserStates(userDataDP, false, ['strom.batterieLadenUhrzeitStart', { 'name': 'automatisch starten ab stunde', 'type': 'boolean', 'read': true, 'write': true, 'role': 'state', 'def': false }], function () {
    setState(batterieLadenUhrzeitStartDP, false, true);
});
createUserStates(userDataDP, false, ['strom.batterieLadenUhrzeit', { 'name': 'Batterie Laden ab Uhr', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 15 }], function () {
    setState(batterieLadenUhrzeitDP, 15, true);
});

/*   Zeile entfernen 
createUserStates(userDataDP, false, [tibberStromDP + 'extra.nutzeNurEntladezeiten', { 'name': 'nutze nur Entladezeiten', 'type': 'boolean', 'read': true, 'write': true, 'role': 'state', 'def': false }], function () {
    setState(tibberDP + 'extra.nutzeNurEntladezeiten', false, true);
});
//            zum einmaligen Erzeugen der Datenpunkte 
createUserStates(userDataDP, false, [tibberStromDP + 'extra.tibberNutzenManuellHH', { 'name': 'nutze Tibber Preise manuell ab Stunde ', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0 }], function () {
    setState(tibberDP + 'extra.tibberNutzenManuellHH', 0, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.tibberNutzenManuellProzent', { 'name': 'lade mit tibber bis SOC ', 'type': 'number', 'read': true, 'write': true, 'role': 'value', 'def': 100 }], function () {
    setState(tibberDP + 'extra.tibberNutzenManuellProzent', 0, true);
});
createUserStates(userDataDP, false, [tibberStromDP + 'extra.PV_Schneebedeckt', { 'name': 'ist die PV mit Schnee bedekt ', 'type': 'boolean', 'read': true, 'write': true, 'role': 'state', 'def': false }], function () {
    setState(tibberDP + 'extra.PV_Schneebedeckt', false, true);
});
createUserStates(userDataDP, false, ['strom.40151_Kommunikation_Check', { 'name': '40151_Kommunikation_Check', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 803 }], function () {
    setState(spntComCheckDP, _InitCom_Aus, true);
});
createUserStates(userDataDP, false, [strom.Momentan_Verbrauch', { 'name': 'Momentan_Verbrauch', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0, 'unit': 'kW', }], function () {
    setState(momentan_VerbrauchDP, 0, true);
});
createUserStates(userDataDP, false, ['strom.PV_Leistung_aktuell', { 'name': 'PV_Leistung_aktuell dc1 + dc2', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0, 'unit': 'kW', }], function () {
    setState(pv_Leistung_aktuellDP, 0, true);
});

Zeile entfernen  */

setState(communicationRegisters.fedInSpntCom, _InitCom_Aus);
setState(spntComCheckDP, _InitCom_Aus, true);
setState(tibberDP + 'extra.tibberProtokoll', 0, true);

console.info('***************************************************');
console.info('starte ladenNachPrognose mit debug ' + _debug);

// bei start immer initialisieren
if (_tibberPreisJetzt <= _stop_discharge && _dc_now <= _verbrauchJetzt && _tibberNutzenSteuerung) {
    console.warn('starte direkt mit Begrenzung da Preis unter schwelle');
}

// hole daten ab nach start
// @ts-ignore
const pvDaten               = await holePVDatenAb();
_pvforecastTodayArray       = pvDaten.pvforecastTodayArray;
_pvforecastTomorrowArray    = pvDaten.pvforecastTomorrowArray;

// ab hier Programmcode
async function processing() {

    _tick ++;

    if (_tick >= 30 && !_batterieLadenUebersteuernManuell) {       // alle 6= 1 min ticks reset damit der WR die Daten bekommt, WR ist auf 10 min reset Eingestellt
        if (_tibberNutzenSteuerung || _prognoseNutzenSteuerung) {
            setState(spntComCheckDP, Math.floor(Math.random() * 100) + 1, true);        // schreibe irgendwas da rein.. 
            setState(tibberDP + 'extra.tibberProtokoll', 0, true);
            _tibber_active_idx = 0;
        }
        _tick = 0;
    }

    // fülle den ertragsarray
    let pvfc                       = await getPvErtrag();             // gib mir den ertrag mit pvlimittierung               

    let pvBis = '--:--';
    if (pvfc.length > 0) {
        pvBis = pvfc[(pvfc.length - 1)][4];
    }

    setState(tibberDP + 'extra.PV_Abschluss', pvBis, true);

    _istLadezeit = false;
    _istEntladezeit = false;

    for (let p = 0; p < pvfc.length; p++) {                         // pvfc ist sortiert nach uhrzeit
        if (compareTime(pvfc[p][3], pvfc[p][4], 'between')) {
            _istLadezeit = true;
            if (_debug) {
                console.warn('-->> Bingo ladezeit ');
            }
        }
    }

    // keine ladezeit aber trotzdem genug sonne
    if (pvfc.length < 2 && _dc_now > 0) {
        _istLadezeit = true;
    }

    let toSundownhr                     = 0;
    let sundownReduzierung              = _sundownReduzierungStunden;
    let batterieLadenUhrzeit            = getState(batterieLadenUhrzeitDP).val;
    let batterieLadenUhrzeitStart       = getState(batterieLadenUhrzeitStartDP).val;
    let battStatus                      = getState(inputRegisters.betriebszustandBatterie).val;

    _batteryLadePower                   = _batteryLadePowerMax;
    _mrkBattNotladung                   = 0;

    if (_battIn > 0) {
        _batteryLadePower =_battIn;
    }

    if (_tibberNutzenSteuerung) {
        _tibberPreisJetzt   = getState(tibberPreisJetztDP).val;
    }

    _tomorrow_kW        = getState(tomorrow_kWDP).val;

    // Lademenge
    let restlademenge   = Math.max(Math.ceil((_batteryCapacity * (_batteryTarget - _batsoc) / 100) * (1 / _wr_efficiency)), 0);     //lademenge = Energiemenge bis vollständige Ladung 
    let restladezeit    = aufrunden(2, (restlademenge / _batteryLadePower));                                                        //Ladezeit = Energiemenge bis vollständige Ladung / Ladeleistung WR

    setState(tibberDP + 'extra.BatterieRestladezeit', restladezeit, true);

    if (_debug) {
        console.info('_tick___________________________ ' + _tick);
        console.info('Verbrauch jetzt_________________ ' + _verbrauchJetzt + ' W');
        console.info('Einspeisung_____________________ ' + aufrunden(2, _einspeisung) + ' W');
        console.info('PV Produktion___________________ ' + _dc_now + ' W');
        console.info('Batt_SOC________________________ ' + _batsoc + ' %');
        const battsts = battStatus == 2291 ? 'Batterie: Standby' : battStatus == 3664 ? 'Notladebetrieb' : battStatus == 2292 ? 'Batterie: laden' : battStatus == 2293 ? 'Batterie: entladen' : 'Batterie: Aus';
        console.info('Batt_Status_____________________ ' + battsts + ' = ' + battStatus);
        console.info('Restladezeit____________________ ' + restladezeit + ' h');
        console.info('Restlademenge___________________ ' + restlademenge + ' Wh');
        console.info('Ladeleistung Batterie jetzt_____ ' + _batteryLadePower + ' W');
        console.info('Nachtfenster nach Astro_________ ' + _sundownAstro + ' - ' + _sunupAstro);
    }

    _max_pwr                = _mindischrg;      // initialisiere
    _maxchrg                = _mindischrg;      // initialisiere

    if (_dc_now > _verbrauchJetzt && _batsoc < 100) {
        _max_pwr    = (_dc_now - _verbrauchJetzt) * -1;   // vorbelegung zum laden     
    }

    
    const nowHour               = _hhJetzt + ':' + _today.getMinutes();

    _klimaLoad = 0;

    if (_mitKlimaanlage) {
        _istKlimaAn = getState(_klimaDP).val;

        if (_istKlimaAn > 0 && _reduzierungStundenKlima > _sundownReduzierungStunden) {  // soll klima berückstichtigt werden dann nimm diese
            sundownReduzierung = _reduzierungStundenKlima;
        }

        const tempWetter = getState(_wetterTemperaturDP).val;
        if (tempWetter >= _tempWetterSoll) {
            if (_dc_now < _verbrauchJetzt) {    // wenn pv grösser als der verbrauch ist.. dann nimm die zeiten ohne klima
                _klimaLoad = _klimaVerbrauch;
            }
        }
    }

    let batlefthrs = aufrunden(2, (_batsoc * _batteryCapacity / 100) / (_verbrauchJetzt / Math.sqrt(_lossfactor)));    /// 12800 / 100 * 30  Batterielaufzeit laut SOC und berücksichtige Grundverbrauch         

    setState(tibberDP + 'extra.Batterielaufzeit', getMinHours(batlefthrs), true);

    //wieviel wh kommen in etwa von PV in den nächsten 24h
    let hrsToRun        = 24;
    let pvwhToday       = 0;
    let pvwhTomorrow    = 0;

    if (_pvforecastTodayArray.length > 0) {
        for (let p = 0; p < hrsToRun * 2; p++) {   // *2 weil 48 PV Datenpunkte
            pvwhToday   = pvwhToday + _pvforecastTodayArray[p][2] / 2;
        }
    }

    if (_pvforecastTomorrowArray.length > 0) {
        for (let p = 0; p < 48; p++) {   // *2 weil 48 PV Datenpunkte               
            pvwhTomorrow    = pvwhTomorrow  + _pvforecastTomorrowArray[p][2] / 2;
        }
    }

    if (_debug) {
        console.info('mit Klimaanlage__________________' + _mitKlimaanlage + ' _klimaLoad '  +_klimaLoad);
        console.info('Bat h verbleibend_____batlefthrs ' + batlefthrs);
        console.info('Erwarte PV ca___________________ ' + aufrunden(2, pvwhToday / 1000) + ' kWh');
        console.info('Erwarte PV morgen ca____________ ' + aufrunden(2, pvwhTomorrow / 1000) + ' kWh');
    }

    setState(tibberDP + 'extra.PV_Prognose', aufrunden(2, pvwhToday), true);

    _sundown       = _sundownAstro;
    _sunup         = _sunupTodayAstro;

    let nextDay         = false;

    if (!_snowmode) {
        if (_pvforecastTodayArray.length > 0) {
            if (pvfc.length > 0) {
                _sundown = pvfc[(pvfc.length - 1)][4];
            }

            for (let su = 0; su < 48; su++) {
                if (_pvforecastTodayArray[su][2] >= (_baseLoad + _klimaLoad)) {
                    _sunup = _pvforecastTodayArray[su][0];
                    break;
                }
            }
        }

        if (_pvforecastTomorrowArray.length > 0 && _hhJetzt > parseInt(_sunup.slice(0, 2))) {
            for (let su = 0; su < 48; su++) {
                if (_pvforecastTomorrowArray[su][2] >= (_baseLoad + _klimaLoad)) {
                    _sunup = _pvforecastTomorrowArray[su][0];
                    nextDay = true;
                    break;
                }
            }
        }
    }

    hrsToRun    = Number(await zeitDifferenzInStunden(nowHour, _sunup, nextDay));       
    nextDay     = _hhJetzt > parseInt(_sundown.slice(0, 2));
    toSundownhr = Number(await zeitDifferenzInStunden(nowHour, _sundown, nextDay));

    if (_debug) {
        console.info('Nachtfenster nach Berechnung : ' + _sundown + ' - ' + _sunup);
        console.warn('bis nächster Sonnenaufgang hrsToRun '  + hrsToRun + ' bis nächster Untergang toSundownhr ' + toSundownhr);
        console.warn('pv stunden pvfc.length ' + pvfc.length);
    }

    if (compareTime(_sunupTodayAstro, _sundownAstro, 'between')) {
        pvwhToday = 0;                                              // initialisiere damit die entladung läuft
        let t = 0;
        if (toSundownhr > 0) {
            //wieviel kwh kommen in etwa von PV ab jetzt
            for (t = 0; t < pvfc.length; t++) {
                pvwhToday = pvwhToday + pvfc[t][0];
            }
            pvwhToday = aufrunden(2, (pvwhToday /2));

            setState(tibberDP + 'extra.PV_Prognose_kurz', pvwhToday, true);

            if (_debug) {
                console.info('Erwarte PV verkürzt ca__________ ' + aufrunden(2, pvwhToday / 1000) + ' kWh');
                //  console.info('_pvforecastTodayArray : ' + JSON.stringify(_pvforecastTodayArray[p]));
            }
        }
    }

    let curbatwh            = aufrunden(2, ((_batteryCapacity / 100) * _batsoc));     // batterie ladung 

    let pvWh                = pvwhToday;
    if (compareTime(_sundown, '00:00', 'between')) {
        pvWh = pvwhTomorrow;              // vor 00:00 brauchen wir den morgen wert
    }

    // im winter wenn keine oder sehr wenige ladezeiten (wenn überhaupt) dann setzte _sunup aus mitternacht für später entladezeitenermittlung
    if (pvwhToday * _wr_efficiency < _batteryCapacity && restladezeit > pvfc.length /2) { 
    // if (pvwhToday * _wr_efficiency < _batteryCapacity && restladezeit > pvfc.length /2 && _hhJetzt > parseInt(_sunup.slice(0, 2))) {    
        _sunup = _maxHHOhnePV;
        if (_debug) {
            console.error('keine ladestunden vorhanden sunup gesetzt auf : ' + _sunup);
        }
    }

    let lefthrs                 = Math.ceil(batlefthrs *2);                         // Batterielaufzeit laut SOC muss doppelt gerechnet werden da 30 min für tibber abgleich

    if (_tibberNutzenSteuerung) {
        const tibberPreisHeute      = getState(tibberPvForcastDP).val;
        const tibberPoiAll          = await sortArrayByCurrentHour(tibberPreisHeute, true, _hhJetzt);  // sortiert ab jetzt
        const tibberPoihighSorted   = await sortArrayByCurrentHour(tibberPreisHeute, false, '00');     // sortiert ab 0 Uhr

        //console.info('tibberPoiAll ' +  JSON.stringify(tibberPoiAll));
        //console.info('tibberPoihighSorted ' +  JSON.stringify(tibberPoihighSorted));

        let tibberPoilow = await tibberPoilowErmittlung(tibberPoihighSorted);
    
        //console.info('tibberPoilow ' +  JSON.stringify(tibberPoilow));    

        
        if (_debug) {
            console.info('Tibber tibberPoiAll.length ' + tibberPoiAll.length);
            //    console.info('tibberPoiAll vor nachladen: ' + JSON.stringify(tibberPoiAll));
        }

        // Nachladestunden Ermittlung
        let starteLadungTibber  = false;       
        let ladeZeitenArray     = [];        
        let prclow              = [];
        let prchigh             = [];

        if (batlefthrs < hrsToRun) {
            for (let h = 0; h < tibberPoiAll.length; h++) {
                if (tibberPoiAll[h][0] <= _start_charge) {
                    prclow.push(tibberPoiAll[h]);
                }
                if (tibberPoiAll[h][0] > _stop_discharge) {
                    prchigh.push(tibberPoiAll[h]);
                }
            }

            prclow.sort(function (a, b) {
                return a[0] - b[0];
            })

            //nachlademenge Wh nach höchstpreisen am Tag muss aber über schwellenwert sein sonst lohnt sich das nachladen nicht schwellenwert_Entladung         
            let nachladeMengeWh = ((prchigh.length * ((_baseLoad + _klimaLoad) /2)) / _wr_efficiency);   // ich mag alles in klammern

            if (hrsToRun < 24 && !_snowmode) {
                nachladeMengeWh = nachladeMengeWh - (pvwhToday * _wr_efficiency);
            }

            if (nachladeMengeWh < 0) {
                nachladeMengeWh = 0;
            } else {
                nachladeMengeWh =  aufrunden(2, nachladeMengeWh);
            }

            let nachladeStunden = aufrunden(2, (Math.max(restlademenge / (_batteryLadePowerMax * _wr_efficiency), 0) * 2));

            // neuaufbau ohne Nachladestunden, billigstunden
            if (_debug) {
                //   console.info(JSON.stringify(prclow)); 
                console.info('Nachladestunden ' + nachladeStunden + ' curbatwh ' + curbatwh + ' nachladeMengeWh ' + nachladeMengeWh + ' prchigh.length ' + prchigh.length);
            }

            if (nachladeStunden > prclow.length) {
                nachladeStunden = prclow.length;
            }

            if (_debug) {
                console.info('nach Nachladestunden prclow.length ' + nachladeStunden + ' restlademenge ' + restlademenge + ' Erwartet pvWh ' + pvWh);
                //  console.info('prclow  Nachladestunden ' + JSON.stringify(prclow));              
                //  console.info('prchigh Nachladestunden ' + JSON.stringify(prchigh));
            }

            if (nachladeStunden > 0 && pvWh < (_baseLoad + _klimaLoad) * 24 * _wr_efficiency) {
                // aufbau der zeiten zum nachladen weiter im _tibber_active_idx = 5
                if (aufrunden(2, nachladeMengeWh - curbatwh) > 0) {
                    for (let i = 0; i < aufrunden(0,nachladeStunden); i++) {
                        if (_debug) {
                            console.warn('Nachladezeit: ' + prclow[i][1] + '-' + prclow[i][2] + ' zum Preis ' + prclow[i][0] + ' (' + aufrunden(2, nachladeMengeWh - curbatwh) + ' Wh)');
                        }
                        if (compareTime(prclow[i][1], prclow[i][2], 'between')) {
                            tibberPoilow.push(prclow[i]);
                            // aus der nachladung starten setzen
                            starteLadungTibber = true;
                            _tibber_active_idx = 1;        // wird nicht gebraucht da im _tibber_active_idx = 5 aufgeht später

                            if (_debug) {
                                console.warn('-->> Bingo nachladezeit');
                                console.warn('-->> starteLadungTibber ' + starteLadungTibber);
                            }
                            break;
                        }
                    }
                }
            }
        }

        _entladeZeitenArray         = [];
        let entladeZeitenArrayVis   = [];
        let tibberPoihigh           = await filterZeitSunup(tibberPoiAll, _sunup);      // sortiert nach preis und stunden grösser jetzt und bis zu sunup oder 14 uhr        

        if (_debug) {
            console.info('tibberPoihigh.length '+ tibberPoihigh.length);
            //console.info('tibberPoihigh nach filter ' + JSON.stringify(tibberPoihigh));
        }

        if (lefthrs > 0 && lefthrs > tibberPoihigh.length) {        // limmitiere auf Tibber höchstpreise
            lefthrs = tibberPoihigh.length;
        }

        if (_debug) {
            console.info('------>>  laufzeit mit tibber höchstpreise a 30 min: lefthrs ' + lefthrs + ' Batterielaufzeit: batlefthrs ' + batlefthrs);
        }

        if (_dc_now < _verbrauchJetzt && !starteLadungTibber) {
            // wenn genug PV am Tag aber gerade nicht genug Sonne aber tibber klein genug
            if (_debug) {
                console.info('pvwhToday ' + pvwhToday + ' benötigt werden ' + ((_baseLoad + _klimaLoad) * toSundownhr * _wr_efficiency) + ' _dc_now ' + _dc_now);
            }

            // Entladezeit wenn was im akku und preis hoch genug um zu sparen 
            if (!_nurEntladestunden && batlefthrs > 0 && _tibberPreisJetzt > _stop_discharge  && _dc_now > 0) {
                _tibber_active_idx = 21;
            }

            if (!_nurEntladestunden && pvwhToday > ((_baseLoad + _klimaLoad) * toSundownhr * _wr_efficiency) && _tibberPreisJetzt <= _stop_discharge && _dc_now < 1) {
                _tibber_active_idx = 20;
            }
        }

        // Entladezeit
        for (let d = 0; d < lefthrs; d++) {
            if (tibberPoihigh[d][0] > _stop_discharge) {
                //console.info('alle Entladezeiten: ' + tibberPoihigh[d][1] + '-' + tibberPoihigh[d][2] + ' Preis ' + tibberPoihigh[d][0] + ' Fahrzeug zieht ' + _vehicleConsum + ' W');
                _entladeZeitenArray.push(tibberPoihigh[d]);
            }
        }

        if (_debug) {
            console.warn(JSON.stringify(_entladeZeitenArray));
        }

        // sortiere entladeZeiten
        if (_entladeZeitenArray.length > 0) {
            const entladeZeitenArrayAll     = await sortHourToSunup(await sortArrayByCurrentHour(_entladeZeitenArray, true, _hhJetzt), _sunup);
            _entladeZeitenArray             = entladeZeitenArrayAll.arrOut;
            entladeZeitenArrayVis           = entladeZeitenArrayAll.arrOutOnlyHH;

            if (batlefthrs > 0 && _dc_now < _verbrauchJetzt && !starteLadungTibber) {
              //  if (pvfc.length > 0 && !_nurEntladestunden) {                               // bekomme ich batterie aufgeladen  
                if (pvwhToday * _wr_efficiency > _batteryCapacity && !_nurEntladestunden) {                                      
                    if (batlefthrs >= hrsToRun) {
                        if (_sunup != _maxHHOhnePV) {
                            if (compareTime(nowHour, addMinutesToTime(_sunup, 30), 'between')) {    // wenn rest battlaufzeit > als bis zum sonnenaufgang oder sonnenaufgang + 30 min
                                if (_debug) {
                                    console.warn('Entladezeit reicht aus bis zum Sonnaufgang');
                                }
                                _istEntladezeit = true;
                                _tibber_active_idx = 22;
                                entladeZeitenArrayVis = [];
                                entladeZeitenArrayVis.push([0.0,"99:99","--:--"]);  //  initialisiere für Vis
                            }
                        }
                    }
                }
                if (!_istEntladezeit) {                     // Entladezeit reicht aus bis zum Sonnaufgang von oben
                    _tibber_active_idx = await entladezeitEntscheidung();
                    if (_tibber_active_idx == 23) {
                        entladeZeitenArrayVis = [];
                        entladeZeitenArrayVis.push([0.0,"--:--","--:--"]);  //  initialisiere für Vis     
                    }
                }
              
            }
        }

        setState(tibberDP + 'extra.entladeZeitenArray', entladeZeitenArrayVis,  true);

        // in der nacht starten setzen
        if (_tibberPreisJetzt <= _start_charge && _batsoc < 100 && _dc_now < 1) {           // wir sind in der nacht            
            if (pvWh < (_baseLoad + _klimaLoad) * 24 * _wr_efficiency) {
                starteLadungTibber = true;
            }

            if (_debug) {
                console.info('pvwh ' + pvWh + ' ist kleiner als ' + (_baseLoad + _klimaLoad) * 24 * _wr_efficiency + ' starteLadungTibber ' + starteLadungTibber);
            }
        }

        tibberPoilow                = await doppelteRausAusArray(tibberPoilow);
        const ladeZeitenArrayTmp    = ladeZeitenArray.concat(tibberPoilow);      // füge die 2 arrays zusammen            
        ladeZeitenArray             = await sortArrayByCurrentHour(ladeZeitenArrayTmp, false, '00');

        // starte die ladung
        if (starteLadungTibber) {
             for (let i = 0; i < ladeZeitenArray.length; i++) {
                if (compareTime(ladeZeitenArray[i][1], ladeZeitenArray[i][2], 'between')) {
                    if (_debug) {
                        console.error('Starte Ladung mit tibber : ' + ladeZeitenArray[i][1] + '-' + ladeZeitenArray[i][2] + ' Preis ' + ladeZeitenArray[i][0]);
                    }
                    _tibber_active_idx = 5;
                    break;
                }
            }
        }

        setState(tibberDP + 'extra.ladeZeitenArray', ladeZeitenArray, true);

        if (_debug) {
            console.info('restladezeit : ' + restladezeit + '_entladeZeitenArray ' + _entladeZeitenArray.length + ' ladeZeitenArray ' + ladeZeitenArray.length);
            //   console.info('ladeZeitenArray ' + JSON.stringify(ladeZeitenArray));
        }

        // stoppe die Entladung
        if (_tibberPreisJetzt <= _stop_discharge) {
            if (_istEntladezeit && pvfc.length < 1) {
                if (_debug) {
                    console.warn('Stoppe Entladung, Preis jetzt ' + _tibberPreisJetzt + ' ct/kWh unter Batterieschwelle von ' + aufrunden(2, _stop_discharge) + ' ct/kWh oder battSoc = 0 ist ' + _batsoc );
                }

                if (_tibber_active_idx != 22) {  // aber nicht wenn die ladung bis zum ende reicht
                    _tibber_active_idx = 3;
                }
            }
        }

        //stoppe die Ladung
        if (_tibber_active_idx == 5 && tibberPoilow.length > 0 && tibberPoilow.length /2 < restladezeit) {
            if (_debug) {
                console.error('Stoppe Ladung');
            }
            _tibber_active_idx = 4;
        }

        if (_debug) {
            console.warn('-->> vor tibber_active_auswertung : _SpntCom ' + _SpntCom + ' _tibber_active_idx ' + _tibber_active_idx);
        }        
    
        await tibber_active_auswertung();
    } else {
        _tibber_active_idx = await entladezeitEntscheidung();
        await tibber_active_auswertung();
    }    

    // ----------------------------------------------------  Start der PV Prognose Sektion

//      _tibber_active_idx = 0;                 initial
//      _tibber_active_idx = 1;                 Nachladezeit
//      _tibber_active_idx = 2;                 Entladezeiten
//      _tibber_active_idx = 20;                pv reicht für den Tag und wir sind in zwischenzeit wo nix produziert wird und preis unter schwelle     
//      _tibber_active_idx = 21;                Entladezeit wenn akku > 0 , der Preis hoch genug um zu sparen
//      _tibber_active_idx = 22;                Entladezeit reicht aus bis zum Sonnaufgang
//      _tibber_active_idx = 23;                keine entladezeit da alle Preise unter schwelle aber Batterie hat ladung
//      _tibber_active_idx = 3;                 entladung stoppen wenn preisschwelle erreicht
//      _tibber_active_idx = 33;                wie 3 nur kommt intern aus der auswertung
//      _tibber_active_idx = 4;                 ladung stoppen wenn Restladezeit kleiner Billigstromzeitfenster
//      _tibber_active_idx = 5;                 starte die ladung
//      _tibber_active_idx = 6;                 Entladung stoppen nutze nur Entladestunden 
//      _tibber_active_idx = 88;                notladung
//      _tibber_active_idx = 99;                manuelles laden aus anderen script

    if (_debug && !_batterieLadenUebersteuernManuell) {
        console.error('-->> Verlasse Tibber Sektion mit _SpntCom ' + _SpntCom + ' _max_pwr ' + _max_pwr + ' _tibber_active_idx ' + _tibber_active_idx);
        console.error('-->> _istEntladezeit ' + _istEntladezeit);
        console.error('-->> _istLadezeit    ' + _istLadezeit);
        console.error('-->  PV ' + _dc_now + ' Verbrauch ' + _verbrauchJetzt + ' Restladezeit ' + restladezeit + ' Restlademenge ' + restlademenge);
    }

    if (batterieLadenUhrzeitStart && _hhJetzt >= batterieLadenUhrzeit && _dc_now > _verbrauchJetzt)  {    // mit pv laden übersteuern ab bestimmter uhrzeit und nur wenn genug pv
        if (_debug) {
            console.warn('-->> übersteuert mit nach Uhrzeit laden');
        }
        setState(tibberDP + 'extra.prognoseNutzenAutomatisch', false, true);
        _prognoseNutzenSteuerung = false;
    }

    if (_prognoseNutzenSteuerung && _dc_now > 0) {
        if (_debug) {
            console.error('--> Starte prognose Nutzen Steuerung ');
            console.info('Abschluss PV bis ' + pvBis);
            console.info('pvfc.length ' + pvfc.length);
            console.info('sundownReduzierung um ' + sundownReduzierung + ' Stunden');            
        }

        if (_batsoc < 100 && _istLadezeit) {

            let toSundownhrReduziert = 0;

            if (restlademenge > 0) {
                if (restlademenge > 500) {
                    toSundownhrReduziert = toSundownhr;
                    if (toSundownhr > sundownReduzierung) {
                        toSundownhrReduziert = toSundownhr - sundownReduzierung;
                    }

                    _max_pwr = Math.max(Math.round(restlademenge / toSundownhrReduziert), 500);
                    
                } else {
                    _max_pwr = Math.round(_dc_now - _verbrauchJetzt);  
                }

            } else {
                _max_pwr = Math.ceil(pvfc[0][0]);
            }

            if (_debug) {
                console.info('nach der Ermittlung _max_pwr ' + _max_pwr + ' toSundownhrReduziert ' + toSundownhrReduziert);
            }

            _max_pwr = Math.ceil(Math.min(Math.max(_max_pwr, 0), _batteryLadePowerMax));     //abfangen negativ werte

            setState(tibberDP + 'extra.Batterieladung_soll', _max_pwr, true);

            if (_debug) {
                console.info('_max_pwr ' + _max_pwr + ' ladezeit ' + _istLadezeit);
            }

            let verbrauchJetztOhneAuto = _verbrauchJetzt;

            if (_considerVehicle) {
                verbrauchJetztOhneAuto = _verbrauchJetzt - _vehicleConsum;
            }

            if (_dc_now < _verbrauchJetzt && _tibber_active_idx == 0) {
                _max_pwr = _mindischrg;
            }
            
            _SpntCom = _InitCom_An;

            if (_debug) {
                console.warn('-->> Bingo ladezeit 2 ' + ' Fahrzeug zieht ' + _vehicleConsum);
                console.info('-->> _powerReduzierung um ' + _powerReduzierung + ' _power90Reduzierung um ' + _power90Reduzierung);
            }

            if (_dc_now < verbrauchJetztOhneAuto ) {                             // kann sein dass die prognose nicht stimmt und wir haben ladezeiten aber draussen regnets
                if (_debug) {
                    console.warn('-->> breche ab, da nicht genug Sonne ' );
                }

                if (_tibberNutzenSteuerung) {
                    if (_debug) {
                        console.warn('-->> komme aber von oben mit _tibber_active_idx ' + _tibber_active_idx + ' mit SOC ' + _batsoc);
                    }

                    if (_nurEntladestunden && _tibber_active_idx != 5) { // nur entladestunden aber nicht wenns geladen wird
                        _tibber_active_idx = 6;
                        _tibber_active_idx = await entladezeitEntscheidung(_tibber_active_idx);
                    }

                    if (!_nurEntladestunden && _tibber_active_idx == 3) { // entladung stoppen
                        _tibber_active_idx = 23;
                    }

                    // komme aus tibber laufzeit
                    await tibber_active_auswertung();

                    if (_debug) {
                        console.warn('-->> neuermittlung ' + _tibber_active_idx + ' mit SOC ' + _batsoc);
                    }
                } else {                  
                    _SpntCom = _InitCom_Aus; // wir haben keinen tibber also ist es egal kannst entladen ausser wenn auto dran hängt        
                    
                    if (_debug) {
                        console.warn('-->> keine Tibber Nutzung kann also entalden werden ' + _SpntCom);
                    }
                    
                    //oder phase abfragen evcc.0.loadpoint.1.status.phasesActive > 1          
                    if (_vehicleConsum > 1) {
                        _SpntCom = _InitCom_An;                               
                        if (_debug) {
                            console.warn('-->> aber Fahrzeug ist dran und lädt ' + _SpntCom);
                        }
                    }   
                }
            } else {

                if (_debug) {
                    console.warn('-->> mit überschuss _max_pwr ' + _max_pwr);
                }

                if (_max_pwr > (_dc_now - verbrauchJetztOhneAuto) && _max_pwr > _mindischrg) {                   // wenn das ermittelte wert grösser ist als die realität dann limmitiere, check nochmal besser ist es
                    _max_pwr = _dc_now - verbrauchJetztOhneAuto;

                    if (_tibber_active_idx == 5 && _tibberNutzenSteuerung) {    // sind in der nachledezeit
                        _max_pwr = _batteryLadePowerMax;
                    }

                    if (_debug) {
                        console.warn('-->> nicht genug PV, limmitiere auf ' + _max_pwr);
                    }
                }                                  
            }
        }
    
        // -----------------------------------  letzten 10 % langsam laden

        if (_batsoc > 90 && _battIn > 0 && _istLadezeit) {
            if (_max_pwr > _lastPercentageLoadWith) {
                _max_pwr = _lastPercentageLoadWith;                    
            } 
            
            if (_max_pwr < _lastPercentageLoadWith && _dc_now > _verbrauchJetzt) {
                _max_pwr = _lastPercentageLoadWith;                    
            }

            if (_debug) {
                console.warn('-->> limmitiere letzte 10 % auf ' + _max_pwr);    
            }
        }      

        if (_debug) {
            console.error('-->> Verlasse prognoseNutzenSteuerung mit ' + _max_pwr + ' _netzbezug ' + _netzbezug );
        }
        
        if ((_max_pwr - _netzbezug) > 0) {
            _max_pwr = _max_pwr - _netzbezug;   // wenn trotzdem bezug dann ziehe den ab
        }

        if (_max_pwr != 0) {        
            _max_pwr = _max_pwr * -1; 
        }
    }

    _maxchrg = aufrunden(0, _max_pwr);    

    if (_lastpwrAtCom != _maxchrg) {
        setState(spntComCheckDP, Math.floor(Math.random() * 100) + 1, true);       // damit der WR auf jedenfall daten bekommt
    }

// ---------------------------------------------------- Ende der PV Prognose Sektion


// ----------------------------------------------------           write WR data

    sendToWR(_SpntCom, _maxchrg);
}


async function sendToWR(commWR, pwrAtCom) {
    const commNow = await getStateAsync(spntComCheckDP);
    setState(tibberDP + 'extra.tibberProtokoll', _tibber_active_idx, true);

    // wenn notladung mach alles aus
    if (_tibber_active_idx == 88) {
        if (commWR == _InitCom_An || commWR == _InitCom_Aus) {              // sende nur gültigen Wert
            setState(communicationRegisters.fedInSpntCom, commWR);          // 40151_Kommunikation
            setState(spntComCheckDP, commWR, true);
        }
    } else {
        if (_debug) {
            console.error('sendToWR _batterieLadenUebersteuernManuell ' + _batterieLadenUebersteuernManuell);
        }

        if (!_batterieLadenUebersteuernManuell) {
            if (_tibberNutzenSteuerung || _prognoseNutzenSteuerung) {
                if ((_lastpwrAtCom != pwrAtCom || commWR != commNow.val || commWR != _lastSpntCom)) {                    
                    if (commWR == _InitCom_An || commWR == _InitCom_Aus) {              // sende nur gültigen Wert
                        if (_debug) {
                            console.error('------ > Daten gesendet an WR kommunikation : ' + commWR  + ' Wirkleistungvorgabe ' + pwrAtCom);
                        }

                        setState(communicationRegisters.fedInPwrAtCom, pwrAtCom);       // 40149_Wirkleistungvorgabe
                        setState(communicationRegisters.fedInSpntCom, commWR);          // 40151_Kommunikation
                        setState(spntComCheckDP, commWR, true);
                    }
                            
                    setState(tibberDP + 'extra.Batterieladung_jetzt', pwrAtCom, true);
                }

                if (_debug) {
                    console.warn('SpntCom jetzt --> ' + commWR + ' <-- davor war ' + _lastSpntCom + ' und commNow ist ' + commNow.val + ' .. Wirkleistungvorgabe jetzt ' + pwrAtCom + ' davor war ' + _lastpwrAtCom + ' _tibber_active_idx ' + _tibber_active_idx);
                    console.info('----------------------------------------------------------------------------------');
                }
            }
        }
    }
    _lastSpntCom    = commWR;
    _lastpwrAtCom   = pwrAtCom;
}


/* ***************************************************************************************************************************************** */

async function vorVerarbeitung() {

    // berechne Astrozeiten für später
    _today              = new Date();
    const tomorrow      = new Date(_today.getFullYear(), _today.getMonth(), _today.getDate() + 1);
    _sundownAstro       = getAstroDate('sunsetStart').getHours() + ':' + getAstroDate('sunsetStart').getMinutes().toString().padStart(2, '0');                           // untergang heute  
    _sunupTodayAstro    = getAstroDate('sunriseEnd').getHours() + ':' + getAstroDate('sunriseEnd').getMinutes().toString().padStart(2, '0');                             // aufgang heute
    _sunupAstro         = getAstroDate('sunriseEnd', tomorrow).getHours() + ':' + getAstroDate('sunriseEnd', tomorrow).getMinutes().toString().padStart(2, '0');         // aufgang nächster Tag

    _dc_now                     = await berechnePV();
    _verbrauchJetzt             = await berechneVerbrauch();

    _hhJetzt                    = getHH();
    _bydDirectSOC               = Math.min(getState(bydDirectSOCDP).val, 100);                          // nimm den BatterieSOC da der WR nicht oft diesen übermittelt
    _batsoc                     = Math.min(getState(inputRegisters.batSoC).val, 100);                   //batsoc = Batterieladestand vom WR
    
    _debug                      = getState(tibberDP + 'debug').val;

    _snowmode                   = getState(tibberDP + 'extra.PV_Schneebedeckt').val;
    _nurEntladestunden          = getState(tibberDP + 'extra.nutzeNurEntladezeiten').val;
    _tibberNutzenAutomatisch    = getState(tibberDP + 'extra.tibberNutzenAutomatisch').val;             // aus dem DP kommend sollte true sein für vis
    _prognoseNutzenAutomatisch  = getState(tibberDP + 'extra.prognoseNutzenAutomatisch').val;           // aus dem DP kommend sollte true sein für vis

    _tibberNutzenSteuerung      = _tibberNutzenAutomatisch;         // init
    _prognoseNutzenSteuerung    = _prognoseNutzenAutomatisch;       // init

    // übersteuern nach prio manuell zuerst dann autoamtisch oder battsoc unter 5 %
    const _tibberNutzenManuell          = getState(tibberDP + 'extra.tibberNutzenManuell').val;
    const _tibberNutzenManuellHH        = getState(tibberDP + 'extra.tibberNutzenManuellHH').val;

    _batterieLadenUebersteuernManuell   = getState(batterieLadenManuellStartDP).val;

    if (_batterieLadenUebersteuernManuell || (_tibberNutzenManuell && ( _hhJetzt == _tibberNutzenManuellHH || _hhJetzt == _tibberNutzenManuellHH +1))) {       // wird durch anderes script geregelt
        _tibberNutzenSteuerung      = false;    // der steuert intern ob lauf gültig  für tibber laden/entladen
        _prognoseNutzenSteuerung    = false;    // der steuert intern ob lauf gültig  für pv laden
        _lastSpntCom                = 98;       // manuelles laden
        _tick = 0;
    }

    if (_debug) {
        console.info('tibberNutzenAutomatisch ' + _tibberNutzenAutomatisch + ' prognoseNutzenAutomatisch ' + _prognoseNutzenAutomatisch);
    }

    // ---     check ob notladung nötig
    _notLadung = await notLadungCheck();

    if (_notLadung) {
        _tibber_active_idx = 88                             // notladung mrk        
        sendToWR(_InitCom_Aus, 0);
    } else {
        await processing();
    }

    if (_debug) {
        console.info('tibberNutzenSteuerung ' + _tibberNutzenSteuerung + ' prognoseNutzenSteuerung ' + _prognoseNutzenSteuerung);
    }
}


async function notLadungCheck() {
    if (_dc_now < _verbrauchJetzt) {
        if (_bydDirectSOC < _bydSOCEmergency && _batsoc == 0) {
            if (_mrkBattNotladung != _bydDirectSOC) {
                console.error(' -----------------    Batterie NOTLADEN ' + _bydDirectSOC + ' %' + ' um ' + _hhJetzt + ':00');
                toLog(' -----------------    Batterie NOTLADEN ' + _bydDirectSOC + ' %', true);  
                _mrkBattNotladung = _bydDirectSOC;
            }
            return true;
        }
    }
    return false;
}

async function berechnePV() {
    let pVJetzt;

    if (compareTime(_sundownAstro, '00:00', 'between') || compareTime('00:00', _sunupAstro, 'between')) {     // nachts ist ehh nix los also kann 0 rein
        pVJetzt = 0;
    } else {
        const dc1 = await getStateAsync(inputRegisters.dc1);
        const dc2 = await getStateAsync(inputRegisters.dc2);
        pVJetzt   = dc1.val + dc2.val;                                                                  // pv vom Dach zusammen in W          
    }

    if (pVJetzt < 2) {              // alles was unter 2 W kann weg
        pVJetzt = 0;
    }

    let pVJetzt_out     = pVJetzt;

    if (pVJetzt_out > 0) {
        pVJetzt_out = aufrunden(2, pVJetzt) /1000;  // in kW
    }

    setState(pv_Leistung_aktuellDP, pVJetzt_out, true);

    return Number(pVJetzt);
}

async function berechneVerbrauch() {
    if (_sma_em.length > 0) {
        inputRegisters.powerOut = _sma_em + ".psurplus" /*aktuelle Einspeiseleistung am Netzanschlußpunkt, SMA-EM Adapter*/
    }

    _einspeisung        = aufrunden(2, getState(inputRegisters.powerOut).val);     // Einspeisung  in W
    const battOut       = await getStateAsync(inputRegisters.battOut);
    _battOut            = battOut.val;
    const battIn        = await getStateAsync(inputRegisters.battIn);
    _battIn             = battIn.val;
    const netzbezug     = await getStateAsync(inputRegisters.netzbezug);
    _netzbezug          = netzbezug.val

    _vehicleConsum = getState(vehicleConsumDP).val;

    if (_considerVehicle) {
        _isVehicleConn = getState(isVehicleConnDP).val;
        if (_isVehicleConn) {
            let evccModus   = getState(evccModusDP).val;

            if (_vehicleConsum < 0 || _vehicleConsum > _max_VehicleConsum) {            // sollte murks vom adapter kommen dann setze auf 0
                _vehicleConsum = 0;
            }

            if (evccModus != 'pv') {                                                   // wenn nicht pv modus dann auch auf 0, wir laden bewusst mit Strom
                _vehicleConsum = 0;
            }
        }
    }

    const verbrauchJetzt   = (_dc_now + _battOut + _netzbezug) - (_einspeisung + _battIn);       // verbrauch in W , 100W reserve obendruaf _vehicleConsum nicht rein nehmen

    const verbrauchVis = (verbrauchJetzt - _vehicleConsum);
    setState(momentan_VerbrauchDP, aufrunden(2, verbrauchVis /1000), true);                                // für die darstellung können die 100 W wieder raus und fahrzeug auch

    return aufrunden(0, verbrauchJetzt);
}
// ------------------------------------------- functions

async function entladezeitEntscheidung(idxIn = 0) {
    let tibber_active_idx = idxIn;
    _istEntladezeit = false;

    if (_debug) {
        console.info('_entladeZeitenArray in neu Berechnung ' +  _entladeZeitenArray.length + ' _nurEntladestunden ' + _nurEntladestunden + ' _vehicleConsum ' + _vehicleConsum);
    }

    if (_nurEntladestunden && _tibberNutzenSteuerung) {
        for (let c = 0; c < _entladeZeitenArray.length; c++) {
            tibber_active_idx = 6;

            if (_debug) {
                console.warn('entladezeit alle ' + JSON.stringify(_entladeZeitenArray[c]));
            }

            if (compareTime(_entladeZeitenArray[c][1], _entladeZeitenArray[c][2], "between")) {
                if (_debug) {
                    console.warn('entladezeit gefunden ' + _entladeZeitenArray[c][1] + '  ' +  _entladeZeitenArray[c][2]);
                }
                _istEntladezeit = true;
                tibber_active_idx = 2;
                break;
            }
        }
    } else {
        tibber_active_idx = 23;
        _entladeZeitenArray = [];
        _istEntladezeit = true;
    }

    if (_debug) {
        console.info('verlasse entladezeitEntscheidung ' +  tibber_active_idx + ' davor war ' + idxIn);
    }

    return tibber_active_idx;
}

async function filterZeitSunup(arrZeit, sunup) {
    const newArray = [];

    //console.warn(JSON.stringify(arrZeit));

    for (let i = 0; i < arrZeit.length; i++) {
        const startTime = parseInt(arrZeit[i][1].split(':')[0]);
        newArray.push(arrZeit[i]);
        if (startTime == sunup.split(':')[0]) {
            break;
        }
    }

    // console.warn(JSON.stringify(newArray));

    newArray.sort(function (a, b) {  // niedrieg preis sort
        return b[0] - a[0];
    });

    //console.warn(JSON.stringify(newArray));

    return newArray;
}

function aufrunden(stellen, zahl) {
// @ts-ignore    
    return +(Math.round(Number(zahl) + 'e+' + Number(stellen)) + 'e-' + Number(stellen));
}

async function zeitDifferenzInStunden(zeit1, zeit2, nextDay) {
    const [stunden1, minuten1] = zeit1.split(':').map(Number);
    const [stunden2, minuten2] = zeit2.split(':').map(Number);

    let zeit1InMinuten = stunden1 * 60 + minuten1;
    let zeit2InMinuten = stunden2 * 60 + minuten2;

    // füge 24 Stunden zu Zeit 2 hinzu (Tagesübergang)
    if (nextDay) {
        zeit2InMinuten += 24 * 60;
    }

    let differenzInMinuten = zeit2InMinuten - zeit1InMinuten;

    // Differenz in Stunden und Minuten aufteilen
    let differenzStunden = Math.floor(differenzInMinuten / 60);
    let differenzMinuten = differenzInMinuten % 60;

    if (differenzStunden < 0) {
        differenzStunden = differenzStunden * -1;
        differenzMinuten = differenzMinuten * -1;
    }

    // console.error('zeit1 ' + zeit1 + ' zeit2 ' + zeit2 + ' ' + differenzStunden + ' ' + differenzMinuten);

    return `${differenzStunden}.${(differenzMinuten < 10 ? '0' : '') + differenzMinuten}`;
}

async function sortHourToSunup(zeiten, sunup) {
    let arrOut          = [];
    let arrOutOnlyHH    = [];

    for (let p = 0; p < zeiten.length; p++) {             /* 48 = 24h a 30min Fenster*/
        const hh  = zeiten[p][1].split(':')[0];
        const min = zeiten[p][1].split(':')[1];

        arrOut.push(zeiten[p]);

        if (min == 0) {
            arrOutOnlyHH.push(zeiten[p]);
        }

        if (hh == sunup.split(':')[0] +1) {              // rechne eine stunde zu sunup damit :30 werte mitgenommen werden können
            break;
        }
    }

    //console.warn('sortHourToSunup ' + JSON.stringify(arrOut));

    return {arrOut, arrOutOnlyHH};
}

async function sortArrayByCurrentHour(zeiten, toEnd, currentHour) {
    // Sortiere den Array nach der Startzeit
    zeiten.sort((a, b) => {
        const timeA = a[1].split(":").map(Number);
        const timeB = b[1].split(":").map(Number);

        // Vergleiche Stunden
        if (timeA[0] !== timeB[0]) {
            return timeA[0] - timeB[0];
        }

        // Wenn Stunden gleich sind, vergleiche Minuten
        return timeA[1] - timeB[1];
    });

    let sortedArray;

    //console.warn('sortArrayByCurrentHour ' + JSON.stringify(sortedArray));

    if (toEnd) {
        // Finde den Index des aktuellen Zeitpunkts
        let startIndex = zeiten.findIndex(item => {
            const time = item[1].split(":").map(Number);
            return time[0] >= currentHour || (time[0] === currentHour && time[1] >= 30);
        });

        // Schneide den Array ab startIndex und setze ihn an das Ende
        sortedArray = zeiten.slice(startIndex).concat(zeiten.slice(0, startIndex));
    } else {
        sortedArray = zeiten;
    }

    //console.warn('sortArrayByCurrentHour ' + JSON.stringify(sortedArray));

    return sortedArray;
}

async function getPvErtrag() {
    let pvfc = [];

    if (_pvforecastTodayArray.length > 0) {
        for (let p = 0; p < 48; p++) {                      /* 48 = 24h a 30min Fenster*/
            const pvstarttime   = _pvforecastTodayArray[p][0];
            const pvendtime     = _pvforecastTodayArray[p][1];
            const wert1         = _pvforecastTodayArray[p][2];
            const wert2         = _pvforecastTodayArray[p][3];

            if (wert1 > (_baseLoad + _klimaLoad) || wert2 > (_baseLoad + _klimaLoad)) {
                const minutes = 30;
                if (compareTime(pvendtime, null, '<=', null)) {
                    pvfc.push([wert1, wert2, minutes, pvstarttime, pvendtime]);
                }
            }
        }
    }

    setState(tibberDP + 'extra.pvLadeZeitenArray', pvfc, true);

    return pvfc;
}

async function holePVDatenAb() {
    let pvforecastTodayArray = [];

    for (let p = 0; p < 48; p++) {
        const startTime = await getStateAsync(pvforecastTodayDP + p + '.startTime');
        const endTime   = await getStateAsync(pvforecastTodayDP + p + '.endTime');
        let power       = getState(pvforecastTodayDP + p + '.power').val;
        let power90     = getState(pvforecastTodayDP + p + '.power90').val;

        // manuelles reduzieren pv
        power = Math.max((power - _powerReduzierung), 0);
        power90 = Math.max((power90 - _power90Reduzierung), 0);

        pvforecastTodayArray.push([startTime.val,endTime.val,power,power90]);
    }

    let  pvforecastTomorrowArray = [];

    for (let p = 0; p < 48; p++) {
        const startTime = await getStateAsync(pvforecastTomorrowDP + p + '.startTime');
        const endTime   = await getStateAsync(pvforecastTomorrowDP + p + '.endTime');
        const power   = getState(pvforecastTomorrowDP + p + '.power').val;
        const power90   = getState(pvforecastTomorrowDP + p + '.power90').val;

        pvforecastTomorrowArray.push([startTime.val,endTime.val,power,power90]);
    }

    return {pvforecastTodayArray, pvforecastTomorrowArray};
}

function getMinHours(timeInHours) {
    let hours = Math.floor(timeInHours);
    let minutes = Math.round((timeInHours - hours) * 60);

    // Formatiere die Stunden und Minuten für das 24-Stunden-Format
    let formattedHours = hours.toString().padStart(2, '0');
    let formattedMinutes = minutes.toString().padStart(2, '0');

    return `${formattedHours}:${formattedMinutes}`;
}

async function doppelteRausAusArray(arr) {
    let uniqueArray = [];
    let seen = new Set();

    for (let item of arr) {
        let serialized = JSON.stringify(item);
        if (!seen.has(serialized)) {
            seen.add(serialized);
            uniqueArray.push(item);
        }
    }

    return uniqueArray;
}

async function tibberPoilowErmittlung(arraySorted) {
    let poiTemp = arraySorted;

    poiTemp.sort(function (a, b) {  // niedrig preis sort
        return a[0] - b[0];
    });

    let tibberPoilow = [];          //wieviele Ladestunden unter Startcharge Preis

    for (let x = 0; x < poiTemp.length; x++) {
        if (poiTemp[x][0] <= _start_charge) {
            tibberPoilow.push(poiTemp[x]);
        } else {
            break;
        }
    }

    return tibberPoilow;
}

function addMinutesToTime(timeStr, minutesToAdd) {
    let timeParts = timeStr.split(':');
    let date = new Date();
    date.setHours(parseInt(timeParts[0], 10));
    date.setMinutes(parseInt(timeParts[1], 10));

    date.setMinutes(date.getMinutes() + minutesToAdd);

    let newHours = date.getHours().toString().padStart(2, '0');
    let newMinutes = date.getMinutes().toString().padStart(2, '0');

    // Zurückgeben der neuen Zeit im HH:MM-Format
    return `${newHours}:${newMinutes}`;
}

function tibber_active_auswertung() {
    _max_pwr = _mindischrg;                                                            // sicher ist sicher

    switch (_tibber_active_idx) {
        case 0:
            if (_dc_now < 2) {

                const tiIdix =  getState(tibberDP + 'extra.tibberProtokoll').val;    // und diesen dann nehmen. bei tibber 0 dann macht der das was zueltzt gesendet worden ist
                if (tiIdix == 0) {
                    _tibber_active_idx = 33;                    
                } else {
                    _tibber_active_idx = tiIdix;
                }                

                if (!_tibberNutzenSteuerung) {
                    _tibber_active_idx = 2;     
                }

                tibber_active_auswertung();
                break;
            }

            if (!_istLadezeit) {
                _SpntCom = _InitCom_An;
            }

            break;
        case 1:                             //      _tibber_active_idx = 1;    Nachladezeit
            _SpntCom = _InitCom_An;
            _max_pwr = _pwrAtCom_def * -1;
            if (_batsoc > 90) {             // limittiere die letzten 10 %
                _max_pwr = _lastPercentageLoadWith * -1;
            }
            break;
        case 2:                             //      _tibber_active_idx = 2;    Entladezeiten
        case 20:                            //      _tibber_active_idx = 20;   pv reicht für den Tag und wir sind in zwischenzeit wo nix produziert wird und preis unter schwelle  
            _SpntCom = _InitCom_Aus;
            break;
        case 21:
            _SpntCom = _InitCom_Aus;
            break;
        case 22:                             //      _tibber_active_idx = 22;   Entladezeit reicht aus bis zum Sonnaufgang        
            _SpntCom = _InitCom_Aus;
            break;
        case 23:                             //      _tibber_active_idx = 23;   keine entladezeit da alle Preise unter schwelle aber Batterie hat ladung                                
            _SpntCom = _InitCom_Aus;
            break;
        case 3:                              //      _tibber_active_idx = 3;    entladung stoppen wenn preisschwelle erreicht        
        case 33:                             //      _tibber_active_idx = 33;   wie 3 nur kommend von intern
            _SpntCom = _InitCom_An;
            break;
        case 4:                              //      _tibber_active_idx = 4;    ladung stoppen wenn Restladezeit kleiner Billigstromzeitfenster
            _SpntCom = _InitCom_An;
            break;
        case 5:                              //      _tibber_active_idx = 5;    starte die ladung
            _SpntCom = _InitCom_An;
            _max_pwr = _pwrAtCom_def * -1;
            if (_batsoc > 90) {              // limittiere die letzten 10 %
                _max_pwr = _lastPercentageLoadWith * -1;
            }
            break;
        case 6:                             //      _tibber_active_idx = 6;    stoppe entladung 
            _SpntCom = _InitCom_An;
            _max_pwr = _mindischrg;
            break;
        default:
            _SpntCom = _InitCom_Aus;
    }
}
// ---------------------------------------------------------------------------------------
on({id: tibberDP + 'extra.nutzeNurEntladezeiten', change: 'ne'}, async function() {
    setState(tibberDP + 'extra.tibberProtokoll', 0, true);
});

on({id: [tibberDP + 'extra.tibberNutzenAutomatisch',
        tibberDP + 'extra.prognoseNutzenAutomatisch',
    ], change: 'any', val: false}, function () {
    _lastSpntCom = 97;
});

on({id: tibberDP + 'extra.prognoseNutzenAutomatisch', change: 'ne', val:false}, async function() {
    setState(communicationRegisters.fedInSpntCom, _InitCom_Aus);
    setState(spntComCheckDP, _InitCom_Aus, true);
    setState(tibberDP + 'extra.tibberProtokoll', 0, true);
});

on({id: '0_userdata.0.wohnung.rollo.steuerung.gutenNacht', change: 'ne', val: true}, function() {
    const abUhr = getState('0_userdata.0.strom.batterieLadenUhrzeitStart').val;
    if (abUhr) {
        setState('0_userdata.0.strom.tibber.extra.prognoseNutzenAutomatisch', true, true);   
        setState('0_userdata.0.strom.batterieLadenUhrzeitStart', false, true);  
    }
});    

on({ id: inputRegisters.triggerDP, change: 'ne' }, async function (obj) {  // aktualisiere laut adapter abfrageintervall
    const ti = obj.state.ts;
    setState('0_userdata.0.strom.aktualisierung', ti, true);
    
    setTimeout(async function() {
        await vorVerarbeitung();
    }, 500);
});

//  reduzierung lesezugriffe, hole die PV nur wenn sich was geändert hat
on({id: pvUpdateDP, change: 'ne'}, async function() {
    const pvDaten               = await holePVDatenAb();
    _pvforecastTodayArray       = pvDaten.pvforecastTodayArray;
    _pvforecastTomorrowArray    = pvDaten.pvforecastTomorrowArray;
});

schedule('0 0 * * *', function() {
    _pvforecastTodayArray       = _pvforecastTomorrowArray;
    _pvforecastTomorrowArray    = [];
});
>>>>>>> 2728c4bf65fd65e2e66b29ad67e702c914a2b416
