import type { APIRoute } from "astro";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createShareRecord, type PublicSharePayload, type ShareTopFix } from "../../utils/aioShareStore";

export const prerender = false;

type CheckStatus = "pass" | "warn" | "fail";
type Grade = "Needs work" | "Fair" | "Good" | "Great";
type Confidence = "High" | "Medium" | "Low";

type CategoryId = "access" | "metadata" | "content" | "structured-data";

type CheckResult = {
  id: string;
  name: string;
  status: CheckStatus;
  points: number;
  max: number;
  evidence: string;
  fix: string;
  snippet?: string;
  categoryId: CategoryId;
};

type CheckOutput = Omit<CheckResult, "max" | "categoryId">;

type CategoryOutput = {
  id: CategoryId;
  name: string;
  score: number;
  max: number;
};

type DebugInfo = {
  cacheHit: boolean;
  remainingRateLimit: {
    burstTokens: number;
    dailyRemaining: number;
  };
};

type AnalysisPayload = {
  url: string;
  fetchedAt: string;
  rubricVersion: "1.0";
  score: number;
  grade: Grade;
  confidence: Confidence;
  categories: CategoryOutput[];
  checks: CheckOutput[];
  topFixes: string[];
  limitations: string[];
  realityCheck: string[];
  exports: {
    markdown: string;
    json: string;
    html: string;
  };
};

type ApiResponse = AnalysisPayload & {
  shareUrl?: string;
  debug?: DebugInfo;
};

type FetchResult = {
  ok: boolean;
  status: number;
  finalUrl: string;
  html: string;
  timedOut: boolean;
  blockedStatus: boolean;
  redirectCount: number;
  error?: string;
};

type RateState = {
  dayStartMs: number;
  dayCount: number;
  tokens: number;
  lastRefillMs: number;
};

const RUBRIC_VERSION = "1.0" as const;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const CACHE_TTL_MS = 10 * 60_000;
const SHARE_TTL_SECONDS = 30 * 24 * 60 * 60;

const BURST_TOKENS = 2;
const BURST_WINDOW_MS = 60_000;
const DAILY_LIMIT = 30;

// TODO: Move rate limiting to KV/Redis for production multi-instance consistency.
const rateState = new Map<string, RateState>();
const analysisCache = new Map<string, { expiresAt: number; payload: AnalysisPayload }>();

const CATEGORY_NAMES: Record<CategoryId, string> = {
  access: "Access",
  metadata: "Metadata",
  content: "Content clarity",
  "structured-data": "Structured data",
};

const CATEGORY_WEIGHTS: Record<CategoryId, number> = {
  access: 25,
  metadata: 25,
  content: 25,
  "structured-data": 25,
};

const REALITY_CHECK_ITEMS = [
  'Not scored. External systems vary. Search: site:example.com "brand".',
  "Not scored. External systems vary. Search the exact business name and review top citations.",
  'Not scored. External systems vary. Ask an LLM: "What is <business> in Coachella Valley?" and verify whether it cites the site.',
];

