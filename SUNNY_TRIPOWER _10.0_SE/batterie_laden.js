
const _tickerVorgabe    = 120; // in minuten
const _spntComCheckDP   = '0_userdata.0.strom.40151_Kommunikation_Check';
const _triggerDP        = 'modbus.0.inputRegisters.3.30193_Systemzeit_als_trigger';


let _ticker              = 0;
let _wirdGeladenUhrzeit  = false;
let _wirdGeladenTibber   = false;
let _battLaden           = false;

setState('0_userdata.0.strom.batterieLadenManuellStart', _battLaden);
setState('0_userdata.0.strom.batterieLadenManuellTicker', _ticker, true); 
setState('0_userdata.0.strom.batterieLadenManuellStop', false, true); 


schedule('* * * * *', function () {
    const battProz                  = getState('modbus.0.inputRegisters.3.30845_Batterie_Prozent').val;        
          _battLaden                = getState('0_userdata.0.strom.batterieLadenManuellStart').val;
    const tibberNutzenManuell       = getState('0_userdata.0.strom.tibber.extra.tibberNutzenManuell').val;
    const tibberStartStunde         = getState('0_userdata.0.strom.tibber.extra.tibberNutzenManuellHH').val;
    const battProzBis               = getState('0_userdata.0.strom.tibber.extra.tibberNutzenManuellProzent').val;
    const battMaxLaden              = getState('0_userdata.0.strom.batterieLadenManuellForceWatt').val;
    const aktuelleStunde            = getHH();  

// prio 1 dann kommt automatisiert
// nach tibber manuell uhrzeit aus der tabelle
    if (tibberNutzenManuell && tibberStartStunde == aktuelleStunde) {
        if (!_wirdGeladenTibber) {
            _battLaden = true;
            setState('0_userdata.0.strom.batterieLadenManuellForce', _battLaden, true); 
            _wirdGeladenTibber = true;         
            _ticker = 0;  
            toLog('Starte Batterie Laden mit Tibber',true );  
        }       
    }

    if (_battLaden) {        
        _ticker = _ticker + 1; 

        if (battProz > battProzBis) {
            _ticker = 999;     
            setState('0_userdata.0.strom.tibber.extra.tibberNutzenManuell', false, true); 
        }                   

        if (_ticker > _tickerVorgabe && battMaxLaden != -1) {                
            processingOff();                    
        }     

        if (battMaxLaden != -1) {
            _ticker = 999;    
        }
    }
    
    setState('0_userdata.0.strom.batterieLadenManuellTicker', _tickerVorgabe - _ticker, true);   
    setState('0_userdata.0.strom.batterieLadenManuellStart', _battLaden, true); 

});


on({id: _triggerDP, change: 'ne'}, function() {  // aktualisiere laut adapter abfrageintervall   
    setTimeout(function () {  
        processingLaden(); 
    }, 600);           // verzögerung zwecks Datenabholung           
});  

on({id: '0_userdata.0.strom.batterieLadenManuellStop',change: 'any'}, function(obj) {  
    const sts = obj.state.val;
    if (sts) { 
        processingOff();
        setTimeout(function() {
            setState('0_userdata.0.strom.batterieLadenManuellStop', false, true); 
        }, 1000 * 10);  
    }
});


// wird auch im kiavollvis gesetzt wenn auto connected
on({id: '0_userdata.0.strom.batterieLadenManuellStart',change: 'ne'}, function(obj) {   
    _battLaden  = obj.state.val;    

    if (_battLaden) { 
        setState('0_userdata.0.strom.batterieLadenManuellStop', false, true); 
        toLog('Start Batterie Laden manuell',true );
        processingLaden();               
    } else {
        processingOff();
    }
}); 

function processingLaden() {
    const verbrauch             = getState('alias.0.usv.pv.Momentan_Verbrauch_W').val + 100;  // + 100 Watt reserve
    const mitStromLaden         = getState('0_userdata.0.strom.batterieLadenManuellForce').val;
    const pvWert                = getState('0_userdata.0.strom.PV_Leistung_aktuell').val * 1000; // in Watt
    const battMaxLaden          = getState('0_userdata.0.strom.batterieLadenManuellForceWatt').val;
    const battProz              = getState('modbus.0.inputRegisters.3.30845_Batterie_Prozent').val; 
    const mom_Batterieladung    = getState('modbus.0.inputRegisters.3.31393_Momentane_Batterieladung').val; 

    let ladenMax = 0;

    if (_battLaden) {              
        if (mitStromLaden) {
            ladenMax = battMaxLaden;
        } else {
            ladenMax = pvWert - verbrauch;
        }   
    
        if (battProz >= 90) {
            ladenMax = 500;    
        }

        if (ladenMax > 0 ) {    
            ladungStart(ladenMax);        
        } 
    } else {
        if (pvWert < verbrauch && mom_Batterieladung > 1000) {
            ladenMax = mom_Batterieladung;
        }
    }

    setState('0_userdata.0.strom.batterieLadenManuellWert', ladenMax, true);
}


function processingOff() {
    toLog('Stoppe Batterie Laden manuell',true );
    ladungStop();
   
    _wirdGeladenUhrzeit  = false;
    _wirdGeladenTibber   = false;
    _ticker              = 0; 
    _battLaden           = false;

    setState('0_userdata.0.strom.batterieLadenManuellStart', false);     
    setState('0_userdata.0.strom.batterieLadenManuellForce', false, true); 
}

function ladungStart(wert) {    
    setState('modbus.0.holdingRegisters.3.40151_Kommunikation', 802);   // 802 active, 803 inactive

    setState(_spntComCheckDP, 802, true);
    if (wert > 0) {
        wert = wert * -1
    }
    setState('modbus.0.holdingRegisters.3.40149_Wirkleistungvorgabe',wert);
    setState('0_userdata.0.strom.tibber.extra.Batterieladung_jetzt', wert *-1, true);
    setState('0_userdata.0.strom.tibber.extra.Batterieladung_soll', wert *-1, true);
}

function ladungStop() {
    setState('modbus.0.holdingRegisters.3.40151_Kommunikation', 803);   // 802 active, 803 inactive
    setState(_spntComCheckDP, 803, true);
}
