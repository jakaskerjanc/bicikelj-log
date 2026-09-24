# BicikeLJ Typical Availability — Design (Step 2)

Date: 2026-09-23
Status: Approved design (pending written-spec review)

## Goal

A Google-Maps-"typical traffic"-style view for BicikeLJ: for every station, the
typical number of bikes and free docks — and the chance the station is empty or
full — for each 15-minute slot of each day type (Mon–Sun + public holiday).

Rebuilt once a day from the raw data step 1 already logs, published as static
JSON in Azure Blob Storage for a separate frontend to consume. Must give
sensible results with only ~1 week of history and improve as data accumulates.

## Non-goals (v1)

- Weather. Evaluated and deferred (see "Research notes"); can be layered on
  later as a forecast without changing this design.
- Frontend / map UI — separate project; this spec defines the data contract.
- Per-calendar-date output, product-facing station alerting (e.g. "notify me when
  this station has bikes"), CDN, parameter-tuning backtest tooling. (Job-failure
  ops monitoring is in scope — see "Job and schedule".)

## Research notes (why this formula)

- Google has not published a formula. Publicly stated: "typical traffic" is a
  historical average per road segment by day-of-week and time-of-day; since
  COVID they "prioritize historical traffic patterns from the last two to four
  weeks" ([Maps 101](https://blog.google/products-and-platforms/products/maps/google-maps-101-how-ai-helps-predict-traffic-and-determine-routes/)).
  Popular Times uses the last 4–6 weeks and hides results when data is too
  sparse ([Popular times](https://blog.google/products/maps/maps101-popular-times-and-live-busyness-information/)).
- For 12–24 h horizons on bike-share data, a historical day/hour average
  ("seasonal naive") matches ARIMA, deep learning and foundation models
  ([benchmark](https://arxiv.org/html/2504.03725)). A well-built average is the
  right tool; ML is not needed.
- Backtest on our 11 days (MAE, bikes per station-slot, predicting each day from
  earlier days): same-weekday-only 3.71–4.38; weekday/weekend pooled 3.38–4.02;
  shrinkage blend (below) 3.53–4.05. Pooling wins with little data; the blend
  converges to per-weekday as data grows. Neighbour-slot smoothing: no gain.
- Weather: a rainy weekday (Sep 17, 14.7 mm) cut system-wide bikes-in-use by
  60–80 % during rain, but per-station profile error rose only ~15 % (4.15 vs
  3.4–3.7). Weather matters for ridership far more than for dock availability.

## Formula

### Inputs

- Raw `status/YYYY/MM/DD.jsonl` rows (step 1 format) for the last **56 full
  local days** (`Europe/Ljubljana`), i.e. local days `[today−56, today−1]`.
  Raw files are per UTC day, so this reads 57 files. Today is excluded
  (incomplete). Missing files are skipped.
- Rows are dropped unless `is_installed and is_renting`.
- Duplicates on `(station_id, ts)` are removed per file (a `ts` lives in exactly
  one UTC-day file, so dedupe memory stays per-file).

### Step 1 — daily slot values

Slot index `i ∈ [0, 95]` covers local wall-clock minutes `[i·15, i·15+15)`.
For each `(station, local_date, slot)` with ≥1 poll:

- `bikes` = mean of `bikes`
- `docks` = mean of `docks`
- `p_empty` = share of polls with `bikes == 0`
- `p_full` = share of polls with `docks == 0`

DST: on the 25-hour day the repeated 02:00–03:00 polls average into the same
slots; on the 23-hour day those slots are simply absent for that date.

### Step 2 — day type

`day_type(date)` = `"holiday"` if a Slovenian public holiday (pure-Python
`holidays` package, country `SI`), else `"mon"`…`"sun"`. A holiday on a weekend
is `"holiday"`. Holiday dates never contribute to the weekday profiles.

### Step 3 — recency-weighted, shrunk estimate

For each station `s`, day type `d`, slot `t`, and each of the four values:

```
w(day)  = 0.5 ^ (age_days / 21)          # HALF_LIFE_DAYS = 21; age = build_date − day
n       = Σ w over days of type d with data at (s, t)
x_d     = Σ w·x / n                       # weighted mean over those days
typical = (n·x_d + K·x_prior) / (n + K)   # K = 2
```

If `n == 0`, `typical = x_prior`. If `x_prior` is also unavailable, the value
is `null`.

Priors:

| Day type | `x_prior` |
|---|---|
| mon–fri | weighted mean over all non-holiday Mon–Fri days |
| sat, sun | weighted mean over all Sat, Sun and holiday days |
| holiday | the final `sun` estimate |

With no holiday data yet, `holiday` equals `sun` exactly.

`days_used` for a profile = Σ w over the days of that type in the window that
have any usable data (not per slot; a day with no data at all, e.g. a logger
outage, adds nothing). It grows ~1/week and saturates near 4.3 at 8 weeks.

### Worked example (golden test)

Station 1, Monday, slot 32 (08:00–08:15), built 2026-09-22:
Mondays 13.0 @ w 0.768 and 9.0 @ w 0.968 → `n = 1.736`, `x_mon = 10.77`;
weekday prior `8.53` → `typical = (1.736·10.77 + 2·8.53)/3.736 = 9.57`.

### Constants

`WINDOW_DAYS = 56`, `HALF_LIFE_DAYS = 21`, `K = 2`, `SLOT_MINUTES = 15`,
`TZ = "Europe/Ljubljana"`. Constants in code, not env: changing them is a
deliberate, reviewed decision.

## Output contract (public, `typical/v1/`)

Nine files, gzip-encoded JSON:

### `meta.json`

```json
{
  "generated_at": "2026-09-23T01:30:12Z",
  "timezone": "Europe/Ljubljana",
  "slot_minutes": 15,
  "window_days": 56,
  "half_life_days": 21,
  "k": 2,
  "profiles": {"mon": {"days_used": 1.7}, "...": {}, "holiday": {"days_used": 0}},
  "stations": [
    {"id": "1", "name": "PREŠERNOV TRG-PETKOVŠKOVO NABREŽJE",
     "lat": 46.05, "lon": 14.50, "capacity": 20}
  ]
}
```

`stations` comes from the latest `station_information/*.json` snapshot. GBFS v3
`name` is a list of translations; `meta` stores the `sl` text (first entry if
`sl` is absent).

### `mon.json` … `sun.json`, `holiday.json`

```json
{
  "profile": "mon",
  "days_used": 1.7,
  "stations": {
    "1": {"bikes": [96], "docks": [96], "p_empty": [96], "p_full": [96]}
  }
}
```

- Keys in `stations` are GBFS `station_id`s, exactly the set in `meta.stations`
  (stations absent from the latest snapshot are dropped).
- Each array has 96 entries; index `i` = local slot `i` (08:10 → `8·4 + 10//15 = 32`).
- `bikes`, `docks` rounded to 1 decimal; `p_empty`, `p_full` to 2; `null` = no data.
- `bikes + docks` ≈ capacity, minus disabled bikes/docks.
- Colour scales and thresholds are the frontend's choice; e.g. it may show
  "limited data" while `days_used < 2`.

Breaking format changes publish to `typical/v2/` alongside `v1/`.

## Components

Same package and image as step 1; existing flat module layout.

- `daytypes.py` — `day_type(date) -> str`. Pure.
- `typical.py` — pure math, no I/O: rows → daily slot values; daily values →
  8 profiles (weights, priors, shrinkage); profiles + station info → JSON
  documents.
- `build_typical.py` — entrypoint `python -m bicikelj_log.build_typical`:
  compute window from the local run date, read blobs, call `typical.py`,
  publish, log one structured line. Mirrors `__main__.py`'s shape.
- `storage.py` — add: read a day's status blob (one ~5 MB file at a time, so
  memory is bounded by one file), read the latest station-information
  snapshot, and a public publisher that uploads gzipped JSON with headers.
- `config.py` — add `BICIKELJ_PUBLIC_ACCOUNT_URL` (managed identity, like the
  raw account) and `BICIKELJ_PUBLIC_CONTAINER` (default `typical`). When
  `AZURE_STORAGE_CONNECTION_STRING` is set (Azurite/local), both the raw and the
  public container live in that one account and `BICIKELJ_PUBLIC_ACCOUNT_URL`
  is not required. The poller ignores the new settings.
- New dependency: `holidays`.

## Job and schedule

- Second Container Apps Job `bicikelj-typical-job` in the existing environment,
  same image, command `python -m bicikelj_log.build_typical`.
- Cron `30 1 * * *` (UTC; Container Apps cron is UTC) = 03:30 CEST / 02:30 CET —
  after local midnight in both, so yesterday is complete.
- 0.5 vCPU / 1 GiB, `replicaTimeout` 900 s, `replicaRetryLimit` 1. Expected
  runtime 30–60 s (measured: pure-Python ingest ≈ 0.17 M rows/s locally; the
  8-week window is ≈ 1.4 M rows ≈ 250 MB).
- Managed identity: **Storage Blob Data Reader** on the raw account,
  **Storage Blob Data Contributor** on the public account.
- Manual run after deploy: `az containerapp job start -n bicikelj-typical-job -g bicikelj-rg`.
- Log line: `{ts, ok, window_days_found, stations, rows_read, bad_lines, duration_ms, error}`.
- Failed executions email `ALERT_EMAIL`, same as the poller job: a second
  `Microsoft.Insights/metricAlerts` scoped to `bicikelj-typical-job`, reusing the
  existing action group from "feat: email alert on container job failure" (no new
  operational surface — the "alerting" non-goal above is about product-facing
  station alerts, not job-failure ops monitoring).

## Storage and serving

- New storage account `bicikeljpub<uniqueString>` (Standard_LRS, StorageV2,
  same region, `allowBlobPublicAccess: true`, TLS 1.2, HTTPS only). The raw
  account stays private and unchanged.
- Container `typical`, `publicAccess: 'Blob'` (anonymous read by URL, no listing).
- CORS on the public blob service: `GET, HEAD` from `*`.
- URLs: `https://bicikeljpub<unique>.blob.core.windows.net/typical/v1/{meta,mon,…,sun,holiday}.json`.
- Headers per blob: `Content-Encoding: gzip`, `Content-Type: application/json`,
  `Cache-Control: public, max-age=3600`. Files are gzipped before upload
  (Blob Storage does not compress). ≈ 25 KB per profile.
- Write order: 8 profiles first, `meta.json` last. Each upload replaces its blob
  atomically; a mixed-generation read is harmless because profiles are
  independent.
- No CDN: Azure CDN classic is being retired and Front Door Standard costs
  ~$35/mo before any traffic. The 100 GB/mo free egress covers ~2 M page loads
  at ~50 KB each. A CDN can be added in front later with no change to paths.
- All of the above in `infra/main.bicep`; no portal steps.
- Cost: storage and reads negligible; total well under $0.10/mo.
- Verified 2026-09-23 on the Azure for Students subscription: the only policy
  assignment is "Allowed resource deployment regions" (francecentral allowed).
  A throwaway account in `bicikelj-rg` with `allowBlobPublicAccess: true`, a
  `Blob`-access container, CORS, and a gzipped upload served anonymously with
  the headers above (`200`, CORS preflight OK, container listing denied, raw
  account still private). The Bicep for the public account passed
  `az deployment group validate`. Test account deleted.
- If a tenant policy later blocks public blob access: enable static website
  hosting on the public account (one
  `az storage blob service-properties update --static-website` step in the
  deploy workflow) and publish under `$web/typical/v1/`; only the base URL
  changes.

## Error handling

Rule: when in doubt, fail without publishing — yesterday's files stay live.

| Situation | Behaviour |
|---|---|
| Missing day files in window | Skip; logged as `window_days_found`. |
| Partial day | Missing slots don't contribute for that day. |
| Malformed JSONL line | Skip, count in `bad_lines`; don't fail. |
| No usable data, or every station entirely `null` | Exit 1, publish nothing. |
| Upload fails midway | Exit 1; Container Apps retries once. |
| Station not in latest `station_information` | Dropped from all outputs. |
| Stale data | Visible via `meta.generated_at`; failures in Log Analytics. |

## Testing

Unit (fixtures) + integration (Azurite), as in step 1.

- `daytypes`: Mon–Sun mapping; fixed holidays (Oct 31, Nov 1, Dec 25);
  moving holiday (Easter Monday 2027-03-29); holiday on a Saturday → `holiday`.
- `typical`:
  - UTC→local slotting; 08:10 local → slot 32; both DST transition dates.
  - Dedupe on `(station_id, ts)`; not installed/renting excluded.
  - Weight at age 21 = 0.5.
  - Golden test: worked example above yields 9.57.
  - `n == 0` → prior; holiday with no data → equals `sun`; no data → `null`.
  - `p_empty` / `p_full` from zero-bike / zero-dock polls.
  - Document shape: 96-length arrays, rounding, meta fields, name flattening,
    station set equals latest snapshot.
- `build_typical` on Azurite:
  - Seeded day blobs + station info → 9 public blobs with correct
    `Content-Encoding`, `Content-Type`, `Cache-Control`; content decodes to
    valid documents; `meta.json` uploaded last.
  - No data → exit 1 and pre-existing public blobs untouched.

## Future work

- Weather-adjusted forecast layer for today/tomorrow: `forecast = anchor +
  (typical − anchor)·m(weather)`, with `m` a city-wide activity multiplier
  fitted from system bikes-in-use; weather history is backfillable from
  Open-Meteo, so nothing needs logging now.
- Backtest script to tune `K` / half-life once ~6 weeks of data exist.