const CHECKS = {
  accessFetch: {
    id: "access-fetch",
    name: "Page fetchability",
    categoryId: "access",
    max: 10,
    fix: "Ensure a normal browser-style GET request can fetch the page without blocking.",
  },
  accessStatus: {
    id: "access-status",
    name: "HTTP status",
    categoryId: "access",
    max: 8,
    fix: "Return a stable 200 response for the canonical page URL.",
  },
  accessRedirects: {
    id: "access-redirects",
    name: "Redirect/canonical sanity",
    categoryId: "access",
    max: 7,
    fix: "Reduce unnecessary redirect chains and keep canonical URL consistent.",
  },
  accessRobotsTxt: {
    id: "access-robots-txt",
    name: "robots.txt availability",
    categoryId: "access",
    max: 5,
    fix: "Publish a readable robots.txt at /robots.txt with crawl directives and sitemap reference.",
  },
  accessSitemapXml: {
    id: "access-sitemap-xml",
    name: "sitemap.xml availability",
    categoryId: "access",
    max: 5,
    fix: "Publish a valid sitemap.xml (urlset or sitemapindex) and keep it updated.",
  },
  metaTitle: {
    id: "meta-title",
    name: "Title tag quality",
    categoryId: "metadata",
    max: 7,
    fix: "Use a specific title that reflects the page topic and audience intent.",
  },
  metaDescription: {
    id: "meta-description",
    name: "Meta description quality",
    categoryId: "metadata",
    max: 6,
    fix: "Write a clear 70-160 char description summarizing value and context.",
  },
  metaRobots: {
    id: "meta-robots",
    name: "Indexing directives",
    categoryId: "metadata",
    max: 6,
    fix: "Avoid noindex/noarchive directives on pages intended for discovery.",
  },
  metaCanonical: {
    id: "meta-canonical",
    name: "Canonical URL tag",
    categoryId: "metadata",
    max: 6,
    fix: "Add a canonical link and keep it aligned with your preferred URL.",
  },
  contentH1: {
    id: "content-h1",
    name: "H1 structure",
    categoryId: "content",
    max: 8,
    fix: "Use one clear H1 that matches the page purpose.",
  },
  contentHeadings: {
    id: "content-headings",
    name: "Heading hierarchy",
    categoryId: "content",
    max: 5,
    fix: "Use H2/H3 sections to make content scannable for users and crawlers.",
  },
  contentDepth: {
    id: "content-depth",
    name: "Meaningful body content",
    categoryId: "content",
    max: 8,
    fix: "Add clear descriptive content about services, audience, outcomes, and location context.",
  },
  contentTrust: {
    id: "content-trust-signals",
    name: "Contact/about trust signals",
    categoryId: "content",
    max: 4,
    fix: "Include obvious About and Contact paths in internal links or body text.",
  },
  sdPresence: {
    id: "sd-presence",
    name: "JSON-LD presence",
    categoryId: "structured-data",
    max: 10,
    fix: "Add at least one JSON-LD block describing your organization or page entity.",
  },
  sdValidity: {
    id: "sd-validity",
    name: "JSON-LD validity",
    categoryId: "structured-data",
    max: 10,
    fix: "Fix JSON-LD syntax errors and validate scripts with structured data tools.",
  },
  sdRecommendedTypes: {
    id: "sd-recommended-types",
    name: "Recommended schema types",
    categoryId: "structured-data",
    max: 5,
    fix: "Prefer Organization/WebSite or LocalBusiness types where appropriate.",
  },
} as const;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const now = Date.now();
  const ip = clientAddress || getForwardedIp(request) || "unknown";
  const rate = consumeRateLimit(ip, now);

  const debugFromRate = maybeDebug(false, rate.remaining);
  if (!rate.allowed) {
    return json(
      {
        message: "Rate limit reached. Try again shortly (2/min burst, 30/day).",
        retryAfterSeconds: rate.retryAfterSeconds,
        ...(debugFromRate ? { debug: debugFromRate } : {}),
      },
      429,
      { "Retry-After": String(rate.retryAfterSeconds), "Cache-Control": "no-store" },
    );
  }

  let body: { url?: unknown; createShare?: unknown };
  try {
    body = (await request.json()) as { url?: unknown; createShare?: unknown };
  } catch {
    return json(
      {
        message: "Invalid JSON body. Expected { url: string }.",
        ...(debugFromRate ? { debug: debugFromRate } : {}),
      },
      400,
    );
  }

  if (typeof body.url !== "string" || !body.url.trim()) {
    return json(
      {
        message: "Please provide a URL.",
        ...(debugFromRate ? { debug: debugFromRate } : {}),
      },
      400,
    );
  }

  const createShare = body.createShare === true;

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(body.url);
    await assertSafeTarget(normalizedUrl);
  } catch (error) {
    return json(
      {
        message: error instanceof Error ? error.message : "URL validation failed.",
        ...(debugFromRate ? { debug: debugFromRate } : {}),
      },
      400,
    );
  }

  const cacheEntry = analysisCache.get(normalizedUrl);
  const cacheHit = !!cacheEntry && cacheEntry.expiresAt > now;

  const analysis = cacheHit ? cacheEntry.payload : await runAnalysis(normalizedUrl, now);

  if (!cacheHit) {
    analysisCache.set(normalizedUrl, { expiresAt: now + CACHE_TTL_MS, payload: analysis });
  }

  let shareUrl: string | undefined;
  if (createShare) {
    const topFixObjects = buildShareTopFixes(analysis);
    const sharePayload: PublicSharePayload = {
      url: analysis.url,
      fetchedAt: analysis.fetchedAt,
      rubricVersion: analysis.rubricVersion,
      score: analysis.score,
      grade: analysis.grade,
      confidence: analysis.confidence,
      categories: analysis.categories,
      topFixes: topFixObjects,
    };

    const origin = new URL(request.url).origin;
    const share = await createShareRecord(sharePayload, SHARE_TTL_SECONDS);
    shareUrl = `${origin}/tools/aio/r/share?sid=${encodeURIComponent(share.id)}`;
  }

  const response: ApiResponse = {
    ...analysis,
    ...(shareUrl ? { shareUrl } : {}),
    ...(maybeDebug(cacheHit, rate.remaining) ? { debug: maybeDebug(cacheHit, rate.remaining) } : {}),
  };

  return json(response, 200, {
    "Cache-Control": "no-store",
    "X-Cache": cacheHit ? "HIT" : "MISS",
  });
};

