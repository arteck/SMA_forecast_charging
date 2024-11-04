const _tibber = 'tibberlink.0.Homes.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.';     // Anpassen!

const _tibberDP1 = '0_userdata.0';
const _tibberDP2 = 'strom.tibber.';
const _tibberDP = _tibberDP1 + '.' + _tibberDP2;

const options = { hour12: false, hour: '2-digit', minute:'2-digit'};
   

//createUserStates(userDataDP, false, [tibberStromDP + 'extra.tibberNutzenManuellHH', { 'name': 'nutze Tibber Preise manuell ab Stunde ', 'type': 'number', 'read': true, 'write': false, 'role': 'value', 'def': 0 }], function () {
//    setState(tibberDP + 'extra.tibberNutzenManuellHH', 0, true);
//});

createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberBestPreisArray', { 'name': 'tibber bester preis als array', 'type':'array', 'read': true, 'write': false, 'role': 'json'}], function () {  });       
createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberBestPreisArrayLang', { 'name': 'tibber bester preis als array', 'type':'array', 'read': true, 'write': false, 'role': 'json'}], function () {  }); 
createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberPvForcast', { 'name': 'tibber formattierung für pv prognose', 'type':'array', 'read': true, 'write': false, 'role': 'json'}], function () {  }); 

createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberBestPreis', { 'name': 'tibber Best Preis', 'type':'number', 'read': true, 'write': false, 'role': 'state', 'def':0 , "unit": "ct" }], function () {      
  setState(_tibberDP + 'extra.tibberBestPreis', 0, true);
}); 

createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberPreisJetzt', { 'name': 'tibber Preis Jetzt', 'type':'number', 'read': true, 'write': false, 'role': 'state', 'def':0, "unit": "ct" }], function () {        
  setState(_tibberDP + 'extra.tibberPreisJetzt', 0, true);
}); 
createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberPreisNächsteStunde', { 'name': 'tibber Preis Nächste Stunde', 'type':'number', 'read': true, 'write': false, 'role': 'state', 'def':0, "unit": "ct" }], function () {        
  setState(_tibberDP + 'extra.tibberPreisNächsteStunde', 0, true);
}); 

holePreis();

aktualisiereStunde();

function holePreis() {
    let preise = [];
    let preisePV = [];

    const now = new Date();
    const array24Stunden = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    const arr1 = JSON.parse(getState(_tibber +'PricesToday.json').val);
    const arr2 = JSON.parse(getState(_tibber +'PricesTomorrow.json').val);
    let arrPrice = arr1;

    if (arr2) {
        arrPrice = arr1.concat(arr2);  // füge beide zusammen
    } 

    for (let i = 0; i < arrPrice.length; i++) {
        const element   = arrPrice[i];
        const startsAt  = element.startsAt;
        const start = new Date(startsAt);
        const preis     = element.total;
        const levelText = element.level;

        let obj = {};

        if (start >= now && start <= array24Stunden) {
            // console.warn(`Starts at: ${start}, Total: ${preis}, level: ${levelText}`);
            const stateBaseName = _tibberDP2 + i + ".";
                    
            const end = new Date(Date.parse(startsAt)).getTime()+3600000;            
            const startTime = start.toLocaleTimeString('de-DE', options);
            const startDate = start.toLocaleDateString('de-DE');        
            const endTime = new Date(end).toLocaleTimeString('de-DE', options);
            
            obj.start = start.getHours();

            obj.preis = preis;
            preise.push(obj);

            preisePV.push([preis, startTime , startTime.split(':')[0] + ':30']);
            preisePV.push([preis, startTime.split(':')[0] + ':30', endTime]);

            createUserStates('0_userdata.0', false, [stateBaseName + 'startTime', { 'name': 'Gultigkeitsbeginn (Uhrzeit)', 'type':'string', 'read': true, 'write': false, 'role': 'state' }], function () {        
                setState('0_userdata.0.' + stateBaseName + 'startTime', startTime, true);
            });
            createUserStates('0_userdata.0', false, [stateBaseName+ 'startDate', { 'name': 'Gultigkeitsbeginn (Datum)', 'type':'string', 'read': true, 'write': false, 'role': 'state' }], function () {        
                setState('0_userdata.0.' + stateBaseName + 'startDate', startDate, true);
            });
            createUserStates('0_userdata.0', false, [stateBaseName+ 'endTime', { 'name': 'Gultigkeitsende (Uhrzeit)', 'type':'string', 'read': true, 'write': false, 'role': 'state' }], function () {        
                setState('0_userdata.0.' + stateBaseName + 'endTime', endTime, true);
            });
            createUserStates('0_userdata.0', false, [stateBaseName+ 'price', { 'name': 'Preis', 'type':'number', 'read': true, 'write': false, 'role': 'state',  'def':0, "unit": "ct" }], function () {       
                setState('0_userdata.0.' + stateBaseName + 'price', preis, true);
            });   
            createUserStates('0_userdata.0', false, [stateBaseName+ 'level', { 'name': 'Preis Level', 'type':'string', 'read': true, 'write': false, 'role': 'text',  'def': '' }], function () {        
                setState('0_userdata.0.' + stateBaseName + 'level', levelText, true);
            });  
        }
    }
   

    let preiseSortLang = preise;
    preiseSortLang.sort(function(a, b) {
        return a.start - b.start;
    });

    const preisePVSort = sortArrayByStartTime(preisePV, getHH());

    setState(_tibberDP + 'extra.tibberBestPreisArrayLang', preiseSortLang, true);
    setState(_tibberDP + 'extra.tibberPvForcast', preisePVSort, true);

    errechneBesteUhrzeit(preise);
    
}

