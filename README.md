# OSM Leaderboard
OpenStreetMap contributor leaderboard — real-time edit stats with MapLibre GL 3D map, period filters, and PWA support.

<img width="1800" height="1127" alt="Image" src="https://github.com/user-attachments/assets/98284fc0-278d-4bb7-b9d4-635d3aaacf1a" />

## DEMO
https://mapconcierge.github.io/osm-leaderboard/

    
## Stack
- React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- MapLibre GL JS + OpenFreeMap vector tiles
- TanStack Query for data fetching
- PWA (Service Worker + Web App Manifest)

## Getting Started

```bash
pnpm install
pnpm --filter @workspace/osm-leaderboard run dev
```

Edit `artifacts/osm-leaderboard/public/users.yaml` to configure the contributor roster and hashtags.

## Development

This project is maintained locally with [Claude Code](https://claude.com/claude-code), not Replit. Clone the repo and work from a local checkout; run `pnpm run typecheck` before committing.

## How It Works

### Score formula

```
score = totalChanges + buildingsAdded×5 + wheelchairMapped×3 + hashtagChangesets×2
```

All four inputs — Changes, Buildings, Wheelchair, and Hashtags — are computed from the *same* set of a user's changesets, not separate queries, so they're always internally consistent.

- **Changes**: sum of `changes_count` across the user's changesets ([OSM Changesets API](https://wiki.openstreetmap.org/wiki/API_v0.6))
- **Buildings** / **Wheelchair**: for each changeset, the app downloads its diff (`/api/0.6/changeset/{id}/download`) and counts `building`-tagged way/relation edits and `wheelchair`-tagged element edits in `<create>`/`<modify>` blocks. Diff results are cached in `localStorage` per changeset id (closed changesets are immutable, so the cache never goes stale).
- **Hashtags**: changesets matching any hashtag configured in `users.yaml`, checked against both the changeset's own `hashtags` tag and a lowercase substring search of the comment (not whitespace-tokenized — many Japanese-language comments have no space around a hashtag, e.g. `#PLATEAUで測量`).

### Period filters & the 1,000-changeset cap

Daily/Weekly/Monthly/Yearly filters page back through a user's changeset history only as far as needed and are always exact. **All Time** pages back through full history but stops at a **1,000-changeset safety cap** — some contributors have 10,000+ lifetime changesets, and downloading a diff for each one from the browser (no backend, no batching) isn't practical. This makes uncorrected "All Time" figures for very active mappers an undercount, not exhaustive.

### The "All Time" HDYC correction

To compensate for that cap, `public/hdyc-corrections.json` stores per-user lifetime totals distilled from saved [hdyc.neis-one.org](https://hdyc.neis-one.org) ("How Did You Contribute") snapshots, which compute over a mapper's *entire* OSM history with no cap. HDYC has no public API, so a snapshot has to be captured manually per user (log in, search the user, "Save Page As" the rendered HTML — see `HDCY2OSMlogs/` and `pnpm --filter @workspace/scripts run extract-hdyc`) and re-captured periodically to stay current.

For the **All Time** period only, the app takes `Math.max(liveValue, hdycValue)` — a *floor*, never an override, so a user who's kept mapping since their snapshot was taken still shows their fresher (higher) live numbers:

- **`totalChanges`** and **`buildingsAdded`** use this HDYC floor. No equivalent free, uncapped, per-user API exists for these — we looked at the [ohsome API](https://github.com/GIScience/ohsome-api) as a way to replace the manual snapshot step entirely, but its filter grammar has no per-user/contributor filter at all (its `/users/count` endpoints count *distinct users editing a given area*, the reverse of what's needed) and every endpoint requires a bounding box — there's no planet-wide, all-time, single-user query mode. So the manual HDYC snapshot remains the only source for these two fields.
- **`totalChangesets`** *no longer* depends on the HDYC snapshot: it's fetched directly and exactly from `GET /api/0.6/user/{uid}.json` (`changesets.count` in the response), which has no cap and needs no pagination — one cheap, CORS-enabled call per user (the numeric `uid` comes free off any changeset already fetched for that user). The HDYC floor is kept only as a fallback if that lookup fails (network error, or a profile opted out of public visibility).
- **Hashtags** and **Wheelchair** have no HDYC correction at all — HDYC's hashtag counts aren't directly comparable (see the extraction script), and HDYC doesn't track the `wheelchair` tag.

### Mapper Level (HOT Tasking Manager)

Each contributor's card shows a Beginner/Intermediate/Advanced badge — linking out to their [HOTOSM Tasking Manager](https://tasks.hotosm.org/) profile — plus a progress meter toward the next level. It's based on lifetime changeset count (the same exact `totalChangesets` lookup described above), independent of the period filter currently selected. Thresholds match [HOT Tasking Manager's own defaults](https://github.com/hotosm/tasking-manager/blob/main/backend/config.py) (`TM_MAPPER_LEVEL_INTERMEDIATE`/`TM_MAPPER_LEVEL_ADVANCED`):

| Level | Changesets |
|---|---|
| Beginner | 0–249 |
| Intermediate | 250–499 |
| Advanced | 500+ |

## Data Sources & License

- Contributor edit stats (changesets, changeset diffs) come from the [OpenStreetMap API](https://wiki.openstreetmap.org/wiki/API_v0.6) — © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/)
- Code and content in this repository: [CC0 1.0 Universal](LICENSE)

## Author

mapconcierge (Taichi FURUHASHI) — Furuhashi Lab, Aoyama Gakuin University

## Links

- Demo: https://mapconcierge.github.io/osm-leaderboard/
- Repository: https://github.com/mapconcierge/osm-leaderboard
