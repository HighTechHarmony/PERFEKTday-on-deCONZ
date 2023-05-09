/* This is an implementation of LEDdynamics PERFEKTday based on ICP v0.83.  
 * Most of it has been ported from C++ to node JS.
 * This module houses the functions that are most core to the operation of PERFEKTday 
 */

import * as fs from 'fs';

/* Library for reading the cycle review pushbutton via GPIO */
import {Gpio} from 'onoff';

/* Functions and variables that deal with talking to the zigbee lights */
import * as deconz from './deCONZ.js';


/* Functions and variables that deal with PERFEKTday tracking */
import * as pdc from './pdc.js';

/* Functions and variables that deal with talking with a ble client */
import * as bleservice from './bleservice.js';

/* Class for an artificial clock which runs separately from the system */
// import CustomClock from './pdclock.js';

// GPIO pin of the cycle review button
const cycleReviewButtonPin = 6;
const pairingButtonPin = 5;
const datafilepath = 'pdc_data.json';

/* Variables shared with other modules */
export const VerSub = 83;
const PD_UPDATE_INTERVAL = 2000; // Time in milliseconds to check and update the bulb group for PERFEKTday


// Time in milliseconds for each cycle review tick. This should be longer than the Hue transition time or it looks bad
const CYCLEREVIEWINTERVAL = 500; 

/* Debug levels for each module.  1 is pretty much errors and status indications only, 2 and up will log traffic to the console */
export const debugpdc = 1; // PDC debug level
export const debugbl = 2;  // Bluetooth debug level. 
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
    cct_limit_bottom: 2200,
    cct_limit_top: 6500,
    NightCCT: 0,
    cctNow: 0,
    OldColorTemp: 0,
    dimNow: 255,
    OldDimLevel: 255,
    clientConnected: false,    
}

/* Attempt to restore the above pdc_parameters from data file (overwriting them) */
restoreParams();


// Create instance of a synthetic clock we will use to track the simulated position of sun
// export const pdClock = new CustomClock();
// pdc_parameters.pdRealTime = pdClock.getTime();


console.log("Starting PERFEKTday Controller");

pdc_parameters.OldDimLevel = pdc_parameters.DimLevel;
pdc_parameters.OldColorTemp = pdc_parameters.ColorTemp;

/* Some config for the push buttons */
const buttonCR = new Gpio(cycleReviewButtonPin, 'in', 'rising', {debounceTimeout: 100});
const buttonPairing = new Gpio(pairingButtonPin, 'in', 'rising', {debounceTimeout: 1000});

process.on('SIGINT', _ => {    
    buttonCR.unexport();
    buttonPairing.unexport();
  });

/* If the cycle review button is pressed, call function to do cycle review */
buttonCR.watch((err, value) => {
    if (err) {
        throw err;
    }

    cycleReview();
});

/* If the pairing button is pressed, call function to initiate join */
buttonPairing.watch((err, value) => {
    if (err) {
        throw err;
    }

    deconz.initiateJoin();
});


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

    // If PERFEKTday is enabled, we will calculate and run regular cct and dim adjustments    
    if (pdc.pdc_parameters.PerfektDay) {
        // doUpdateCCT();
        // doUpdateDim();
        doUpdateAll(minsNow());
    } // End of if perfektday enabled
    

    // console.log ("disconnect_timer = " + pdc_parameters.disconnect_timer);
    // // If a client is connected, deduct seconds since they last said something
    // if (pdc_parameters.clientConnected) {
    //     if (debugpdc > 1) {console.log ("disconnect time: " + pdc_parameters.disconnect_timer);}
    //     pdc_parameters.disconnect_timer = pdc_parameters.disconnect_timer - PD_UPDATE_INTERVAL;

        
    //     if (pdc_parameters.disconnect_timer <= 0) {
    //         // well I think they're dead, kick them.
    //         pdc_parameters.disconnect_timer = 0;  //Don't let disconnect_timer go below 0
    //         clearInterval(disconnect_interval);
    //         bleservice.disconnect();
    //     }
    // }
    // else {
    //     if (debugpdc > 1) {console.log("A client is not connected");}
    // }
    


    // This function returns nothing
    return "";

}




/* Computes new CCT and dimlevel for the time. Sends an update to the bulb group in a single API command */

