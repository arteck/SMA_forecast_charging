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

const pvUpdateDP                    = userDataDP + '.strom.pvforecast.lastUpdated';

const momentan_VerbrauchDP          = userDataDP + '.strom.Momentan_Verbrauch';
const pV_Leistung_aktuellDP         = userDataDP + '.strom.PV_Leistung_aktuell';

// debug
let _debug = getState(tibberDP + 'debug').val == null ? false : getState(tibberDP + 'debug').val;

//-------------------------------------------------------------------------------------
const _pvPeak                   = 13170;                                // PV-Anlagenleistung in Wp
const _batteryCapacity          = 12800;                                // Netto Batterie Kapazität in Wh BYD 2.56 pro Modul
const _batteryTarget            = 100;                                  // Gewünschtes Ladeziel der Regelung (e.g., 85% for lead-acid, 100% for Li-Ion)
const _lastPercentageLoadWith   = -500;                                 // letzten 5 % laden mit xxx Watt
const _baseLoad                 = 850;                                  // Grundverbrauch in Watt
const _wr_efficiency            = 0.93;                                 // Batterie- und WR-Effizienz (e.g., 0.9 for Li-Ion, 0.8 for PB)
const _batteryPowerEmergency    = -4000;                                // Ladeleistung der Batterie in W notladung
const _mindischrg               = -1;                                   // min entlade W entweder 0 oder -1
const _batteryLadePowerMax      = 5000;                                 // max Batterie ladung 
const _lossfactor               = 0.75;                                 // System gesamtverlust in % (Lade+Entlade Effizienz)
const _pwrAtCom_def             = _batteryLadePowerMax * (253 / 230);   // max power bei 253V = 5500 W
const _sma_em                   = 'sma-em.0.3015242334';                // Name der SMA EnergyMeter/HM2 Instanz bei installierten SAM-EM Adapter, leer lassen wenn nicht vorhanden
let   _batteryLadePower         = _batteryLadePowerMax;                 // Ladeleistung laufend der Batterie in W
const _loadfact                 = 1 / _lossfactor;                      // 1,33
let   _istLadezeit              = false;                                // ladezeit gefunden merker
let   _istEntladezeit           = false;                                // Entladezeit gefunden merker

// manuelles reduzieren der PV um x Watt
let _power50Reduzierung             = 0;                                    // manuelles reduzieren der pv prognose pro stunde bewölkt
let _power90Reduzierung             = 0;                                    // manuelles reduzieren der pv prognose pro stunde ohne wolken
let _sundownReduzierung             = 0;                                    // zum rechnen
const _sundownReduzierungStunden    = 3;                                    // ladedauer verkürzen um x Stunden nach hinten

// Klimaanlagesteuerung dazu ist ein Wetteradapter notwendig der die Temperatur liefert
// die ladezeit wird dann laut verbrauch berechnet
const   _mitKlimaanlage           = false;                                             // soll die Klimaanlage berücksichtig werden
const   _wetterTemperaturDP       = 'openweathermap.0.forecast.day0.temperatureMax';  // beispiel hier openweathermap
const   _klimaVerbrauch           = 1500;                                             // manuell ermitteltes Wert wie viel Watt die Klimaanlage zieht 
let     _klimaLoad                = 0;                                                // manuell ermitteltes Wert wie viel Watt die Klimaanlage zieht 
const   _tempWetterSoll           = 23;                                               // referenz Wert ab da soll die klima mit berücksichtig werden
const   klimaDP                   = 'esphome.0.xxxx.mode'; // DP der klimaanlage zum check ob diese läuft
let     istKlimaAn                = 0;                                                // läuft die klima bei mir 0 = aus
const  _reduzierungStundenKlima   = 2;                                                // ladedauer verkürzen um x Stunden nach hinten wenn klima an 


// tibber Preis Bereich
let _snowmode                   = false;                                        // manuelles setzen des Schneemodus, dadurch wird in der Nachladeplanung die PV Prognose ignoriert, z.b. bei Schneebedeckten PV Modulen und der daraus resultierenden falschen Prognose
let _start_charge               = 0.1881;                                       // Eigenverbrauchspreis
const _stop_discharge           = aufrunden(4, _start_charge * _loadfact);      // 0.19 * 1.33 = 0.2533 €

// Fahrzeug mit berücksichtigen in Verbrauchsrechnung EVCC Adapter benötigt
const _considerVehicle   = true;
const _max_VehicleConsum = 4000;                                                // max Wert wenn Fahrzeug lädt
const isVehicleConnDP   = 'evcc.0.loadpoint.1.status.connected';                // ist Fahrzeug gerade an der Ladeseule DP
const vehicleConsumDP   = 'evcc.0.loadpoint.1.status.chargePower';              // angaben in W
const evccModusDP       = 'evcc.0.loadpoint.1.status.mode';                     // lademodus

let _isVehicleConn      = false;
let _vehicleConsum      = 0;

let _hhJetzt = getHH();

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

const bydDirectSOCDP            = 'bydhvs.0.State.SOC';                            // battSOC netto direkt von der Batterie

let _dc_now                     = 0;  
let _einspeisung                = 0;
let _battOut                    = 0;
let _battIn                     = 0;

const _InitCom_Aus              = 803;
const _InitCom_An               = 802;

let _SpntCom                    = _InitCom_Aus;           //   802: aktiv (Act)    803: inaktiv (Ina)
let _verbrauchJetzt             = 0;
let _lastSpntCom                = 0;
let _lastpwrAtCom               = 0;
let _bydDirectSOC               = 5;
let _bydDirectSOCMrk            = 0;
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
let _tibberNutzenSteuerung      = true;    //wird _tibberNutzenAutomatisch benutzt (dyn. Strompreis)
let _tibberNutzenAutomatisch    = _tibberNutzenSteuerung;
let _tibberPreisJetzt           = getState(tibberPreisJetztDP).val;

// für prognose
let _prognoseNutzenSteuerung            = true;    //wird _tibberNutzenAutomatisch benutzt (dyn. Strompreis)
let _prognoseNutzenAutomatisch          = _prognoseNutzenSteuerung; //wird _prognoseNutzenAutomatisch benutzt
let _batterieLadenUebersteuernManuell   = false;
let _tomorrow_kW                        = 0;
let _entladeZeitenArray                 = [];

