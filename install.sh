#!/bin/sh

sudo cp perfektday.service /lib/systemd/system/perfektday.service
sudo systemctl daemon-reload
sudo systemctl enable perfektday.service
sudo systemctl start perfektday.service
rm pdc_data.json 2> /dev/null