async function runAnalysis(url: string, now: number): Promise<AnalysisPayload> {
  const fetchResult = await fetchWithRedirectChecks(url);
  const html = fetchResult.html || "";
  const bodyText = extractBodyText(html);
  const loweredText = bodyText.toLowerCase();
  const scriptCount = countMatches(html, /<script\b/gi);
  const jsShell = isLikelyJsShell(html, bodyText, scriptCount);

  const checks: CheckResult[] = [];

  checks.push(
    check(
      CHECKS.accessFetch,
      fetchResult.ok && html.length > 200 ? "pass" : fetchResult.ok ? "warn" : "fail",
      fetchResult.ok && html.length > 200 ? CHECKS.accessFetch.max : fetchResult.ok ? 5 : 0,
      fetchResult.ok
        ? `Fetched HTML successfully (${html.length.toLocaleString()} chars).`
        : fetchResult.error || `Fetch failed (${fetchResult.status}).`,
    ),
  );

  checks.push(
    check(
      CHECKS.accessStatus,
      fetchResult.status >= 200 && fetchResult.status < 300 ? "pass" : "fail",
      fetchResult.status >= 200 && fetchResult.status < 300 ? CHECKS.accessStatus.max : 0,
      `Final status code: ${fetchResult.status}.`,
    ),
  );

  const title = extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = findMetaTag(html, "description");
  const robots = findMetaTag(html, "robots");
  const canonical = findCanonical(html);
  const finalUrlObj = parseUrl(fetchResult.finalUrl);
  const crawlBase = finalUrlObj?.origin || parseUrl(url)?.origin || null;
  const [robotsTxtResult, sitemapResult] = await Promise.all([
    crawlBase ? fetchWithRedirectChecks(`${crawlBase}/robots.txt`, 4_000) : Promise.resolve(null),
    crawlBase ? fetchWithRedirectChecks(`${crawlBase}/sitemap.xml`, 4_000) : Promise.resolve(null),
  ]);
  const canonicalUrlObj = resolveCanonicalUrl(canonical, fetchResult.finalUrl || url);

  let redirectStatus: CheckStatus = fetchResult.redirectCount === 0 ? "pass" : fetchResult.redirectCount <= 3 ? "warn" : "fail";
  let redirectPoints = fetchResult.redirectCount === 0 ? CHECKS.accessRedirects.max : fetchResult.redirectCount <= 3 ? 4 : 0;
  const redirectEvidence = [`Redirect hops detected: ${fetchResult.redirectCount}. Final URL: ${fetchResult.finalUrl}.`];

  if (canonicalUrlObj && finalUrlObj && canonicalUrlObj.host !== finalUrlObj.host) {
    redirectStatus = redirectStatus === "fail" ? "fail" : "warn";
    redirectPoints = redirectStatus === "fail" ? 0 : Math.min(redirectPoints, 3);
    redirectEvidence.push(`Canonical host (${canonicalUrlObj.host}) differs from final host (${finalUrlObj.host}).`);
  }

  checks.push(check(CHECKS.accessRedirects, redirectStatus, redirectPoints, redirectEvidence.join(" ")));

  if (!robotsTxtResult) {
    checks.push(check(CHECKS.accessRobotsTxt, "warn", 2, "Could not evaluate robots.txt for this URL origin."));
  } else {
    const robotsBody = robotsTxtResult.html.trim();
    const robotsPass = robotsTxtResult.ok && robotsBody.length >= 24;
    const robotsWarn = robotsTxtResult.status === 404 || (robotsTxtResult.ok && robotsBody.length > 0 && robotsBody.length < 24);
    checks.push(
      check(
        CHECKS.accessRobotsTxt,
        robotsPass ? "pass" : robotsWarn ? "warn" : "fail",
        robotsPass ? CHECKS.accessRobotsTxt.max : robotsWarn ? 2 : 0,
        robotsPass
          ? `robots.txt reachable (${robotsBody.length} chars).`
          : robotsWarn
            ? `robots.txt weak or missing (status ${robotsTxtResult.status}, ${robotsBody.length} chars).`
            : `robots.txt unavailable (status ${robotsTxtResult.status}).`,
      ),
    );
  }

  if (!sitemapResult) {
    checks.push(check(CHECKS.accessSitemapXml, "warn", 2, "Could not evaluate sitemap.xml for this URL origin."));
  } else {
    const sitemapBody = sitemapResult.html;
    const sitemapLooksValid = /<(urlset|sitemapindex)\b/i.test(sitemapBody);
    const sitemapPass = sitemapResult.ok && sitemapLooksValid;
    const sitemapWarn = sitemapResult.status === 404 || (sitemapResult.ok && !sitemapLooksValid);
    checks.push(
      check(
        CHECKS.accessSitemapXml,
        sitemapPass ? "pass" : sitemapWarn ? "warn" : "fail",
        sitemapPass ? CHECKS.accessSitemapXml.max : sitemapWarn ? 2 : 0,
        sitemapPass
          ? `sitemap.xml reachable and valid (status ${sitemapResult.status}).`
          : sitemapWarn
            ? `sitemap.xml missing or not parseable as sitemap (status ${sitemapResult.status}).`
            : `sitemap.xml unavailable (status ${sitemapResult.status}).`,
      ),
    );
  }

  checks.push(
    check(
      CHECKS.metaTitle,
      title.length >= 18 ? "pass" : title.length > 0 ? "warn" : "fail",
      title.length >= 18 ? CHECKS.metaTitle.max : title.length > 0 ? 3 : 0,
      title ? `Title found (${title.length} chars).` : "No title tag found.",
      title ? `<title>${title}</title>` : undefined,
    ),
  );

  const descriptionLength = metaDescription.trim().length;
  const metaDescriptionStatus: CheckStatus =
    descriptionLength >= 70 && descriptionLength <= 160
      ? "pass"
      : (descriptionLength >= 50 && descriptionLength < 70) || (descriptionLength > 160 && descriptionLength <= 200)
        ? "warn"
        : "fail";
  const metaDescriptionPoints = metaDescriptionStatus === "pass" ? CHECKS.metaDescription.max : metaDescriptionStatus === "warn" ? 3 : 0;
  const metaDescriptionEvidence =
    descriptionLength === 0
      ? "Meta description length: 0 (missing; ideal 70-160)."
      : descriptionLength < 50
        ? `Meta description length: ${descriptionLength} (too short; ideal 70-160).`
        : descriptionLength < 70
          ? `Meta description length: ${descriptionLength} (slightly short; ideal 70-160).`
          : descriptionLength <= 160
            ? `Meta description length: ${descriptionLength} (ideal 70-160).`
            : descriptionLength <= 200
              ? `Meta description length: ${descriptionLength} (slightly long; ideal 70-160).`
              : `Meta description length: ${descriptionLength} (too long; ideal 70-160).`;
  checks.push(
    check(
      CHECKS.metaDescription,
      metaDescriptionStatus,
      metaDescriptionPoints,
      metaDescriptionEvidence,
      metaDescription ? `<meta name=\"description\" content=\"${metaDescription}\" />` : undefined,
    ),
  );

  const noindex = /(^|\s|,)(noindex|none)(\s|,|$)/i.test(robots);
  checks.push(
    check(
      CHECKS.metaRobots,
      noindex ? "fail" : "pass",
      noindex ? 0 : CHECKS.metaRobots.max,
      robots ? `Robots directive: ${robots}.` : "No robots meta set (default crawl behavior).",
      robots ? `<meta name=\"robots\" content=\"${robots}\" />` : undefined,
    ),
  );

  const canonicalHostMismatch = Boolean(canonicalUrlObj && finalUrlObj && canonicalUrlObj.host !== finalUrlObj.host);
  const canonicalPathMismatch = Boolean(canonicalUrlObj && finalUrlObj && canonicalUrlObj.pathname !== finalUrlObj.pathname);
  const canonicalMismatch = canonicalHostMismatch || canonicalPathMismatch;
  checks.push(
    check(
      CHECKS.metaCanonical,
      canonical ? (canonicalMismatch ? "warn" : "pass") : "fail",
      canonical ? (canonicalMismatch ? 3 : CHECKS.metaCanonical.max) : 0,
      canonical
        ? canonicalMismatch
          ? `Canonical URL found (${canonical}) but differs from final URL path/host (${fetchResult.finalUrl}).`
          : `Canonical URL found: ${canonical}.`
        : "Canonical link missing.",
      canonical ? `<link rel=\"canonical\" href=\"${canonical}\" />` : undefined,
    ),
  );

  const h1Count = countMatches(html, /<h1\b[^>]*>/gi);
  checks.push(
    check(
      CHECKS.contentH1,
      h1Count === 1 ? "pass" : h1Count > 1 ? "warn" : "fail",
      h1Count === 1 ? CHECKS.contentH1.max : h1Count > 1 ? 4 : 0,
      `H1 count: ${h1Count}.`,
    ),
  );

  const headingCount = countMatches(html, /<h[2-3]\b[^>]*>/gi);
  checks.push(
    check(
      CHECKS.contentHeadings,
      headingCount >= 2 ? "pass" : headingCount === 1 ? "warn" : "fail",
      headingCount >= 2 ? CHECKS.contentHeadings.max : headingCount === 1 ? 2 : 0,
      `H2/H3 heading count: ${headingCount}.`,
    ),
  );

  checks.push(
    check(
      CHECKS.contentDepth,
      bodyText.length >= 600 ? "pass" : bodyText.length >= 220 ? "warn" : "fail",
      bodyText.length >= 600 ? CHECKS.contentDepth.max : bodyText.length >= 220 ? 4 : 0,
      `Detected ${bodyText.length.toLocaleString()} readable characters in body content.`,
    ),
  );

  const hasAboutOrContact = /\babout\b|\bcontact\b/i.test(loweredText) || hasAboutContactLinks(html, url);
  checks.push(
    check(
      CHECKS.contentTrust,
      hasAboutOrContact ? "pass" : "warn",
      hasAboutOrContact ? CHECKS.contentTrust.max : 1,
      hasAboutOrContact
        ? "About/contact trust signals detected in text or links."
        : "No strong about/contact trust signal detected.",
    ),
  );

  const jsonLd = inspectJsonLd(html);

  checks.push(
    check(
      CHECKS.sdPresence,
      jsonLd.total > 0 ? "pass" : "fail",
      jsonLd.total > 0 ? CHECKS.sdPresence.max : 0,
      jsonLd.total > 0 ? `JSON-LD blocks found: ${jsonLd.total}.` : "No JSON-LD blocks found.",
    ),
  );

  const jsonldValidityStatus: CheckStatus = jsonLd.total === 0 ? "warn" : jsonLd.parseErrors === 0 ? "pass" : "fail";
  const jsonldValidityPoints = jsonLd.total === 0 ? 3 : jsonLd.parseErrors === 0 ? CHECKS.sdValidity.max : 0;
  checks.push(
    check(
      CHECKS.sdValidity,
      jsonldValidityStatus,
      jsonldValidityPoints,
      jsonLd.total === 0
        ? "No JSON-LD to validate yet."
        : jsonLd.parseErrors === 0
          ? "JSON-LD syntax parsed successfully."
          : `JSON-LD parse errors: ${jsonLd.parseErrors}.`,
      jsonLd.validScripts[0],
    ),
  );

  const recommendedTypeFound = jsonLd.types.some((type) => ["Organization", "WebSite", "LocalBusiness"].includes(type));
  checks.push(
    check(
      CHECKS.sdRecommendedTypes,
      recommendedTypeFound ? "pass" : jsonLd.total > 0 ? "warn" : "fail",
      recommendedTypeFound ? CHECKS.sdRecommendedTypes.max : jsonLd.total > 0 ? 2 : 0,
      jsonLd.types.length
        ? `Detected JSON-LD @type values: ${jsonLd.types.join(", ")}.`
        : "No recommended Organization/WebSite/LocalBusiness type detected.",
    ),
  );

  const categoryScores = summarizeCategories(checks).map((category) =>
    category.id === "content" && jsShell.flag ? { ...category, score: Math.min(category.score, 10) } : category,
  );
  const rawScore = clamp(categoryScores.reduce((sum, category) => sum + category.score, 0), 0, 100);

  const meaningfulContent = bodyText.length >= 220;
  const hasMajorBlocker = checks.some((item) =>
    [CHECKS.accessFetch.id, CHECKS.accessStatus.id].includes(item.id) && item.status === "fail",
  );

  const baseConfidence = toConfidence({
    fetchResult,
    meaningfulContent,
    metadataGaps: checks.filter((c) => c.categoryId === "metadata" && c.status !== "pass").length,
    jsonLdErrors: jsonLd.parseErrors,
    hasMajorBlocker,
  });
  const confidence = jsShell.flag ? downgradeConfidence(baseConfidence) : baseConfidence;

  let score = rawScore;
  let harshMetaPenaltyApplied = false;
  if (descriptionLength > 220) {
    score = Math.max(0, score - 3);
    harshMetaPenaltyApplied = true;
  }
  const hasFail = checks.some((item) => item.status === "fail");
  const hasWarn = checks.some((item) => item.status === "warn");
  let strictCapReason: "warn" | "fail" | null = null;
  if (hasFail && score > 85) {
    score = 85;
    strictCapReason = "fail";
  } else if (hasWarn && score > 95) {
    score = 95;
    strictCapReason = "warn";
  }
  let capReason: string | null = null;
  if (confidence === "Low" && score > 60) {
    score = 60;
    capReason = "Low";
  } else if (confidence === "Medium" && score > 85) {
    score = 85;
    capReason = "Medium";
  }
  const grade = toGrade(score);

  const prioritizedFixChecks = checks
    .filter((item) => item.status !== "pass")
    .sort((a, b) => a.points - b.points || b.max - a.max);

  const topFixes = prioritizedFixChecks.map((item) => item.fix).filter(unique).slice(0, 7);

  const limitations = [
    "This check uses one live fetch and may not reflect geo-specific variants, login states, or cookies.",
    "JavaScript-rendered content can be partially missed because analysis is HTML-first.",
    "Recommendations are heuristic and should be reviewed with your CMS and analytics context.",
  ];
  if (jsShell.flag) {
    limitations.push(
      `${jsShell.evidence} This page appears to rely heavily on client-side rendering; AI crawlers may see little content. Content score is capped until server-rendered content is available.`,
    );
  }
  if (capReason === "Low") {
    limitations.push("Score capped due to Low confidence (fetch/parse limitations).");
  } else if (capReason === "Medium") {
    limitations.push("Score capped due to Medium confidence (partial signals).");
  }
  if (harshMetaPenaltyApplied) {
    limitations.push("Additional penalty applied: meta description is far above recommended length (>220 chars).");
  }
  if (strictCapReason === "fail") {
    limitations.push("Strict mode cap applied: one or more checks failed, so score is capped at 85.");
  } else if (strictCapReason === "warn") {
    limitations.push("Strict mode cap applied: one or more checks are warnings, so score is capped at 95.");
  }

  const outputChecks: CheckOutput[] = checks.map(({ categoryId, max, ...rest }) => rest);

  const base: AnalysisPayload = {
    url,
    fetchedAt: new Date(now).toISOString(),
    rubricVersion: RUBRIC_VERSION,
    score,
    grade,
    confidence,
    categories: categoryScores,
    checks: outputChecks,
    topFixes,
    limitations,
    realityCheck: REALITY_CHECK_ITEMS,
    exports: {
      markdown: "",
      json: "",
      html: "",
    },
  };

  const snippets = recommendedSnippets(url, title, metaDescription, canonical);
  base.exports.markdown = buildMarkdownExport(base, checks, snippets.jsonLdStarter);
  base.exports.json = buildJsonExport(base, snippets);
  base.exports.html = buildHtmlExport(snippets);

  return base;
}

