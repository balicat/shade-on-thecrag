# Shade on theCrag

A Chrome extension that shows sun and shade times for climbing routes on [theCrag.com](https://www.thecrag.com), powered by the [Lost In Kalymnos](https://lostinkalymnos.com/shade) shade calculator.

## What it does

When you browse a route or area on theCrag that has a shade profile, the extension injects a panel showing:

**On route pages:**
- Sun intervals (e.g. 09:51 – 15:35)
- Total sun and shade hours
- Timeline bar with current time indicator
- Link to the full sky chart

**On area pages:**
- Shade summary for the crag
- "Best shade" composite bar (move between routes to maximise shade)
- Individual route bars with sun times
- Link to crag overview

If a route doesn't have a shade profile, nothing is shown — the extension is invisible.

## Currently supported areas

The shade calculator is currently being tested in **Leonidio, Greece**. Kalymnos profiles are coming April 2026.

See all available routes at [lostinkalymnos.com/shade](https://lostinkalymnos.com/shade).

## Install

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select this folder
5. Browse any route or area on theCrag — the shade panel appears automatically

## How it works

The extension fetches route data from the [Lost In Kalymnos](https://lostinkalymnos.com) API and computes sun/shade times for today using terrain profiles captured from the actual climbing locations. The terrain profile maps out the mountains, cliffs, and ridges that block the sun — so you get accurate shade times specific to each route, not just generic sunrise/sunset.

## Screenshots

*Coming soon*

## Links

- [Lost In Kalymnos — Shade Calculator](https://lostinkalymnos.com/shade)
- [How the shade calculator works](https://lostinkalymnos.com/shade/help)
- [About the companion app](https://lostinkalymnos.com/shade/app)
