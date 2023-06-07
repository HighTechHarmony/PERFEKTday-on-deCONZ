#!/bin/sh

sudo cp perfektday.service /lib/systemd/system/perfektday.service
sudo systemctl daemon-reload
sudo systemctl enable perfektday.service
sudo systemctl restart perfektday.service
sudo systemctl disable ntp
sudo systemctl stop ntp
rm pdc_data.json 2> /dev/null

