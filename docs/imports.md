# RadioReference and CSV imports

TrunkScope imports talkgroups, sites, and systems from CSV exports. TrunkScope does **not** scrape RadioReference — export CSVs from RR (or compatible tools) and upload through the web UI or API.

**Legal:** Comply with [RadioReference terms of use](https://www.radioreference.com). Only import data you are licensed to use.

## Talkgroup import

### Format

Trunk Recorder / RadioReference style header:

```csv
Decimal,Hex,Alpha Tag,Mode,Description,Tag,Category
100,064,Dispatch,D,Main Dispatch,Fire,Public Safety
```

Column detection is flexible — `Decimal` and `Alpha Tag` columns are required; order may vary.

### Web UI

**Appliance → Systems → Talkgroups** (per-system panel inside each P25 system card)

1. Pick the system, click **Talkgroups (N)**
2. Check **Merge on import** to update in place (match by decimal ID + system)
3. Upload CSV, or add talkgroups manually with a Mode (A/D/M/T) and record flag
4. Catalog and decoder config regenerate automatically

### API

```bash
curl -X POST "http://APPLIANCE:18088/api/v1/imports/talkgroups?systemId=UUID&merge=true" \
  -H "Cookie: session=..." \
  -H "Content-Type: text/csv" \
  --data-binary @trs_tg_export.csv
```

Preview (first 10 rows):

```bash
POST /api/v1/imports/talkgroups/preview
```

### Per-system talkgroups

Rows bind to `systemId` (required in the UI panel). Decoder config emits per-system `talkgroups-{systemId}.csv` for Trunk Recorder in canonical column order (`Decimal,Hex,Mode,Alpha Tag,Description,Tag,Category,Priority`). `Mode` comes from the talkgroup's mode field (default `D`); a talkgroup with **Record** off exports as `Priority -1` (never record).

Fixture example: [`deploy/decoder/trs_tg_6364.csv`](../deploy/decoder/trs_tg_6364.csv)

---

## Site import

### Format

RadioReference `trs_sites` style:

```csv
RFSS,Site Dec,Site Hex,Site NAC,Description,County Name,Lat,Lon,Range,Frequencies
1,002,2,B0C,"Baraboo","Sauk",43.430920,-89.647837,30,139.187500c,152.022500
```

- Frequencies ending in `c` are control channels
- Other numeric tokens are voice channels
- NAC parsed as hex (e.g. `B0C` → `0xB0C`)

### Web UI

**Appliance → Systems → Import RadioReference site CSV**

Imports into the **first** system profile with merge enabled. Select the target system in future UI iterations; use API for explicit `systemId` today.

### API

```bash
curl -X POST "http://APPLIANCE:18088/api/v1/imports/sites?systemId=UUID&merge=true" \
  -H "Cookie: session=..." \
  -H "Content-Type: text/csv" \
  --data-binary @trs_sites_6364.csv
```

Preview:

```bash
POST /api/v1/imports/sites/preview
```

Fixture: [`deploy/decoder/trs_sites_6364.csv`](../deploy/decoder/trs_sites_6364.csv)

After import, decoder config regenerates with updated `sites` and control channel lists.

---

## System import

### JSON (API)

```bash
POST /api/v1/imports/systems
Content-Type: application/json

[{"name":"County P25","protocol":"p25","controlChannelHz":851012500,"nac":2816}]
```

### CSV

```bash
POST /api/v1/imports/systems
Content-Type: text/csv
```

Header columns: `name`, `protocol`, `controlchannelhz`, `frequencyhz`, `nac`, etc. (case-insensitive).

Preview:

```bash
POST /api/v1/imports/systems/preview
```

---

## Workflow: new P25 system

1. **Systems** — create profile (name, protocol `p25`, control channel, NAC)
2. **Sites** — import `trs_sites_*.csv` or edit in Sites editor
3. **Talkgroups** — import `trs_tg_*.csv` with correct `systemId`
4. **Radio** — set `siteFilter` if statewide export
5. Verify **Diagnostics → decoder config preview**
6. Confirm Trunk Recorder locks control channel on live RF

## Presets in repository

| File | Description |
|------|-------------|
| `deploy/decoder/presets/black-river-falls.json` | Example Jackson County profile |
| `deploy/decoder/trs_tg_6364.csv` | WISCOM talkgroup sample |
| `deploy/decoder/trs_sites_6364.csv` | WISCOM site sample |

These are reference fixtures — not auto-loaded unless imported.
