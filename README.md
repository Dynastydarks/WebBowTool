# BowTool Web

React + TypeScript rewrite of BowTool using the Web Serial API.

## Requirements

- Chrome or Edge desktop with `navigator.serial` support
- Node.js 20+

## Run

```bash
npm install
npm run dev
```

## Build and test

```bash
npm run lint
npm run test
npm run build
```

## Web Serial flow

1. Click `Port permission` and select your USB serial device.
2. Click `Port refresh`, select the port, then `Connect`.
3. Run workflow commands (`Scan`, `Pair`, `Clear E0003`).
4. Use `Stop` to abort in-flight command loops immediately.

## Notes

- Serial access requires HTTPS origin or `localhost`.
- Port disconnects/unplug events should be handled by reconnecting and refreshing ports.
