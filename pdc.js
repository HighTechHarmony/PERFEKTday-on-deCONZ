/* This is an implementation of LEDdynamics PERFEKTday based on ICP v0.83.  
 * Most of it has been ported from C++ to node JS.
 * This module houses the functions that are most core to the operation of PERFEKTday 
 */

import * as fs from 'fs';

/* Library for reading the cycle review pushbutton via GPIO */
import {Gpio} from 'onoff';

/* Functions and variables that deal with talking to the zigbee lights */
import * as deconz from './deCONZ.js';

/* Functions and variables that deal with talking with a ble client */
import * as bleservice from './bleservice.js';

/* Class for an artificial clock which runs separately from the system */
// import CustomClock from './pdclock.js';

// GPIO pin of the cycle review button
const cycleReviewButtonPin = 6;
const pairingButtonPin = 5;
const ledPin = 13;
const datafilepath = 'pdc_data.json';

/* Variables shared with other modules */
export const VerSub = 83;
const PD_UPDATE_INTERVAL = 2000; // Time in milliseconds to check and update the bulb group for PERFEKTday


// Time in milliseconds for each cycle review tick. This should be longer than the Hue transition time or it looks bad
const CYCLEREVIEWINTERVAL = 500; 

export const LEDBLINKSLOWINTERVAL = 2000;  // Pairing 
export const LEDBLINKFASTINTERVAL = 150;   // Cycle review


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
    cct_limit_bottom: 2200,
    cct_limit_top: 6500,
    NightCCT: 0,
    cctNow: 0,
    OldColorTemp: 0,
    dimNow: 255,
    OldDimLevel: 255,
    clientConnected: false,
    stopBlinking: false,   // Set this to on to stop blinking
    led_state: 0       // 0 = off, 1 = on, 2= blink slow, 3= blink fast, 4 = fade blink
}

/* A blacklist of pdc_parameters that should not be saved or restored between startups */
const blacklist = [ 'PerfektDay', 
                    'PerfektLight', 
                    'clientConnected', 
                    'hue_sem', 
                    'stopBlinking', 
                    'led_state', 
                    'DimLevel', 
                    'DimLevelScaled',
                    'ColorTemp',
                    'ColorTempScaled',
                    'OldDimLevel',
                    'OldColorTemp',                    
                ];  


/* Attempt to restore the above pdc_parameters from data file (overwriting them) */
restoreParams();

console.log("Starting PERFEKTday Controller");

pdc_parameters.OldDimLevel = pdc_parameters.dimNow;
pdc_parameters.OldColorTemp = pdc_parameters.cctNow;
pdc_parameters.PerfektDay = 1; // Always Startup with PerfektDay enabled

/* Some config for the push buttons */
const buttonCR = new Gpio(cycleReviewButtonPin, 'in', 'rising', {debounceTimeout: 100});
const buttonPairing = new Gpio(pairingButtonPin, 'in', 'rising', {debounceTimeout: 1000});

/* Configure the indicator LED */
const led = new Gpio(ledPin, 'out');
pdc_parameters.led_state = 4;

ledOn();  // The LED is turned on to indicate the program is running


/* Clean up on exit (Ctrl-C) */
/* Uninstall handlers if the program is stopped */
process.on('SIGINT', _ => {
    ledOff();  // Turn off the LED to indicate the program is going down
         
    buttonCR.unexport();
    buttonPairing.unexport();    
    led.unexport();
    if (typeof pdc_event_loop !== 'undefined') {clearInterval(pdc_event_loop);}
    if (typeof ui_event_loop !== 'undefined') {clearInterval(ui_event_loop);}
    if (typeof ledBlinkInterval !== 'undefined') {clearInterval(ledBlinkInterval);}
    process.exit(0);
  });

