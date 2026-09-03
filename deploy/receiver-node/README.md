# TrunkScope receiver node

A receiver node owns an SDR and forwards IQ to the main TrunkScope appliance. It
performs no P25/NFM decoding, recording, transcription, geocoding, or summaries.

The initial transport is SoapyRemote on TCP/UDP port `55132`. It has no built-in
authentication or encryption. Bind it only to a trusted LAN address; use a VPN
instead when crossing networks, and never port-forward it from the internet.

## RTL-SDR and Airspy on Linux

```bash
SOAPYREMOTE_BIND=0.0.0.0:55132 docker compose -f deploy/receiver-node/compose.yml up -d --build
SoapySDRUtil --find="remote=RECEIVER_LAN_IP:55132"
```

The bind address defaults to `0.0.0.0:55132`; restrict TCP/UDP 55132 to the
trusted LAN or VPN with the host firewall. The main appliance verifies this
endpoint before starting the decoder.

## SDRplay RSP1B reference node

SDRplay's API is vendor-distributed and is not copied into the public image.
On Debian/Ubuntu, install the open-source host tools first:

```bash
sudo apt-get update
sudo apt-get install -y soapysdr-tools soapysdr-server libsoapysdr-dev usbutils
```

Then install SDRplay API v3.15 or later and SoapySDRPlay3 using their Linux
packages, and run:

```bash
lsusb -d 1df7:
SoapySDRUtil --find="driver=sdrplay"
SoapySDRUtil --probe="driver=sdrplay"
SoapySDRServer --bind="RECEIVER_LAN_IP:55132"
```

The probe must report hardware key `RSP1B`. On the main appliance, the remote
device is addressed as
`driver=remote,remote=tcp://RECEIVER_LAN_IP:55132,remote:driver=sdrplay,remote:format=CS16`.
