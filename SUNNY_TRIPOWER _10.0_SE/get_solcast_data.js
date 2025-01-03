// @ts-ignore
const moment = require('moment');
const options = { hour12: false, hour: '2-digit', minute: '2-digit' };

// welche javascript instanz wird genutzt, für diese muss in Einstellungen ASTRO Zeit generierung aktiviert sein 
const javascriptI = 'javascript.0';    

// zum ändern ab hier
const summeDpAnlegen = false;   // einmalig manuell für 24h auf true setzten, es werden summen Dp's angelegt   <<<<<<<<-----------------------------------  wichtig

const key_id    = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

const seite1    = 'garten';                     // name dp1  frei wählbar, sonne vormittags 
const seite1Key = "xxxx-xxxx-xxxx-xxxx";

const seite2    = 'strasse';                    //name dp2  frei wählbar, sonne nachmittags, leer wenn nur eine Seite genutzt wird
const seite2Key = "yyyy-yyyy-yyyy-yyyy";        // nicht ändern wenn nicht genutzt

const gesamt    = 'gesamt';                     // dp für zusammenrechnen muss in ladenNachPrognose angepasst werden wenn hier geändert

const _influxDb                     = false;   // wenn grafana output erwünscht benötigt wird eine influx.0 instanz
const  influxInstance               = 'influxdb.0';
const _influxDbMeasurementGesamt    = 'pvforecast.0.summary.power';
const _influxDbMeasurementStrasse   = 'pvforecast.0.plants.strasse.power';
const _influxDbMeasurementGarten    = 'pvforecast.0.plants.garten.power';

const mainObject            = '0_userdata.0.strom.pvforecast';
const mainObjectToday       = '0_userdata.0.strom.pvforecast.today';
const mainObjectTomorrow    = '0_userdata.0.strom.pvforecast.tomorrow';
const _abbrechenBei         = '00:00';   // ab wieviel Uhr kommt nix mehr, kann so bleiben

// pv_estimate   – Der Realist: Dies ist sozusagen die Standardvorhersage. Denk an ihn als den durchschnittlichen Wert, basierend auf den aktuellen Wetterdaten und Modellen. Er sagt uns, was wir in einem normalen Szenario erwarten können – weder zu optimistisch noch zu pessimistisch.
// pv_estimate10 – Der Vorsichtige: Jetzt wird's interessant. Dieser Wert ist die 10. Perzentile, also eher auf der niedrigen Seite. Er sagt uns, dass es eine 90 %ige Chance gibt, dass die tatsächliche Leistung höher ausfällt. Wenn du also lieber auf Nummer sicher gehst und nicht gerne enttäuscht wirst, ist das dein Wert.
// pv_estimate90 – Der Optimist: Im Gegensatz zum pv_estimate10 zeigt uns der pv_estimate90 die sonnige Seite. Dieser Wert ist die 90. Perzentile – eine Art Best-Case-Szenario. Hier sagen die Daten, dass es nur eine 10 %ige Chance gibt, dass die Leistung diesen Wert überschreitet. Ideal, wenn du die Dinge gerne von der besten Seite betrachtest.​
let prognose1              = 1;    // 0 = realistisch, 1 = vorsichtig, 2 = optimistisch
let prognose2              = 0;    // 0 = realistisch, 1 = vorsichtig, 2 = optimistisch
const ersteTagAbfrage      = seite2;   // wir brauchen morgends werte, welche Seite soll zuerst abgefragt werden

//-------------------------------------------------------------

const _baseUrl = "https://api.solcast.com.au/rooftop_sites/";
const _hours = 24;

let _tickerAbholung = 0;
let _errorMrk = false;

let _aufrufUrl   = '';
let _aufrufSeite = '';

// ------------------------------------------------------------------------------------------------------------------

//                       zum testen
//const testDaten = getState(`${mainObject}.response`).val;
//datenErzeugen(JSON.parse(testDaten), seite2);

