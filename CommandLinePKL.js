/* This is a command handler that parses and takes actions according to client interaction via bluetooth */

/* Functions and variables that deal with talking to the zigbee lights */
import * as deconz from './deCONZ.js';
/* Functions and variables that deal with the PERFEKTday Controller*/
import * as pdc from './pdc.js';

import {exec} from 'child_process';


const delimiters = "?, \n";

export function parseFunction(data)
{
    var mymonth;
    var myday;
    var cleaned;

    if (pdc.debugcp > 1) {console.log ("parseFunction() data = " + data); }
    
    if (hasLineFeed(data)) {
        cleaned = stripUnrecChars(data);
        if (pdc.debugcp > 0) {console.log ("parseFunction() cleaned = " + cleaned);}    
    }



    
    /* All commands' response code defined below */

    if (cleaned === "CK?") {
        return "CK;Version 0." + pdc.VerSub;
    }

    if (cleaned === "PD?") {
        // Send the value of PD mode
        return "PD;" + pdc.pdc_parameters.PerfektDay;
    }

    if (cleaned === "PL?") {
        // Send the value of PL mode
        return "PL;" + pdc.pdc_parameters.PerfektLight;
    }

    if (cleaned === "SU?") {
        // Send the sunup time
        return "SU;" + pdc.pdc_parameters.SunUp;
    }

    if (cleaned === "SD?") {
        // Send the sundown time
        return "SD;" + pdc.pdc_parameters.SunDown;
    }

    if (cleaned === "SN?") {
        // Send the solarnoon time
        return "SN;" + pdc.pdc_parameters.SolarNoon;
    }

    if (cleaned === "DU?") {
        // Send the sunup dim level
        return "DU;" + pdc.pdc_parameters.SunUpDim;
    }

    if (cleaned === "DD?") {
        // Send the sundown dim level
        return "DD;" + pdc.pdc_parameters.SunDownDim;
    }

    if (cleaned === "DN?") {
        // Send the noon dim level
        return "DN;" + pdc.pdc_parameters.SolarNoonDim;
    }

    if (cleaned === "CT?") {
        // Send the current CCT
        return "CT;" + pdc.pdc_parameters.cctNow;
    }

    if (cleaned === "DL?") {
        return "DL;" + pdc.pdc_parameters.dimNow;
    }

    if (cleaned === "RD?") {
        let date = new Date();

        // let mm = (pdc.pdClock.getMonth() + 1).toString().padStart(2, '0');
        // let dd = pdc.pdClock.getDate().toString().padStart(2, '0');
        let mm = (date.getMonth() + 1).toString().padStart(2, '0');
        let dd = date.getDate().toString().padStart(2, '0');

        return "RD;" + mm + "/" + dd;
    }

    if (cleaned === "RY?") {
        let date = new Date();

        // let year = pdc.pdClock.getFullYear().toString();
        let year = date.getFullYear().toString();
        let lastTwoDigitsOfYear = year.substr(-2);
        return "RY;" + lastTwoDigitsOfYear;
    }

    if (cleaned === "RT?") {
        let now = new Date();
        // let hours = pdc.pdClock.getHours().toString().padStart(2, '0');
        // let minutes = pdc.pdClock.getMinutes().toString().padStart(2, '0');
        let hours = now.getHours().toString().padStart(2, '0');
        let minutes = now.getMinutes().toString().padStart(2, '0');
        return "RT;" + hours + ':' + minutes;
        
    }


    /* Setting commands */
    if (extract_command(cleaned) === "PDS") {
        if (pdc.debugcp) {console.log("Got PDS command");}
        
        let pdtemp = extract_numeric (cleaned,delimiters);
        if (pdc.debugcp) {console.log("Received PerfektDay to set: " + pdtemp);}

        pdc.pdc_parameters.PerfektDay = pdtemp;
        return "PD;" + pdc.pdc_parameters.PerfektDay;
    }

    if (extract_command(cleaned) === "CTS") {

        // Turn off perfektday for manual override
        pdc.pdc_parameters.PerfektDay = 0;
        let ccttemp = extract_numeric (cleaned, delimiters);
        if (pdc.debugcp) {console.log("Received CCT to set: " + ccttemp);}
        pdc.pdc_parameters.cctNow = ccttemp;
        
        // Why not, just do it here
        let mired_to_send = deconz.kelvinToMired(deconz._8bit_to_kelvin(pdc.pdc_parameters.cctNow));
        pdc.pdc_parameters.hue_sem = true;
        deconz.setGroupValue("ct", mired_to_send, "0");
        pdc.pdc_parameters.OldColorTemp = pdc.pdc_parameters.cctNow;
        pdc.pdc_parameters.hue_sem = false;

        return "CT;" + pdc.pdc_parameters.cctNow;
    }

    if (extract_command(cleaned) === "DLS") {

        // Turn off perfektday for manual override
        pdc.pdc_parameters.PerfektDay = 0;

        let dltemp = extract_numeric (cleaned, delimiters);
        if (pdc.debugcp) {console.log("Received dimlevel to set: " + dltemp);}
        pdc.pdc_parameters.dimNow = dltemp;

        // Why not, just do it here        
        pdc.pdc_parameters.hue_sem = true;
        let dl_string = pdc.pdc_parameters.dimNow;     
        deconz.setGroupValue("bri", dl_string, "0");
        pdc.pdc_parameters.OldDimLevel = pdc.pdc_parameters.dimNow;
        pdc.pdc_parameters.hue_sem = false;

        return "DL;" + pdc.pdc_parameters.dimNow;
    }

    if (extract_command(cleaned) === "DNS") {
        pdc.pdc_parameters.SolarNoonDim = extract_numeric(cleaned, delimiters);
        return "DN;" + pdc.pdc_parameters.SolarNoonDim;
    }

    if (extract_command(cleaned) === "DUS") {
        pdc.pdc_parameters.SunUpDim = extract_numeric(cleaned, delimiters);
        return "DU;" + pdc.pdc_parameters.SunUpDim;
    }

    if (extract_command(cleaned) === "DDS") {
        pdc.pdc_parameters.SunDownDim = extract_numeric(cleaned, delimiters);
        return "DD;" + pdc.pdc_parameters.SunDownDim;
    }


    if (extract_command(cleaned) ===  "SUS") {
        pdc.pdc_parameters.SunUp = extract_numeric(cleaned, delimiters);
        return "SU;" + pdc.pdc_parameters.SunUp;
    }

    if (extract_command(cleaned) ===  "SDS") {
        pdc.pdc_parameters.SunDown = extract_numeric(cleaned, delimiters);
        return "SD;" + pdc.pdc_parameters.SunDown;
    }

    if (extract_command(cleaned) ==  "SNS") {
        pdc.pdc_parameters.SolarNoon = extract_numeric(cleaned, delimiters);
        return "SN;" + pdc.pdc_parameters.SolarNoon;
    }


    if (extract_command(cleaned) === "RTS") {
        
        const  { hours,minutes } = getHoursAndMinutes(extract_numeric(cleaned,delimiters));
        if (pdc.debugcp > 1) {
            console.log(`Hours: ${hours}, Minutes: ${minutes}`);
        }   
        // pdc.pdClock.setTime(hours,minutes);
        let now = new Date();
        
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const year = now.getFullYear();
        const seconds = now.getSeconds().toString().padStart(2, '0');        
        const timeString = "\"" + year +month + day + " " + hours + ":" + minutes + ":" + seconds + "\"";
        
        if (pdc.debugcp > 1) {console.log("Setting system clock to: "+ timeString);}
        setSystemClock(timeString);
        
        // Todo: Add code to sync RTC

        // Read it back for verification
        now = null;
        now = new Date();
        let newhours = now.getHours().toString().padStart(2, '0');
        let newminutes = now.getMinutes().toString().padStart(2, '0');

        // Force an immediate update of the PDC in case this is part of a cycle review
        pdc.doUpdateCCT();
        pdc.doUpdateDim();

        return "RT;" + newhours + ":" + newminutes;

    }

    if (extract_command(cleaned) === "RDS") {
        
        const  { month,date } = getMonthAndDate(extract_numeric(cleaned,delimiters));
        if (pdc.debugcp > 1) {
            console.log(`Month: ${month}, Date: ${date}`);
        }   
        
        
        let now = new Date();
        
        
        const year = now.getFullYear();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');        
        const timeString = "\"" + year +month + date + " " + hours + ":" + minutes + ":" + seconds + "\"";
        
        if (pdc.debugcp > 1) {console.log("Setting system clock to: "+ timeString);}
        setSystemClock(timeString);
        
        // Todo: Add code to sync RTC

        // Read it back for verification
        now = null;
        now = new Date();
        let newmm = (now.getMonth() + 1).toString().padStart(2, '0');
        let newdd = now.getDate().toString().padStart(2, '0');

        return "RD;" + newmm + "/" + newdd;

    }

    // If we get to here, the client most likely requested to do something unsupported.
    return "ERR";

}


