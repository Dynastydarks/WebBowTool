# BowTool Web

React + TypeScript rewrite of BowTool using the Web Serial API.

## Live deploy

BowTool Web is live at **[bowtool.dynastydarks.de](http://bowtool.dynastydarks.de/)**.

The repository is mirrored/deployed from `main` (pull-based deployment). Änderungswünsche und Funktionserweiterungen sind ausdrücklich erwünscht: open a pull request with your proposal, and after review + merge it can be deployed live directly from this repo mirror.

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

## Credits

BowTool builds on community reverse-engineering of the ION bus. Thanks especially to:

- **[void-spark](https://github.com/void-spark)** — major protocol analysis, tooling, calibration and assist insights
- **[stancecoke](https://github.com/stancecoke)** — ION translator work and documentation
- **[InfantEudora](https://github.com/InfantEudora)** — early protocol groundwork and bus research
- **[Pedelec-Forum](https://www.pedelecforum.de/forum/index.php?threads/zweiter-fruehling-fuer-ion-antrieb-sparta-batavus-koga.90186)** thread *Zweiter Frühling für ION-Antrieb — Sparta, Batavus, Koga …* and contributors there (including **gpu7990**, **Gast1867**, **Mike747**), plus everyone who shared captures and ideas in that discussion.
