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