function buildMarkdownExport(payload: AnalysisPayload, checks: CheckResult[], jsonLdStarter: string): string {
  const lines: string[] = [];
  lines.push("# AI Visibility Checkup - Fix Pack");
  lines.push("");
  lines.push(`- URL: ${payload.url}`);
  lines.push(`- Score: ${payload.score}/100 (${payload.grade})`);
  lines.push(`- Confidence: ${payload.confidence}`);
  lines.push(`- Rubric version: ${payload.rubricVersion}`);
  lines.push("");
  lines.push("## Prioritized checklist");

  const prioritized = checks
    .filter((item) => item.status !== "pass")
    .sort((a, b) => a.points - b.points || b.max - a.max)
    .slice(0, 7);

  if (!prioritized.length) {
    lines.push("- [ ] No high-priority fixes from this run.");
  } else {
    for (const item of prioritized) {
      lines.push(`- [ ] ${item.name}: ${item.fix}`);
      lines.push(`  - Found: ${item.evidence}`);
      lines.push(`  - Why it matters: Improves crawl understanding and retrieval quality.`);
      lines.push(`  - How to fix: ${item.fix}`);
    }
  }

  lines.push("");
  lines.push("## Reality Check (Not scored)");
  for (const item of payload.realityCheck) {
    lines.push(`- ${item}`);
  }

  lines.push("");
  lines.push("## JSON-LD starter");
  lines.push("```json");
  lines.push(jsonLdStarter);
  lines.push("```");
  lines.push("");
  lines.push("## Developer notes");
  lines.push("- Paste meta tags into the page <head> template.");
  lines.push("- Keep title, H1, canonical, and schema values aligned to the same page intent.");
  lines.push("- Replace placeholders before publishing.");

  return lines.join("\n");
}

