#!/bin/sh

sudo cp perfektday.service /lib/systemd/system/perfektday.service
sudo systemctl daemon-reload
sudo systemctl enable perfektday.service
sudo systemctl restart perfektday.service
sudo systemctl disable ntp
sudo systemctl stop ntp
rm pdc_data.json 2> /dev/null
grep -qxF 'dtoverlay=i2c-rtc,pcf8523' /boot/config.txt || echo 'dtoverlay=i2c-rtc,pcf8523' >> /boot/config.txt
grep -qxF 'arm_64bit=0 ' /boot/config.txt || echo 'arm_64bit=0' >> /boot/config.txt
timedatectl set-timezone Etc/UTC
apt remove -y fake-hwclock
update-rc.d -f fake-hwclock remove
systemctl disable fake-hwclock
patch /lib/udev/hwclock-set hwclock-set.patch
if [ -d "/boot" ]
then
    cp -u version.txt /boot/
fi
