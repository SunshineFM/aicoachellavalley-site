import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const siteUrl = process.env.SITE_URL;
const maxPages = Number(process.env.AUDIT_MAX_PAGES || 500);

if (!siteUrl) {
  console.error("SITE_URL is required. Example: SITE_URL=https://www.aicoachellavalley.com npm run audit:site");
  process.exit(1);
}

const start = new URL(siteUrl);
const origin = start.origin;
const startUrl = normalizeUrl(start.href, start.href);

const reportsDir = path.resolve("reports");
const screenshotsDir = path.join(reportsDir, "screenshots");
const reportPath = path.join(reportsDir, "site-audit.md");

await fs.mkdir(screenshotsDir, { recursive: true });

const queue = [startUrl];
const enqueued = new Set(queue);
const visited = new Set();
const results = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

while (queue.length > 0 && visited.size < maxPages) {
  const currentUrl = queue.shift();
  if (!currentUrl || visited.has(currentUrl)) continue;
  visited.add(currentUrl);

  let status = "ERR";
  let title = "";
  let notes = [];
  let error = "";
  let screenshotRelPath = "";

  try {
    const response = await page.goto(currentUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    status = response?.status() ?? 0;
    title = await page.title();

    const hrefs = await page.$$eval("a[href]", (anchors) =>
      anchors.map((a) => a.getAttribute("href")).filter(Boolean)
    );

    for (const href of hrefs) {
      const normalized = normalizeUrl(href, currentUrl);
      if (!normalized) continue;
      if (!enqueued.has(normalized) && !visited.has(normalized)) {
        enqueued.add(normalized);
        queue.push(normalized);
      }
    }

    const diagnostics = await page.evaluate(() => {
      const main = document.querySelector("main");
      const footer = document.querySelector("footer");
      const mainTextLength = (main?.textContent ?? "").replace(/\s+/g, " ").trim().length;
      const viewportHeight = window.innerHeight;
      const scrollHeight = document.documentElement.scrollHeight;

      let footerTop = null;
      if (footer) {
        const rect = footer.getBoundingClientRect();
        footerTop = rect.top;
      }

      const emptyContent = !!main && mainTextLength < 100;
      const weirdFooter =
        footerTop !== null && scrollHeight <= viewportHeight * 1.05 && footerTop < viewportHeight * 0.75;

      return { emptyContent, weirdFooter };
    });

    if (diagnostics.emptyContent) notes.push("empty content");
    if (diagnostics.weirdFooter) notes.push("weird footer position");
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    notes.push("navigation error");
  }

  if (status !== 200) {
    screenshotRelPath = path.join("reports", "screenshots", screenshotNameForUrl(currentUrl));
    try {
      await page.screenshot({
        path: path.resolve(screenshotRelPath),
        fullPage: true,
      });
    } catch {
      // Ignore screenshot errors so audit can continue.
    }
  }

  results.push({
    url: currentUrl,
    status,
    title,
    notes,
    error,
    screenshot: screenshotRelPath,
  });
}

await browser.close();

const broken = results.filter((r) => r.status !== 200);
const topBroken = broken.slice(0, 10);
const weirdOrEmpty = results.filter((r) => r.notes.includes("empty content") || r.notes.includes("weird footer position"));

const reportLines = [];
reportLines.push("# Site Audit");
reportLines.push("");
reportLines.push(`- Site: ${origin}`);
reportLines.push(`- Start URL: ${startUrl}`);
reportLines.push(`- Generated: ${new Date().toISOString()}`);
reportLines.push(`- Pages visited: ${results.length}`);
reportLines.push(`- Non-200 pages: ${broken.length}`);
if (queue.length > 0) {
  reportLines.push(`- Crawl capped at ${maxPages} pages`);
}
reportLines.push("");

reportLines.push("## Top 10 broken links");
reportLines.push("");
if (topBroken.length === 0) {
  reportLines.push("No broken links found.");
  reportLines.push("");
} else {
  reportLines.push("| URL | Status | Title | Screenshot |");
  reportLines.push("| --- | --- | --- | --- |");
  for (const row of topBroken) {
    reportLines.push(
      `| ${escapeMd(row.url)} | ${escapeMd(String(row.status))} | ${escapeMd(row.title || "-")} | ${row.screenshot ? `[image](${escapeMd(row.screenshot)})` : "-"} |`
    );
  }
  reportLines.push("");
}

reportLines.push("## Pages with empty content / weird footer");
reportLines.push("");
if (weirdOrEmpty.length === 0) {
  reportLines.push("No pages flagged.");
  reportLines.push("");
} else {
  reportLines.push("| URL | Status | Title | Flags |");
  reportLines.push("| --- | --- | --- | --- |");
  for (const row of weirdOrEmpty) {
    reportLines.push(
      `| ${escapeMd(row.url)} | ${escapeMd(String(row.status))} | ${escapeMd(row.title || "-")} | ${escapeMd(row.notes.join(", "))} |`
    );
  }
  reportLines.push("");
}

reportLines.push("## Full crawl results");
reportLines.push("");
reportLines.push("| URL | Status | Title | Notes | Error |");
reportLines.push("| --- | --- | --- | --- | --- |");
for (const row of results) {
  reportLines.push(
    `| ${escapeMd(row.url)} | ${escapeMd(String(row.status))} | ${escapeMd(row.title || "-")} | ${escapeMd(row.notes.join(", ") || "-")} | ${escapeMd(row.error || "-")} |`
  );
}
reportLines.push("");

await fs.writeFile(reportPath, reportLines.join("\n"), "utf8");
console.log(`Site audit written to ${reportPath}`);

function normalizeUrl(href, base = start.href) {
  try {
    const url = new URL(href, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.origin !== origin) return null;
    url.search = "";
    url.hash = "";
    if (!url.pathname) url.pathname = "/";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

function screenshotNameForUrl(rawUrl) {
  const url = new URL(rawUrl);
  const key = `${url.pathname}${url.search || ""}` || "/";
  const normalized = key
    .replace(/^\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${normalized || "root"}.png`;
}

function escapeMd(value) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