function buildJsonExport(payload: AnalysisPayload, snippets: ReturnType<typeof recommendedSnippets>): string {
  const parsedJsonExport = {
    ...payload,
    snippets: {
      headTags: snippets.headTags,
      jsonLdStarter: JSON.parse(snippets.jsonLdStarter),
      placementNotes: [
        "Paste headTags into <head>.",
        "Paste JSON-LD script in <head> or before </body>.",
      ],
    },
  };

  return JSON.stringify(parsedJsonExport, null, 2);
}

function buildHtmlExport(snippets: ReturnType<typeof recommendedSnippets>): string {
  return [
    "<!-- Paste into <head> -->",
    snippets.headTags,
    "",
    "<!-- Paste into <head> or before </body> -->",
    '<script type="application/ld+json">',
    snippets.jsonLdStarter,
    "</script>",
  ].join("\n");
}

function recommendedSnippets(url: string, title: string, description: string, canonical: string) {
  const safeTitle = escapeHtml(title || "Business Name | Service + Location");
  const safeDescription = escapeHtml(
    description || "Concise summary of what you offer, where you operate, and who you serve.",
  );
  const safeCanonical = escapeHtml(canonical || url);

  const jsonLdStarter = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: safeTitle,
      url: safeCanonical,
      description: safeDescription,
    },
    null,
    2,
  );

  const headTags = [
    `<title>${safeTitle}</title>`,
    `<meta name=\"description\" content=\"${safeDescription}\" />`,
    `<meta name=\"robots\" content=\"index,follow\" />`,
    `<link rel=\"canonical\" href=\"${safeCanonical}\" />`,
  ].join("\n");

  return { headTags, jsonLdStarter };
}

