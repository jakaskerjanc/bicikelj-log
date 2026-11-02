# BicikeLJ Trip Planner — Design (Step 4)

Date: 2026-11-02
Status: Draft, awaiting approval

## Intent

You're catching a 5:30 train and planning the night before. The question is whether
the station by your flat will have a bike at 5am, or whether you should walk to
another one. Live availability doesn't help: the trip is hours away.

The trip planner answers that question from the typical-availability profiles we
already publish. You give a start, an end and a time. It picks a pickup station that
is likely to have a bike when you get there and a drop-off station that is likely to
have a free dock when you arrive. Then it shows the route: walk, bike, walk.

Success: for a time-critical trip, you trust the plan enough to follow it without
checking anything else.

## Goals

- Start and end points, each set by typing a place or street name, by tapping the map,
  or (start only) from "my location".
- Time as either **Leave at** or **Arrive by**, on a chosen date. Arrive by works
  backwards from the arrival time.
- Two risk profiles:
  - **Safe** walks further if needed, to reach stations that are very likely to work.
  - **Risky** takes closer stations, even if the chance of a bike or dock is lower.
- One route on the map (walk → bike → walk), with leg durations, departure and arrival
  times, and the chance of a bike at pickup and of a dock at drop-off.
- Only inside Ljubljana. A point outside the city can't be set.
- Works on phones first, and on desktop.

## Non-goals (v1)

- A backup station ("if it's empty, walk to X"). The user chose one route for now.
- Live availability, even for "leave now". The plan always uses typical profiles.
- Turn-by-turn navigation, alternative routes, saving or sharing trips (no URL state).
- Using your own bike, or any mode other than walk + BicikeLJ bike.
- Mapbox Matrix API (see "Station selection" for why).
- Slovenian UI.

## Anti-goals (failure even if it "works")

- In Safe mode, showing a pickup or drop-off that the data says is risky without
  saying so clearly.
- Looking up the wrong slot or day. Examples: using the departure time instead of the
  time you reach the station; using the device timezone instead of Ljubljana time; a
  trip after midnight still reading the previous day's profile; a weekday holiday
  read as a normal weekday instead of a Sunday.
- Letting a start or end point outside Ljubljana through by any route: typing, map tap
  or geolocation.

## What already exists

See `2026-10-01-typical-availability-frontend-design.md`. In short:

- Static Vite + React + TS app in `frontend/` using `mapbox-gl` with a public token
  (`VITE_MAPBOX_TOKEN`), hosted on GitHub Pages. There's no backend of its own.
- `meta.json` lists stations (`id`, `name`, `lat`, `lon`, `capacity`).
- `{mon..sun,holiday}.json` hold 96 × 15-min slots per station of `bikes`, `docks`,
  `p_empty` and `p_full`, in Ljubljana local time. `null` means no data.
- The frontend currently loads only `mon..sun` and does not detect holidays.
- Mobile layout: the map fills the screen, and the availability panel is docked at the
  bottom. A station bottom sheet opens on tap. Desktop: a floating card at top left,
  and the station detail opens as a popup.

## Decisions made with the user

- **Layout: option B.** A Google-Maps-style search card on top of the map. The
  availability panel stays at the bottom. The result is shown in a bottom sheet
  listing the three legs. (Mockup from the brainstorm: From and To fields at the top,
  then chips for "Arrive by 05:30", the day, and Safe/Risky.)
- Both Leave at and Arrive by.
- Risky = closer station even if the chance is lower.
- One route, no backup.
- Points can be set by place/street search or by picking on the map, restricted to
  Ljubljana.

## Behaviour

### Inputs

- **From / To.** Each field offers:
  - search suggestions as you type
  - "Choose on map": the next map tap sets the point
  - for From only, "My location"

  Swapping From and To is allowed (my call).
- **Time.** A Leave at / Arrive by toggle, a time in 5-minute steps, and a date from
  today to 7 days ahead (my call). Default: Leave at, now rounded up to the next
  5 minutes. All times are Ljubljana time, whatever the device timezone.
- **Risk.** Safe (default) or Risky.
- Planning runs automatically once both points are set, and re-runs on any change,
  debounced. There is no "Plan route" button (my call; it matches option B).

