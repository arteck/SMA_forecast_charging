const _tibber = 'tibberlink.0.Homes.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.';     // Anpassen!

const _tibberDP1 = '0_userdata.0';
const _tibberDP2 = 'strom.tibber.';
const _tibberDP  = _tibberDP1 + '.' + _tibberDP2;

const options = { hour12: false, hour: '2-digit', minute:'2-digit'};
   
// bei jeder preisänderung wird die neue Stunde mit dem niedrigen Preis für die vis übernommen
const tibberPreisUebermnehmen = true;
// 
const _tibberLevelErmitteln = false;

createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberPvForcast', { 'name': 'tibber formattierung für pv prognose', 'type':'array', 'read': true, 'write': false, 'role': 'json'}], function () {  }); 
createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberPvForcastTomorrow', { 'name': 'tibber rest preise für morgen', 'type':'array', 'read': true, 'write': false, 'role': 'json'}], function () {  }); 
createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberBestPreisArrayLang', { 'name': 'tibber bester preis als array', 'type':'array', 'read': true, 'write': false, 'role': 'json'}], function () {  });
createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberBestPreisArrayLangTomorrow', { 'name': 'tibber bester preis als array für Morgen', 'type':'array', 'read': true, 'write': false, 'role': 'json'}], function () {  });

createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberBestPreis', { 'name': 'tibber Best Preis', 'type':'number', 'read': true, 'write': false, 'role': 'state', 'def':0 , "unit": "ct" }], function () {      
  setState(_tibberDP + 'extra.tibberBestPreis', 0, true);
}); 

createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberPreisJetzt', { 'name': 'tibber Preis Jetzt', 'type':'number', 'read': true, 'write': false, 'role': 'state', 'def':0, "unit": "ct" }], function () {        
  setState(_tibberDP + 'extra.tibberPreisJetzt', 0, true);
}); 

createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberPreisNächsteStunde', { 'name': 'tibber Preis Nächste Stunde', 'type':'number', 'read': true, 'write': false, 'role': 'state', 'def':0, "unit": "ct" }], function () {        
  setState(_tibberDP + 'extra.tibberPreisNächsteStunde', 0, true);
}); 

if (_tibberLevelErmitteln) {
    createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberLevelJetzt', { 'name': 'Preis Level', 'type':'string', 'read': true, 'write': false, 'role': 'text',  'def': '' }], function () {        
        setState(_tibberDP + 'extra.tibberLevelJetzt', '', true);
    });  

    createUserStates(_tibberDP1, false, [_tibberDP2 + 'extra.tibberLevelNächsteStunde', { 'name': 'Preis Level', 'type':'string', 'read': true, 'write': false, 'role': 'text',  'def': '' }], function () {        
        setState(_tibberDP + 'extra.tibberLevelNächsteStunde', '', true);
    }); 
}

holePreis();
preisJetzt();

