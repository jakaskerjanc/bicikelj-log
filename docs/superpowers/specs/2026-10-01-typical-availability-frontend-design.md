# BicikeLJ Typical Availability — Frontend Design (Step 3)

Date: 2026-10-01
Status: Approved design (pending written-spec review)

## Goal

A public, mobile-friendly web map that shows, for any weekday and 15-minute time of
day, how likely each BicikeLJ station is to be **empty** (no bike to take) or
**full** (no dock to return to). The interaction model is the Google Maps
"Typical traffic" control: day chips, a time slider and a colour legend.

It reads the static JSON published by step 2
(`docs/superpowers/specs/2026-09-23-typical-availability-design.md`, "Output
contract"). There is no backend of its own.

Audience: riders in Ljubljana. English UI. It must work well on phones.

## Non-goals (v1)

- Live, current availability. This map shows typical availability only.
- The `holiday` profile. The weekday chips are Sun to Sat only, and holidays are not
  detected.
- A Slovenian UI or i18n.
- Station search, geolocation and routing.
- PWA/offline support, end-to-end tests and visual-regression tests.

## Stack and hosting

- Vite + React + TypeScript + `mapbox-gl`. No state library and no UI kit.
- It lives in a new `frontend/` folder next to `backend/` and `infra/`.
- It is hosted on GitHub Pages at `https://jakaskerjanc.github.io/bicikelj-log/`
  (Vite `base: '/bicikelj-log/'`).
- Map style: `mapbox://styles/mapbox/light-v11`, so the coloured circles stand out.

## Data

Base URL comes from the `VITE_DATA_BASE_URL` build variable. It is the backend's
`publicBaseUrl` deploy output and ends with `/v1/`.

- `meta.json` is fetched first. It provides the stations (`id`, `name`, `lat`, `lon`,
  `capacity`) and `profiles[day].days_used`.
- `{mon,…,sun}.json` holds 96-slot arrays per station: `bikes`, `docks`, `p_empty`,
  `p_full`. A `null` entry means no data.
- The blobs are served with `Content-Encoding: gzip`, so the browser decompresses
  them transparently. CORS allows any origin.
- **Loading order:** `meta` and the selected day's profile are fetched in parallel.
  After both arrive, the other six profiles are prefetched in the background. Each
  profile is fetched at most once per page load and cached in memory. A failed
  prefetch is silent and is retried when the user selects that day.
- **Validation (`api.ts`):** hand-written type guards check the top-level shape.
  For profiles that means every station has all four arrays and each has length 96.
  Profile stations not listed in `meta` are ignored. Meta stations missing from a
  profile are treated as all-`null`. A malformed document is a load error, not a
  partial render.

## State

`App` owns all state and passes it down as props:

| State | Type | Initial value |
|---|---|---|
| `day` | `'sun' \| 'mon' \| … \| 'sat'` | Current weekday in `Europe/Ljubljana` |
| `slot` | `0..95` | Current slot in `Europe/Ljubljana`: `hour*4 + floor(minute/15)` |
| `mode` | `'bikes' \| 'docks'` | `'bikes'` |
| `selectedStationId` | `string \| null` | `null` |

"Now" is computed with `Intl.DateTimeFormat(…, { timeZone: 'Europe/Ljubljana' })`,
so it is correct even when the device is set to another timezone. The state is not
synced to the URL in v1.

## Colour encoding

The value encoded is `p = p_empty[slot]` in bikes mode and `p = p_full[slot]` in docks
mode.

| p | Colour | Meaning |
|---|---|---|
| `< 0.10` | green `#1ea362` | likely available |
| `0.10 – < 0.30` | yellow `#f2c12e` | |
| `0.30 – < 0.60` | orange `#f26b3a` | |
| `≥ 0.60` | dark red `#a3201d` | likely empty (bikes) / full (docks) |
| `null` | grey `#9aa0a6` | no data |

`colors.ts` exports `bucket(p)` and the legend definition, and both the map and the
chart use them. Legend text: **Available ▮▮▮▮ Empty** in bikes mode and
**Available ▮▮▮▮ Full** in docks mode.

## Components

```
frontend/
  index.html, vite.config.ts, tsconfig.json, package.json, .env.example
  src/
    main.tsx, App.tsx, styles.css
    data/
      types.ts        Meta, Station, Profile, Day, Mode
      api.ts          fetchMeta(), fetchProfile(day) — fetch + validate
      useTypical.ts   hook: meta, profiles cache, loading/error state, retry(), prefetch
      slots.ts        pure: nowInLjubljana(), slotLabel(i) → "09:00", hourly(values) → 24
      colors.ts       pure: bucket(p), LEGEND
      stations.ts     pure: stationFeatureStates(meta, profile, slot, mode), titleCase(name)
    map/
      StationMap.tsx  mapbox-gl wrapper
    controls/
      TypicalPanel.tsx, DayChips.tsx, TimeSlider.tsx, ModeToggle.tsx, Legend.tsx
    station/
      StationDetail.tsx  popup (desktop) / bottom sheet (mobile)
      DayChart.tsx       SVG bar chart
```

### `StationMap`

- Creates the map once. It adds one GeoJSON source built from `meta.stations`
  (`promoteId: 'id'`) and one `circle` layer, then calls `fitBounds` on the stations
  with padding.
- When `day`, `slot`, `mode` or the profile changes, it calls `setFeatureState` with
  `{ p }` for each station, using values from `stationFeatureStates`. It never
  rebuilds the source, so dragging the slider stays smooth.
- `circle-color` is a `step` expression on `["feature-state", "p"]`, with a `case`
  for `null` that gives grey. It uses the thresholds from `colors.ts`.
- `circle-radius` interpolates by zoom: about 5 px at z12 and about 11 px at z16.
  The circles have a white stroke. The selected station has a thicker dark stroke,
  set with feature-state `selected`.
- Clicking a circle selects that station. Clicking empty map deselects.
- The component is a thin imperative wrapper. Its logic lives in
  `stationFeatureStates`, which is unit-tested.

### `TypicalPanel`

A floating white card with rounded corners and a soft shadow, laid out like the
Google "Typical traffic" control:

1. Title "Typical availability", then the `Legend`, then `ModeToggle` (a two-segment
   pill: **Bikes | Docks**).
2. `DayChips` showing S M T W T F S, Sunday first, with the selected chip as a filled
   circle. Next to it, `TimeSlider`: a native `<input type="range" min=0 max=95>`
   styled with ticks and labels at 08:00, 12:00, 16:00 and 20:00 (slots 32, 48,
   64, 80).
3. A label such as "Monday, 09:00" (24-hour clock). When the selected profile has
   `days_used < 2`, a muted "Limited data" note follows it.

While `meta` is loading, the panel shows a skeleton. On a load error it shows
"Couldn't load data." and a **Retry** button.

### `StationDetail`

The same content appears in both containers:

- The station name, converted from GBFS UPPERCASE to title case (Slovenian locale
  lowercasing, and words after spaces and hyphens are capitalised).
- In bikes mode: "Typically **N** bikes · **P %** chance empty".
- In docks mode: "Typically **N** free docks · **P %** chance full".
  `N` is rounded to an integer and `P` to an integer percentage. If the value is
  `null`, it shows "No data for this time".
- "Capacity C" in muted text.
- `DayChart` for the selected day and mode.

Containers:

- **Desktop (≥ 640 px):** a Mapbox `Popup` anchored to the station, about 300 px wide.
- **Mobile (< 640 px):** a bottom sheet above the panel, at most 50 % of the viewport
  height. It closes with a close button, by swiping down on its handle (pointer
  events) or by tapping the map. The map pans so the selected station stays
  visible above the sheet.

### `DayChart`

- An SVG bar chart of `p` across the selected day, coloured with `bucket()`.
- Desktop shows 96 bars. Mobile shows 24 hourly bars, each the mean of its 4 slots
  with nulls ignored. An hour with all 4 slots null is null.
- A `null` bar is drawn as a short grey stub. The bar containing the selected slot
  is outlined. X-axis labels: 08:00, 12:00, 16:00, 20:00.
- Tapping a bar sets `slot`: to that slot on desktop, or to the first slot of that
  hour on mobile.

## Responsive layout

- **≥ 640 px:** the map is full screen. The panel floats at the top left, about
  420 px wide.
- **< 640 px:** the map is full screen. The panel docks at the bottom, full width,
  with its rows stacked. Touch targets are at least 44 px, including the slider
  thumb and the chips.
- The breakpoint is a single `matchMedia('(min-width: 640px)')` hook that picks the
  popup or the sheet and the 96- or 24-bar chart.

## Error handling

| Situation | Behaviour |
|---|---|
| `meta` or the selected profile fails to fetch or validate | Panel shows "Couldn't load data." and Retry. Station circles stay grey, or are absent if `meta` failed. |
| Background prefetch fails | Silent. Fetched again when that day is selected. |
| Station value `null` at this slot | Grey circle. The detail says "No data for this time". |
| `days_used < 2` for the selected day | "Limited data" note in the panel. |
| `VITE_MAPBOX_TOKEN` or `VITE_DATA_BASE_URL` missing at build time | The build fails, via a check in `vite.config.ts` that runs only when `command === 'build'`, so `dev` and Vitest are unaffected. A blank map is never shipped. |
| Mapbox fails to load (token rejected, WebGL unavailable) | The map area shows "Map failed to load". |

## Build and deploy

- Scripts in `frontend/package.json`: `dev`, `build`, `preview`, `typecheck`
  (`tsc --noEmit`), `test` (`vitest run`).
- New workflow `.github/workflows/frontend.yml`, modelled on `build.yml`:
  - Triggers: `push` to `main` and `pull_request`, on paths `frontend/**` and
    `.github/workflows/frontend.yml`.
  - Job `test`: Node 22, `npm ci`, `typecheck`, `test`, `build`. All of these run in
    `frontend/`.
  - Job `deploy`: only on `main`, needs `test`, and has permissions `pages: write` and
    `id-token: write`. It builds, then runs `actions/upload-pages-artifact`
    (`frontend/dist`) and `actions/deploy-pages`.
  - Env: `VITE_MAPBOX_TOKEN` from `secrets.MAPBOX_TOKEN`, and `VITE_DATA_BASE_URL`
    from `vars.DATA_BASE_URL`. On PRs from forks the secret is absent, so the
    `test` job builds with a dummy token and data URL. The check only requires that
    they are set.
- Local dev uses `frontend/.env.local` (gitignored, with `.env.example` committed).
  It points at the real production JSON, which works because CORS allows any origin.
  There is no mock server.
- The README gets a "Frontend" section covering the one-time setup:
  1. In the repo settings, set Pages → Source to "GitHub Actions".
  2. Create a Mapbox public (`pk.`) token with URL restrictions
     `https://jakaskerjanc.github.io/bicikelj-log/` and `http://localhost:5173`.
  3. Add the repo secret `MAPBOX_TOKEN`, and the repo variable `DATA_BASE_URL` set to
     the `publicBaseUrl` deployment output.

## Testing

Vitest with jsdom, plus React Testing Library.

- `slots.ts`:
  - `nowInLjubljana` gives the correct day and slot when the device timezone differs
    (for example a UTC timestamp near midnight), and on both DST transition dates
  - `slotLabel(0) = "00:00"`, `slotLabel(36) = "09:00"`, `slotLabel(95) = "23:45"`
  - `hourly` averages 4 slots, ignores nulls, and returns null for an all-null hour
- `colors.ts`: `bucket` at 0, 0.0999, 0.10, 0.2999, 0.30, 0.60 and 1, and for `null`.
- `stations.ts`:
  - `stationFeatureStates` picks `p_empty` or `p_full` by mode, and gives null for a
    station missing from the profile
  - `titleCase("PREŠERNOV TRG-PETKOVŠKOVO NABREŽJE")` →
    `"Prešernov Trg-Petkovškovo Nabrežje"`
- `api.ts`:
  - accepts a valid fixture
  - rejects an array that isn't length 96, a missing field, and non-JSON
- Components:
  - tapping a day chip changes the label and requests that profile
  - moving the slider updates the label
  - the mode toggle swaps the legend word and the detail sentence
  - tapping a `DayChart` bar moves the slider
  - a fetch failure shows Retry, and clicking it refetches
  - `days_used < 2` shows "Limited data"
- `StationMap` is not unit-tested, because mapbox-gl needs WebGL. Check it by hand
  in `npm run dev` on desktop and on a phone before merging.

## Future work

- Holiday chip with Slovenian holiday detection.
- Live current availability from GBFS `station_status`, overlaid on or compared with
  typical availability.
- Slovenian UI.
- Day, time, mode and station in the URL, for shareable links.
