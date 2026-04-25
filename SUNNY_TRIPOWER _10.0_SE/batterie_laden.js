
const _spntComCheckDP       = '0_userdata.0.strom.40151_Kommunikation_Check';
const _triggerDP            = 'modbus.0.inputRegisters.3.30193_Systemzeit_als_trigger';
const _batteryLadePowerMax  = 5000;                                 // max Batterie ladung 

let _wirdGeladen    = false;
let _battLaden      = false;

setState('0_userdata.0.strom.batterieLadenManuellStart', _battLaden, true);      
setState('0_userdata.0.strom.batterieLadenManuellForce', false, true);      
setState('0_userdata.0.strom.batterieLadenManuellWert', 0, true);      

on({id: _triggerDP, change: 'ne'}, function() {  // aktualisiere laut adapter abfrageintervall   
        _battLaden              = getState('0_userdata.0.strom.batterieLadenManuellStart').val;
    let battSOC                 = getState('modbus.0.inputRegisters.3.30845_Batterie_Prozent').val;                
    const tibberNutzenManuell   = getState('0_userdata.0.strom.tibber.extra.tibberNutzenManuell').val;
    const tibberStartStunde     = getState('0_userdata.0.strom.tibber.extra.tibberNutzenManuellHH').val;
    const battSOCBis            = getState('0_userdata.0.strom.tibber.extra.tibberNutzenManuellProzent').val;
    const aktuelleStunde        = getHH();  

    if (_wirdGeladen && !_battLaden) {
        processingOff();
    }

    if (!_wirdGeladen) {
        if (tibberNutzenManuell && tibberStartStunde == aktuelleStunde) {
            _battLaden = true; 
            setState('0_userdata.0.strom.batterieLadenManuellStart', _battLaden, true);                 // button manuelle laden
            setState('0_userdata.0.strom.batterieLadenManuellForce', _battLaden, true);                 // checkbox
            setState('0_userdata.0.strom.batterieLadenManuellForceWatt',_batteryLadePowerMax, true);    // watt anzahl
            _wirdGeladen = true;
        }
    }

    if (_battLaden) {
        if (battSOC >= battSOCBis) {
            processingOff(); 
        } else {
            setTimeout(function () {  
                processingLaden(); 
            }, 600);           // verzögerung zwecks Datenabholung  
        }         
    }

});  

function processingLaden() {
    const verbrauch             = getState('alias.0.usv.pv.Momentan_Verbrauch_W').val + 100;  // + 100 Watt reserve
    const pvWert                = getState('0_userdata.0.strom.PV_Leistung_aktuell').val * 1000; // in Watt
    const mitStromLaden         = getState('0_userdata.0.strom.batterieLadenManuellForce').val;
    const battMaxLaden          = getState('0_userdata.0.strom.batterieLadenManuellForceWatt').val;
    const battSOC               = getState('modbus.0.inputRegisters.3.30845_Batterie_Prozent').val; 

    let ladenMax = pvWert - verbrauch;
               
    if (mitStromLaden) {
        ladenMax = battMaxLaden;
    } else {
        if (ladenMax < 10) {
            ladenMax = 0;
        }
    }    

    if (ladenMax > 1) {
        if (battSOC >= 90) {
            ladenMax = 1000;    
        }
    }
    
    ladungStart(ladenMax);   
    
    //console.warn('Starte Batterie Laden mit Tibber ladenMax ' + ladenMax); 
    setState('0_userdata.0.strom.batterieLadenManuellWert', ladenMax, true);

}

function processingOff() {
    toLog('Stoppe Batterie Laden manuell',true );
    //console.warn('Stoppe Batterie Laden mit Tibber');

    ladungStop();
  
    _battLaden      = false;
    _wirdGeladen    = false;

    setState('0_userdata.0.strom.batterieLadenManuellForce', _battLaden, true);      
    setState('0_userdata.0.strom.tibber.extra.tibberNutzenManuell', _battLaden, true);      
    setState('0_userdata.0.strom.batterieLadenManuellWert', 0, true);      
    setState('0_userdata.0.strom.batterieLadenManuellStart', _battLaden, true);      
}

function ladungStart(wert) {    

    //console.warn('an WR gesendet ' + wert);
    setState('modbus.0.holdingRegisters.3.40151_Kommunikation', 802);   // 802 active, 803 inactive

    setState(_spntComCheckDP, 802, true);
    if (wert > 0) {
        wert = wert * -1
    }
    setState('0_userdata.0.strom.tibber.extra.tibberProtokoll', 99, true); 
    setState('modbus.0.holdingRegisters.3.40149_Wirkleistungvorgabe',wert);
    setState('0_userdata.0.strom.tibber.extra.Batterieladung_jetzt', wert, true);
    setState('0_userdata.0.strom.tibber.extra.Batterieladung_soll', wert, true);
}

function ladungStop() {
    setState('modbus.0.holdingRegisters.3.40151_Kommunikation', 803);   // 802 active, 803 inactive
    setState(_spntComCheckDP, 803, true);
}