function holePreis() {
    let preiseHeute = [];
    let preiseMorgen = [];
    let preisePV = [];
    let preisePVTommorow = [];
    
    const arr1 = JSON.parse(getState(_tibber +'PricesToday.json').val);
    const arr2 = JSON.parse(getState(_tibber +'PricesTomorrow.json').val);
    let arrPrice = arr1;

    let now = new Date();

    if (arr2.length > 0) {
        now.setMinutes(0, 0, 0);
        const heutePreise = arrPrice.filter(price => new Date(price.startsAt) >= now);
        arrPrice = heutePreise.concat(arr2);           // füge beide zusammen
       
    } else {
        now.setHours(0, 0, 0, 0);
    }
    
    const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    for (let i = 0; i < arrPrice.length; i++) {
        const element       = arrPrice[i];
        const startsAt      = element.startsAt;
        const start         = new Date(startsAt);
        const preis         = element.total;
        const end           = new Date(Date.parse(startsAt)).getTime()+3600000;            
        const startTime     = start.toLocaleTimeString('de-DE', options);
        const endTime       = new Date(end).toLocaleTimeString('de-DE', options);
        const hhStartTime   = startTime.split(':')[0];

        let objHeute = {};
            
        if (start >= now && start < next24Hours) {        
//      console.warn(`Starts at: ${start}, Total: ${preis}`);
            objHeute.start = start.getHours();
            objHeute.preis = preis;
            preiseHeute.push(objHeute);

            preisePV.push([preis, startTime , hhStartTime + ':30']);
            preisePV.push([preis, hhStartTime + ':30', endTime]);            
        }
    }

// preise für morgen für die VIS
    for (let m = 0; m < arr2.length; m++) {
        const element       = arr2[m];
        const startsAt      = element.startsAt;
        const start         = new Date(startsAt);
        const preis         = element.total;
        const end           = new Date(Date.parse(startsAt)).getTime()+3600000;            
        const startTime     = start.toLocaleTimeString('de-DE', options);
        const endTime       = new Date(end).toLocaleTimeString('de-DE', options);
        const hhStartTime   = startTime.split(':')[0];

        let objMorgen = {
            start : start.getHours(),
            preis : preis
        };
                   
        preiseMorgen.push(objMorgen);

        preisePVTommorow.push([preis, startTime , hhStartTime + ':30']);
        preisePVTommorow.push([preis, hhStartTime + ':30', endTime]);        
    }       

    let preiseSortLang = preiseHeute;
    preiseSortLang.sort(function(a, b) {
        return a.start - b.start;
    });

    let preiseSortLangTomorrow = preiseMorgen;
    preiseSortLangTomorrow.sort(function(a, b) {
        return a.start - b.start;
    });
    
    const preisePVSort = sortArrayByStartTime(preisePV, getHH());
    
    setState(_tibberDP + 'extra.tibberBestPreisArrayLang', preiseSortLang, true);
    setState(_tibberDP + 'extra.tibberBestPreisArrayLangTomorrow', preiseSortLangTomorrow, true);
    
    setState(_tibberDP + 'extra.tibberPvForcast', preisePVSort, true);
    setState(_tibberDP + 'extra.tibberPvForcastTomorrow', preisePVTommorow, true);

    errechneBesteUhrzeit(preiseSortLang);
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
    let niedrigsterPreisSumme = Number.POSITIVE_INFINITY;
    let niedrigsterPreisIndex1 = -1;
    let niedrigsterPreisIndex2 = -1;

    for (let i = 0; i < preisArray.length - 1; i++) {
        // wir bilden eine summer
        const summe = preisArray[i].preis + preisArray[i + 1].preis;

        // Prüfe, ob diese Summe kleiner als die bisher niedrigste ist
        if (summe < niedrigsterPreisSumme) {
            niedrigsterPreisSumme = summe;
            niedrigsterPreisIndex1 = i;
            niedrigsterPreisIndex2 = i + 1;
        }
    }

    if (niedrigsterPreisIndex1 > niedrigsterPreisIndex2) {
        let temp = niedrigsterPreisIndex1;
        niedrigsterPreisIndex1 = niedrigsterPreisIndex2;
        niedrigsterPreisIndex2 = temp;        
    }

    // gebe den index raus
    return [niedrigsterPreisIndex1, niedrigsterPreisIndex2];
}

function startZeit(preiseKurz) {   
    const tibberNutzenManuell = getState(_tibberDP + 'extra.tibberNutzenManuell').val; 

    const start = preiseKurz[0].start;
    const preis = preiseKurz[0].preis;

    preiseKurz.splice(0, 1);

    if (tibberPreisUebermnehmen && !tibberNutzenManuell) {
        setState(_tibberDP + 'extra.tibberNutzenManuellHH', start, true);
        setState(_tibberDP + 'extra.tibberBestPreis', preis, true);     
    }
}

function preisJetzt() {
    let hh          = Number(getHH());
    let preis       = getState(_tibber + 'PricesToday.' + hh + '.total').val;
    let tibberLevel = getState(_tibber + 'PricesToday.' + hh + '.level').val;

    setState(_tibberDP + 'extra.tibberPreisJetzt', preis, true);

    if (_tibberLevelErmitteln) {    
        setState(_tibberDP + 'extra.tibberLevelJetzt', tibberLevel, true);
    }

    hh = hh + 1;
    if (hh > 23) {
        hh = 0;
    }
    
    preis       = getState(_tibber + 'PricesToday.' + hh + '.total').val;
    setState(_tibberDP + 'extra.tibberPreisNächsteStunde', preis, true);

    if (_tibberLevelErmitteln) {    
        tibberLevel = getState(_tibber + 'PricesToday.' + hh + '.level').val;
        setState(_tibberDP + 'extra.tibberLevelNächsteStunde', tibberLevel, true);
    }
}

schedule('0 * * * *', function () {
    holePreis();
    preisJetzt();
});