### Ljubljana boundary

- Boundary: the Mestna občina Ljubljana polygon from OpenStreetMap, simplified and
  checked in as static GeoJSON. The polygon source and simplification tolerance are
  the builder's call.
- Every way of setting a point runs a point-in-polygon check. A point outside is not
  set, and a short message says "Pick a point inside Ljubljana".
  - Search results are also restricted with a bounding box, and any result outside
    the polygon is dropped.
- The boundary is drawn as a dashed outline while the search card is open or a route
  is shown (my call).

### Station selection

All of this is client-side, and the selection is a pure function: inputs in, chosen
pair and timings out. No network inside.

1. **Candidates.** Pickup candidates are stations within 1 km straight-line of From.
   Drop-off candidates are stations within 1 km of To (my call).
2. **Estimated durations** for choosing stations, so there is no API call per
   candidate:
   - straight-line distance × 1.3 detour factor
   - walking at 4.8 km/h, cycling at 15 km/h
   - +1 min to unlock at pickup, +1 min to dock at drop-off

   These constants are my call and live in one place. If the estimates prove poor,
   the upgrade path is the Mapbox Matrix API for the walking legs.
3. **Times at stations.** For each (pickup, drop-off) pair, compute the moment you'd
   reach the pickup station and the moment you'd reach the drop-off station.
   - Leave at: count forward from the departure time.
   - Arrive by: departure = arrival − estimated total, then count forward.
4. **Slot lookup.** For each moment, take the Ljubljana local date and the 15-min
   slot.
   - A Slovenian public holiday uses the **Sunday** profile (user's decision: holidays
     use weekend availability; Sunday is my call for which weekend day). Any other
     date uses its weekday's profile.
   - A moment past midnight uses the next date's profile.
5. **Chance of success:**
   - pickup = `1 − p_empty`
   - drop-off = `1 − p_full`
   - `null` means no data, and that station is not acceptable.
6. **Acceptable** means a chance ≥ 0.9 in Safe, and ≥ 0.5 in Risky (my call; both
   thresholds are in one place). The chosen pair is the acceptable pair with the
   lowest estimated total time. Ties go to the higher combined chance.
7. **Fallbacks:**
   - If no station within 1 km has data: show "No station within 1 km of the
     start/end".
   - If stations exist but none is acceptable: consider only the pairs whose
     combined chance is within a margin of the likeliest pair's (10 points in Safe,
     20 in Risky). Among those, pick the lowest expected time: the estimated total
     plus the chance of failing times a failure cost (20 min in Safe, 10 in Risky).
     So a slightly less likely pair wins only if it saves several minutes, and
     walking time never buys a much worse chance. Show a clear warning on any
     station below the threshold (e.g. "Bike unlikely · 4 in 10").
   - If pickup equals drop-off, or walking straight from From to To is estimated to
     be no slower than the bike trip: show "Walking is faster" with a single walking
     route (my call).

### Route and timings

- Once the pair is chosen, make three Mapbox Directions requests (`mapbox/walking`
  From → pickup, `mapbox/cycling` pickup → drop-off, `mapbox/walking` drop-off → To)
  with GeoJSON geometry.
- The displayed times use the real Directions durations plus the unlock and dock
  minutes. For Arrive by, the departure is recomputed from them.
- The station chances shown are recomputed for the real times. Stations are **not**
  re-selected (my call: no loops). If the recomputed chance falls below the
  threshold, the warning shows.
- Directions responses are cached in memory per (profile, from, to) for the session.

### Result display

- **Map:**
  - walking legs as grey dotted lines, the bike leg as a solid accent line
  - From and To markers
  - the pickup and drop-off stations highlighted
  - other stations faded while a route is shown (my call)
  - the map fits to the route
- **While a route is shown (my call):**
  - The map no longer follows the availability panel's day, time and bikes/docks
    setting.
  - The pickup station is coloured by its chance of a bike at the moment you reach it.
    The drop-off station is coloured by its chance of a dock at the moment you arrive.
    Both use the existing bucket colours, so the map always matches the result sheet.
  - All other stations are faded and can't be tapped.
  - The availability panel is hidden on desktop too, since it can't show a specific
    date.
  - Closing the result restores the panel, its settings and normal station colours.
