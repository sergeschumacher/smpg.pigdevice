# smpg.pigdevice

A lightweight emulator of the SMPG pig device. Open `/:deviceId` to view a pig UI with a clock, QR code and current total. The page auto-updates when balance messages arrive via AWS IoT.

## Quick start

1. Copy env

```bash
cp .env.example .env
# set IOT_ENDPOINT, IOT_REGION and ensure AWS creds (env vars or profile) are available
```

2. Install and run

```bash
npm install
npm run start
# visit http://localhost:4090/DEMO-DEVICE-1
```

3. Simulate adding money (without IoT)

```bash
curl -X POST http://localhost:4090/api/DEMO-DEVICE-1/add/250
```

## IoT topics

Subscribes to `${IOT_TOPIC_BALANCE_PREFIX}/+/state` (default `smpg/devices/+/state`).
Payload examples:

```json
{"amountCents": 15025, "currency": "EUR"}
```

or delta style:

```json
{"deltaCents": 125}
```

The deviceId is the wildcard between the prefix and `state`.
