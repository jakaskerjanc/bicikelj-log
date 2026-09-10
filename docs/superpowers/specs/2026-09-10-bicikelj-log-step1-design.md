# BicikeLJ Availability Logger — Step 1 Design (Fetch & Save)

Date: 2026-09-10
Status: Approved design (step 1 of 2)

## Goal

Poll the BicikeLJ (Ljubljana JCDecaux/Cyclocity) GBFS 3.0 feed once per minute
and persist per-station availability to cheap storage, so step 2 can later query
historic data and predict bike/dock availability.

Step 1 = fetch + save only. Step 2 (query + predict) is out of scope here.

## Source API

GBFS 3.0, public, no auth, CORS-open:
`https://api.cyclocity.fr/contracts/ljubljana/gbfs/v3/`

Feeds used:
- `station_status.json` (live; `num_vehicles_available`, `num_docks_available`,
  `*_disabled`, `is_installed/is_renting/is_returning`, `last_reported`) — 88 stations.
- `station_information.json` (static-ish; `station_id`, `name`, `lat`, `lon`,
  `address`, `capacity`) — 88 stations.

Envelope on every file: `{ last_updated, ttl, version, data }`. Source data moves
~once/minute despite `ttl: 1`; polling every 60s is sufficient.

## Non-goals

- No prediction / querying (step 2).
- No backfill of missed minutes.
- No write-side locking / exactly-once (dedup handled in step 2).
- No always-on service; the job scales to zero between runs.

## Architecture

```
Azure Container Apps Job (cron: * * * * *)
        |  runs container, one poll, exits
        v
  Python fetcher --HTTP--> GBFS API (station_status + station_information)
        |
        v
  Azure Blob Storage (Hot, LRS), append-only
```

Stateless "one poll, exit" job. Azure cron is the scheduler — the container has no
internal loop. Billed per-second of execution only.

### Modules (each one responsibility)

- `client.py` — fetch GBFS feeds (`httpx`), validate envelope.
- `models.py` — typed rows (dataclasses/pydantic).
- `storage.py` — Blob append + daily station-info snapshot.
- `main.py` (`__main__.py`) — orchestrate one poll cycle, exit 0/1.
- `fixtures/` — saved sample GBFS JSON for tests.

## Storage: Blob layout

Azure Blob Storage, Hot tier, LRS. **Append Blobs** (built for stateless repeated
appends; each run does one atomic append, no read-modify-write).

```
status/YYYY/MM/DD.jsonl               # append blob, one per UTC day
                                      # each minute appends 88 JSON lines
station_information/YYYY-MM-DD.json    # daily snapshot (static-ish data)
```

- `status/…/DD.jsonl`: 1440 appends/day (well under append-blob 50k-block limit).
  One JSON line per station per minute:
  `{ts, station_id, bikes, docks, bikes_disabled, docks_disabled,
    is_installed, is_renting, is_returning, last_reported}`.
  `ts` = feed `last_updated` (epoch, authoritative), not wall-clock.
- `station_information/YYYY-MM-DD.json`: written once per UTC day (first run of the
  day writes if the blob is absent; otherwise skipped). Rarely changes.

Format rationale: job is stateless and can't buffer a growing file in memory, so
Append Blob + JSONL fits. Parquet is not appendable and per-minute Parquet creates
a tiny-file problem (~525k files/yr); step 2 compacts JSONL → Parquet (DuckDB reads
both directly from Blob).

## Data flow (one run)

1. Fetch `station_status.json` + `station_information.json` in parallel (`httpx`,
   ~10s timeout, 2× retry with backoff on network/5xx only).
2. Validate envelope: `data` present, `station_status` non-empty. Malformed →
   log + exit 1, write nothing (no partial write).
3. Transform status → JSONL lines. `ts` from feed `last_updated`.
4. Append the minute's lines to `status/YYYY/MM/DD.jsonl` (create append blob if
   absent, keyed off feed date UTC).
5. If `station_information/YYYY-MM-DD.json` absent, write it. Else skip.
6. Exit 0.

Idempotency: overlapping/rerun could double-append a minute. No write-side guard
(YAGNI at 1/min); each line carries `last_reported`/`ts` so step 2 dedups on
`(station_id, last_updated)`.

## Error handling

- Any fetch/validate failure → exit non-zero, write nothing. A missed minute is
  acceptable; a corrupt line is not.
- Retries only for transient network/5xx (2 attempts). No retry on malformed data.
- One structured log line per run: `ts, ok/fail, station_count, duration_ms, error`.
- Step 2 must assume minutes can be missing (job failure / API down). No backfill.

## Deployment

- **Image:** `python:3.12-slim`, non-root, `CMD ["python","-m","bicikelj_log"]`.
- **Registry:** `ghcr.io` (free). Built + pushed via GitHub Actions on push to main.
  (Avoid Azure Container Registry Basic — ~$5/mo would dwarf all other costs.)
- **Job:** Azure Container Apps Job, trigger **Schedule**, cron `* * * * *`,
  0.25 vCPU / 0.5 GiB, `replicaTimeout` ~60s, `replicaRetryLimit` 0
  (cron retries next minute).
- **Auth:** system-assigned Managed Identity → `Storage Blob Data Contributor` on
  the storage account. No secrets in env; env holds only account + container name.
- **Provisioning:** documented `az` CLI commands (resource group, storage account,
  blob container, container-apps environment, job). Bicep optional, later.

## Testing

- **Unit:** transform (sample GBFS JSON → expected JSONL), envelope validation
  (reject empty/malformed), blob path/date logic. Uses saved fixtures.
- **Integration:** run against Azurite (local Blob emulator); assert append
  creates/extends the day blob correctly.
- **Smoke:** one real fetch against live GBFS in CI (skippable if network-restricted).

## Cost (estimated, EU region, pay-as-you-go)

| Component | Basis | ~Monthly |
|---|---|---|
| Container Apps Job | ~43,200 runs/mo, ~5–15s each, 0.25 vCPU / 0.5 GiB | ~$0 (within 180k vCPU-s / 360k GiB-s free grant) |
| Blob storage | ~5.5 GB/yr JSONL, growing | ~$0.10/mo |
| Blob writes | ~43k append ops/mo | ~$0.30/mo |
| Registry (ghcr) | free | $0 |
| **Total** | | **< $1/mo** |

Job stays free while each run is under ~15s (I/O-bound: 2 HTTP round-trips + 1
append dominate). Language choice does not affect cost meaningfully; Python chosen
to share one stack with step-2 ML.

## Open items for step 2 (not built now)

- Compaction JSONL → partitioned Parquet.
- Query layer (DuckDB over Blob) + feature extraction.
- Prediction model.