function buildShareTopFixes(payload: AnalysisPayload): ShareTopFix[] {
  return payload.checks
    .filter((check) => check.status !== "pass")
    .slice(0, 7)
    .map((check) => ({
      title: check.name,
      why: check.evidence,
      how: check.fix,
      snippet: check.snippet ? check.snippet.slice(0, 350) : undefined,
    }));
}

function check(
  def: { id: string; name: string; categoryId: CategoryId; max: number; fix: string },
  status: CheckStatus,
  points: number,
  evidence: string,
  snippet?: string,
): CheckResult {
  return {
    id: def.id,
    name: def.name,
    status,
    points,
    max: def.max,
    evidence,
    fix: def.fix,
    snippet,
    categoryId: def.categoryId,
  };
}

function summarizeCategories(checks: CheckResult[]): CategoryOutput[] {
  const grouped = new Map<CategoryId, { score: number; max: number }>();

  for (const item of checks) {
    const current = grouped.get(item.categoryId) || { score: 0, max: 0 };
    current.score += item.points;
    current.max += item.max;
    grouped.set(item.categoryId, current);
  }

  return (Object.keys(CATEGORY_NAMES) as CategoryId[]).map((id) => {
    const raw = grouped.get(id) || { score: 0, max: 0 };
    const max = CATEGORY_WEIGHTS[id];
    const normalized = raw.max > 0 ? Math.round((clamp(raw.score, 0, raw.max) / raw.max) * max) : 0;
    return {
      id,
      name: CATEGORY_NAMES[id],
      score: clamp(normalized, 0, max),
      max,
    };
  });
}