export function doUpdateAll (mins) {
    pdc_parameters.cctNow = CCTPerfectDay(mins);
    if (debugpdc > 1) {console.log("Computed CCT: " + pdc_parameters.cctNow);}
    let mired_to_send = deconz.kelvinToMired(deconz._8bit_to_kelvin(pdc.pdc_parameters.cctNow));
        
    
    pdc_parameters.dimNow = DimPerfectDay(mins);    
    if (debugpdc > 1) {console.log("Computed Dim: " + pdc_parameters.dimNow);}
    let dl_string = pdc_parameters.dimNow;

    //Send an update to the light group the zigbee interface isn't busy
    // if (!pdc.pdc_parameters.hue_sem && (pdc.pdc_parameters.cctNow != pdc.pdc_parameters.OldColorTemp || pdc.pdc_parameters.dimNow != pdc.pdc_parameters.OldDimLevel))     
    
    let ct = "";
    deconz.getGroupValue("ct").then((ct) => {
        // console.log("getGroupValue got: "+ ct);        
        pdc_parameters.OldColorTemp = deconz.kelvinTo8Bit(deconz.miredToKelvin(Number(ct)));        
        // console.log ("ct in mired: " + Number(ct));
        // console.log ("kelvin: " + deconz.miredToKelvin(Number(ct)));
        // console.log ("cct: " + deconz.kelvinTo8Bit(deconz.miredToKelvin(Number(ct))));
      });

    // if (debugpdc >1) {console.log ("OldColorTemp is now " + pdc_parameters.OldColorTemp);}

    let bri = "";
    deconz.getGroupValue("bri").then((bri) => {
        // console.log("getGroupValue got: "+ bri);        
        pdc_parameters.OldDimLevel = Number(bri);
      });

    // if (debugpdc >1) {console.log ("OldDimLevel is now " + pdc_parameters.OldDimLevel);}

    // Below line only sends the update it the values have changed
    // if (!pdc_parameters.hue_sem && (pdc_parameters.cctNow != pdc_parameters.OldColorTemp || pdc_parameters.dimNow != pdc_parameters.OldDimLevel))    
    if (!pdc_parameters.hue_sem )    
    {
        pdc.pdc_parameters.hue_sem = true;

        // Update both in one shot
        if (debugpdc > 0) {console.log("doUpdateAll () Updating bulb group (zigbee) with: "+ mired_to_send + "," + dl_string);}
        deconz.setGroupValueRaw("{\"ct\": " +mired_to_send + ",\"bri\": " + dl_string + "}", "0");
        

        // Update the value comparator
        pdc_parameters.OldColorTemp = pdc_parameters.cctNow;
        pdc_parameters.OldDimLevel = pdc_parameters.dimNow;

        pdc_parameters.hue_sem = false;
    }

}



/* Explicitly calculate and update the Colortemp of the bulb group, used for forced updates after time settings */
export function doUpdateCCT (mins) {
    pdc.pdc_parameters.cctNow = CCTPerfectDay(mins);
    if (debugpdc > 1) {console.log("Computed CCT: " + pdc.pdc_parameters.cctNow);}

    //Send an update to the light group if solar position changed and the zigbee interface isn't busy
    
    pdc.pdc_parameters.hue_sem = true;        

    // Update the CT
    let mired_to_send = deconz.kelvinToMired(deconz._8bit_to_kelvin(pdc.pdc_parameters.cctNow));
    if (debugpdc > 0) {console.log("doUpdateCCT () Updating bulb group with new CCT: "+ pdc_parameters.cctNow);}
    deconz.setGroupValue("ct", mired_to_send, "0");        

        
    // Update the value comparator
    pdc.pdc_parameters.OldColorTemp = pdc.pdc_parameters.cctNow;

    pdc_parameters.hue_sem = false;

}


/* Explicitly calculate and update the dimlevel of the bulb group, used for forced updates after time settings */
export function doUpdateDim (mins) {

    pdc.pdc_parameters.dimNow = DimPerfectDay(mins);
    if (debugpdc > 1) {console.log("Computed Dim: " + pdc.pdc_parameters.dimNow);}

    pdc.pdc_parameters.hue_sem = true;

    // Update the dimlevel
    if (debugpdc > 0) {console.log("doUpdateDim() Updating bulb group with new DimLevel: "+ pdc_parameters.dimNow);}
    let dl_string = pdc.pdc_parameters.dimNow;        
    deconz.setGroupValue("bri", dl_string, "0");
    
    

    // Update the value comparator        
    pdc.pdc_parameters.OldDimLevel = pdc.pdc_parameters.dimNow;

    pdc.pdc_parameters.hue_sem = false;

}



/* The math portion of perfekt day, plots the current color temp based on the sun's position from minsnow (minutes since midnight)*/
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

/* The math portion of perfekt day, plots the current dim level based on the sun's position (minsnow = minutes since midnight) */
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
export function minsNow() {
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

/* If the button is pushed, this will engage cycle review mode. This is a quick run through of the PD day */
function cycleReview () {
    console.log("cycleReview()");

    // Disable PERFEKTday because it will interfere
    let oldPerfektDay = pdc_parameters.PerfektDay;
    pdc_parameters.PerfektDay = false;

    let mins = TimeToMins(pdc_parameters.SunUp);
    // let count = 0;

    const interval = setInterval(() => {
        if (mins >= TimeToMins(pdc_parameters.SunDown)) {
            clearInterval(interval);
            pdc_parameters.PerfektDay = oldPerfektDay;  // Restore PerfektDay setting
            deconz.flashFixture(); // Flash the fixture to show we are done
            return;
        }
        console.log("mins = " + mins);
        doUpdateAll(mins);
        mins += 15;
        // count++;
    }, CYCLEREVIEWINTERVAL);

}

/* Writes all PDC parameters to a file for restoring at startup */
export function storeParams () {  
  
  fs.writeFile(datafilepath, JSON.stringify(pdc_parameters), (err) => {
    if (err) {
      console.error(err);
      return;
    }
    
    console.log('PDC Parameters written to ' + datafilepath);
  });
}

/* Restores all PDC parameters from file */
function restoreParams () {

    if (!fs.existsSync(datafilepath)) {
        console.log('Data File ' + datafilepath + ' does not exist. Creating it');
        storeParams();
        return;
    }

    fs.readFile(datafilepath, (err, data) => {
        if (err) {
          console.error(err);          
          return;
        }
        
        // const { value1, value2, value3 } = JSON.parse(data);
        pdc_parameters =  JSON.parse(data);

        console.log('PDC Parameters restored from ' + datafilepath);
    });    
}