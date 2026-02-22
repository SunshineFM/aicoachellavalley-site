import fs from "node:fs";
import path from "node:path";

const WORKDIR = process.cwd();
const REGISTRY_FILE = path.join(WORKDIR, "src", "data", "citySources.ts");
const REPORT_FILE = path.join(WORKDIR, "docs", "research", "link-audit-report.json");
const TIMEOUT_MS = 12_000;
const FALLBACK_TO_GET_STATUSES = new Set([400, 401, 403, 404, 405, 406, 429]);

const readCitySourceRegistry = () => {
  const content = fs.readFileSync(REGISTRY_FILE, "utf8");
  const match = content.match(/export const citySourcesBySlug[^=]*=\s*(\{[\s\S]*\});/);
  if (!match) throw new Error("Could not parse citySourcesBySlug from src/data/citySources.ts");
  // Evaluate only the object literal extracted from the registry file.
  return Function(`"use strict"; return (${match[1]});`)();
};

const fetchWithTimeout = async (url, method) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "aicv-link-audit/1.0",
      },
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

const classifyResult = ({ url, response, error, method }) => {
  if (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        status: "timeout",
        method,
        statusCode: null,
        finalUrl: url,
        error: "timeout",
      };
    }
    return {
      status: "error",
      method,
      statusCode: null,
      finalUrl: url,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const statusCode = response.status;
  const finalUrl = response.url || url;

  if (statusCode === 404) {
    return { status: "not_found", method, statusCode, finalUrl, error: null };
  }

  if (statusCode >= 200 && statusCode < 300) {
    const redirected = finalUrl !== url;
    return {
      status: redirected ? "redirect" : "ok",
      method,
      statusCode,
      finalUrl,
      error: null,
    };
  }

  if (statusCode >= 300 && statusCode < 400) {
    return { status: "redirect", method, statusCode, finalUrl, error: null };
  }

  return { status: "error", method, statusCode, finalUrl, error: null };
};

const auditOneUrl = async (url) => {
  try {
    const headResponse = await fetchWithTimeout(url, "HEAD");
    if (FALLBACK_TO_GET_STATUSES.has(headResponse.status)) {
      try {
        const getResponse = await fetchWithTimeout(url, "GET");
        return classifyResult({ url, response: getResponse, error: null, method: "GET" });
      } catch (getError) {
        return classifyResult({ url, response: headResponse, error: null, method: "HEAD" });
      }
    }
    return classifyResult({ url, response: headResponse, error: null, method: "HEAD" });
  } catch (headError) {
    return classifyResult({ url, response: null, error: headError, method: "HEAD" });
  }
};

const run = async () => {
  const citySourcesBySlug = readCitySourceRegistry();
  const flatEntries = Object.entries(citySourcesBySlug).flatMap(([citySlug, sources]) =>
    (sources || []).map((source) => ({
      citySlug,
      type: source.type,
      label: source.label,
      url: source.url,
      notes: source.notes || "",
      verified: Boolean(source.verified),
    }))
  );

  const reportRows = [];
  for (const entry of flatEntries) {
    const result = await auditOneUrl(entry.url);
    reportRows.push({
      ...entry,
      ...result,
      checkedAt: new Date().toISOString(),
    });
  }

  const totals = {
    urls: reportRows.length,
    ok: reportRows.filter((row) => row.status === "ok").length,
    redirect: reportRows.filter((row) => row.status === "redirect").length,
    not_found: reportRows.filter((row) => row.status === "not_found").length,
    error: reportRows.filter((row) => row.status === "error").length,
    timeout: reportRows.filter((row) => row.status === "timeout").length,
  };

  const cities = {};
  for (const row of reportRows) {
    cities[row.citySlug] ??= {
      total: 0,
      ok: 0,
      redirect: 0,
      not_found: 0,
      error: 0,
      timeout: 0,
      rows: [],
    };
    cities[row.citySlug].total += 1;
    cities[row.citySlug][row.status] += 1;
    cities[row.citySlug].rows.push(row);
  }

  const notFound = reportRows.filter((row) => row.status === "not_found");
  const report = {
    generatedAt: new Date().toISOString(),
    timeoutMs: TIMEOUT_MS,
    totals,
    notFound,
    cities,
  };

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.info(`[audit:sources] urls=${totals.urls} ok=${totals.ok} redirect=${totals.redirect} not_found=${totals.not_found} error=${totals.error} timeout=${totals.timeout}`);
  console.info(`[audit:sources] report written: ${path.relative(WORKDIR, REPORT_FILE)}`);

  if (notFound.length > 0) {
    console.error("[audit:sources] confirmed 404 URLs:");
    notFound.forEach((row) => {
      console.error(`- ${row.citySlug} | ${row.type} | ${row.url}`);
    });
    process.exitCode = 1;
  }
};

await run();