//  initialisiere einmal in den nacht um 2 Uhr
schedule({ astro: 'sunset' }, () => {
    _tickerAbholung = 0;
});

schedule({ astro: 'sunrise' }, () => {
    initialPV();

    if (seite2.length > 0) {
        _aufrufUrl   = `${seite2Key}/forecasts?format=json&api_key=${key_id}`;
        _aufrufSeite = seite2;
        toLog(`Hole PV ${_aufrufSeite}`, true);
        requestData(_aufrufUrl, _aufrufSeite);
    }

    _aufrufUrl   = `${seite1Key}/forecasts?format=json&api_key=${key_id}`;
    _aufrufSeite = seite1;
    toLog(`Hole PV ${_aufrufSeite}`, true);
    requestData(_aufrufUrl, _aufrufSeite);

    _tickerAbholung = +1;
});


schedule('1 6 * * *', function () {   // um 6 immer abholen damit wir morgen gültige Tageswerte haben    
    if (_tickerAbholung < 1) {     // wurde schon mal abgeholt
        _aufrufUrl   = `${seite2Key}/forecasts?format=json&api_key=${key_id}`;
        _aufrufSeite = ersteTagAbfrage;
        requestData(_aufrufUrl, _aufrufSeite);
    }
});

// 10 request sind frei bei solcast.com
schedule('1 7,9,10 * * *', function () {
    const _hhJetzt  = getHH();
    const sunup = getState(javascriptI + '.variables.astro.sunrise').val;  
    
    let seite = seite1;
    if (seite2.length > 0) { 
        seite = seite2;
    }

    if (_hhJetzt >= parseInt(sunup.slice(0, 2)) && seite2.length > 0) {  
        _aufrufUrl   = `${seite2Key}/forecasts?format=json&api_key=${key_id}`;
        _aufrufSeite = seite;
        requestData(_aufrufUrl, _aufrufSeite);
        _tickerAbholung = +1;
    }
});

schedule('2 8,12,13,15 * * *', function () {
    const _hhJetzt            = getHH();
    const sunup = getState(javascriptI + '.variables.astro.sunrise').val;  
    
    if (_hhJetzt >= parseInt(sunup.slice(0, 2))) {     
        _aufrufUrl   = `${seite1Key}/forecasts?format=json&api_key=${key_id}`;
        _aufrufSeite = seite1;
        requestData(_aufrufUrl, _aufrufSeite);
        _tickerAbholung = +1;
    }
});
 
schedule('5,10,15 * * * *', function () {
    if (_errorMrk) {
        toLog(`ERROR - Hole PV ${_aufrufSeite} ticker ${_tickerAbholung}`, true);
        requestData(_aufrufUrl, _aufrufSeite);
        _tickerAbholung = +1;
    }
});
 
// ------------------------------------------------------------------------------------------------------------------

/*************** ab hier nix ändern  ***************************** */

async function requestData(seiteUrl, seite) {
    const url = `${_baseUrl}${seiteUrl}`;   
    _errorMrk = false;

    httpGet(url, { timeout: 9000, responseType: 'text' }, async (err, response) => {
        if (err) {
            _errorMrk = true;
            console.error(err);           
        } else {           
            const jsonData  = JSON.parse(response.data);
            const array     = jsonData.forecasts;
            
            setState(`${mainObject}.response`, JSON.stringify(array), true);

            datenErzeugen(array, seite);       
        };
    });
}

// --------------------------------------------------------------------