function toConfidence(input: {
  fetchResult: FetchResult;
  meaningfulContent: boolean;
  metadataGaps: number;
  jsonLdErrors: number;
  hasMajorBlocker: boolean;
}): Confidence {
  if (input.fetchResult.timedOut || input.fetchResult.blockedStatus || !input.meaningfulContent || input.hasMajorBlocker) {
    return "Low";
  }

  if (input.metadataGaps > 1 || input.jsonLdErrors > 0) {
    return "Medium";
  }

  return "High";
}

function downgradeConfidence(confidence: Confidence): Confidence {
  if (confidence === "High") {
    return "Medium";
  }
  if (confidence === "Medium") {
    return "Low";
  }
  return "Low";
}

function isLikelyJsShell(_html: string, readableText: string, scriptCount: number): { flag: boolean; evidence: string } {
  const readableLen = readableText.trim().length;
  const flagged = (readableLen < 600 && scriptCount >= 10) || (readableLen < 300 && scriptCount >= 6);
  if (!flagged) {
    return { flag: false, evidence: "" };
  }
  return {
    flag: true,
    evidence: `Likely JS-rendered shell: readable text ${readableLen} chars, scripts ${scriptCount}. Server-render key content or add SSR/prerender.`,
  };
}

function toGrade(score: number): Grade {
  if (score <= 39) {
    return "Needs work";
  }
  if (score <= 69) {
    return "Fair";
  }
  if (score <= 84) {
    return "Good";
  }
  return "Great";
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Invalid URL format.");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Only http(s) URLs are allowed.");
  }

  parsed.hash = "";
  return parsed.toString();
}

async function assertSafeTarget(input: string): Promise<void> {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Private or local network targets are blocked.");
  }

  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) {
      throw new Error("Private or internal IP targets are blocked.");
    }
    return;
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => [] as Array<{ address: string }>);
  if (!addresses.length) {
    throw new Error("Hostname could not be resolved.");
  }

  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new Error("Resolved IP points to a private/internal range.");
    }
  }
}

async function fetchWithRedirectChecks(input: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchResult> {
  let current = new URL(input);
  let redirects = 0;

  while (redirects <= MAX_REDIRECTS) {
    if (!/^https?:$/i.test(current.protocol)) {
      return {
        ok: false,
        status: 400,
        finalUrl: current.toString(),
        html: "",
        timedOut: false,
        blockedStatus: false,
        redirectCount: redirects,
        error: "Redirected to an unsupported URL scheme.",
      };
    }

    await assertSafeTarget(current.toString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "AICV-AI-Visibility-Checkup/1.0",
          accept: "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timeout);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            ok: false,
            status: response.status,
            finalUrl: current.toString(),
            html: "",
            timedOut: false,
            blockedStatus: false,
            redirectCount: redirects,
            error: "Redirect response missing Location header.",
          };
        }

        redirects += 1;
        if (redirects > MAX_REDIRECTS) {
          return {
            ok: false,
            status: 508,
            finalUrl: current.toString(),
            html: "",
            timedOut: false,
            blockedStatus: false,
            redirectCount: redirects,
            error: `Too many redirects (>${MAX_REDIRECTS}).`,
          };
        }

        current = new URL(location, current);
        continue;
      }

      const html = (await response.text()).slice(0, 1_500_000);
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: current.toString(),
        html,
        timedOut: false,
        blockedStatus: response.status === 403 || response.status === 429,
        redirectCount: redirects,
      };
    } catch (error) {
      clearTimeout(timeout);
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      return {
        ok: false,
        status: timedOut ? 408 : 520,
        finalUrl: current.toString(),
        html: "",
        timedOut,
        blockedStatus: false,
        redirectCount: redirects,
        error: timedOut ? `Fetch timed out after ${Math.round(timeoutMs / 1000)} seconds.` : "Target fetch failed.",
      };
    }
  }

  return {
    ok: false,
    status: 508,
    finalUrl: input,
    html: "",
    timedOut: false,
    blockedStatus: false,
    redirectCount: redirects,
    error: "Redirect limit exceeded.",
  };
}

