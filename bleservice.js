import util from 'util';
import bleno from 'bleno';
import * as pdc from './pdc.js';
import * as CommandLinePKL from './CommandLinePKL.js';

const UART_UUID = "FFE0";
const CH_UUID = "FFE1";
const CCCD = "2901";

const DEVICENAME = "PKL24-rpi"
const INITIAL_ADVERTISING_TIME = 60;
const INACTIVITY_DISC_TIME = 45;

// const EVENTLOOPINTERVAL = 1000;  // UI Update interval

var updateInterval =  null;


// This will hold the RW characteristic for the BLE "serial" commands and responses
var ch = null;

// Advertising based on bleno starting or stopping. 
bleno.on('stateChange', function(state) {
    console.log('on -> stateChange: ' + state);
  
    // State has chanaged to on, start advertising
    if (state === 'poweredOn') {
      bleno.startAdvertising(DEVICENAME, [UART_UUID], function(err) {
          console.log(err);
      });
    } else {
      // State has changed to off, stop advertising
      if (pdc.debugbl > 0) {console.log("will stop advertising");}
      bleno.stopAdvertising();
    }
  });

  // Report and respond to the result of advertising start
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

// Inherit the prototype methods from from the BlenoCharacteristic constructor
util.inherits(EchoCharacteristic, BlenoCharacteristic);


// Do something when we receive data from the client
EchoCharacteristic.prototype.onWriteRequest = function(data, offset, withoutResponse, callback) {
  this._value = data;

  // console.log('EchoCharacteristic - onWriteRequest: value = ' + this._value.toString('hex'));
  // console.log('EchoCharacteristic - onWriteRequest: value = ' + this._value);
  if (pdc.debugbl > 1) {console.log ('Characteristic received: ' + this._value);}

  // Here we will call the function to process commands sent by the client
  let pfreturn = CommandLinePKL.parseFunction (this._value.toString());

  if (pfreturn.length > 0) 
  {
    if (pdc.debugbl > 1) {console.log ("parseFunction has data for the client: " + pfreturn);}
    if (pdc.debugbl > 1) {console.log ("sending...");}
    try {
      this._updateValueCallback(Buffer.from(pfreturn + "\r\r"));  // sometime this fails, need to catch
    } catch (error) {
      if (debugbl > 0) {console.log(error);}
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
  

  // Uncomment this code if server push UI updates are needed
  // // Start an interval loop to send UI updates to the client
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
  
};

// A client has unsubscribed from our characteristic
EchoCharacteristic.prototype.onUnsubscribe = function() {
  if (pdc.pdc_parameters.debugbl > 0 ) {console.log('EchoCharacteristic - onUnsubscribe');}

  // Clear the update interval
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }

  this._updateValueCallback = null;

  try {
    pdc.pdc_paramaeters.clientConnected = false;  // Publish to other modules the fact that we are not connected
  } catch (error) {
    if (debugbl > 0) { console.log(error);}
  }
};


// export {EchoCharacteristic };