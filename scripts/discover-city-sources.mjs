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
const applyMode = args.has("--apply");
const dryRun = !applyMode || args.has("--dry-run");

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
  for (const citySlug of Object.keys(registry)) {
    lines.push(`  "${citySlug}": [`);
    for (const source of registry[citySlug]) {
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
  fs.writeFileSync(CITY_SOURCES_FILE, lines.join("\n"), "utf8");
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

const run = async () => {
  const cities = readCities();
  const registry = readRegistry();
  const input = readInputCandidates();
  const suggestions = {
    generatedAt: new Date().toISOString(),
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
        if (existing) {
          existing.url = best.url;
          existing.label = best.label || existing.label;
          existing.notes = best.notes || existing.notes;
          existing.verified = true;
          suggestions.summary.updated += 1;
        } else {
          citySources.push({
            type,
            label: best.label || `${cityName} ${type}`,
            url: best.url,
            notes: best.notes || "Added by source discovery apply mode.",
            verified: true,
          });
          registry[citySlug] = citySources;
          suggestions.summary.updated += 1;
        }
      } else if (!dryRun && existing && !best) {
        const manualNote = "needs manual verification";
        if (!String(existing.notes || "").includes(manualNote)) {
          existing.notes = `${existing.notes ? `${existing.notes} ` : ""}${manualNote}`.trim();
        }
        existing.verified = false;
      }
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(suggestions, null, 2) + "\n", "utf8");

  if (!dryRun) {
    writeRegistry(registry);
  }

  console.info(`[discover:sources] mode=${dryRun ? "dry-run" : "apply"} checked=${suggestions.summary.checked} valid=${suggestions.summary.valid} updated=${suggestions.summary.updated}`);
  console.info(`[discover:sources] suggestions written: ${path.relative(WORKDIR, OUTPUT_FILE)}`);
};

await run();