function consumeRateLimit(
  ip: string,
  now: number,
):
  | { allowed: true; remaining: { burstTokens: number; dailyRemaining: number } }
  | { allowed: false; retryAfterSeconds: number; remaining: { burstTokens: number; dailyRemaining: number } } {
  const state =
    rateState.get(ip) || {
      dayStartMs: now,
      dayCount: 0,
      tokens: BURST_TOKENS,
      lastRefillMs: now,
    };

  if (now - state.dayStartMs >= 24 * 60 * 60 * 1000) {
    state.dayStartMs = now;
    state.dayCount = 0;
  }

  const elapsed = Math.max(0, now - state.lastRefillMs);
  const refill = (elapsed / BURST_WINDOW_MS) * BURST_TOKENS;
  state.tokens = Math.min(BURST_TOKENS, state.tokens + refill);
  state.lastRefillMs = now;

  if (state.dayCount >= DAILY_LIMIT) {
    rateState.set(ip, state);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((state.dayStartMs + 24 * 60 * 60 * 1000 - now) / 1000)),
      remaining: {
        burstTokens: round2(state.tokens),
        dailyRemaining: 0,
      },
    };
  }

  if (state.tokens < 1) {
    rateState.set(ip, state);
    const secondsPerToken = BURST_WINDOW_MS / BURST_TOKENS / 1000;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - state.tokens) * secondsPerToken)),
      remaining: {
        burstTokens: round2(state.tokens),
        dailyRemaining: Math.max(0, DAILY_LIMIT - state.dayCount),
      },
    };
  }

  state.tokens -= 1;
  state.dayCount += 1;
  rateState.set(ip, state);

  return {
    allowed: true,
    remaining: {
      burstTokens: round2(state.tokens),
      dailyRemaining: Math.max(0, DAILY_LIMIT - state.dayCount),
    },
  };
}

function maybeDebug(
  cacheHit: boolean,
  remaining: { burstTokens: number; dailyRemaining: number },
): DebugInfo | undefined {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
  if (!env?.DEV) {
    return undefined;
  }
  return { cacheHit, remainingRateLimit: remaining };
}

function extractFirst(html: string, regex: RegExp): string {
  const match = html.match(regex);
  if (!match || !match[1]) {
    return "";
  }
  return decodeEntities(stripTags(match[1]).replace(/\s+/g, " ").trim());
}

function findMetaTag(html: string, name: string): string {
  const esc = escapeRegex(name);
  const forward = new RegExp(`<meta[^>]+name=["']${esc}["'][^>]*content=["']([\\s\\S]*?)["'][^>]*>`, "i");
  const reverse = new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]*name=["']${esc}["'][^>]*>`, "i");
  const match = html.match(forward) || html.match(reverse);
  return match?.[1] ? decodeEntities(match[1].trim()) : "";
}

function findCanonical(html: string): string {
  const forward = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  const reverse = html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  return forward?.[1]?.trim() || reverse?.[1]?.trim() || "";
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function resolveCanonicalUrl(canonical: string, fallbackBase: string): URL | null {
  if (!canonical) {
    return null;
  }
  try {
    return new URL(canonical, fallbackBase);
  } catch {
    return null;
  }
}

function extractBodyText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const body = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || cleaned;
  return decodeEntities(stripTags(body).replace(/\s+/g, " ").trim());
}

function inspectJsonLd(html: string): { total: number; parseErrors: number; types: string[]; validScripts: string[] } {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => (match[1] || "").trim())
    .filter(Boolean);

  let parseErrors = 0;
  const types = new Set<string>();
  const validScripts: string[] = [];

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script) as unknown;
      validScripts.push(script);
      collectSchemaTypes(parsed, types);
    } catch {
      parseErrors += 1;
    }
  }

  return { total: scripts.length, parseErrors, types: [...types], validScripts };
}

function collectSchemaTypes(value: unknown, types: Set<string>): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSchemaTypes(item, types);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const rawType = record["@type"];
  if (typeof rawType === "string") {
    types.add(rawType);
  } else if (Array.isArray(rawType)) {
    for (const entry of rawType) {
      if (typeof entry === "string") {
        types.add(entry);
      }
    }
  }

  for (const item of Object.values(record)) {
    collectSchemaTypes(item, types);
  }
}

function hasAboutContactLinks(html: string, baseUrl: string): boolean {
  const base = new URL(baseUrl);
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]);

  for (const link of links) {
    try {
      const resolved = new URL(link, base);
      if (resolved.hostname !== base.hostname) {
        continue;
      }
      const path = `${resolved.pathname}${resolved.search}`.toLowerCase();
      if (path.includes("/about") || path.includes("/contact")) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map((part) => Number.parseInt(part, 10));
    if (a === 127 || a === 10 || a === 0) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    return false;
  }

  if (isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::") {
      return true;
    }
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
      return true;
    }
    if (normalized.startsWith("fe80:")) {
      return true;
    }
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.replace("::ffff:", "");
      return isPrivateAddress(mapped);
    }
    return false;
  }

  return true;
}

function getForwardedIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

function countMatches(value: string, regex: RegExp): number {
  return [...value.matchAll(regex)].length;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function unique(value: string, index: number, source: string[]): boolean {
  return source.indexOf(value) === index;
}

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(headers || {}),
    },
  });
}
