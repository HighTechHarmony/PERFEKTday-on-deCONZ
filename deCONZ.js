/* A set of asynchronous functions and configuration for controlling Zigbee lights via deCONZ REST API */
/* SJM, 2023 */

// const request = require('request');
// const axios = require('axios');
import axios from 'axios';
import * as pdc from './pdc.js';

var DCONZSERVER = "127.0.0.1";
// Bluetooth advertised name  

const API  = "82C80C894F";
const PORT = 80;

var FLASH_DELAY = 1000;
var FLASH_ID_ON_BOOT = 1000;
var WAIT_INTERVAL = 25;

// Delay when sending commands to deCONZ
export var SEND_DELAY = 1000;



export async function setGroupValue(command, myValue, group = "0") {
    
    const url = `http://${DCONZSERVER}/api/${API}/groups/${group}/action`;
    if (pdc.debugdc > 1) {
        console.log("deconz url: " + url);
        console.log("deconz data: " + command +": " + myValue);
    }

    const res = await axios.put(url, {[command]: Number(myValue)})
    .then(response => {
        if (pdc.debugdc > 1) {
            console.log("Got Axios Response: ");
            console.log(response.data);
        }        
        
        })
        .catch(error => {
            if (pdc.debugdc > 0) {console.log(error); }
        });   

}


// Similar to setGroupValue but accepts raw JSON to send in the request body
export async function setGroupValueRaw(command, group = "0") {
    
    const url = `http://${DCONZSERVER}/api/${API}/groups/${group}/action`;
    if (pdc.debugdc > 1) {
        console.log("deconz url: " + url);
        console.log("deconz data: " + command);
    }
    
    const res = await axios.put(url, command)
    .then(response => {
        if (pdc.debugdc > 1) {
            console.log("Got Axios Response: ");
            console.log(response.data);
        }        
        
        })
        .catch(error => {
            if (pdc.debugdc > 0) {console.log(error); }
        });   

}

/* Returns the value of the given attribute for the given group */
export async function getGroupValue(attribute, group = "0") {

    const url = `http://${DCONZSERVER}/api/${API}/groups/${group}`;
    // let response = "";

    if (pdc.debugdc > 1) {
        console.log("deconz url: " + url);        
    }

    try {
        const response = await axios.get(url);
        if (pdc.debugdc > 1) {console.log(response.data);}
        return response.data.action[attribute];
      } catch (error) {
        console.error(error);
      }
}


/* Helper function to wait in an async friendly way */
export function sleep(ms) {
    if (pdc.debugdc > 1) {console.log ("waiting for " + ms + "ms");}
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function flashFixture() {
    // Now using the handy function built into the API
    setGroupValueRaw({alert: "select"}, "0");

    // for (let i = 0; i < 2; i++) {
    //     setGroupValue("on", true);
    //     if (pdc.debugdc > 1) {console.log("Light is on");}
    //     await sleep(FLASH_DELAY);

    //     setGroupValue("on", false);
    //     if (pdc.debugdc > 1) {console.log("Light is off");}
    //     await sleep(FLASH_DELAY);
    // }

    // sleep(SEND_DELAY);
}


/* Helper function to convert 8 bit number to Kelvin. Takes into account our fixture defined limits */
export function _8bit_to_kelvin(_8_bit_cct) {
    let MAX_CCT = pdc.pdc_parameters.cct_limit_top;
    let MIN_CCT = pdc.pdc_parameters.cct_limit_bottom;

    let proportion = _8_bit_cct / 255;
    let cct = Math.round(proportion * (MAX_CCT - MIN_CCT) + MIN_CCT);
  
    // if (cct < MIN_CCT) {
    //   cct = MIN_CCT;
    // } else if (cct > MAX_CCT) {
    //   cct = MAX_CCT;
    // }
 
    cct = clamp(cct, MIN_CCT, MAX_CCT);

    if (pdc.debugdc > 0) {console.log("Kelvin: " + cct);}
  
    return cct;
}

export function kelvinTo8Bit(kelvin) {
    let MIN_CCT = pdc.pdc_parameters.cct_limit_bottom;
    let MAX_CCT = pdc.pdc_parameters.cct_limit_top;
    const kelvinRange = MAX_CCT - MIN_CCT;
    const cct = Math.round(((kelvin - MIN_CCT) / kelvinRange) * 255);
    return Math.max(0, Math.min(255, cct));
}


/* Helper function to clamp Kelvin values */
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/* Helper function to convert kelvin to mired */
export function kelvinToMired(kelvin) {
    return Math.round(1000000 / Number(kelvin));
}

export function miredToKelvin(mired) {
    return Math.round(1000000 / Number(mired));
}