function datenErzeugen(array, seite) {
    const list          = [];  
    let heute           = true;

    for (let i = 0; i < array.length; i++) {                              
        const endtime   = Date.parse(array[i].period_end);
        const startTime = new Date(endtime - 1800000);

        let wert1   = array[i].pv_estimate;
        let wert2   = array[i].pv_estimate;

        switch(prognose1) {
            case 1:
                wert1 = array[i].pv_estimate10;
                break;
            case 2:
                wert1 = array[i].pv_estimate90;
                break;
            default:
                // nix
        } 

        switch(prognose2) {
            case 1:
                wert2 = array[i].pv_estimate10;
                break;
            case 2:
                wert2 = array[i].pv_estimate90;
                break;
            default:
                // nix
        } 

        list[i] = {
            starttime: startTime / 1000,
            endtime: endtime / 1000,
            wert1: Math.round(wert1 * 1000),
            wert2: Math.round(wert2 * 1000),
        };

     //   console.warn('list ' + JSON.stringify(list));
    }

    const startTime = new Date(list[0].starttime * 1000);
    const startDPTime = startTime.toLocaleTimeString('de-DE', options);

    let ind = 0;

    setTimeout(function () {   // warte falls dp noch nicht angelegt
        // finde startzeit
        for (ind = 0; ind < _hours * 2; ind++) {
            const startTimeind = getState(mainObjectToday + '.' + seite + '.' + ind + '.startTime').val;
            if (startDPTime == startTimeind) {               
                break;
            }
        }

        // console.warn('start ind ' + ind + ' auf seite ' + seite);

        let listenDP = -1;    // damit ich auf 0 komme bei ersten lauf
        let posiA = ind - 1;
        let schonGebucht = false;
        
        let wertW1Ges = 0;
        let wertW2Ges = 0;

        for (let a = 0; a < _hours * 4; a++) {
            listenDP += 1;

            if (list[listenDP] == undefined) {
                break;
            }

            const starttt       = new Date(list[listenDP].starttime * 1000);
            const endtt         = new Date(list[listenDP].endtime * 1000);
            const startTime     = starttt.toLocaleTimeString('de-DE', options);
            const endTime       = endtt.toLocaleTimeString('de-DE', options);

            if (startTime == _abbrechenBei) {   // wir brauchen nur bis nachts
                if (schonGebucht) {
                    break;
                }
                if (!schonGebucht) {
                    heute = false;
                    posiA = -1;                     
                    schonGebucht = true;
                }
            }

            posiA += 1;

            let stateBaseName1 = `${mainObjectToday}.${seite1}.${posiA}.`;
            let stateBaseName2 = ``;
            
            if (seite2.length > 0) {
                stateBaseName2 = `${mainObjectToday}.${seite2}.${posiA}.`;
            }
            
            let stateBaseNameGes = `${mainObjectToday}.${gesamt}.${posiA}.`;

            if (!heute) {
                stateBaseName1 = `${mainObjectTomorrow}.${seite1}.${posiA}.`;
                if (seite2.length > 0) {
                    stateBaseName2 = `${mainObjectTomorrow}.${seite2}.${posiA}.`;
                }
                stateBaseNameGes = `${mainObjectTomorrow}.${gesamt}.${posiA}.`;
            }

            let wertW1 = list[listenDP].wert1;      
            let wertW2 = list[listenDP].wert2;

            if (seite == seite1) {
                setState(stateBaseName1 + 'power', wertW1, true);
                setState(stateBaseName1 + 'power90', wertW2, true);
                
                let powerWName2   = 0;
                let powerW90Name2 = 0;

                if (seite2.length > 0) {
                    powerWName2     = getState(stateBaseName2 + 'power').val;
                    powerW90Name2   = getState(stateBaseName2 + 'power90').val;
                }

                wertW1Ges = wertW1 + powerWName2;
                wertW2Ges = wertW2 + powerW90Name2;
            }

            if (seite == seite2 && seite2.length > 0) {
                setState(stateBaseName2 + 'power', wertW1, true);
                setState(stateBaseName2 + 'power90', wertW2, true);

                const powerWName1 = getState(stateBaseName1 + 'power').val;
                const power90WName1 = getState(stateBaseName1 + 'power90').val;

                wertW1Ges = wertW1 + powerWName1;
                wertW2Ges = wertW2 + power90WName1;
            }                             

            setState(stateBaseNameGes + 'power', parseInt((wertW1Ges).toFixed(3)), true);
            setState(stateBaseNameGes + 'power90', parseInt((wertW2Ges).toFixed(3)), true);
        }        
        
        genGraphAnlegen(true);    // erzeuge today
        genGraphAnlegen(false);   // erzeuge tomorrow

        setState(`${mainObject}.lastUpdated`, { val: moment().valueOf(), ack: true });
        toLog(`Hole PV ${seite}`, true);
        
    }, 500); 
}