- **Result sheet:** replaces the availability panel at the bottom on mobile, and sits
  below the inputs in the search card on desktop. It shows:
  - departure → arrival, and the total
  - "Leave by HH:MM to arrive by HH:MM" for Arrive by
  - three rows: Walk N min to *pickup* (bike chance), Ride N min to *drop-off* (dock
    chance), Walk N min to *destination*
- **Chance format:** "N in 10", coloured with the existing availability bucket colours.
  The wording is the builder's call. If the chosen profile has few days of history,
  the existing "Limited data" note shows.
- Closing the result clears the route and brings back the availability panel.

### Layout

- **Mobile:**
  - Collapsed by default to a single "Where to?" pill at the top (my call: it keeps
    the map clear for people who only browse availability).
  - Tapping it expands the search card: From, To, and the chips row.
  - The availability panel stays docked at the bottom until a result replaces it.
- **Desktop:** the search card sits in the left column, above the availability card,
  at the same width.
- Map taps select stations as today, except:
  - while a field is in "Choose on map" mode
  - while a route is shown (see above)

### Search

**Search must stay free (user's decision).**

- **Places:** use the Mapbox Search Box API's `/forward` endpoint, which is billed per
  request (about 50k free a month).
  - Don't use the session-billed `/suggest` + `/retrieve` pair. It gets only about
    500 free sessions a month.
  - Don't use Geocoding v6: it has no POIs, so "train station" wouldn't work.
- **Request parameters:**
  - `auto_complete=true`
  - `country=si`
  - `bbox` = the Ljubljana boundary's bounding box
  - `proximity` = the map centre
  - `limit` = 5
- **Spending few requests:**
  - Search only after typing pauses for 400 ms, and only from 3 characters.
  - Cache each query string's results for the session.
  - Never search on every keystroke.
- **Station names:** BicikeLJ station names are matched locally from `meta.json` and
  listed first. This costs nothing, and still works when Mapbox search fails.
- `/forward` doesn't offer brand or category suggestions. That's acceptable.

### Holidays

- The frontend needs to know Slovenian public holidays for any date up to 7 days
  ahead.
- My call: the backend's `build_typical` adds an optional `holidays` field to
  `meta.json`, a list of ISO dates for the next 365 days from its existing `holidays`
  library. The change is additive to the contract.
- The frontend treats a missing field as "no holidays known".
- Trips on those dates use the `sun` profile. The planner never loads `holiday.json`
  (user's decision). The backend keeps publishing it, unchanged.

## Errors

- Profiles not loaded yet: planning waits. A load failure uses the existing retry.
- Directions request fails: "Couldn't get the route. Retry" in the result sheet.
- Geolocation denied or unavailable: a short message, and the field stays empty.
- Search fails: the suggestions list shows "Search unavailable". Station-name matches
  and choosing on the map still work.

## Costs and limits

- About 3 Directions requests per plan. With the Mapbox free tier of 100k a month,
  that's about 33k plans a month, before caching.
- Search: `/forward` is billed per request, with about 50k free a month. At roughly 3–5
  requests per typed place, that's about 10k typed places a month.
- Set a usage alert in the Mapbox account as a safety net. Whether Mapbox supports a
  hard cap is for the builder to check and report.
- The public token is already URL-restricted. It needs the default public scopes only.

## Testing

- Unit tests (vitest) for the selection function:
  - Safe vs Risky choose different stations on the same data
  - Leave at vs Arrive by
  - pickup slot ≠ departure slot
  - a trip crossing midnight
  - a weekday holiday uses the Sunday profile
  - null data
  - no acceptable station (warning)
  - no station in range
  - walking is faster
- Unit tests for the point-in-polygon check, slot and day-type lookup in Ljubljana
  time, and the parsing of Directions and Search responses.
- Component tests with mocked fetch, matching the existing style.
- Backend test for the `holidays` field in `meta.json`.

## Left to the builder

- Component and file structure, under a new `frontend/src/trip/` folder.
- Exact copy and wording, the date and time picker controls, and the icons.
- The boundary polygon source and simplification.
- How the route layers are added to `StationMap`.