function sortArrayByStartTime(array, currentHour) {
    // Sortiere den Array nach der Startzeit
    array.sort((a, b) => {
        const timeA = a[1].split(":").map(Number);
        const timeB = b[1].split(":").map(Number);
        
        // Vergleiche Stunden
        if (timeA[0] != timeB[0]) {
            return timeA[0] - timeB[0];
        }
        
        // Wenn Stunden gleich sind, vergleiche Minuten
        return timeA[1] - timeB[1];
    });

    // Finde den Index des aktuellen Zeitpunkts
    let startIndex = array.findIndex(item => {
        const time = item[1].split(":").map(Number);
        return time[0] >= currentHour || (time[0] == currentHour && time[1] >= 30);
    });

    // Schneide den Array ab startIndex und setze ihn an das Ende
    const sortedArray = array.slice(startIndex).concat(array.slice(0, startIndex));

    return sortedArray;
}



function errechneBesteUhrzeit(allePreise) {
    const [niedrigsterIndex, zweitNiedrigsterIndex] = findeBenachbarteNiedrigstePreise(allePreise);
    const preiseKurzArr = [];

    preiseKurzArr.push(allePreise[niedrigsterIndex]);
    preiseKurzArr.push(allePreise[zweitNiedrigsterIndex]);
    startZeit(preiseKurzArr);
}

function findeBenachbarteNiedrigstePreise(preisArray) {     
    let niedrigsterPreis = Number.POSITIVE_INFINITY;
    let zweitNiedrigsterPreis = Number.POSITIVE_INFINITY;
    let niedrigsterPreisIndex = -1;
    let zweitNiedrigsterPreisIndex = -1;

    for (let i = 0; i < preisArray.length; i++) {
        if (preisArray[i].preis < niedrigsterPreis) {
            zweitNiedrigsterPreis = niedrigsterPreis;
            zweitNiedrigsterPreisIndex = niedrigsterPreisIndex;
            niedrigsterPreis = preisArray[i].preis;
            niedrigsterPreisIndex = i;
        } else if (preisArray[i].preis < zweitNiedrigsterPreis) {
            zweitNiedrigsterPreis = preisArray[i].preis;
            zweitNiedrigsterPreisIndex = i;
        }
    }
    return [niedrigsterPreisIndex, zweitNiedrigsterPreisIndex];
}

function startZeit(preiseKurz) {    
    const obj = preiseKurz[0];
    const start = obj.start * 1;
    const preis = obj.preis * 1;

    preiseKurz.splice(0, 1);

    setState(_tibberDP + 'extra.tibberNutzenManuellHH', start, true);
    setState(_tibberDP + 'extra.tibberBestPreis', preis, true);
    setState(_tibberDP + 'extra.tibberBestPreisArray', preiseKurz, true);
}


function aktualisiereStunde() {
    let stunde = Number(getHH());

    setState(_tibberDP + 'extra.tibberPreisJetzt' , getState(_tibberDP + stunde + '.price'/*Preis*/).val, true);
    
    stunde = stunde + 1;
    if (stunde == 24) {
        stunde = 0;
    }

    setState(_tibberDP + 'extra.tibberPreisNächsteStunde' , getState(_tibberDP + stunde + '.price'/*Preis*/).val, true);
}

schedule('*/60 * * * *', function() {
    holePreis();     
});

schedule('1 * * * *', function() {
    aktualisiereStunde();
});
 

