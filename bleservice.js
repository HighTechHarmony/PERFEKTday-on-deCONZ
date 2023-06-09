import util from 'util';
import bleno from 'bleno';
import * as pdc from './pdc.js';
import * as CommandLinePKL from './CommandLinePKL.js';
import { exec } from 'child_process';
import { promisify } from 'util';


const UART_UUID = "FFE0";
const CH_UUID = "FFE1";
const CCCD = "2901";

// var DEVICENAME = "PKL24-temp";
// var DEVICENAME = "";
let DEVICENAME = "PKL24-temp";
const INITIAL_ADVERTISING_TIME = 60;

const INACTIVITY_DISC_TIME = 45; // Number of seconds since last transmission received before a client is forcibly disconnected
var disconnect_timer = INACTIVITY_DISC_TIME;

const EVENTLOOPINTERVAL = 1000;  // Server side Update interval. Currently used for disconnect timer

var inactivityInterval =  null;

// This will hold the RW characteristic for the BLE "serial" commands and responses
var ch = null;



// Control advertising based on bleno starting or stopping. 
bleno.on('stateChange', function(state) {  
  console.log('on -> stateChange: ' + state);

  // State has chanaged to on, start advertising
  if (state === 'poweredOn') {
    convertToDeviceName() // Sets a device name based on the Bluetooth adapter address
      .then((result) => {
        DEVICENAME = result;        
        
        if (pdc.debugbl > 0) {console.log("Starting advertising with DEVICENAME " + DEVICENAME);}

        // if (pdc.debugbl > 1) {console.log("Setting hostname and /etc/hosts");}
        // setHostname(DEVICENAME);  // This must be done for iOS devices because they could potentially pick this up instead of the DEVICENAME. Requires reboot to take effect
        
        if (pdc.debugbl > 1) {console.log("Setting GAP name");}
        process.env['BLENO_DEVICE_NAME'] = DEVICENAME;  // You set the GAP name as device name using an environement variable. Again this is more for iOS devices as they will choose the GAP na

        if (pdc.debugbl > 1) {console.log("Setting advertising name and starting advertising");}
        /* Start advertising with the host name and characteristics*/
        bleno.startAdvertising(DEVICENAME, [UART_UUID], function(err) {
          console.log(err);
        });
      })
      .catch(console.error);
  } else {
    // State has changed to off, stop advertising
    if (pdc.debugbl > 0) {console.log("will stop advertising");}
    bleno.stopAdvertising();
  }
});

  // If advertising started okay, create our service and characteristic
  bleno.on('advertisingStart', function(error) {
    if (pdc.debugbl > 0) {console.log('on -> advertisingStart: ' + (error ? 'error ' + error : 'success'));}
  
    // Advertising has started successfully
    if (!error) {
      // create our new characteristic 
      ch = new EchoCharacteristic();      

      // Create the service and add our characteristic
      var result = bleno.setServices([
        new bleno.PrimaryService({
          uuid: UART_UUID,
          characteristics: [ ch ]
        })
      ]);
    }
  });

/* This function changes the hostname to the desired bluetooth devicename.  This is helpful in ways,
 * but mostly there is something that causes iOS devices to occasionally pickup this name as the advertised name
 * instead of the one provided to startAdvertising. It requires a reboot before it will take effect. */

function setHostname(newHostname) {

  // Set the hostname of the machine using hostnamectl
  exec(`sudo hostnamectl set-hostname ${newHostname}`, (err, stdout, stderr) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(stdout);
  });

  // Also change the name in /etc/hosts so we don't have name resolution issues
  exec(`sudo sed -i 's/127.0.1.1.*/127.0.1.1\t${newHostname}/' /etc/hosts`, (err, stdout, stderr) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(stdout);
  });
}

// Call the Characteristic constructor and define our RW characteristic and CCCD (Configuration Descriptor)
var BlenoCharacteristic = bleno.Characteristic;
var EchoCharacteristic = function() {
  EchoCharacteristic.super_.call(this, {
    uuid: CH_UUID,
    properties: ['read', 'write', 'writeWithoutResponse', 'notify'],  // writeWithoutResponse is important!
    value: null,
    descriptors: [
        new bleno.Descriptor({
          uuid: CCCD,
          value: 1  // I think this allows subscription to notifications
        })
      ] 
  });

  this._value = new Buffer(0);
  this._updateValueCallback = null;


};

// Inherit the prototype methods from the BlenoCharacteristic constructor
util.inherits(EchoCharacteristic, BlenoCharacteristic);


