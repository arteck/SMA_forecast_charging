/**
* @param {string} where          Where to create the state: '0_userdata.0' or 'javascript.x'.
 * @param {boolean} force         Force state creation (overwrite), if state is existing.
 * @param {array} statesToCreate  State(s) to create. single array or array of arrays
 * @param {object} [callback]     Optional: a callback function -- This provided function will be executed after all states are created.
*/
function createUserStates(where, force, statesToCreate, callback = undefined) {
 
    const WARN = false; // Only for 0_userdata.0: Throws warning in log, if state is already existing and force=false. Default is false, so no warning in log, if state exists.
    const LOG_DEBUG = false; // To debug this function, set to true
    // Per issue #474 (https://github.com/ioBroker/ioBroker.javascript/issues/474), the used function setObject() executes the callback 
    // before the state is actual created. Therefore, we use a setTimeout and counter as a workaround.
    const DELAY = 50; // Delay in milliseconds (ms). Increase this to 100, if it is not working.

    // Validate "where"
    if (where.endsWith('.')) where = where.slice(0, -1); // Remove trailing dot
    if ( (where.match(/^((javascript\.([1-9][0-9]|[0-9]))$|0_userdata\.0$)/) == null) ) {
        log('This script does not support to create states under [' + where + ']', 'error');
        return;
    }

    // Prepare "statesToCreate" since we also allow a single state to create
    if(!Array.isArray(statesToCreate[0])) statesToCreate = [statesToCreate]; // wrap into array, if just one array and not inside an array

    // Add "where" to STATES_TO_CREATE
    for (let i = 0; i < statesToCreate.length; i++) {
        let lpPath = statesToCreate[i][0].replace(/\.*\./g, '.'); // replace all multiple dots like '..', '...' with a single '.'
        lpPath = lpPath.replace(/^((javascript\.([1-9][0-9]|[0-9])\.)|0_userdata\.0\.)/,'') // remove any javascript.x. / 0_userdata.0. from beginning
        lpPath = where + '.' + lpPath; // add where to beginning of string
        statesToCreate[i][0] = lpPath;
    }

    if (where != '0_userdata.0') {
        // Create States under javascript.x
        let numStates = statesToCreate.length;
        statesToCreate.forEach(function(loopParam) {
            if (LOG_DEBUG) log('[Debug] Now we are creating new state [' + loopParam[0] + ']');
            let loopInit = (loopParam[1]['def'] == undefined) ? null : loopParam[1]['def']; // mimic same behavior as createState if no init value is provided
            createState(loopParam[0], loopInit, force, loopParam[1], function() {
                numStates--;
                if (numStates === 0) {
                    if (LOG_DEBUG) log('[Debug] All states processed.');
                    if (typeof callback === 'function') { // execute if a function was provided to parameter callback
                        if (LOG_DEBUG) log('[Debug] Function to callback parameter was provided');
                        return callback();
                    } else {
                        return;
                    }
                }
            });
        });
    } else {
        // Create States under 0_userdata.0
        let numStates = statesToCreate.length;
        let counter = -1;
        statesToCreate.forEach(function(loopParam) {
            counter += 1;
            if (LOG_DEBUG) log ('[Debug] Currently processing following state: [' + loopParam[0] + ']');
            if( ($(loopParam[0]).length > 0) && (existsState(loopParam[0])) ) { // Workaround due to https://github.com/ioBroker/ioBroker.javascript/issues/478
                // State is existing.
                if (WARN && !force) log('State [' + loopParam[0] + '] is already existing and will no longer be created.', 'warn');
                if (!WARN && LOG_DEBUG) log('[Debug] State [' + loopParam[0] + '] is already existing. Option force (=overwrite) is set to [' + force + '].');
                if(!force) {
                    // State exists and shall not be overwritten since force=false
                    // So, we do not proceed.
                    numStates--;
                    if (numStates === 0) {
                        if (LOG_DEBUG) log('[Debug] All states successfully processed!');
                        if (typeof callback === 'function') { // execute if a function was provided to parameter callback
                            if (LOG_DEBUG) log('[Debug] An optional callback function was provided, which we are going to execute now.');
                            return callback();
                        } else {  // no callback, return anyway
                            return;
                        }
                    } else {
                        // We need to go out and continue with next element in loop.
                        return; // https://stackoverflow.com/questions/18452920/continue-in-cursor-foreach
                    }
                } // if(!force)
            }

            // State is not existing or force = true, so we are continuing to create the state through setObject().
            let obj = {};
            obj.type = 'state';
            obj.native = {};
            obj.common = loopParam[1];
            setObject(loopParam[0], obj, function (err) {
                if (err) {
                    log('Cannot write object for state [' + loopParam[0] + ']: ' + err);
                } else {
                    if (LOG_DEBUG) log('[Debug] Now we are creating new state [' + loopParam[0] + ']')
                    let init = null;
                    if(loopParam[1].def === undefined) {
                        if(loopParam[1].type === 'number') init = 0;
                        if(loopParam[1].type === 'boolean') init = false;
                        if(loopParam[1].type === 'string') init = '';
                    } else {
                        init = loopParam[1].def;
                    }
                    setTimeout(function() {
                        setState(loopParam[0], init, true, function() {
                            if (LOG_DEBUG) log('[Debug] setState durchgeführt: ' + loopParam[0]);
                            numStates--;
                            if (numStates === 0) {
                                if (LOG_DEBUG) log('[Debug] All states processed.');
                                if (typeof callback === 'function') { // execute if a function was provided to parameter callback
                                    if (LOG_DEBUG) log('[Debug] Function to callback parameter was provided');
                                    return callback();
                                }
                            }
                        });
                    }, DELAY + (20 * counter) );
                }
            });
        });
    }
}

function secondsToTime(totalSeconds,tage) {
    let days    = Math.floor(totalSeconds / 86400); // 86400 Sekunden in einem Tag
    let hours   = Math.floor((totalSeconds % 86400) / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;

  // Runde Sekunden auf zwei Dezimalstellen
    seconds = Math.round(seconds * 100) / 100;
    let result = '';

    if (tage) {
        result = (days < 10 ? "0" + days : days) + ":";
    }
  
    result +=       (hours < 10 ? "0" + hours : hours);
    result += ":" + (minutes < 10 ? "0" + minutes : minutes);
    result += ":" + (seconds < 10 ? "0" + seconds : seconds);

    return result;
}

function getHH() {
    const datNow = new Date();
    let HHNow =  datNow.getHours();
    
    if (Number(HHNow < 10)) {
        HHNow = '0' + HHNow;
    }   
    
    return HHNow;  
}

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

function toLog(text, addTimestamp) {
   // console.log(text);
    var lines = getState('0_userdata.0.System.log').val;
    lines = lines.split('<br>');
    
    if (addTimestamp) {
        lines.unshift(getTimeAsString() + ': ' + text);
    } else {
        lines.unshift(text);
    }
    if (lines.length > 50) { 
  //      lines.splice(0,1);
        lines.pop();
    }
    setState('0_userdata.0.System.log', lines.join('<br>'), true);
}

function getTimeAsString(d) {
    var date = d || new Date();
    return date.getFullYear() + '.' + ('0' + (date.getMonth() + 1)).slice(-2) + '.' + ('0' + date.getDate()).slice(-2) + ' '+ ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2) + ':' +  ('0' + date.getSeconds()).slice(-2);    
}