/* If the cycle review button is pressed, call function to do cycle review */
buttonCR.watch(async (err, value) => {
    if (err) {
        throw err;
    }

    await cycleReview();
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
}


/* This is the PDC event loop which computes and sends regular PERFEKTday updates to the bulb group */
export function pdc_event_loop () {
    
    console.log ("pdc_parameters.PerfektDay = " + pdc_parameters.PerfektDay);
    // console.log (JSON.stringify(pdc_parameters, null, 4));
    if (debugpdc > 1) {console.log("pdc_event_loop cycle");}   

    // If PERFEKTday is enabled, we will calculate and run regular cct and dim adjustments    
    if (pdc_parameters.PerfektDay == 1) {
        if (debugpdc > 1) {console.log ("pdc_parameters.PerfektDay = " + pdc_parameters.PerfektDay + ", doing PERFEKTday update");}
        doUpdateAll(minsNow());
    } // End of if perfektday enabled
    

}




/* Computes new CCT and dimlevel for the time. Sends an update to the bulb group in a single API command */

export function doUpdateAll (mins) {
    pdc_parameters.cctNow = CCTPerfectDay(mins);
    if (debugpdc > 1) {console.log("Computed CCT: " + pdc_parameters.cctNow);}
    let mired_to_send = deconz.kelvinToMired(deconz._8bit_to_kelvin(pdc_parameters.cctNow));
        
    
    pdc_parameters.dimNow = DimPerfectDay(mins);    
    if (debugpdc > 1) {console.log("Computed Dim: " + pdc_parameters.dimNow);}
    let dl_string = pdc_parameters.dimNow;

    //Send an update to the light group the zigbee interface isn't busy
    // if (!pdc_parameters.hue_sem && (pdc_parameters.cctNow != pdc_parameters.OldColorTemp || pdc_parameters.dimNow != pdc_parameters.OldDimLevel))     
    
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
        pdc_parameters.hue_sem = true;

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
    pdc_parameters.cctNow = CCTPerfectDay(mins);
    if (debugpdc > 1) {console.log("Computed CCT: " + pdc_parameters.cctNow);}

    //Send an update to the light group if solar position changed and the zigbee interface isn't busy
    
    pdc_parameters.hue_sem = true;        

    // Update the CT
    let mired_to_send = deconz.kelvinToMired(deconz._8bit_to_kelvin(pdc_parameters.cctNow));
    if (debugpdc > 0) {console.log("doUpdateCCT () Updating bulb group (zigbee) with new CCT: "+ pdc_parameters.cctNow);}
    deconz.setGroupValue("ct", mired_to_send, "0");        

        
    // Update the value comparator
    pdc_parameters.OldColorTemp = pdc_parameters.cctNow;

    pdc_parameters.hue_sem = false;

}


/* Explicitly calculate and update the dimlevel of the bulb group, used for forced updates after time settings */
export function doUpdateDim (mins) {

    pdc_parameters.dimNow = DimPerfectDay(mins);
    if (debugpdc > 1) {console.log("Computed Dim: " + pdc_parameters.dimNow);}

    pdc_parameters.hue_sem = true;

    // Update the dimlevel
    if (debugpdc > 0) {console.log("doUpdateDim() Updating bulb group (zigbee) with new DimLevel: "+ pdc_parameters.dimNow);}
    let dl_string = pdc_parameters.dimNow;        
    deconz.setGroupValue("bri", dl_string, "0");
    
    

    // Update the value comparator        
    pdc_parameters.OldDimLevel = pdc_parameters.dimNow;

    pdc_parameters.hue_sem = false;

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
        if (debugpdc > 1) {console.log ("Pre sunup calculated as " + pdc_parameters.SunDownDim);}
        return pdc_parameters.SunDownDim;
    }
    if (minsnow >= sunup && minsnow < sonoon) {
        prop = ((Math.sin((minsnow - sunup) / (sonoon - sunup)) * (Math.PI / 2)));
        return deconz.clamp(Math.round((prop * pdc_parameters.SolarNoonDim) + ((1 - prop) * pdc_parameters.SunUpDim)), 0, pdc_parameters.SolarNoonDim);
    }
    if (minsnow <= sundown && minsnow >= sonoon) {
        let prop = Math.sin((parseFloat(sundown - minsnow) / parseFloat(sundown - sonoon)) * (Math.PI / 2));
        // return Math.round((Math.sin((sundown - minsnow) / (sundown - sonoon)) * (Math.PI / 2))) * pdc_parameters.SolarNoonDim + ((1 - prop) * pdc_parameters.SunDownDim);
        return deconz.clamp(Math.round ((prop * pdc_parameters.SolarNoonDim) + ((1 - prop) * pdc_parameters.SunDownDim)), 0, pdc_parameters.SolarNoonDim);
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
async function cycleReview () {
    console.log("cycleReview()");
    
    ledBlinkFor(1, 0);

    // Disable PERFEKTday because it will interfere
    let oldPerfektDay = pdc_parameters.PerfektDay;
    pdc_parameters.PerfektDay = 0;

    let mins = TimeToMins(pdc_parameters.SunUp)-120; // 2 hours before SunUp time
    // let count = 0;

    const interval = setInterval(async () => {
        if (mins >= TimeToMins(pdc_parameters.SunDown)+120)  // 2 hours after SunDown time
        {
            clearInterval(interval);  // Clear the cycle review interval
            pdc_parameters.PerfektDay = 1;  // Restore PerfektDay setting
            //deconz.flashFixture(); // Flash the fixture to show we are done

            await ledOn();  //Return LED to normal on state
            return;
        }
        console.log("mins = " + mins);
        
        await doUpdateAll(mins);
        mins += 15;
        // count++;
    }, CYCLEREVIEWINTERVAL);

}

/* Writes all PDC parameters to a file for restoring at startup */
export function storeParams () {  
    

    const filteredParams = Object.keys(pdc_parameters)
    .filter(key => !blacklist.includes(key))
    .reduce((obj, key) => {
        obj[key] = pdc_parameters[key];
        return obj;
    }, {});

        fs.writeFile(datafilepath, JSON.stringify(filteredParams), (err) => {
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

        // Temporarily store the value of PerfektDay
        let tempPerfektDay = pdc_parameters.PerfektDay;
        
        let parsedData = {};
        
        // Attempt to parse the data from the file
        if (data) {
            try {
                parsedData = JSON.parse(data);                
            }
            catch (err)
            {
                if (debugpdc > 0) {console.log(err);}
                
                // We failed, blow away the pdc_data file because it's probably corrupt
                if (debugpdc > 0) {console.log("Corrupt data file detected, resetting stored parameters");}            
                fs.unlinkSync('pdc_data.json');
                return;
            }
        }
        else {if (debugpdc > 0) {console.log ("No data to parse");}}

        // If we get here and for some reason we don't have parsed data, skip trying to restore the properties
        if (typeof parsedData !== 'undefined') {
            pdc_parameters = Object.keys(parsedData)
                .filter(key => !blacklist.includes(key))
                .reduce((obj, key) => {
                    obj[key] = parsedData[key];
                    return obj;
                }, {});
            if (debugpdc > 0) {console.log('PDC Parameters restored from ' + datafilepath);}            
        }
        else {if (debugpdc > 0) {console.log ("Skipping PDC data restore because we didn't get any data from the file");}}
        
        pdc_parameters.PerfektDay = tempPerfektDay; // Restore the previous value of PERFEKTday
    });    
}



  

/* A set of LED communicator functions 
 *
 * Example usages:
 * ledOff() turns LED off
 * ledOn() turns LED on solid
 * ledBlinkFor (0,0) blinks the led slowly forever until a different function is called, or pdc_parameters.stopBlinking is set to true (auto resets)
 * ledBlinkFor(0, 255) blinks the led slowly for 255 seconds and then returns to the previous state (on or off)
 * ledBlinkFor(1, 30) blinks the led fast for 30 seconds and then returns to the previous state (on or off)
 * ledDoubleBlinkFor (15) double blinks the led for 15 seconds and then returns to the previous state (on or off) * 
 */


  
/* Starts the LED blinking 
fast = 0 or 1, for slow or fast blinking
if timeout is 0 will blink continuously, otherwise it will stop blinking after the preset number of seconds */
export function ledBlinkFor (fast, timeoutSeconds)
{
    
    // Store the current state of the LED for later
    let old_led_state = pdc_parameters.led_state;
    pdc_parameters.led_state = 2;  // Update the current LED state

    pdc_parameters.stopBlinking = false;    

    // Toggle the state of the LED connected to GPIO every nnn ms
    const blinkLed = _ => {
        if (pdc_parameters.stopBlinking) {
            if (timeoutSeconds > 0 ) {
                // Restore to LED action to that of the previous state 
                pdc_parameters.led_state = old_led_state;
                if (pdc_parameters.led_state == 0) {
                    if (typeof ledBlinkInterval !== 'undefined') {
                        clearInterval (ledBlinkInterval); 
                        ledBlinkInterval = undefined;
                    }
                    if (debugpdc>1) {console.log("ledDoubleBlinkFor() restoring LED state to off");}
                    ledOff();
                }
                else {
                    if (typeof ledBlinkInterval !== 'undefined') {
                        clearInterval (ledBlinkInterval); 
                        ledBlinkInterval = undefined;
                    }
                    if (debugpdc>1) {console.log("ledDoubleBlinkFor() restoring LED state to on");}
                    ledOn();
                }
            } // If timeoutSeconds > 0

            pdc_parameters.stopBlinking = false;
            return;
        } // If stopBlinking


        led.read((err, value) => { // Asynchronous read
            if (err) {
            throw err;
            }

            led.write(value ^ 1, err => { // Asynchronous write
            if (err) {
                throw err;
            }
            });
        });

        if (fast == 0) {setTimeout(blinkLed, LEDBLINKSLOWINTERVAL);}
        if (fast == 1) {setTimeout(blinkLed, LEDBLINKFASTINTERVAL);}
    };  // blinkLED()

    blinkLed();

    // Stop blinking the LED after timeoutseconds
    if (timeoutSeconds > 0) {    setTimeout(_ => pdc_parameters.stopBlinking = true, timeoutSeconds*1000); }

}


/* Starts the LED double blinking continuously if timeout is 0, otherwise it will stop blinking after the preset number of seconds */
export function ledDoubleBlinkFor (timeoutSeconds) {    
    
    // Store the current state of the LED for later
    let old_led_state = pdc_parameters.led_state;
    pdc_parameters.led_state = 4;  // Update the current state

    pdc_parameters.stopBlinking = false;    
   
    // Toggle the state of the LED connected to GPIO every nnn ms
    const blinkLed = _ => {
        if (pdc_parameters.stopBlinking) {
            if (timeoutSeconds > 0 ) {
                // Restore to LED action to that of the previous state 
                pdc_parameters.led_state = old_led_state;
                if (pdc_parameters.led_state == 0) {
                    if (typeof ledBlinkInterval !== 'undefined') {
                        clearInterval (ledBlinkInterval); 
                        ledBlinkInterval = undefined;
                    }
                    if (debugpdc>1) {console.log("ledDoubleBlinkFor() restoring LED state to off");}
                    ledOff();
                }
                else {
                    if (typeof ledBlinkInterval !== 'undefined') {
                        clearInterval (ledBlinkInterval); 
                        ledBlinkInterval = undefined;
                    }
                    if (debugpdc>1) {console.log("ledDoubleBlinkFor() restoring LED state to on");}
                    ledOn();
                }
            } // If timeoutSeconds > 0
   
            pdc_parameters.stopBlinking = false;
            return;
        }  // If stopBlinking
    
        led.writeSync(0);
            setTimeout(() => {
                led.writeSync(1);
                setTimeout(() => {
                led.writeSync(0);
                setTimeout(() => {
                    led.writeSync(1);
                }, 100);
                }, 100);
            }, 500);
                
        setTimeout(blinkLed, LEDBLINKSLOWINTERVAL*2);
    };  // blinkLED()
   
    blinkLed();

    // Stop blinking the LED after timeoutseconds
    if (timeoutSeconds > 0) {    setTimeout(_ => pdc_parameters.stopBlinking = true, timeoutSeconds*1000); }
    
}


/* Stops any blinking and turns the indicator LED on steady */
export function ledOn() {

    // Stop any blinking
    pdc_parameters.stopBlinking = true;
    pdc_parameters.led_state = 1;
    led.writeSync(1);
    
    }
    
/* Stops any blinking and turns the indicator LED OFF */
export function ledOff() {
    // Stop any blinking
    pdc_parameters.stopBlinking = true;
    pdc_parameters.led_state = 0;
    led.writeSync(0);
}
     

/* Helper function to toggle the LED state for blinking, etc. */
export function toggleLED() {
    if (led.readSync() === 0) {
        led.writeSync(1);
    } else {
        led.writeSync(0);
    }
}