/* Helper functions */

/* Removes characters that are not expected as part of the ICP implementation */
function stripUnrecChars(str) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        let c = str.charAt(i);
        if (/[a-zA-Z0-9?; :/]/.test(c)) {
            result += c;
        }
    }
    return result;
}

/* Checks to see if the end of the string is a newline (so we know a command is complete). returns true/false */
function hasLineFeed(str) {
    let len = str.length;
    return (len > 0) && (str[len - 1] === '\n');
}

/* Extracts only the command portion of a string (truncates the delimiter, value, etc.) */

function extract_command(inputString) {
    if (typeof inputString === 'undefined') {
        return null;
    }
    let string_value = inputString.split(" ")[0];
    return string_value;
}

function extract_numeric(inputString) {
    if (typeof inputString === 'undefined') {
        return null;
    }

    let string_value = inputString.split(" ")[1];
    return string_value;
}

// Takes time in the format hh:mm and returns milliseconds 
function convertToMilliseconds(time) {
    const [hours, minutes] = time.split(':');
    return (hours * 60 + minutes * 1) * 60 * 1000;
}

function getHoursAndMinutes(time) {
    // console.log ("getHoursAndMinutes got time: " + time );
    const [hours, minutes] = time.split(':');
    // console.log ("getHoursAndMinutes returning: " + hours + ":" + minutes);
    return { hours, minutes };
}

/* Takes date in form mm/dd and returns mm and dd as an array */
function getMonthAndDate(datestring) {
    // console.log ("getHoursAndMinutes got time: " + time );
    const [month, date] = datestring.split('/');
    // console.log ("getHoursAndMinutes returning: " + hours + ":" + minutes);
    return { month, date };
}

// setSystemClock('05/05/2023 22:01:12');
function setSystemClock(time) {
    exec(`date --set=${time}`, (error, stdout, stderr) => {
        if (error) {
        console.error(`exec error: ${error}`);
        return;
        }
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
    });
}