async function initialPV() {
    await seiteAnlegen(seite1);
    if (seite2.length > 0) {
        await seiteAnlegen(seite2);
    }
    await seiteAnlegen(gesamt);
}

async function seiteAnlegen(seite) {
    const stunden = 24;
    const startTime = { hour: 0, minute: 30 };
    let dp = mainObjectToday + '.' + seite + '.';
    let ind = 0;

    // Schleife zur Generierung der Zeitfolge today
    if (summeDpAnlegen) {
        for (let hour = 0; hour < stunden; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {

                let stateBaseNameGes = dp + ind + '.';

                if (ind < 48) {    
                    createUserStates('0_userdata.0', false, [stateBaseNameGes + 'startTime', { 'name': 'Gultigkeitsbeginn (Uhrzeit)', 'type': 'string', 'read': true, 'write': false, 'role': 'state' }], function () {
                        setStateAsync(stateBaseNameGes + 'startTime', formatTime(hour, minute), true);
                    });                
                }
                ind += 1;
            }
        }
    }

    ind = 0;

    for (let hour = startTime.hour; hour <= stunden; hour++) {
        for (let minute = (hour === startTime.hour ? startTime.minute : 0); minute < 60; minute += 30) {

            let stateBaseNameGes = dp + ind + '.';

            if (ind < 48) {
                if (hour == 24) {
                    hour = 0;
                }
                if (summeDpAnlegen) {
                    createUserStates('0_userdata.0', false, [stateBaseNameGes + 'endTime', { 'name': 'Gultigkeitsende (Uhrzeit)', 'type': 'string', 'read': true, 'write': false, 'role': 'state' }], function () {
                        setStateAsync(stateBaseNameGes + 'endTime', formatTime(hour, minute), true);
                    });
                }

                createUserStates('0_userdata.0', false, [stateBaseNameGes + 'power', { 'name': 'power', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0, 'unit': 'W' }], function () {
                    setStateAsync(stateBaseNameGes + 'power', 0, true);
                });

                createUserStates('0_userdata.0', false, [stateBaseNameGes + 'power90', { 'name': 'power90', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0, 'unit': 'W' }], function () {
                    setStateAsync(stateBaseNameGes + 'power90', 0, true);
                });
            }
            ind += 1;
        }
    }

    dp = mainObjectTomorrow + '.' + seite + '.';

    // Schleife zur Generierung der Zeitfolge tomorrow
    if (summeDpAnlegen) {
        ind = 0;
        for (let hour = 0; hour < stunden; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {

                let stateBaseNameGes = dp + ind + '.';

                if (ind < 48) {
                    createUserStates('0_userdata.0', false, [stateBaseNameGes + 'startTime', { 'name': 'Gultigkeitsbeginn (Uhrzeit)', 'type': 'string', 'read': true, 'write': false, 'role': 'state' }], function () {
                        setStateAsync(stateBaseNameGes + 'startTime', formatTime(hour, minute), true);
                    });
                }
                ind += 1;
            }
        }
    }

    ind = 0;

    for (let hour = startTime.hour; hour <= stunden; hour++) {
        for (let minute = (hour === startTime.hour ? startTime.minute : 0); minute < 60; minute += 30) {

            let stateBaseNameGes = dp + ind + '.';

            if (ind < 48) {
                if (hour == 24) {
                    hour = 0;
                }
                if (summeDpAnlegen) {
                    createUserStates('0_userdata.0', false, [stateBaseNameGes + 'endTime', { 'name': 'Gultigkeitsende (Uhrzeit)', 'type': 'string', 'read': true, 'write': false, 'role': 'state' }], function () {
                        setStateAsync(stateBaseNameGes + 'endTime', formatTime(hour, minute), true);
                    });
                }

                createUserStates('0_userdata.0', false, [stateBaseNameGes + 'power', { 'name': 'power', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0, 'unit': 'W' }], function () {
                    setStateAsync(stateBaseNameGes + 'power', 0, true);
                });

                createUserStates('0_userdata.0', false, [stateBaseNameGes + 'power90', { 'name': 'power90', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0, 'unit': 'W' }], function () {
                    setStateAsync(stateBaseNameGes + 'power90', 0, true);
                });
            }

            ind += 1;
        }
    }

    if (summeDpAnlegen) {
        await dPAnlegen(seite);
    }   
}

