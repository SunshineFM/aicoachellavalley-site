import fs from "node:fs";
import path from "node:path";

const WORKDIR = process.cwd();
const RESEARCH_DIR = path.join(WORKDIR, "docs", "research", "2025");
const CITIES_FILE = path.join(WORKDIR, "src", "data", "cities.ts");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HIT_SOURCE_TYPES = new Set(["youtube", "pdf", "agenda", "minutes", "webpage"]);
const COVERAGE_KEYS = [
  "meetingsScanned",
  "transcriptsAvailable",
  "documentsScanned",
  "aiMentionsFound",
];

const fail = (message) => {
  throw new Error(message);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const readCanonicalCitySlugs = () => {
  assert(fs.existsSync(CITIES_FILE), `Missing canonical cities file: ${CITIES_FILE}`);
  const content = fs.readFileSync(CITIES_FILE, "utf8");
  const slugs = [...content.matchAll(/slug:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert(slugs.length > 0, "Could not parse city slugs from src/data/cities.ts");
  return new Set(slugs);
};

const validateResearchFile = (filePath, citySlugSet) => {
  const raw = fs.readFileSync(filePath, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    fail(`${filePath}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }

  const relPath = path.relative(WORKDIR, filePath);
  const requiredTopLevel = ["citySlug", "year", "lastScanDate", "coverage", "sourcesScanned", "hits"];
  requiredTopLevel.forEach((key) => {
    assert(key in data, `${relPath}: missing required key "${key}"`);
  });

  assert(typeof data.citySlug === "string" && data.citySlug.length > 0, `${relPath}: citySlug must be a string`);
  assert(citySlugSet.has(data.citySlug), `${relPath}: citySlug "${data.citySlug}" not found in src/data/cities.ts`);
  assert(typeof data.year === "number", `${relPath}: year must be a number`);
  assert(typeof data.lastScanDate === "string" && DATE_RE.test(data.lastScanDate), `${relPath}: lastScanDate must be YYYY-MM-DD`);
  assert(typeof data.coverage === "object" && data.coverage !== null, `${relPath}: coverage must be an object`);
  assert(Array.isArray(data.sourcesScanned), `${relPath}: sourcesScanned must be an array`);
  assert(Array.isArray(data.hits), `${relPath}: hits must be an array`);

  COVERAGE_KEYS.forEach((key) => {
    assert(key in data.coverage, `${relPath}: coverage missing "${key}"`);
    const value = data.coverage[key];
    assert(value === null || typeof value === "number", `${relPath}: coverage.${key} must be number or null`);
  });

  data.sourcesScanned.forEach((source, index) => {
    const ctx = `${relPath}: sourcesScanned[${index}]`;
    assert(typeof source === "object" && source !== null, `${ctx} must be an object`);
    assert(typeof source.url === "string" && source.url.startsWith("http"), `${ctx}.url must be a URL`);
    assert(typeof source.type === "string" && source.type.length > 0, `${ctx}.type must be a non-empty string`);
    assert(typeof source.label === "string" && source.label.length > 0, `${ctx}.label must be a non-empty string`);
  });

  data.hits.forEach((hit, index) => {
    const ctx = `${relPath}: hits[${index}]`;
    assert(typeof hit === "object" && hit !== null, `${ctx} must be an object`);
    assert(typeof hit.sourceUrl === "string" && hit.sourceUrl.startsWith("http"), `${ctx}.sourceUrl is required and must be a URL`);
    assert(typeof hit.sourceType === "string" && HIT_SOURCE_TYPES.has(hit.sourceType), `${ctx}.sourceType must be one of: ${Array.from(HIT_SOURCE_TYPES).join(", ")}`);
    assert(typeof hit.title === "string" && hit.title.length > 0, `${ctx}.title must be a non-empty string`);
    assert(hit.date === null || (typeof hit.date === "string" && DATE_RE.test(hit.date)), `${ctx}.date must be YYYY-MM-DD or null`);
    assert(hit.timestampOrPage === null || typeof hit.timestampOrPage === "string", `${ctx}.timestampOrPage must be string or null`);
    assert(typeof hit.snippet === "string" && hit.snippet.length > 0, `${ctx}.snippet is required`);
    assert(hit.snippet.length <= 280, `${ctx}.snippet must be <= 280 chars`);
    assert(Array.isArray(hit.keywords), `${ctx}.keywords must be an array`);
    hit.keywords.forEach((keyword, keywordIndex) => {
      assert(typeof keyword === "string" && keyword.length > 0, `${ctx}.keywords[${keywordIndex}] must be a non-empty string`);
    });
    if (hit.confidence !== undefined) {
      assert(["low", "med", "high"].includes(hit.confidence), `${ctx}.confidence must be low, med, or high`);
    }
  });

  return {
    citySlug: data.citySlug,
    hits: data.hits.length,
    coverage: data.coverage,
  };
};

const run = () => {
  const citySlugSet = readCanonicalCitySlugs();
  if (!fs.existsSync(RESEARCH_DIR)) {
    fail(`Missing research directory: ${RESEARCH_DIR}`);
  }

  const files = fs
    .readdirSync(RESEARCH_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(RESEARCH_DIR, entry))
    .sort((a, b) => a.localeCompare(b));

  assert(files.length > 0, `No research JSON files found in ${path.relative(WORKDIR, RESEARCH_DIR)}`);

  const summaries = files.map((file) => validateResearchFile(file, citySlugSet));

  console.info(`[validate:research] Validated ${summaries.length} file(s).`);
  summaries.forEach((summary) => {
    const coverageKnown = COVERAGE_KEYS.filter((key) => typeof summary.coverage[key] === "number").length;
    console.info(`- ${summary.citySlug}: hits=${summary.hits}, coverage_known=${coverageKnown}/${COVERAGE_KEYS.length}`);
  });
};

run();
