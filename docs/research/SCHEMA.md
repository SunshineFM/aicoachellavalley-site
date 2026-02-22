# Research Ingestion Schema (Docking Port)

This format is the deterministic handoff for external research crawls and manual scans.

## File location and naming

- Directory: `docs/research/2025/`
- File pattern: `docs/research/2025/{city-slug}.json`
- Example: `docs/research/2025/palm-springs.json`

`city-slug` must match a canonical slug in `src/data/cities.ts`.

## Required top-level fields

```json
{
  "citySlug": "palm-springs",
  "year": 2025,
  "lastScanDate": "2026-02-22",
  "coverage": {
    "meetingsScanned": null,
    "transcriptsAvailable": null,
    "documentsScanned": null,
    "aiMentionsFound": null,
    "notes": "Optional short note."
  },
  "sourcesScanned": [],
  "hits": []
}
```

- `citySlug`: string, required, must match `cities.ts`
- `year`: number, required
- `lastScanDate`: string `YYYY-MM-DD`, required
- `coverage`: object, required
- `sourcesScanned`: array, required
- `hits`: array, required (can be empty)

## `coverage` object

Required keys:

- `meetingsScanned`: number or `null`
- `transcriptsAvailable`: number or `null`
- `documentsScanned`: number or `null`
- `aiMentionsFound`: number or `null`
- `notes`: optional string

Values may be `null` when unknown. Do not fabricate metrics.

## `sourcesScanned` entries

Array of:

```json
{
  "url": "https://example.gov/path",
  "type": "Agendas-Minutes",
  "label": "City Council Agendas & Minutes"
}
```

- `url`: required URL
- `type`: required short source type label (`YouTube`, `Agendas-Minutes`, `Docs`, `Video Archive`, etc.)
- `label`: required short label

## `hits` entries

Array of evidence hits (can be empty):

```json
{
  "sourceUrl": "https://example.gov/doc.pdf",
  "sourceType": "pdf",
  "title": "City Council Agenda Packet",
  "date": "2025-11-18",
  "timestampOrPage": "p.14",
  "snippet": "Short source-grounded excerpt or summary.",
  "keywords": ["procurement", "software"],
  "confidence": "med",
  "notes": "Optional note."
}
```

Required keys:

- `sourceUrl`: URL
- `sourceType`: one of `youtube | pdf | agenda | minutes | webpage`
- `title`: string
- `date`: `YYYY-MM-DD` or `null`
- `timestampOrPage`: string or `null`
- `snippet`: string (max 280 chars)
- `keywords`: array of strings

Optional keys:

- `confidence`: `low | med | high`
- `notes`: string

Rule: no hit is valid without `sourceUrl`.

## Generate Briefs From Hits

Use the deterministic generator to convert `hits[]` into signal briefs:

- Dry run (default): `npm run generate:briefs:research`
- Explicit dry run: `npm run generate:briefs:research -- --dry-run`
- Write files: `npm run generate:briefs:research -- --write`

Behavior:

- Reads all files in `docs/research/2025/`
- Creates briefs in `src/content/signals/` from `hits[]`
- Uses stable IDs to prevent duplicates on reruns
- Skips collisions with existing human-authored briefs when source URL + timestamp/page matches

## PR Checklist

When a PR changes research files or research-hit generation inputs:

1. Run `npm run validate:research`
2. Run `npm run generate:briefs:research -- --write`
3. Commit generated markdown outputs under `src/content/signals/`
4. Ensure CI dry-run reports `to_write=0`

## Source Discovery Tooling

- Dry run (read-only): `npm run discover:sources`
- Apply validated updates: `npm run discover:sources:apply`
- Optional suggestions artifact write: add `--write-suggestions` to either command.
