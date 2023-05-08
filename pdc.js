/* This is an implementation of LEDdynamics PERFEKTday based on ICP v0.83.  
 * Most of it has been ported from C++ to node JS.
 * This module houses the functions that are most core to the operation of PERFEKTday 
 */

/* Functions and variables that deal with talking to the zigbee lights */
import * as deconz from './deCONZ.js';


/* Functions and variables that deal with PERFEKTday tracking */
import * as pdc from './pdc.js';

/* Functions and variables that deal with talking with a ble client */
import * as bleservice from './bleservice.js';

/* Class for an artificial clock which runs separately from the system */
// import CustomClock from './pdclock.js';


/* Variables shared with other modules */
export const VerSub = 83;
const PD_UPDATE_INTERVAL = 2000; // Time in milliseconds to check and update the bulb group for PERFEKTday

/* Debug levels for each module.  1 is pretty much errors and status indications only, 2 and up will log traffic to the console */
export const debugpdc = 1; // PDC debug level
export const debugbl = 1;  // Bluetooth debug level. 
export const debugdc = 1;  // deCONZ debug level
export const debugcp = 1;  // Command Parser debug level


// a shared object with variables of parameters that are shared between and modified by both the pdc and the command parser 
export let pdc_parameters = {     
    PerfektDay: 1,
    SunUpDim: 255,
    SunDownDim: 255,
    SolarNoonDim: 255,
    SunUp: "06:00",
    SunDown: "18:00",
    SolarNoon: "12:00",
    ColorTemp: 127,
    ColorTempScaled: 0,
    DimLevel: 255,
    DimLevelScaled: 0,    
    PerfektLight: 1,
    cct_limit_bottom: 2700,
    cct_limit_top: 6500,
    NightCCT: 0,
    cctNow: 0,
    OldColorTemp: 0,
    dimNow: 255,
    OldDimLevel: 255,
    clientConnected: false,    
}

// Create instance of a synthetic clock we will use to track the simulated position of sun
// export const pdClock = new CustomClock();
// pdc_parameters.pdRealTime = pdClock.getTime();


pdc.pdc_parameters.OldDimLevel = pdc_parameters.DimLevel;
pdc.pdc_parameters.OldColorTemp = pdc_parameters.ColorTemp;


console.log("Starting PERFEKTday Controller");

// Uncomment this to flash the bulb group at boot up
deconz.flashFixture();

// Start the PDC cct and dim update event loop
setInterval(pdc_event_loop, PD_UPDATE_INTERVAL);

/* This is the UI event loop. It is run every EVENTLOOPINTERVAL  (as defined in the bleservice.js module) when there is a subscriber */
export function ui_event_loop () {

    // Currently this function does nothing because the client drives UI updates
    return "";
}


/* This is the PDC event loop which computes and sends regular PERFEKTday updates to the bulb group */
export function pdc_event_loop () {
    
    if (debugpdc > 1) {console.log("pdc_event_loop cycle");}

    // let attribute =  deconz.getGroupValue(("ct").then => {
    //     console.log ("getGroupValue got: " + attribute);
    // });

    let ct = "";
    deconz.getGroupValue("ct").then((ct) => {
        console.log("getGroupValue got: "+ Number(ct));
      });

    // If PERFEKTday is enabled, we will calculate and run regular cct and dim adjustments    
    if (pdc.pdc_parameters.PerfektDay) {
        // doUpdateCCT();
        // doUpdateDim();
        doUpdateAll();
    } // End of if perfektday enabled

    // This function returns nothing
    return "";

}




/* Computes new CCT and dimlevel for the time.  If it is different, it will send and update to the bulb group in a single API command */

export function doUpdateAll () {
    pdc.pdc_parameters.cctNow = CCTPerfectDay(minsNow());
    if (debugpdc > 1) {console.log("Computed CCT: " + pdc.pdc_parameters.cctNow);}
    let mired_to_send = deconz.kelvinToMired(deconz._8bit_to_kelvin(pdc.pdc_parameters.cctNow));
        
    
    pdc.pdc_parameters.dimNow = DimPerfectDay(minsNow());    
    if (debugpdc > 1) {console.log("Computed Dim: " + pdc.pdc_parameters.dimNow);}
    let dl_string = pdc.pdc_parameters.dimNow;

    //Send an update to the light group if solar position changed and the zigbee interface isn't busy
    // if (!pdc.pdc_parameters.hue_sem && (pdc.pdc_parameters.cctNow != pdc.pdc_parameters.OldColorTemp || pdc.pdc_parameters.dimNow != pdc.pdc_parameters.OldDimLevel))     
    pdc_parameters.OldColorTemp = deconz.kelvinTo8Bit(deconz.miredToKelvin(deconz.getGroupValue("ct")));
    if (!pdc.pdc_parameters.hue_sem && (pdc.pdc_parameters.cctNow != pdc_parameters.OldColorTemp || pdc.pdc_parameters.dimNow != deconz.getGroupValue("dl")))     
    

    {
        pdc.pdc_parameters.hue_sem = true;

        // Update both in one shot
        if (debugpdc > 0) {console.log("Updating bulb group with: "+ mired_to_send + "," + dl_string);}
        deconz.setGroupValueRaw("{\"ct\": " +mired_to_send + ",\"bri\": " + dl_string + "}", "0");

        // Update the value comparator
        pdc.pdc_parameters.OldColorTemp = pdc.pdc_parameters.cctNow;
        pdc.pdc_parameters.OldDimLevel = pdc.pdc_parameters.dimNow;
    }

}

