import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WORKDIR = process.cwd();
const RESEARCH_DIR = path.join(WORKDIR, "docs", "research", "2025");
const SIGNALS_DIR = path.join(WORKDIR, "src", "content", "signals");
const CITIES_FILE = path.join(WORKDIR, "src", "data", "cities.ts");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const args = new Set(process.argv.slice(2));
const shouldWrite = args.has("--write");
const dryRun = !shouldWrite || args.has("--dry-run");

const fail = (message) => {
  throw new Error(message);
};

const readCitySlugSet = () => {
  const citiesRaw = fs.readFileSync(CITIES_FILE, "utf8");
  const slugs = [...citiesRaw.matchAll(/slug:\s*"([^"]+)"/g)].map((match) => match[1]);
  return new Set(slugs);
};

const safeDate = (value) => (typeof value === "string" && DATE_RE.test(value) ? value : null);

const slugPart = (text) =>
  String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const stableShortId = (hit) => {
  const key = `${hit.sourceUrl}|${hit.title}|${hit.date || ""}|${hit.timestampOrPage || ""}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 10);
};

const toIsoDate = (hit, research) => {
  if (safeDate(hit.date)) return { date: hit.date, dateUnknown: false };
  if (safeDate(research.lastScanDate)) return { date: research.lastScanDate, dateUnknown: true };
  return { date: "2025-01-01", dateUnknown: true };
};

const readResearchFiles = () => {
  if (!fs.existsSync(RESEARCH_DIR)) return [];
  return fs
    .readdirSync(RESEARCH_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(RESEARCH_DIR, entry))
    .sort((a, b) => a.localeCompare(b));
};

const readExistingSignalFiles = () => {
  if (!fs.existsSync(SIGNALS_DIR)) return [];
  return fs
    .readdirSync(SIGNALS_DIR)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => ({
      name: entry,
      path: path.join(SIGNALS_DIR, entry),
      content: fs.readFileSync(path.join(SIGNALS_DIR, entry), "utf8"),
    }));
};

const hasHumanCollision = (existingFiles, hit) => {
  return existingFiles.some((file) => {
    if (file.name.includes("research-hit-")) return false;
    const hasSource = file.content.includes(hit.sourceUrl);
    if (!hasSource) return false;
    if (!hit.timestampOrPage) return false;
    return file.content.includes(hit.timestampOrPage);
  });
};

const buildFrontmatter = ({ title, date, citySlug, summary, hit, sourceMeta, research, dateUnknown }) => {
  const sourceType = sourceMeta?.type || "webpage";
  const sourceLabel = sourceMeta?.label || hit.title;
  const sourceNotes = sourceMeta?.notes || "Logged from research ingestion hit.";
  const confidence =
    hit.confidence === "low" ? "low" : hit.confidence === "high" ? "high" : "medium";

  return `---
title: "${title.replace(/"/g, '\\"')}"
date: ${date}
city: ${citySlug}
sector: Public Sector
signal_type: research
confidence: ${confidence}
tags:
  - research-hit
  - state-of-ai-2025
sources:
  - url: ${hit.sourceUrl}
    type: ${sourceType}
    label: "${sourceLabel.replace(/"/g, '\\"')}"
    notes: "${sourceNotes.replace(/"/g, '\\"')}"
summary: "${summary.replace(/"/g, '\\"')}"
dateUnknown: ${dateUnknown ? "true" : "false"}
evidence:
  timestampOrPage: ${hit.timestampOrPage ? `"${hit.timestampOrPage.replace(/"/g, '\\"')}"` : "null"}
  snippet: "${hit.snippet.replace(/"/g, '\\"')}"
research:
  year: ${research.year}
  citySlug: ${research.citySlug}
  lastScanDate: "${research.lastScanDate}"
---
`;
};

const buildBody = ({ hit, date }) => `This brief records a source-grounded research hit captured from a public document or recording. Logged snippet: "${hit.snippet}".

## Source
- URL: ${hit.sourceUrl}
- Date: ${hit.date || date}
- Timestamp/Page: ${hit.timestampOrPage || "Not provided"}

