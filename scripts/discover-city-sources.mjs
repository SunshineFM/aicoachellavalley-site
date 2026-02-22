import fs from "node:fs";
import path from "node:path";

const WORKDIR = process.cwd();
const CITY_SOURCES_FILE = path.join(WORKDIR, "src", "data", "citySources.ts");
const CITIES_FILE = path.join(WORKDIR, "src", "data", "cities.ts");
const INPUT_FILE = path.join(WORKDIR, "docs", "research", "source-discovery-input.json");
const OUTPUT_FILE = path.join(WORKDIR, "docs", "research", "source-discovery-suggestions.json");
const TIMEOUT_MS = 12_000;
const REQUIRED_TYPES = ["youtube", "agendas-minutes", "docs", "video-archive"];
const FALLBACK_TO_GET_STATUSES = new Set([400, 401, 403, 404, 405, 406, 429]);

const args = new Set(process.argv.slice(2));
if (args.has("--help")) {
  console.info("Usage:");
  console.info("  node scripts/discover-city-sources.mjs --dry-run");
  console.info("  node scripts/discover-city-sources.mjs --apply");
  console.info("  node scripts/discover-city-sources.mjs --dry-run --write-suggestions");
  console.info("  node scripts/discover-city-sources.mjs --apply --write-suggestions");
  process.exit(0);
}
const applyMode = args.has("--apply");
const dryRun = !applyMode || args.has("--dry-run");
const writeSuggestions = args.has("--write-suggestions");

const readCities = () => {
  const content = fs.readFileSync(CITIES_FILE, "utf8");
  const cityBlocks = [...content.matchAll(/\{\s*slug:\s*"([^"]+)",[\s\S]*?name:\s*"([^"]+)"/g)];
  return Object.fromEntries(cityBlocks.map((m) => [m[1], m[2]]));
};

const readRegistry = () => {
  const content = fs.readFileSync(CITY_SOURCES_FILE, "utf8");
  const match = content.match(/export const citySourcesBySlug[^=]*=\s*(\{[\s\S]*\});/);
  if (!match) throw new Error("Could not parse citySourcesBySlug");
  return Function(`"use strict"; return (${match[1]});`)();
};

const writeRegistry = (registry) => {
  const sortedCitySlugs = Object.keys(registry).sort((a, b) => a.localeCompare(b));
  const lines = [];
  lines.push("export type CitySource = {");
  lines.push("  citySlug: string;");
  lines.push("  sources: Array<{");
  lines.push('    type: "youtube" | "video-archive" | "agendas-minutes" | "docs" | "city-site" | "econ-dev";');
  lines.push("    label: string;");
  lines.push("    url: string;");
  lines.push("    notes?: string;");
  lines.push("    verified?: boolean;");
  lines.push("  }>;");
  lines.push("};");
  lines.push("");
  lines.push('export const citySourcesBySlug: Record<string, CitySource["sources"]> = {');
  for (const citySlug of sortedCitySlugs) {
    lines.push(`  "${citySlug}": [`);
    const sortedSources = [...(registry[citySlug] || [])].sort((a, b) => {
      const byType = String(a.type).localeCompare(String(b.type));
      if (byType !== 0) return byType;
      const byLabel = String(a.label).localeCompare(String(b.label));
      if (byLabel !== 0) return byLabel;
      return String(a.url).localeCompare(String(b.url));
    });
    for (const source of sortedSources) {
      lines.push("    {");
      lines.push(`      type: "${source.type}",`);
      lines.push(`      label: "${String(source.label).replace(/"/g, '\\"')}",`);
      lines.push(`      url: "${String(source.url).replace(/"/g, '\\"')}",`);
      if (source.notes !== undefined) {
        lines.push(`      notes: "${String(source.notes).replace(/"/g, '\\"')}",`);
      }
      lines.push(`      verified: ${source.verified ? "true" : "false"},`);
      lines.push("    },");
    }
    lines.push("  ],");
  }
  lines.push("};");
  lines.push("");
  const nextContent = lines.join("\n");
  const prevContent = fs.existsSync(CITY_SOURCES_FILE) ? fs.readFileSync(CITY_SOURCES_FILE, "utf8") : "";
  if (prevContent !== nextContent) {
    fs.writeFileSync(CITY_SOURCES_FILE, nextContent, "utf8");
  }
};

const readInputCandidates = () => {
  if (!fs.existsSync(INPUT_FILE)) return {};
  return JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
};

const fetchWithTimeout = async (url, method) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "aicv-source-discovery/1.0",
      },
    });
  } finally {
    clearTimeout(timer);
  }
};

const validateCandidate = async (url) => {
  try {
    const head = await fetchWithTimeout(url, "HEAD");
    if (FALLBACK_TO_GET_STATUSES.has(head.status)) {
      const get = await fetchWithTimeout(url, "GET");
      return classify(url, get, "GET");
    }
    return classify(url, head, "HEAD");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "timeout", method: "HEAD", statusCode: null, finalUrl: url, valid: false };
    }
    return { status: "error", method: "HEAD", statusCode: null, finalUrl: url, valid: false };
  }
};

