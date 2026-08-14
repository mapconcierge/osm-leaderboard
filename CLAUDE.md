# OSM Leaderboard

A client-side OpenStreetMap contributor leaderboard that fetches real edit stats from OSM public APIs and displays ranked contributors with TOP3 gold/silver/bronze highlights, an interactive 3D map, and PWA support.

## Run & Operate

- `pnpm --filter @workspace/osm-leaderboard run dev` — run the leaderboard frontend (requires `PORT` and `BASE_PATH` env vars, see Gotchas)
- `pnpm --filter @workspace/api-server run dev` — run the API server (requires `PORT`; currently unused scaffolding — see Architecture decisions)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run deploy:pages` — build the leaderboard frontend and copy it into `docs/` (what GitHub Pages actually serves). **Nothing is live until this runs and the result is committed and pushed** — see Gotchas. It calls `vite` directly (not `pnpm --filter ... run build`) deliberately, to avoid `pnpm run`'s lockfile-sync check wiping the native-binary workaround below; needs that workaround applied first on macOS.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui
- Map: MapLibre GL JS + OpenFreeMap (vector tiles, 3D buildings)
- YAML parsing: js-yaml
- Animations: framer-motion
- API: Express 5 (shared api-server scaffold, not wired into the frontend)
- DB: PostgreSQL + Drizzle ORM (scaffolded, empty schema, not used by the leaderboard)
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `artifacts/osm-leaderboard/` — React frontend (the only deployed part; `pnpm run deploy:pages` builds it into root `docs/` for GitHub Pages)
  - `src/components/Leaderboard.tsx` — ranked list with TOP3 highlights
  - `src/components/UserCard.tsx` — individual user card
  - `src/components/MapPanel.tsx` — MapLibre GL map with WebGL2 fallback
  - `src/components/PeriodTabs.tsx` — Daily/Weekly/Monthly/Yearly/All Time filter
  - `src/hooks/useOSMData.ts` — TanStack Query data orchestration; owns the score formula and hashtag matching
  - `src/lib/osmApi.ts` — OSM Changesets API client (XML), paginates back through a user's history
  - `src/lib/changesetDiff.ts` — downloads each changeset's diff to count building/wheelchair-tagged elements (Buildings/Wheelchair metrics)
  - `src/lib/parseUsers.ts` — YAML user config parser
  - `src/lib/hdycCorrections.ts` — fetches `public/hdyc-corrections.json`; see Architecture decisions
  - `src/lib/growthData.ts` — per-user monthly cumulative TOTAL SCORE for the last 36 months, for the growth chart
  - `src/components/GrowthChart.tsx` — the growth chart dialog (recharts), lazy-loaded so recharts isn't in the main bundle
  - `public/users.yaml` — user roster and hashtag config
  - `public/hdyc-corrections.json` — generated file, see "Updating HDYC corrections" below; don't hand-edit
  - `public/manifest.json` + `public/sw.js` — PWA files
- `artifacts/api-server/` — Express scaffold (health route only; not deployed, not called by the frontend)
- `lib/db/` — Drizzle scaffold (empty schema; not used)
- `lib/api-spec/openapi.yaml` — API contract source of truth (for the unused api-server)
- `scripts/src/extract-hdyc-corrections.ts` — reads `HDCY2OSMlogs/*.html`, writes `artifacts/osm-leaderboard/public/hdyc-corrections.json`
- `HDCY2OSMlogs/` — gitignored, local-only. Raw HDYC page saves (`HDYC2OpenStreetMap_<username>.html`, browser "Save Page As" from a logged-in session), one per user. Not source — only the JSON distilled from them is committed.

## Architecture decisions

- **Client-side only, static hosting**: all OSM data is fetched live from the browser at view time; the built `docs/` output is a static GitHub Pages site. `api-server`/`lib/db` are unused scaffolding — no backend is deployed.
- **One aggregation unit for all 4 stats**: Changes, Buildings, Wheelchair, and Hashtags are all computed from the *same* set of a user's changesets (`osmApi.ts`), not a separate Overpass query. This was a deliberate fix made on 2026-08-13 — see Gotchas below for why.
- **Buildings/Wheelchair via changeset diff, not Overpass**: for each changeset, `changesetDiff.ts` downloads `/api/0.6/changeset/{id}/download` and counts `building`/`wheelchair`-tagged elements in `<create>`/`<modify>` blocks (way/relation only for buildings; any element type for wheelchair). Results are cached in `localStorage` per changeset id (6h TTL) since closed changesets are immutable.
- **Changeset pagination with a safety cap**: `fetchUserChangesets` pages back via the `time=` range parameter, capped at 1000 changesets total. For "All Time" on very active mappers (some lab members have 10k+ lifetime changesets), this is a known approximation, not exhaustive — a deliberate tradeoff to keep the leaderboard responsive from the browser. Don't lift the cap without discussing the plan first; exhaustive fetching would mean thousands of sequential API calls per user.
- **HDYC correction for "All Time"**: `public/hdyc-corrections.json` holds per-user totals (changesets, changes, buildings created/modified) distilled from saved [hdyc.neis-one.org](https://hdyc.neis-one.org) snapshots, which compute over the *full* OSM history with no cap. **As of 2026-08-15, this is only the primary source for `totalChanges`/`buildingsAdded`** — `totalChangesets` now prefers the exact, uncapped count straight from `GET /api/0.6/user/{uid}.json` (`fetchUserTotalChangesetCount` in `osmApi.ts`; `uid` comes free off any changeset the app already fetched, via `fetchUserId` when nothing's been fetched yet). The HDYC floor (`Math.max(liveValue, correctionValue)`) is now only the fallback for `totalChangesets` if that live lookup fails, and is still the only source for `totalChanges`/`buildingsAdded`, which have no equivalent uncapped per-user API. Applied **only for the "All Time" period** — bounded periods are already complete from live data. See "Updating HDYC corrections" below for how to regenerate the snapshot file. No correction exists for Hashtags (HDYC's hashtag counts aren't directly comparable — see the extraction script) or Wheelchair (HDYC doesn't track that tag at all).
- **ohsome API investigated and rejected (2026-08-15)** as a general replacement for the HDYC correction (to remove the manual-snapshot dependency entirely for `totalChanges`/`buildingsAdded` too). Ruled out: its filter grammar (https://docs.ohsome.org/ohsome-api/v1/filter.html) has no user-identity filter at all — the changeset filters it does have are explicitly scoped to "contribution based API endpoints" only, and every endpoint requires a bounding box/circle/polygon (no planet-wide query mode). It fundamentally answers "which users touched *this area*", never "what has *this user* touched, anywhere" — the reverse of what a per-mapper lifetime total needs. CORS is fine (`access-control-allow-origin: *`, confirmed live), so it wasn't a dead end on technical grounds, just a capability mismatch. Revisit only if ohsome ships a contributor-scoped endpoint.
- **Mapper level (HOT Tasking Manager)**: `lib/mapperLevel.ts` classifies Beginner/Intermediate/Advanced off the same exact `totalChangesets` lookup above (`useMapperLevel`/`fetchMapperLevelData` in `useOSMData.ts`), independent of the period filter. Thresholds (250/500 changesets) are HOTOSM's own defaults, from `hotosm/tasking-manager`'s `backend/config.py` (`TM_MAPPER_LEVEL_INTERMEDIATE`/`TM_MAPPER_LEVEL_ADVANCED`), not guessed.
- **Hashtag matching is substring-based, not tokenized**: `changesetMatchesHashtags` in `useOSMData.ts` checks the changeset's own `hashtags` tag plus a lowercase substring search of the comment — not whitespace-splitting. Japanese changeset comments routinely have no space around a hashtag (e.g. `#PLATEAUで測量`), so token-splitting silently drops them.
- **MapLibre + WebGL2**: the map requires WebGL2; a clean fallback message is shown when unavailable (e.g. preview iframes, older browsers).
- **Score formula**: `totalChanges + buildingsAdded×5 + wheelchairMapped×3 + hashtagChangesets×2` — exported as `SCORE_WEIGHTS` from `useOSMData.ts` and reused by `growthData.ts` so the per-changeset score is computed identically in both places.
- **Growth chart: emphasis, not full categorical**: with ~26 users, only the top 8 (by 3-year score) get a distinct hue (fixed dataviz palette slot order, by rank); everyone else renders as an individual thin gray line rather than a 9th+ generated color, per the dataviz skill's series-count ladder. The palette was validated with `scripts/validate_palette.js` against this app's actual dark card surface (`#0e152a`), not the skill's generic default. Log-scale Y-axis maps `0 → null` (a real gap, not clamped to 1) since a log scale can't represent "no score yet".

## Product

- Loads `public/users.yaml` for the contributor roster and hashtag list
- Fetches changesets from `api.openstreetmap.org/api/0.6/changesets` (XML) and changeset diffs from `.../download`
- Shows a ranked leaderboard with 5 period filters (Daily/Weekly/Monthly/Yearly/All Time) and animated TOP3 cards
- Clicking a user's "View on Map" flies the MapLibre camera to their last edit location
- The download button exports a plaintext log (`OSMLB_YYYYMMDD-HHMMSS.log`) of the current leaderboard snapshot

## Gotchas

- **`pnpm run dev`/`build` require `PORT` and `BASE_PATH` env vars** (`vite.config.ts` throws without them). Replit injected these automatically; locally use e.g. `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/osm-leaderboard run dev`. For a production-equivalent build, `BASE_PATH=/osm-leaderboard/` matches the GitHub Pages path.
- **Local dev/build may fail to start on macOS (esp. Apple Silicon)**: `pnpm-lock.yaml` doesn't resolve the darwin-arm64 native binaries for `rollup`, `esbuild`, `lightningcss`, and `@tailwindcss/oxide` — `pnpm install` (even with `--force`) reports "Lockfile is up to date" and never adds them, so `vite build`/`vite dev` fail at import time, one missing module at a time ("Cannot find module '@rollup/rollup-darwin-arm64'", then the same for lightningcss and oxide once each prior one is patched). The lockfile was likely last generated in a Linux (Replit) environment. **Verified one-time workaround** (doesn't touch the lockfile; repeat per package, matching the version pinned in `pnpm-lock.yaml`):
  ```bash
  # 1. Download the missing platform package in isolation
  npm install --no-save --prefix /tmp/binstall @rollup/rollup-darwin-arm64@4.62.3
  # 2. Drop it into pnpm's virtual store next to the package that needs it
  #    (path is node_modules/.pnpm/<pkg-with-/-replaced-by-+>@<version>/node_modules/<pkg>/)
  mkdir -p node_modules/.pnpm/rollup@4.62.3/node_modules/@rollup
  cp -R /tmp/binstall/node_modules/@rollup/rollup-darwin-arm64 node_modules/.pnpm/rollup@4.62.3/node_modules/@rollup/
  ```
  As of 2026-08-13, four packages needed this: `@esbuild/darwin-arm64@0.27.3`, `@rollup/rollup-darwin-arm64@4.62.3`, `lightningcss-darwin-arm64@1.32.0`, `@tailwindcss/oxide-darwin-arm64@4.3.3`. Just re-run the build after each patch — it tells you the next missing module. The patch is wiped by the *next* `pnpm install` (including the implicit one `pnpm run <script>` triggers whenever it detects `node_modules` is out of sync with the lockfile — e.g. after any `package.json`/lockfile edit), but survives repeated `pnpm run` calls once things are in sync. Treat `pnpm run typecheck` as the fast/reliable local check day-to-day; only bother with this workaround when you actually need `pnpm run dev` or `pnpm run deploy:pages`.
- **`pnpm install` may prompt "Ignored build scripts: esbuild"** — run `pnpm approve-builds esbuild` once. Doing so also surfaced an unrelated stale `pnpm-lock.yaml` entry for `artifacts/mockup-sandbox`, a workspace member that no longer exists on disk, which pnpm proposes to prune. That's a pre-existing lockfile inconsistency, not something to fix incidentally as a side effect of unrelated work — if `pnpm install` proposes a large `pnpm-lock.yaml`/`pnpm-workspace.yaml` diff, review and commit it deliberately and separately.
- **GitHub Pages serves `docs/` at the repo root, built output does not land there automatically**: `vite build` outputs to `artifacts/osm-leaderboard/dist/public`; there is no CI step that publishes it. Use `pnpm run deploy:pages` (builds with the correct `BASE_PATH=/osm-leaderboard/` and copies into root `docs/`), then commit and push `docs/`. Before 2026-08-13 there were *two* stale, independently-drifting `docs/` copies (root `docs/` and a leftover `artifacts/osm-leaderboard/docs/`) from ad-hoc manual copying — the duplicate has been removed. Root `docs/` is the only one that matters; don't recreate a second copy.
- MapLibre GL JS requires WebGL2 — always pre-check with `canvas.getContext('webgl2')` before instantiating `new maplibregl.Map(...)` to avoid an uncaught async error.
- `js-yaml` v5 is ESM-only — use `import { load } from 'js-yaml'`, not `import yaml from 'js-yaml'`.
- `maplibre-gl` must be excluded from Vite's `optimizeDeps` (see `vite.config.ts`) to avoid a worker `.mjs` resolution error. Don't move it into `optimizeDeps.include`.

## Updating HDYC corrections

1. Log into https://hdyc.neis-one.org as (or search for) the target user, let the page finish loading all sections.
2. Browser "Save Page As" → save into `HDCY2OSMlogs/` as `HDYC2OpenStreetMap_<username>.html`, where `<username>` exactly matches their entry in `users.yaml` (case-sensitive — it's used as the lookup key).
3. `pnpm --filter @workspace/scripts run extract-hdyc` — parses every `HDCY2OSMlogs/HDYC2OpenStreetMap_*.html` and rewrites `artifacts/osm-leaderboard/public/hdyc-corrections.json` from scratch (so it's fine to re-run any time; the file is always the current state of everything in `HDCY2OSMlogs/`, not an incremental patch).
4. `pnpm run deploy:pages`, then commit and push (both the regenerated `hdyc-corrections.json` and `docs/`).

Corrections only ever move numbers up for "All Time", and only for users with a saved snapshot — skipping a user, or letting a snapshot go stale, just means their "All Time" figures stay exactly as accurate as our own live (capped) aggregation already makes them elsewhere.

## Maintenance

This project moved off Replit on 2026-08-13 and is now maintained locally via Claude Code. `replit.md` (Replit's agent memory file) is superseded by this file.