async function dPAnlegen(seite) {
    const dp = mainObject + '.';

    createUserStates('0_userdata.0', true, [dp + 'lastUpdated', { 'name': 'Letztes Update (Daten)', 'type': 'number', 'read': true, 'write': false, 'role': 'value.time', 'def': 0 }], function () {
        setStateAsync(dp + 'lastUpdated', 0, true);
    });

    createUserStates('0_userdata.0', true, [dp + 'response', { 'name': 'Abfrage array', 'type': 'string', 'read': true, 'write': false, 'role': 'state', 'def': '' }], function () {
        setStateAsync(dp + 'response', '', true);
    });

    const dp1 = mainObjectToday + '.' + seite + '.';

    createUserStates('0_userdata.0', true, [dp1 + 'today_kW', { 'name': 'today_kW', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0, 'unit': 'W' }], function () {
        setStateAsync(dp1 + 'today_kW', 0, true);
    });

    createUserStates('0_userdata.0', true, [mainObjectToday + '.JSONGraph', { 'name': 'Diagrammdaten', 'type': 'string', 'read': true, 'write': false, 'role': 'json', 'def': '{}' }], function () {
        setStateAsync(mainObjectToday + '.JSONGraph', '{}', true);
    });

    const dp2 = mainObjectTomorrow + '.' + seite + '.';

    createUserStates('0_userdata.0', true, [dp2 + 'tomorrow_kW', { 'name': 'tomorrow_kW', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0, 'unit': 'W' }], function () {
        setStateAsync(dp2 + 'tomorrow_kW', 0, true);
    });

    createUserStates('0_userdata.0', true, [mainObjectTomorrow + '.JSONGraph', { 'name': 'Diagrammdaten', 'type': 'string', 'read': true, 'write': false, 'role': 'json', 'def': '{}' }], function () {
        setStateAsync(mainObjectTomorrow + '.JSONGraph', '{}', true);
    });
}

//------------ graph