// Do something when we receive data from the client
EchoCharacteristic.prototype.onWriteRequest = function(data, offset, withoutResponse, callback) {
  this._value = data;
  
  if (pdc.debugbl > 1) {console.log ('Characteristic received: ' + this._value);}

  // Here we will call the function to process commands sent by the client
  let pfreturn = CommandLinePKL.parseFunction (this._value.toString());

  if (pfreturn.length > 0) 
  {
    if (pdc.debugbl > 1) {console.log ("parseFunction has data for the client: " + pfreturn);}
    if (pdc.debugbl > 1) {console.log ("sending...");}
    
    //Reset the disconnect timer
    disconnect_timer = INACTIVITY_DISC_TIME;

    try {
      this._updateValueCallback(Buffer.from(pfreturn + "\r\r"));  // sometime this fails, need to catch
    } catch (error) {
      if (pdc.debugbl > 0) {console.log(error);}
    }

  }

  callback(this.RESULT_SUCCESS);
};


// Now we use the prototype method onReadRequest to perform something when the client reads(?)  Not sure when this happens
EchoCharacteristic.prototype.onReadRequest = function(offset, callback) {
  if (pdc.debugbl > 1) {console.log('EchoCharacteristic - onReadRequest: value = ' + this._value.toString('hex'));}

  callback(this.RESULT_SUCCESS, this._value);
};

// A new client has subscribed to our characteristic. The function updateValueCallback will be called when we need to notify the client of new data
EchoCharacteristic.prototype.onSubscribe = function(maxValueSize, updateValueCallback) {
  if (pdc.debugbl > 0 ) {console.log('EchoCharacteristic - onSubscribe');}

  this._updateValueCallback = updateValueCallback;

  pdc.pdc_parameters.clientConnected = true;  // Publish to other modules the fact that we are connected
  
  //Reset the disconnect timer
  disconnect_timer = INACTIVITY_DISC_TIME;

  // Uncomment this code if server push UI updates are needed
  // // Start an interval loop to send UI updates to the client

  inactivityInterval =  setInterval(() => {
      // console.log ("disconnect_timer = " + disconnect_timer);
      // If a client is connected, deduct seconds since they last said something
      if (pdc.pdc_parameters.clientConnected) {
          if (pdc.debugbl > 1) {console.log ("disconnect time: " + disconnect_timer);}
          disconnect_timer = disconnect_timer - (EVENTLOOPINTERVAL / 1000);  // Subtract this loop interval in seconds

          
          if (disconnect_timer <= 0) {
              // well I think they're dead, kick them.
              disconnect_timer = 0;  //Don't let disconnect_timer go below 0
              clearInterval(inactivityInterval);
              disconnect();
          }
      }
      else {
          if (pdc.debugbl > 1) {console.log("A client is not connected");}
      }
    }, EVENTLOOPINTERVAL); // inactivityInterval
  };
  // updateInterval = setInterval(() => {
  //   // Convert string to a byte array so it can be sent over bluetooth
  //   // this._value = Buffer.from ("Hello from UI interval\r\r");
  //   // this._value = Buffer.from (perfektday.test_string + "\r\r");

    
  //   // Call our ui event loop function
  //   let data = pdc.ui_event_loop();
  //   if (data.length > 0) {
  //     // if (pdc.debugbl > 1) { console.log ("Event loop has data for the client: " + data); }

  //     this._value = Buffer.from (data + "\r\r");
      
  //     // Notify that there is new data to be sent    
  //     if (this._updateValueCallback) {
  //       // console.log('Update Interval sending ' + this._value.toString('hex'));
  //       if (pdc.debugbl > 1) {console.log('Update Interval sending ' + this._value);}
        
  //       this._updateValueCallback(this._value);
  //     }
  //   } // End of If data.length > 0
  //   }, EVENTLOOPINTERVAL);
  
// };

// A client has unsubscribed from our characteristic
EchoCharacteristic.prototype.onUnsubscribe = function() {
  if (pdc.pdc_parameters.debugbl > 0 ) {console.log('EchoCharacteristic - onUnsubscribe');}

  // Clear the update interval
  if (inactivityInterval) {
    clearInterval(inactivityInterval);
    inactivityInterval = null;
  }

  this._updateValueCallback = null;

  try {
    pdc.pdc_paramaeters.clientConnected = false;  // Publish to other modules the fact that we are not connected
  } catch (error) {
    // if (debugbl > 0) { console.log(error);}
  }
};


const getBluetoothAdapterAddress = async () => {
  const { stdout } = await promisify(exec)('hciconfig -a');
  const regex = /BD Address: ([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/;
  const match = stdout.match(regex);
  if (match) {
    return match[0];
  }
  throw new Error('Bluetooth adapter address not found.');
};

const convertToDeviceName = async () => {
  const address = await getBluetoothAdapterAddress();
  const regex = /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/;
  const match = address.match(regex);
  if (match) {
    const last4Digits = match[0].replace(/:/g, '').slice(-4);
    return `PKL24-${last4Digits}`;
  }
  throw new Error('Bluetooth adapter address not found.');
};


/* Forcibly disconnects a client */
export function disconnect () {
  if (pdc.debugbl > 0 ) {console.log ("Inactivity timeout, forcibly disconnecting client");}
  bleno.disconnect();
}
