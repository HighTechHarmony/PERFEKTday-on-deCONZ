# PERFEKTday-on-deCONZ

## Warning
The PDC controller manipulates the system clock in order to simulate different times of day and locations. This may be disturbing behavior on a non-dedicated system.  

## Installation
* Clone the repository

* Create a file call api-key.txt in the parent folder (..) and paste your Application key from Phoscon (For more info on getting this, see [this guide](https://dresden-elektronik.github.io/deconz-rest-doc/getting_started/) ).

* Optionally run install.sh (requires root). This script will create a systemd service to start the controller, and also disables NTP (because the PDC manipulates the system clock)


# Bluetooth App
PERFEKTcontrol can be downloaded from the Apple and Google Play app stores:

* [Android](https://play.google.com/store/apps/details?id=com.leddynamics.perfektcontrol)
* iOS: Search for PERFEKTcontrol in app store