## Why this matters
This entry preserves traceable evidence context so city-level AI tracking can reference a dated source location without adding unsupported claims.
`;

const run = () => {
  const citySlugSet = readCitySlugSet();
  const researchFiles = readResearchFiles();
  if (researchFiles.length === 0) fail(`No research files found in ${path.relative(WORKDIR, RESEARCH_DIR)}`);

  const existingFiles = readExistingSignalFiles();
  const existingGeneratedNames = new Set(existingFiles.filter((f) => f.name.includes("research-hit-")).map((f) => f.name));
  const outputs = [];
  const cityStats = new Map();
  let processedTotal = 0;
  let skippedExistingTotal = 0;
  let skippedCollisionTotal = 0;

  for (const filePath of researchFiles) {
    const raw = fs.readFileSync(filePath, "utf8");
    const research = JSON.parse(raw);
    if (!citySlugSet.has(research.citySlug)) fail(`${filePath}: unknown citySlug ${research.citySlug}`);
    if (!Array.isArray(research.hits)) fail(`${filePath}: hits must be an array`);

    const stats = cityStats.get(research.citySlug) || { processed: 0, toWrite: 0, skippedExisting: 0, skippedCollision: 0 };

    for (const hit of research.hits) {
      stats.processed += 1;
      processedTotal += 1;
      if (!hit?.sourceUrl || !hit?.snippet) fail(`${filePath}: each hit must include sourceUrl and snippet`);

      const shortId = stableShortId(hit);
      const resolved = toIsoDate(hit, research);
      const [year, month, day] = resolved.date.split("-");
      const filename = `${year}-${month}-${day}-${slugPart(research.citySlug)}-research-hit-${shortId}.md`;
      const outPath = path.join(SIGNALS_DIR, filename);

      if (existingGeneratedNames.has(filename) || fs.existsSync(outPath)) {
        stats.skippedExisting += 1;
        skippedExistingTotal += 1;
        continue;
      }

      if (hasHumanCollision(existingFiles, hit)) {
        stats.skippedCollision += 1;
        skippedCollisionTotal += 1;
        continue;
      }

      const sourceMeta = (research.sourcesScanned || []).find((source) => source.url === hit.sourceUrl);
      const title = `Research hit: ${hit.title}`;
      const summary = `Source-grounded hit logged from ${hit.sourceType} evidence for ${research.citySlug}: ${hit.snippet}`.slice(0, 250);
      const frontmatter = buildFrontmatter({
        title,
        date: resolved.date,
        citySlug: research.citySlug,
        summary,
        hit,
        sourceMeta,
        research,
        dateUnknown: resolved.dateUnknown,
      });
      const body = buildBody({ hit, date: resolved.date });

      outputs.push({ path: outPath, content: `${frontmatter}\n${body}\n` });
      stats.toWrite += 1;
    }

    cityStats.set(research.citySlug, stats);
  }

  console.info(`[generate:briefs:research] mode=${dryRun ? "dry-run" : "write"}`);
  for (const [citySlug, stats] of cityStats.entries()) {
    console.info(
      `- ${citySlug}: hits=${stats.processed}, to_write=${stats.toWrite}, skipped_existing=${stats.skippedExisting}, skipped_collision=${stats.skippedCollision}`
    );
  }
  console.info(`[generate:briefs:research] total new files: ${outputs.length}`);
  const summary = {
    mode: dryRun ? "dry-run" : "write",
    files_scanned: researchFiles.length,
    hits_processed: processedTotal,
    to_write: outputs.length,
    skipped_existing: skippedExistingTotal,
    skipped_collision: skippedCollisionTotal,
  };
  console.info(`RESEARCH_GENERATION_SUMMARY=${JSON.stringify(summary)}`);

  if (!dryRun) {
    outputs.forEach((output) => {
      fs.writeFileSync(output.path, output.content, "utf8");
    });
    console.info(`[generate:briefs:research] wrote ${outputs.length} file(s).`);
  } else {
    outputs.slice(0, 5).forEach((output) => {
      console.info(`  dry-run would write: ${path.relative(WORKDIR, output.path)}`);
    });
  }
};

run();