export function doUpdateCCT () {
    pdc.pdc_parameters.cctNow = CCTPerfectDay(minsNow());
    if (debugpdc > 1) {console.log("Computed CCT: " + pdc.pdc_parameters.cctNow);}

    //Send an update to the light group if solar position changed and the zigbee interface isn't busy
    
    pdc.pdc_parameters.hue_sem = true;        

    // Update the CT
    let mired_to_send = deconz.kelvinToMired(deconz._8bit_to_kelvin(pdc.pdc_parameters.cctNow));
    if (debugpdc > 0) {console.log("Updating bulb group with new CCT: "+ pdc_parameters.cctNow);}
    deconz.setGroupValue("ct", mired_to_send, "0");        

    // Update both in one shot
    // if (debugpdc > 0) {console.log("Updating bulb group with: "+ mired_to_send + "," + dl_string);}
    // deconz.setGroupValueRaw("{\"ct\": " +mired_to_send + ",\"bri\": " + dl_string + "}", "0");

    // Update the value comparator
    pdc.pdc_parameters.OldColorTemp = pdc.pdc_parameters.cctNow;

}


export function doUpdateDim () {

    pdc.pdc_parameters.dimNow = DimPerfectDay(minsNow());
    if (debugpdc > 1) {console.log("Computed Dim: " + pdc.pdc_parameters.dimNow);}

    pdc.pdc_parameters.hue_sem = true;

    // Update the dimlevel
    if (debugpdc > 0) {console.log("Updating bulb group with new DimLevel: "+ pdc_parameters.dimNow);}
    let dl_string = pdc.pdc_parameters.dimNow;        
    deconz.setGroupValue("bri", dl_string, "0");
    
    pdc.pdc_parameters.hue_sem = false;

    // Update the value comparator        
    pdc.pdc_parameters.OldDimLevel = pdc.pdc_parameters.dimNow;

}


function CCTPerfectDay(minsnow) {
    let sunup = TimeToMins(pdc_parameters.SunUp);
    let sundown = TimeToMins(pdc_parameters.SunDown);
    let sonoon = TimeToMins(pdc_parameters.SolarNoon);
    let resulting = 0;
    if (minsnow < sunup || minsnow > sundown) {
        return pdc_parameters.NightCCT;
    }
    if (minsnow >= sunup && minsnow < sonoon) {
        return Math.round((Math.sin((minsnow - sunup) / (sonoon - sunup) * (Math.PI / 2))) * 255);
    }
    if (minsnow <= sundown && minsnow >= sonoon) {
        return Math.round((Math.sin((sundown - minsnow) / (sundown - sonoon) * (Math.PI / 2))) * 255);
    }
}

function DimPerfectDay(minsnow) {
    let sunup = TimeToMins(pdc_parameters.SunUp);
    let sundown = TimeToMins(pdc_parameters.SunDown);
    let sonoon = TimeToMins(pdc_parameters.SolarNoon);
    let resulting = 0;
    let prop = 0;
    if (minsnow < sunup || minsnow > sundown) {
        return pdc_parameters.SunDownDim;
    }
    if (minsnow >= sunup && minsnow < sonoon) {
        prop = ((Math.sin((minsnow - sunup) / (sonoon - sunup)) * (Math.PI / 2)));
        return Math.round((prop * pdc_parameters.SolarNoonDim) + ((1 - prop) * pdc_parameters.SunUpDim));
    }
    if (minsnow <= sundown && minsnow >= sonoon) {
        let prop = Math.sin((parseFloat(sundown - minsnow) / parseFloat(sundown - sonoon)) * (Math.PI / 2));
        // return Math.round((Math.sin((sundown - minsnow) / (sundown - sonoon)) * (Math.PI / 2))) * pdc_parameters.SolarNoonDim + ((1 - prop) * pdc_parameters.SunDownDim);
        return Math.round ((prop * pdc.pdc_parameters.SolarNoonDim) + ((1 - prop) * pdc.pdc_parameters.SunDownDim));
    }
}


/* Helper function to return the number of minutes since midnight */
function minsNow() {
    const now = new Date();    
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const diff = now - midnight;
    // const midnight = new Date(pdClock.getFullYear(), pdClock.getMonth(), pdClock.getDate(), 0, 0, 0);
    // const diff = pdClock.getTime() - midnight;
    return Math.round(Math.floor(diff / 60000));    
}


/* Helper function that converts a time in hh:mm format to the number of minutes since midnight */
function TimeToMins(time) {
    const [hours, minutes] = time.split(':');
    return (parseInt(hours) * 60) + parseInt(minutes);
}