let _sunup              = '00:00';
let _sunupAstro         = '00:00';
let _sundown            = '00:00';
let _sundownAstro       = '00:00';
let _sunupTodayAstro    = '00:00';
let _ladezeitVon        = '00:00';
let _ladezeitBis        = '00:00';
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
    setState(pV_Leistung_aktuellDP, 0, true);
});

Zeile entfernen  */ 

setState(communicationRegisters.fedInSpntCom, _InitCom_Aus);
setState(spntComCheckDP, _InitCom_Aus, true);
setState(tibberDP + 'extra.tibberProtokoll', 0, true);

console.info('***************************************************');
console.info('starte ladenNachPrognose mit debug ' + _debug);

// bei start immer initialisieren
if (_tibberPreisJetzt <= _stop_discharge && _dc_now <= _verbrauchJetzt) {
    console.warn('starte direkt mit Begrenzung da Preis unter schwelle');
}

// hole daten ab nach start
const pvDaten               = await holePVDatenAb();
_pvforecastTodayArray       = pvDaten.pvforecastTodayArray;
_pvforecastTomorrowArray    = pvDaten.pvforecastTomorrowArray;

// ab hier Programmcode
async function processing() {

    _tick ++;

    if (_tick >= 60) {         // alle 60 ticks reset damit der WR die Daten bekommt, WR ist auf 10 min reset Eingestellt
        const commNow = await getStateAsync(spntComCheckDP);
        setState(communicationRegisters.fedInSpntCom, commNow);                     // 40151_Kommunikation
        setState(spntComCheckDP, Math.floor(Math.random() * 100) + 1, true);        // schreibe irgendwas da rein.. 
        _tick = 0;
    }
 
    _bydDirectSOCMrk = 0;

    if (_dc_now < 5) {              // alles was unter 5 W kann weg
        _dc_now = 0;
    }

    let dc_now_DP     = _dc_now;

    if (dc_now_DP > 0) {    
        dc_now_DP = aufrunden(2, dc_now_DP) /1000;  // in kW
    }

    setState(pV_Leistung_aktuellDP, dc_now_DP, true);

    // fülle den ertragsarray
    let pvfc                       = getPvErtrag();             // gib mir den ertrag mit pvlimittierung               
    
    setState(tibberDP + 'extra.pvLadeZeitenArray', pvfc, true);

    let pvBis = '--:--';
    if (pvfc.length > 0) {            
        pvBis = pvfc[(pvfc.length - 1)][4];
    }

    setState(tibberDP + 'extra.PV_Abschluss', pvBis, true);

    _istLadezeit = false;
    _istEntladezeit = false;

    for (let h = 0; h < pvfc.length; h++) {                         // pvfc ist sortiert nach uhrzeit
        if (compareTime(pvfc[h][3], pvfc[h][4], 'between')) {
        //    _ladezeitVon = pvfc[h][3];            
        //    _ladezeitBis = pvfc[h][4];

            _istLadezeit = true;

            if (_debug) {
                console.warn('-->> Bingo ladezeit ');
            }
        }
    }

    let batterieLadenUhrzeit            = getState(batterieLadenUhrzeitDP).val;
    let batterieLadenUhrzeitStart       = getState(batterieLadenUhrzeitStartDP).val;
    let battStatus                      = getState(inputRegisters.betriebszustandBatterie).val;

    _batteryLadePower                   = _batteryLadePowerMax;

    if (_battIn > 0) {
        _batteryLadePower =_battIn;  
    }     

    _tibberPreisJetzt   = getState(tibberPreisJetztDP).val;
    _tomorrow_kW        = getState(tomorrow_kWDP).val;

    // Lademenge
    let restlademenge   = Math.max(Math.ceil((_batteryCapacity * (_batteryTarget - _batsoc) / 100) * (1 / _wr_efficiency)), 0);     //lademenge = Energiemenge bis vollständige Ladung 
    let restladezeit    = aufrunden(2, (restlademenge / _batteryLadePower));                                                        //Ladezeit = Energiemenge bis vollständige Ladung / Ladeleistung WR

    if (_dc_now < _verbrauchJetzt) {
        _batteryLadePower   = 0;  
        restladezeit        = 0
    }

    let _toSundownhr     = 0;

    setState(tibberDP + 'extra.BatterieRestladezeit', restladezeit, true);

    if (_debug) {
        console.info('_tick___________________________ ' + _tick);
        console.info('Verbrauch jetzt_________________ ' + _verbrauchJetzt + ' W');
        console.info('Einspeisung_____________________ ' + aufrunden(2, _einspeisung) + ' W');
        console.info('PV Produktion___________________ ' + _dc_now + ' W');       
        console.info('Batt_SOC________________________ ' + _batsoc + ' %');
        const battsts = battStatus == 2291 ? 'Batterie Standby' : battStatus == 3664 ? 'Notladebetrieb' : battStatus == 2292 ? 'Batterie laden' : battStatus == 2293 ? 'Batterie entladen' : 'Aus';
        console.info('Batt_Status_____________________ ' + battsts + ' = ' + battStatus);
        console.info('Restladezeit____________________ ' + restladezeit + ' h');
        console.info('Restlademenge___________________ ' + restlademenge + ' Wh');
        console.info('Ladeleistung Batterie jetzt_____ ' + _batteryLadePower + ' W');
    }

    _SpntCom                = _InitCom_Aus;     // initialisiere AUS
    _max_pwr                = _mindischrg;      // initialisiere
    _maxchrg                = _mindischrg;      // initialisiere
    
    if (_dc_now > _verbrauchJetzt && _batsoc < 100) {
        _max_pwr    = (_dc_now - _verbrauchJetzt) * -1;   // vorbelegung zum laden     
    } 

    if (_tibberNutzenSteuerung) {  
        const nowHour               = _hhJetzt + ':' + _today.getMinutes();         
        _tibber_active_idx          = 0;                                                        // initialisiere

        const tibberPvForcast       = getState(tibberPvForcastDP).val;
        const tibberPoiAll          = sortArrayByCurrentHour(tibberPvForcast, true, _hhJetzt);  // sortiert ab jetzt
        const tibberPoihighSorted   = sortArrayByCurrentHour(tibberPvForcast, false, '00');     // sortiert ab 0 Uhr
        
        //console.info('tibberPoiAll ' +  JSON.stringify(tibberPoiAll));
        //console.info('tibberPoihighSorted ' +  JSON.stringify(tibberPoihighSorted));

        let tibberPoilow = tibberPoilowErmittlung(tibberPoihighSorted);
               
        //console.info('tibberPoilow ' +  JSON.stringify(tibberPoilow));    

        _klimaLoad = 0;
        _sundownReduzierung = _sundownReduzierungStunden;

        if (_mitKlimaanlage) {
            _istKlimaAn = getState(_klimaDP).val;            

            if (_istKlimaAn > 0) {
                _sundownReduzierung = _sundownReduzierungStunden + _reduzierungStundenKlima; // verkürze die ladedauer um x stunden     
            }

            const tempWetter = getState(_wetterTemperaturDP).val;
            if (tempWetter >= _tempWetterSoll) {
                if (_dc_now < _verbrauchJetzt) {    // wenn pv grösser als der verbrauch ist.. dann nimm die zeiten ohne klima
                    _klimaLoad = _klimaVerbrauch;
                }
            }
        }

        let restLaufzeit = _batsoc * _batteryCapacity / 100;
        let batlefthrs = aufrunden(2, restLaufzeit / (_verbrauchJetzt / Math.sqrt(_lossfactor)));    /// 12800 / 100 * 30  Batterielaufzeit laut SOC und berücksichtige Grundverbrauch         

        setState(tibberDP + 'extra.Batterielaufzeit', getMinHours(batlefthrs), true);

        //wieviel wh kommen in etwa von PV in den nächsten 24h
        let hrstorun        = 24;
        let pvwhToday       = 0;
        let pvwhTomorrow    = 0;

        if (_pvforecastTodayArray.length > 0) {
            for (let p = 0; p < hrstorun * 2; p++) {   // *2 weil 48 PV Datenpunkte
                pvwhToday       = pvwhToday     + _pvforecastTodayArray[p][2] / 2;
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
            console.info('Erwarte ca______________________ ' + aufrunden(2, pvwhToday / 1000) + ' kWh von PV');
            console.info('Erwarte morgen ca_______________ ' + aufrunden(2, pvwhTomorrow / 1000) + ' kWh von PV');
        }

        setState(tibberDP + 'extra.PV_Prognose', aufrunden(2, pvwhToday), true);
        
        _sundown       = _sundownAstro; 
        _sunup         = _sunupTodayAstro;

        if (_debug) {
            console.info('Nachtfenster nach Astro : ' + _sundownAstro + ' - ' + _sunupAstro);
        }     

        let nextDay         = false;
        let sunupTomorrow   = _sunupAstro;

        if (!_snowmode && _pvforecastTodayArray.length > 0) {   
            if (pvfc.length > 0) {
                _sundown = pvfc[(pvfc.length - 1)][4];
            } 

            for (let su = 0; su < 48; su++) {
                if (_pvforecastTodayArray[su][2] >= (_baseLoad + _klimaLoad)) {   
                    _sunup = _pvforecastTodayArray[su][0];     
                    break;
                }
            }

            if (_pvforecastTomorrowArray.length > 0) {
                for (let su = 0; su < 48; su++) {
                    if (_pvforecastTomorrowArray[su][2] >= (_baseLoad + _klimaLoad)) {  
                        sunupTomorrow = _pvforecastTomorrowArray[su][0]; 
                        break;
                    }
                }           
            }
        }

        if (_hhJetzt > parseInt(_sunup.slice(0, 2))) {        
            _sunup = sunupTomorrow;
            nextDay = true;
        }      

        hrstorun    = Number(zeitDifferenzInStunden(nowHour, _sunup, nextDay));
        _toSundownhr = Number(zeitDifferenzInStunden(nowHour, _sundown, false));

        if (_debug) {
            console.info('Nachtfenster nach Berechnung : ' + _sundown + ' - ' + _sunup + '. bis zum nächsten Sonnenaufgang sind es ' + hrstorun + ' hrstorun und zum nächsten Untergang toSundownhr ' + _toSundownhr);
        }        

        if (compareTime(_sunupTodayAstro, _sundownAstro, 'between')) {  // Astro stunde 
            pvwhToday = 0;                                              // initialisiere damit die entladung läuft
            let t = 0;
            if (_toSundownhr > 0) {                
                //wieviel kwh kommen in etwa von PV ab jetzt
                for (t = 0; t < pvfc.length; t++) {                                 
                    pvwhToday = pvwhToday + pvfc[t][0];          
                }
                pvwhToday = aufrunden(2, (pvwhToday /2));
                
                setState(tibberDP + 'extra.PV_Prognose_kurz', pvwhToday, true);

                if (_debug) {
                    console.info('Erwarte ca______________________ ' + aufrunden(2, pvwhToday / 1000) + ' kWh von PV verkürzt');
                  //  console.info('_pvforecastTodayArray : ' + JSON.stringify(_pvforecastTodayArray[p]));
                }
            }
        }

        if (_debug) {
            console.info('Tibber tibberPoiAll.length ' + tibberPoiAll.length);
            //    console.info('tibberPoiAll vor nachladen: ' + JSON.stringify(tibberPoiAll));
        }

        // Nachladestunden Ermittlung
        let starteLadungTibber  = false;
        let prclow              = [];
        let prchigh             = [];
        let ladeZeitenArray     = [];

        let curbatwh   = aufrunden(2, ((_batteryCapacity / 100) * _batsoc));     // batterie ladung 

        if (batlefthrs < hrstorun) {
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

            //nachlademenge Wh nach höchstpreisen am Tag            
            let nachladeMengeWh = ((prchigh.length) * ((_baseLoad + _klimaLoad) /2) * 1 / _wr_efficiency);   // ich mag alles in klammern
            
            if (hrstorun < 24 && !_snowmode) {
                nachladeMengeWh = nachladeMengeWh - (pvwhToday * _wr_efficiency);
            }           

            // hier anschauen

            nachladeMengeWh =  aufrunden(2, nachladeMengeWh);

            if (nachladeMengeWh < 0) {
                nachladeMengeWh = nachladeMengeWh * -1;
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
                console.info('nach Nachladestunden prclow.length ' + nachladeStunden + ' restlademenge ' + restlademenge);
          //    console.info('prclow  Nachladestunden ' + JSON.stringify(prclow));
          //    console.info('prchigh Nachladestunden ' + JSON.stringify(prchigh));
            }
            
            //if (nachladeStunden > 0 && prclow.length > 0 && pvwhToday < curbatwh) {    
            //   oder
            if (nachladeStunden > 0 && prclow.length > 0 && nachladeMengeWh - curbatwh > 0  && pvwhTomorrow < (_baseLoad + _klimaLoad) * 24) {                 
                // aufbau der zeiten zum nachladen weiter im _tibber_active_idx = 5
                if (aufrunden(2, nachladeMengeWh - curbatwh) > 0) {
                    for (let i = 0; i < nachladeStunden; i++) {
                        if (_debug) {
                            console.warn('Nachladezeit: ' + prclow[i][1] + '-' + prclow[i][2] + ' zum Preis ' + prclow[i][0] + ' (' + aufrunden(2, nachladeMengeWh - curbatwh) + ' Wh)');
                        }
                        if (compareTime(prclow[i][1], prclow[i][2], 'between')) {
                            tibberPoilow.push(prclow[i]);                            
                            // aus der nachladung starten setzen
                            starteLadungTibber = true;
                            _tibber_active_idx = 1;

                            if (_debug) {
                                console.warn('-->> Bingo nachladezeit');
                                console.warn('-->> starteLadungTibber ' + starteLadungTibber);
                            }
                        }
                    }
                }
            }
        }        // Nachladestunden Ermittlung ende

        _entladeZeitenArray         = [];      
        let entladeZeitenArrayVis   = [];    
        let tibberPoihigh           = filterZeit14UhrOrSunup(tibberPoiAll, _sunup);    // sortiert nach preis und stunden grösser jetzt und bis zu sunup oder 14 uhr
        let lefthrs                 = Math.ceil(batlefthrs *2);                         // Batterielaufzeit laut SOC muss doppelt gerechnet werden da 30 min für tibber abgleich

        if (_debug) {
            console.info('tibberPoihigh.length '+ tibberPoihigh.length);
          //  console.info('tibberPoihigh nach filter ' + JSON.stringify(tibberPoihigh));
        }

        if (lefthrs > 0 && lefthrs > tibberPoihigh.length) {        // limmitiere auf Tibber höchstpreise
            lefthrs = tibberPoihigh.length;
        }

        if (_debug) {
            console.info('------>>  laufzeit mit tibber höchstpreise a 30 min: lefthrs ' + lefthrs + ' Batterielaufzeit: batlefthrs ' + batlefthrs);
        }
        
        for (let d = 0; d < lefthrs; d++) {
            if (tibberPoihigh[d][0] > _stop_discharge) {                                                   
                //console.info('alle Entladezeiten: ' + tibberPoihigh[d][1] + '-' + tibberPoihigh[d][2] + ' Preis ' + tibberPoihigh[d][0] + ' Fahrzeug zieht ' + _vehicleConsum + ' W');
                _entladeZeitenArray.push(tibberPoihigh[d]);                               
            }  
        }

      //       console.warn(JSON.stringify(_entladeZeitenArray));
      
      // sortiere die entladezeiten
        const entladeZeitenArrayAll     = sortHourToSunup(sortArrayByCurrentHour(_entladeZeitenArray, true, _hhJetzt), _sunup);
        _entladeZeitenArray             = entladeZeitenArrayAll.arrOut; 
        entladeZeitenArrayVis           = entladeZeitenArrayAll.arrOutOnlyHH; 

        if (_dc_now < _verbrauchJetzt && !starteLadungTibber) {                            
            // wenn genug PV am Tag aber gerade nicht genug Sonne aber tibber klein genug
            if (_debug) {
                console.info('pvwhToday ' + pvwhToday + ' benötigt werden ' + ((_baseLoad + _klimaLoad) * _toSundownhr * _wr_efficiency) + ' _dc_now ' + _dc_now);                
            }
            
            // Entladezeit wenn was im akku und preis hoch genug um zu sparen 
            if (batlefthrs > 0 && _tibberPreisJetzt > _stop_discharge  && _dc_now > 0 && !_nurEntladestunden) {               
                _tibber_active_idx = 21;
            }
            
            if (pvwhToday > ((_baseLoad + _klimaLoad) * _toSundownhr * _wr_efficiency) && _tibberPreisJetzt <= _stop_discharge && _dc_now < 1) {
                _tibber_active_idx = 20;          
            } 
        }          
                
        // Entladezeit
        if (batlefthrs > 0 && _dc_now < _verbrauchJetzt && !starteLadungTibber) { 
            if (batlefthrs >= hrstorun) { 
                if (compareTime(nowHour, addMinutesToTime(_sunup, 30), 'between')) {                                // wenn rest battlaufzeit > als bis zum sonnenaufgang oder sonnenaufgang + 30 min
                    if (_debug) {
                        console.warn('Entladezeit reicht aus bis zum Sonnaufgang');
                    }
                    _istEntladezeit = true;
                    _tibber_active_idx = 22;
                    _entladeZeitenArray = [];
                    entladeZeitenArrayVis = [];
                    entladeZeitenArrayVis.push([0.0,"99:99","--:--"]);  //  initialisiere für Vis
                }
            } else {
                if (_entladeZeitenArray.length > 0) {  
                    entladezeitEntscheidung();
                } else {
                    _entladeZeitenArray = [];
                    entladeZeitenArrayVis = [];
                    entladeZeitenArrayVis.push([0.0,"--:--","--:--"]);  //  initialisiere für Vis
                    _tibber_active_idx = 23;    
                }                                                             
            }
        }

        setState(tibberDP + 'extra.entladeZeitenArray', entladeZeitenArrayVis,  true); 

        // in der nacht starten setzen
        if (_tibberPreisJetzt <= _start_charge && _batsoc < 100 && _dc_now < 1) {           // wir sind in der nacht
            let vergleichepvWh = 0;
            
            if (compareTime('00:00', null, ">", null)) {
                vergleichepvWh = pvwhTomorrow;              // vor 00:00 brauchen wir den morgen wert
            } else {
                vergleichepvWh = pvwhToday;                 // danach den tageswert
            }
            
            if (vergleichepvWh < (_baseLoad + _klimaLoad) * 24 * _wr_efficiency) {
                starteLadungTibber = true;
            }
        
            if (_debug) {                                        
                console.info('pvwh ' + vergleichepvWh + ' ist kleiner als ' + (_baseLoad + _klimaLoad) * 24 * _wr_efficiency);
            }
        }

        // starte die ladung
        if (starteLadungTibber) {
            if (restladezeit == 0) {
                if (_battIn > 0) {
                    restladezeit = aufrunden(2, (restlademenge / _battIn * _wr_efficiency));
                } 
            }                   

            tibberPoilow = doppelteRausAusArray(tibberPoilow);

            if (_debug) {
                console.error('restladezeit : ' + restladezeit + ' tibberPoilow.length ' + tibberPoilow.length / 2);
            }

            const ladeZeitenArrayTmp = ladeZeitenArray.concat(tibberPoilow);      // füge die 2 arrays zusammen
                
            ladeZeitenArray = sortArrayByCurrentHour(ladeZeitenArrayTmp, false, '00');      

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

        if (_debug) {
            console.info('entladeZeitenArray ' + _entladeZeitenArray.length + ' ladeZeitenArray ' + ladeZeitenArray.length);
         //   console.info('ladeZeitenArray ' + JSON.stringify(ladeZeitenArray));
        }

       // stoppe die Entladung
        if (_tibberPreisJetzt <= _stop_discharge) {
            if (_istEntladezeit && pvfc.length < 1) {
                if (_debug) {                                        
                    console.warn('Stoppe Entladung, Preis jetzt ' + _tibberPreisJetzt + ' ct/kWh unter Batterieschwelle von ' + aufrunden(2, _stop_discharge) + ' ct/kWh oder battSoc = 0 ist ' + _batsoc );
                    console.info(' _SpntCom ' + _SpntCom + ' _max_pwr ' + _max_pwr + ' _tibber_active_idx ' + _tibber_active_idx);                    
                }

                if (_tibber_active_idx != 22) {  // aber nicht wenn die ladung bis zum ende reicht
                    _tibber_active_idx = 3;
                }
            }
        }      

        //ladung stoppen wenn Restladezeit kleiner Billigstromzeitfenster
        if (_tibber_active_idx == 5 && tibberPoilow.length > 0 && tibberPoilow.length /2 < restladezeit) {
            if (_debug) {
                console.error('Stoppe Ladung');
            }
            _tibber_active_idx = 4;            
        }    
        
        setState(tibberDP + 'extra.ladeZeitenArray', ladeZeitenArray, true);

        if (_debug) {
            console.warn('-->> vor tibber_active_auswertung : _SpntCom ' + _SpntCom + ' _tibber_active_idx ' + _tibber_active_idx);
        }
        
        tibber_active_auswertung();
    }   

    setState(tibberDP + 'extra.tibberProtokoll', _tibber_active_idx, true);

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

    if (_debug) {
        console.error('-->> Verlasse Tibber Sektion mit _SpntCom ' + _SpntCom + ' _max_pwr ' + _max_pwr + ' _tibber_active_idx ' + _tibber_active_idx);
        console.error('-->  PV ' + _dc_now + ' Verbrauch ' + _verbrauchJetzt + ' Restladezeit ' + restladezeit + ' Restlademenge ' + restlademenge);
    }

    if (batterieLadenUhrzeitStart && _hhJetzt >= batterieLadenUhrzeit && _dc_now > _verbrauchJetzt)  {    // laden übersteuern ab bestimmter uhrzeit und nur wenn genug pv
        if (_debug) {
            console.warn('-->> übersteuert mit nach Uhrzeit laden');
        }
        _SpntCom  = _InitCom_Aus;
        _prognoseNutzenSteuerung = false;
    }    

    if (_prognoseNutzenSteuerung && _dc_now > 0) {    // compareTime(_sunupTodayAstro, _sundownAstro, 'between')
        if (_debug) {
            console.error('--> Starte prognose Nutzen Steuerung ');
        }
        
        let latesttime = pvBis;

        if (restladezeit == 0 || ((restladezeit * 2) <= pvfc.length && pvfc.length > 0)) {          // überschreibe die restladezeit mit möglichen pv ladezeiten
            restladezeit = Math.ceil(pvfc.length / 2);                          
        }
        
        if (_debug && latesttime) {
            console.info('Abschluss PV bis ' + latesttime);
            console.info('pvfc.length ' + pvfc.length + ' Restladezeit nach pvfc Ermittlung möglich ' + restladezeit);
        //    console.warn('pvfc ' + JSON.stringify(pvfc));
            console.info('_sundownReduzierung um ' + _sundownReduzierung + ' Stunden');
        }        
   
        if (_batsoc < 100 && pvfc.length > 0) {    
            let toSundownhrReduziert = 0;          

            if (restlademenge > 0) {                   
                toSundownhrReduziert = _toSundownhr;
                if (_toSundownhr > _sundownReduzierung) {
                    toSundownhrReduziert = _toSundownhr - _sundownReduzierung;
                } 

                _max_pwr = Math.max(Math.round(restlademenge / toSundownhrReduziert), 0);  
                
                if (_max_pwr == 0) {
                    _max_pwr= Math.round(restlademenge / toSundownhrReduziert)   
                }
            } else {
                _max_pwr = Math.ceil(pvfc[0][0]);  
            }

            if (_debug) {                
                console.info('nach der Ermittlung _max_pwr ' + _max_pwr + ' toSundownhrReduziert ' + toSundownhrReduziert);
            }

            _max_pwr = Math.ceil(Math.min(Math.max(_max_pwr, 0), _batteryLadePowerMax));     //abfangen negativ werte

            setState(tibberDP + 'extra.Batterieladung_soll', _max_pwr, true);

            // zero werte nicht erlaubt
            if (_max_pwr == 0) {
                _max_pwr = _mindischrg;            
            }

            if (_debug) {
                console.info('Ausgabe :_max_pwr ' + _max_pwr + ' ist ladezeit ' + _istLadezeit);
            }           

            const verbrauchJetztOhneAuto = _verbrauchJetzt - _vehicleConsum;

            if (_dc_now < _verbrauchJetzt && _tibber_active_idx == 0) {  
                _max_pwr = _mindischrg;
            }  

            if (_istLadezeit) {            
                _SpntCom = _InitCom_An;

                if (_debug) {
                    console.warn('-->> Bingo ladezeit 2 ' + ' Fahrzeug zieht ' + _vehicleConsum);
                    console.info('-->> _power50Reduzierung um ' + _power50Reduzierung + ' _power90Reduzierung um ' + _power90Reduzierung);
                }
                
                if (_dc_now < verbrauchJetztOhneAuto ) {                             // kann sein dass die prognose nicht stimmt und wir haben ladezeiten aber draussen regnets
                    if (_debug) {
                        console.warn('-->> breche ab, da nicht genug Sonne ' );
                        console.warn('-->> komme aber von oben mit _tibber_active_idx ' + _tibber_active_idx + ' mit SOC ' + _batsoc);
                    }

                    if (_nurEntladestunden && _tibber_active_idx != 5) { // nur entladestunden aber nicht wenns geladen wird
                        _tibber_active_idx = 6;
                        entladezeitEntscheidung();
                    }

                    // komme aus tibber laufzeit
                    tibber_active_auswertung();

                    if (_debug) {
                        console.warn('-->> neuermittlung ' + _tibber_active_idx + ' mit SOC ' + _batsoc);
                    }                   
                    
                } else {

                    if (_debug) {
                        console.warn('-->> mit überschuss _max_pwr ' + _max_pwr);
                    }
                    
                    if (_max_pwr > (_dc_now - verbrauchJetztOhneAuto)) {                   // wenn das ermittelte wert grösser ist als die realität dann limmitiere, check nochmal besser ist es
                        _max_pwr = _dc_now - verbrauchJetztOhneAuto;
                        
                        if (_tibber_active_idx == 5) {    // sind in der nachledezeit
                            _max_pwr = _batteryLadePowerMax;
                        }   

                        if (_debug) {
                            console.warn('-->> nicht genug PV, limmitiere auf ' + _max_pwr);
                        }
                    }
                    
                    _max_pwr = _max_pwr * -1;

                    if (_lastpwrAtCom != _max_pwr) {
                        _lastSpntCom = 95;                                          // damit der WR auf jedenfall daten bekommt
                    }
                }
            }     
       
            if (_batsoc < 91) {
                let max_pwrReserve = _max_pwr + _max_pwr * 0.05;    // 5 % reserve damit kein bezug aus dem netz bei schwankung

                if (_dc_now < max_pwrReserve) {
                    _max_pwr = _max_pwr - _max_pwr * 0.05;          // 5 % reserve damit kein bezug aus dem netz bei schwankung
                }     

                if (_debug) {
                    console.info('nach Berechnung 5% ' + _max_pwr);
                }
                
                if (_max_pwr > 0) {        // hier muss immer was negatives rauskommen.. sonst keine pv ladung
                    _max_pwr = _mindischrg;          
                }
            }
        }
    }

    // -----------------------------------  letzten 10 % langsam laden
    if (_batsoc > 90 && _battIn > 0) {  
        _max_pwr = _lastPercentageLoadWith;

 //       if (_dc_now > _verbrauchJetzt + (_lastPercentageLoadWith * -1) + 200) {    // 200W reserve           
            if (_debug) {
                console.warn('-->> limmitiere letzte 10 % auf ' + _max_pwr);
            }
//        }          
    }      

    _maxchrg = _max_pwr;    

// ---------------------------------------------------- Ende der PV Prognose Sektion
 

// ----------------------------------------------------           write WR data

    sendToWR(_SpntCom, aufrunden(0, _maxchrg));
}


async function sendToWR(commWR, pwrAtCom) {
    const commNow = await getStateAsync(spntComCheckDP);

    if ((_lastpwrAtCom != pwrAtCom || commWR != commNow.val || commWR != _lastSpntCom) && !_batterieLadenUebersteuernManuell) {
        if (_debug) {
            console.error('------ > Daten gesendet an WR kommunikation : ' + commWR  + ' Wirkleistungvorgabe ' + pwrAtCom);
        }
        setState(communicationRegisters.fedInPwrAtCom, pwrAtCom);       // 40149_Wirkleistungvorgabe
        setState(communicationRegisters.fedInSpntCom, commWR);          // 40151_Kommunikation
        setState(spntComCheckDP, commWR, true);                         // check DP für vis        
        setState(tibberDP + 'extra.Batterieladung_jetzt', pwrAtCom, true);
    }

    if (_debug && !_batterieLadenUebersteuernManuell) {
        console.warn('SpntCom jetzt --> ' + commWR + ' <-- davor war ' + _lastSpntCom + ' und commNow ist ' + commNow.val + ' .. Wirkleistungvorgabe jetzt ' + pwrAtCom + ' davor war ' + _lastpwrAtCom);
        console.info('----------------------------------------------------------------------------------');
    }

    _lastSpntCom    = commWR;
    _lastpwrAtCom   = pwrAtCom;
}


/* ***************************************************************************************************************************************** */

on({ id: inputRegisters.triggerDP, change: 'ne' }, function () {  // aktualisiere laut adapter abfrageintervall
    setTimeout(function() {
        vorVerarbeitung();
    }, 500);     
});


on({id: [tibberDP + 'extra.tibberNutzenAutomatisch',
         tibberDP + 'extra.prognoseNutzenAutomatisch',
        ], change: 'any', val: false}, function () {
    _lastSpntCom = 97;
});


//  reduzierung lesezugroffe, hole die PV nur wenn sich was geändert hat
on({id: pvUpdateDP, change: 'ne'}, async function() {      
   // console.warn('hole pv daten ab'); 

    const pvDaten               = await holePVDatenAb();
    _pvforecastTodayArray       = pvDaten.pvforecastTodayArray;
    _pvforecastTomorrowArray    = pvDaten.pvforecastTomorrowArray;
});

schedule('0 0 * * *', function() {    
    _pvforecastTodayArray       = _pvforecastTomorrowArray;
    _pvforecastTomorrowArray    = [];
});
  
async function vorVerarbeitung() {

    // berechne Astrozeiten für später
    const tomorrow      = new Date(_today.getFullYear(), _today.getMonth(), _today.getDate() + 1);  
    _sundownAstro       = getAstroDate('sunsetStart').getHours() + ':' + getAstroDate('sunsetStart').getMinutes().toString().padStart(2, '0');                           // untergang heute  
    _sunupTodayAstro    = getAstroDate('sunriseEnd').getHours() + ':' + getAstroDate('sunriseEnd').getMinutes().toString().padStart(2, '0');                             // aufgang heute
    _sunupAstro         = getAstroDate('sunriseEnd', tomorrow).getHours() + ':' + getAstroDate('sunriseEnd', tomorrow).getMinutes().toString().padStart(2, '0');         // aufgang nächster Tag
                                                
    if (compareTime(_sundownAstro, _sunupAstro, 'between')) {                                           // nachts ist ehh nix los also kann 0 rein
        _dc_now = 0;    
    } else {
        const dc1 = await getStateAsync(inputRegisters.dc1);
        const dc2 = await getStateAsync(inputRegisters.dc2);
        _dc_now   = dc1.val + dc2.val;                                                                  // pv vom Dach zusammen in W          
    }
    
    _verbrauchJetzt             = await berechneVerbrauch(_dc_now);

    _hhJetzt                    = getHH();
    _today                      = new Date();
    _batsoc                     = Math.min(getState(inputRegisters.batSoC).val, 100);                   //batsoc = Batterieladestand vom WR
    _bydDirectSOC               = Math.min(getState(bydDirectSOCDP).val, 100);                          // nimm den bydSoc da der WR nicht oft diesen übermittelt
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
    }

    if (_debug) {
        console.info('tibberNutzenAutomatisch ' + _tibberNutzenAutomatisch + ' prognoseNutzenAutomatisch ' + _prognoseNutzenAutomatisch);
    }

    // ---     check ob notladung nötig
    _notLadung = notLadungCheck();

    if (_notLadung) {         
        _tibber_active_idx            = 88          // notladung mrk
        sendToWR(_InitCom_An, _batteryPowerEmergency);
    } else {
        processing();             
    }

    if (_debug) {
        console.info('tibberNutzenSteuerung ' + _tibberNutzenSteuerung + ' prognoseNutzenSteuerung ' + _prognoseNutzenSteuerung);
    }
}


function notLadungCheck() {    
    if (_bydDirectSOC < 5 && _dc_now < _verbrauchJetzt) {
        if (_bydDirectSOC != _bydDirectSOCMrk) {
            console.error(' -----------------    Batterie NOTLADEN ' + _bydDirectSOC + ' %' + ' um ' + _hhJetzt + ':00');
            toLog(' -----------------    Batterie NOTLADEN ' + _bydDirectSOC + ' %', true);
            _bydDirectSOCMrk = _bydDirectSOC;
        }
        return true;
    }
    return false;
}

async function berechneVerbrauch(pvJetzt) {
    if (_sma_em.length > 0) {
        inputRegisters.powerOut = _sma_em + ".psurplus" /*aktuelle Einspeiseleistung am Netzanschlußpunkt, SMA-EM Adapter*/
    }

    _einspeisung        = aufrunden(2, getState(inputRegisters.powerOut).val);     // Einspeisung  in W
    const battOut       = await getStateAsync(inputRegisters.battOut);
    _battOut            = battOut.val;
    const battIn        = await getStateAsync(inputRegisters.battIn);
    _battIn             = battIn.val;
    const netzbezug     = await getStateAsync(inputRegisters.netzbezug);

    _vehicleConsum = 0;

    if (_considerVehicle) {
        _isVehicleConn = getState(isVehicleConnDP).val;
        if (_isVehicleConn) {
            _vehicleConsum  = getState(vehicleConsumDP).val;
            _evccModus      = getState(evccModusDP).val;

            if (_vehicleConsum < 0 || _vehicleConsum > _max_VehicleConsum) {            // sollte murks vom adapter kommen dann setze auf 0
                _vehicleConsum = 0;
            }

            if (_evccModus != 'pv') {                                                   // wenn nicht pv modus dann auch auf 0, wir laden bewusst mit Strom
                _vehicleConsum = 0;                                                     
            }
        }
    }

    const verbrauchJetzt   = (pvJetzt + _battOut + netzbezug.val) - (_einspeisung + _battIn);       // verbrauch in W , 100W reserve obendruaf _vehicleConsum nicht rein nehmen
    const verbrauchVis = (verbrauchJetzt - _vehicleConsum);
    setState(momentan_VerbrauchDP, aufrunden(2, verbrauchVis /1000), true);                                // für die darstellung können die 100 W wieder raus und fahrzeug auch

    return aufrunden(0, verbrauchJetzt);
}
// ------------------------------------------- functions

function entladezeitEntscheidung() {
    for (let c = 0; c < _entladeZeitenArray.length; c++) {
        
        if (!_nurEntladestunden) {
            _entladeZeitenArray = [];
            _istEntladezeit = true;
            break;
        }

        if (_vehicleConsum > 0) {                                                               // wenn fahrzeug am laden dann aber nicht aus der batterie laden
            break;
        }

        if (_debug) {
            console.warn('entladezeit alle' + JSON.stringify(_entladeZeitenArray[c]));
        }

        if (compareTime(_entladeZeitenArray[c][1], _entladeZeitenArray[c][2], "between")) {
            //   console.warn('entladezeit ' + _entladeZeitenArray[c][1]);
            _istEntladezeit = true;
            _tibber_active_idx = 2;
            break;
        }
    }
}

function filterZeit14UhrOrSunup(arrZeit, sunup) {
    const newArray = [];

    // console.warn(JSON.stringify(arrZeit));

    for (let i = 0; i < arrZeit.length; i++) {
        const startTime = parseInt(arrZeit[i][1].split(':')[0]);
        newArray.push(arrZeit[i]);
        if (startTime == sunup.split(':')[0]) { // || startTime == 14
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
    return +(Math.round(Number(zahl) + 'e+' + Number(stellen)) + 'e-' + Number(stellen));
}

function zeitDifferenzInStunden(zeit1, zeit2, nextDay) {
    const [stunden1, minuten1] = zeit1.split(':').map(Number);
    const [stunden2, minuten2] = zeit2.split(':').map(Number);

    let zeit1InMinuten = stunden1 * 60 + minuten1;
    let zeit2InMinuten = stunden2 * 60 + minuten2;

    // füge 24 Stunden zu Zeit 2 hinzu (Tagesübergang)
    if (nextDay && _hhJetzt >= 0) {
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

function sortHourToSunup(zeiten, sunup) {
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

function sortArrayByCurrentHour(zeiten, toEnd, currentHour) {
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

    let sortedArray = [];
    
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

function getPvErtrag() {
    let pvfc = [];
    
    if (_pvforecastTodayArray.length > 0) {
        for (let p = 0; p < 48; p++) { /* 48 = 24h a 30min Fenster*/
            const pvstarttime = _pvforecastTodayArray[p][0];
            const pvendtime   = _pvforecastTodayArray[p][1];               
            const pvpower50   = _pvforecastTodayArray[p][2];
            const pvpower90   = _pvforecastTodayArray[p][3];

            if (pvpower90 > (_baseLoad + _klimaLoad)) {
                const minutes = 30;
                if (compareTime(pvendtime, null, '<=', null)) {
                    pvfc.push([pvpower50, pvpower90, minutes, pvstarttime, pvendtime]);                
                }
            }
        }
    }
    return pvfc;
}

async function holePVDatenAb() {
    let pvforecastTodayArray = [];

    for (let p = 0; p < 48; p++) {   
        const startTime = await getStateAsync(pvforecastTodayDP + p + '.startTime');
        const endTime   = await getStateAsync(pvforecastTodayDP + p + '.endTime');
        let power50     = getState(pvforecastTodayDP + p + '.power').val;
        let power90     = getState(pvforecastTodayDP + p + '.power90').val;

        // manuelles reduzieren pv
        power50 = Math.max((power50 - _power50Reduzierung), 0); 
        power90 = Math.max((power90 - _power90Reduzierung), 0); 

        pvforecastTodayArray.push([startTime.val,endTime.val,power50,power90]);
    }

    let  pvforecastTomorrowArray = [];

    for (let p = 0; p < 48; p++) {   
        const startTime = await getStateAsync(pvforecastTomorrowDP + p + '.startTime');
        const endTime   = await getStateAsync(pvforecastTomorrowDP + p + '.endTime');
        const power50   = getState(pvforecastTomorrowDP + p + '.power').val;
        const power90   = getState(pvforecastTomorrowDP + p + '.power90').val;
      
        pvforecastTomorrowArray.push([startTime.val,endTime.val,power50,power90]);
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

function doppelteRausAusArray(arr) {
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

function tibberPoilowErmittlung(arraySorted) {
    let poiTemp = arraySorted;   

    poiTemp.sort(function (a, b) {  // niedrieg preis sort
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
    _max_pwr = _mindischrg;
  
    switch (_tibber_active_idx) {
        case 0:       
            if (_dc_now < 10) {
                const tibPoint =  getState(tibberDP + 'extra.tibberProtokoll').val;    // und diesen dann nehmen. bei tibber 0 dann macht der das was zueltzt gesendet worden ist
                if (tibPoint == 0) {
                    _tibber_active_idx = 33;    
                } else {
                    _tibber_active_idx = tibPoint;
                }
                
                tibber_active_auswertung();
                break;
            }
            
            if (!_istLadezeit) {
                _SpntCom = _InitCom_An;    
            } else {
                if (_dc_now < _verbrauchJetzt) {
                    _SpntCom = _InitCom_Aus;       
                }
            }
           
            break;
        case 1:                             //      _tibber_active_idx = 1;    Nachladezeit
            _SpntCom = _InitCom_An;
            _max_pwr = _pwrAtCom_def * -1;            
            break;
        case 2:                             //      _tibber_active_idx = 2;    Entladezeiten
        case 20:                            //      _tibber_active_idx = 20;   pv reicht für den Tag und wir sind in zwischenzeit wo nix produziert wird und preis unter schwelle  
            _SpntCom = _InitCom_Aus;
            break;    
        case 21:
            _SpntCom = _InitCom_Aus;         
            // if (kommeAusPrognose && _entladeZeitenArray.length > 1 ) {     //      halte die batterie bei  1 = da ist der --:-- drin
            //     _SpntCom = _InitCom_An;  
            // } 
            break;  
        case 22:                            //      _tibber_active_idx = 22;   Entladezeit reicht aus bis zum Sonnaufgang        
            _SpntCom = _InitCom_Aus;             
            break;    
        case 23:                            //      _tibber_active_idx = 23;   keine entladezeit da alle Preise unter schwelle aber Batterie hat ladung
            _SpntCom = _InitCom_Aus;
            break;            
        case 3:                              //      _tibber_active_idx = 3;    entladung stoppen wenn preisschwelle erreicht        
        case 33:                             //      _tibber_active_idx = 33;   wie 3 nur kommend von intern
            _SpntCom = _InitCom_An;
            break;        
        case 4:                             //      _tibber_active_idx = 4;    ladung stoppen wenn Restladezeit kleiner Billigstromzeitfenster
            _SpntCom = _InitCom_An;
            break;
        case 5:                             //      _tibber_active_idx = 5;    starte die ladung
            _SpntCom = _InitCom_An;
            _max_pwr = _pwrAtCom_def * -1;
            break;
        case 6:                             //      _tibber_active_idx = 6;    stoppe entladung 
            _SpntCom = _InitCom_An;
            _max_pwr = _mindischrg;
            break;
        default:
            _SpntCom = _InitCom_Aus;        
    }
}