function genGraphAnlegen(today) {
    let mainObjectGraph = '';
    let dayTag = '';

    if (!today) {
        mainObjectGraph = mainObjectTomorrow;
        dayTag = 'tomorrow_kW';
    } else {
        mainObjectGraph = mainObjectToday;
        dayTag = 'today_kW'
    }
    const jsonGraphData = [];
    const jsonGraphLabels = [];

    let powerWGes = 0;
    let powerWGesName1 = 0;
    let powerWGesName2 = 0;
    
    for (let posiA = 0; posiA < _hours * 2; posiA++) {
    
        let stateBaseNameGes = `${mainObjectGraph}.${gesamt}.${posiA}.`;
        let stateBaseName1 = `${mainObjectGraph}.${seite1}.${posiA}.`;
        let stateBaseName2 = ``;

        if (seite2.length > 0) {
            stateBaseName2 = `${mainObjectGraph}.${seite2}.${posiA}.`;
        }
        const startTime = getState(stateBaseNameGes + 'startTime').val;

        let powerWGesamt  = getState(stateBaseNameGes + 'power').val;
        let powerWName1   = getState(stateBaseName1 + 'power').val;
        let powerWName2   = 0;
         
        if (seite2.length > 0) {
            powerWName2   = getState(stateBaseName2 + 'power').val;
        }

        powerWGes = powerWGes + powerWGesamt;
        powerWGesName1 = powerWGesName1 + powerWName1;
        if (seite2.length > 0) {
            powerWGesName2 = powerWGesName2 + powerWName2;
        }
    
        if (powerWGesamt > 0) {  
            if (startTime.match(':00')) {   
                jsonGraphLabels.push(startTime);                           
                powerWGesamt = Number(Math.round((powerWGesamt * 100)/100)/1000);      
                jsonGraphData.push(powerWGesamt);

                if (_influxDb) {
                    influxDdOutput(_influxDbMeasurementGesamt, startTime, powerWGesamt);
                    influxDdOutput(_influxDbMeasurementGarten, startTime, powerWName1);
                    influxDdOutput(_influxDbMeasurementStrasse, startTime, powerWName2);                    
                }
            }
        }       
    }
    
    setState(`${mainObjectGraph}.${seite1}.${dayTag}`,  Number(Math.round((powerWGesName1 /2/1000)*100)/100), true);
    if (seite2.length > 0) {
        setState(`${mainObjectGraph}.${seite2}.${dayTag}`,  Number(Math.round((powerWGesName2 /2/1000)*100)/100), true);
    }
    setState(`${mainObjectGraph}.${gesamt}.${dayTag}`, Number(Math.round((powerWGes /2/1000)*100)/100), true);

    genGraph(jsonGraphLabels, jsonGraphData, mainObjectGraph);
}

function formatTime(hour, minute) {
    return (hour < 10 ? '0' + hour : hour) + ':' + (minute < 10 ? '0' + minute : minute);
}

function addLeadingZero(number) {
    return number < 10 ? '0' + number : number;
}

async function influxDdOutput(influxDbMeasurementDP, startTime, powerW) {
    const stTime = startTime + ':00';
    let currentDate = new Date();
    let formattedDate = currentDate.getFullYear() + '-' + addLeadingZero(currentDate.getMonth() + 1) + '-' + addLeadingZero(currentDate.getDate()) + ' ' + stTime;
    await addToInfluxDB(influxDbMeasurementDP, moment(formattedDate).valueOf(), powerW);
}

async function genGraph(jsonGraphLabels, jsonGraphData, whichDay) {
    let globalunit = 1000;

    // https://github.com/Scrounger/ioBroker.vis-materialdesign/blob/master/README.md
    const jsonGraph = {
        // graph
        data: jsonGraphData,
        type: 'bar',
        legendText: 'PV',
        displayOrder: 1,
        color: '#fffd00',
        tooltip_AppendText: 'kW',
        datalabel_show: true,
        datalabel_rotation: 300,
        datalabel_color: '#cccccc',
        datalabel_fontSize: 14,

        // graph bar chart 
        barIsStacked: true,
        barStackId: 1,

        // graph y-Axis
        yAxis_id: 0,
        yAxis_position: 'left',
        yAxis_show: true,
        yAxis_appendix: 'kW',
        yAxis_step: 5,
        yAxis_max: 13100 / globalunit,
        yAxis_maximumDigits: 3,
    };

    await this.setStateAsync(`${whichDay}.JSONGraph`, { val: JSON.stringify({ 'graphs': [jsonGraph], 'axisLabels': jsonGraphLabels }, null, 2), ack: true });
}

async function addToInfluxDB(influxDbMeasurement, timestamp, value) {
    try {
        const result = await this.sendToAsync(influxInstance, 'storeState', {
            id: influxDbMeasurement,
            state: {
                ts: timestamp,
                val: value,
                ack: true,
                from: `system.adapter.javascript`,
                //q: 0
            }
        });			
    } catch (err) {
        console.warn(`[addToInfluxDB] storeState error: ${err}`);
    }
}