const classify = (originalUrl, response, method) => {
  const finalUrl = response.url || originalUrl;
  if (response.status >= 200 && response.status < 300) {
    return {
      status: finalUrl !== originalUrl ? "redirect" : "ok",
      method,
      statusCode: response.status,
      finalUrl,
      valid: true,
    };
  }
  if (response.status === 404) {
    return { status: "not_found", method, statusCode: response.status, finalUrl, valid: false };
  }
  return { status: "error", method, statusCode: response.status, finalUrl, valid: false };
};

const buildQueries = (cityName) => ({
  youtube: `City of ${cityName} official YouTube channel`,
  "agendas-minutes": `City of ${cityName} agendas minutes city clerk`,
  docs: `City of ${cityName} city clerk minutes agenda archive`,
  "video-archive": `City of ${cityName} city council video archive`,
});

const pickBest = (candidates) => {
  for (const candidate of candidates) {
    if (candidate.validation.valid) return candidate;
  }
  return null;
};

const normalizeSuggestions = (suggestions) => {
  suggestions.results.sort((a, b) => {
    const byCity = a.citySlug.localeCompare(b.citySlug);
    if (byCity !== 0) return byCity;
    return a.type.localeCompare(b.type);
  });
  return suggestions;
};

const run = async () => {
  const cities = readCities();
  const registry = readRegistry();
  const input = readInputCandidates();
  const suggestions = {
    mode: dryRun ? "dry-run" : "apply",
    inputFile: path.relative(WORKDIR, INPUT_FILE),
    outputFile: path.relative(WORKDIR, OUTPUT_FILE),
    results: [],
    summary: {
      checked: 0,
      valid: 0,
      missingTypeEntries: 0,
      needsManualVerification: 0,
      updated: 0,
    },
  };

  for (const [citySlug, cityName] of Object.entries(cities)) {
    const citySources = registry[citySlug] || [];
    const queries = buildQueries(cityName);

    for (const type of REQUIRED_TYPES) {
      const existing = citySources.find((source) => source.type === type);
      const externalCandidates = ((input[citySlug] || {})[type] || []).map((entry) => ({
        source: "input",
        url: entry.url,
        label: entry.label,
        notes: entry.notes,
      }));
      const defaultCandidates = existing
        ? [{ source: "existing", url: existing.url, label: existing.label, notes: existing.notes }]
        : [];
      const candidates = [...externalCandidates, ...defaultCandidates];

      if (!existing) {
        suggestions.summary.missingTypeEntries += 1;
      }

      const checkedCandidates = [];
      for (const candidate of candidates) {
        const validation = await validateCandidate(candidate.url);
        suggestions.summary.checked += 1;
        if (validation.valid) suggestions.summary.valid += 1;
        checkedCandidates.push({ ...candidate, validation });
      }

      const best = pickBest(checkedCandidates);
      const needsManualVerification = !best;
      if (needsManualVerification) suggestions.summary.needsManualVerification += 1;

      const action = best
        ? existing
          ? best.url === existing.url
            ? "keep"
            : "replace"
          : "add"
        : existing
          ? "keep-needs-manual-verification"
          : "missing-needs-manual-verification";

      suggestions.results.push({
        citySlug,
        cityName,
        type,
        query: queries[type],
        action,
        existing: existing || null,
        selected: best
          ? {
              url: best.url,
              label: best.label || existing?.label || `${cityName} ${type}`,
              notes: best.notes || existing?.notes || "",
              validation: best.validation,
            }
          : null,
        candidates: checkedCandidates,
      });

      if (!dryRun && best) {
        const nextLabel = best.label || existing?.label || `${cityName} ${type}`;
        const nextNotes = best.notes || existing?.notes || "Added by source discovery apply mode.";
        const nextVerified = true;
        if (existing) {
          const changed =
            existing.url !== best.url ||
            existing.label !== nextLabel ||
            (existing.notes || "") !== (nextNotes || "") ||
            Boolean(existing.verified) !== nextVerified;
          if (changed) {
            existing.url = best.url;
            existing.label = nextLabel;
            existing.notes = nextNotes;
            existing.verified = nextVerified;
            suggestions.summary.updated += 1;
          }
        } else {
          citySources.push({
            type,
            label: nextLabel,
            url: best.url,
            notes: nextNotes,
            verified: nextVerified,
          });
          registry[citySlug] = citySources;
          suggestions.summary.updated += 1;
        }
      }
    }
  }

  normalizeSuggestions(suggestions);

  if (writeSuggestions) {
    const nextSuggestions = JSON.stringify(suggestions, null, 2) + "\n";
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    const prevSuggestions = fs.existsSync(OUTPUT_FILE) ? fs.readFileSync(OUTPUT_FILE, "utf8") : "";
    if (nextSuggestions !== prevSuggestions) {
      fs.writeFileSync(OUTPUT_FILE, nextSuggestions, "utf8");
    }
  }

  if (!dryRun && suggestions.summary.updated > 0) {
    writeRegistry(registry);
  }

  console.info(`[discover:sources] mode=${dryRun ? "dry-run" : "apply"} checked=${suggestions.summary.checked} valid=${suggestions.summary.valid} updated=${suggestions.summary.updated}`);
  if (writeSuggestions) {
    console.info(`[discover:sources] suggestions written: ${path.relative(WORKDIR, OUTPUT_FILE)}`);
  } else {
    console.info("[discover:sources] suggestions file not written (use --write-suggestions).");
  }
};

await run();
