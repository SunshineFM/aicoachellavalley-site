import type { APIRoute } from "astro";
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const prerender = false;

type SubmissionInput = {
  title?: unknown;
  summary?: unknown;
  sourceUrl?: unknown;
  city?: unknown;
  sector?: unknown;
  date?: unknown;
  submitterName?: unknown;
  submitterEmail?: unknown;
  notes?: unknown;
  company?: unknown;
};

type RateState = {
  dayStartMs: number;
  dayCount: number;
  tokens: number;
  lastRefillMs: number;
};

type SubmissionRecord = {
  title: string;
  summary: string;
  sourceUrl: string;
  city: string;
  sector: string;
  date: string;
  submitterName: string;
  submitterEmail: string;
  notes: string;
  submittedAt: string;
  ipHash: string;
  userAgent: string;
};

const BURST_TOKENS = 2;
const BURST_WINDOW_MS = 60_000;
const DAILY_LIMIT = 10;
const MAX_LINKS_IN_SUMMARY = 3;
const MAX_REQUEST_BODY_BYTES = 12 * 1024;

const rateState = new Map<string, RateState>();
const memoryQueue: SubmissionRecord[] = [];

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const now = Date.now();
  const ip = clientAddress || getForwardedIp(request) || "unknown";
  const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 16);

  const contentLengthHeader = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLengthHeader) && contentLengthHeader > MAX_REQUEST_BODY_BYTES) {
    devLog("reject_body_too_large", { ipHash, contentLengthHeader });
    return json({ message: "Request body too large." }, 413);
  }

  const rate = consumeRateLimit(ip, now);
  if (!rate.allowed) {
    devLog("reject_rate_limit", { ipHash, retryAfterSeconds: rate.retryAfterSeconds });
    return json(
      {
        message: "Too many submissions from this IP. Please try again shortly.",
        retryAfterSeconds: rate.retryAfterSeconds,
      },
      429,
      {
        "Retry-After": String(rate.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    );
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return json({ message: "Invalid request body." }, 400);
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BODY_BYTES) {
    devLog("reject_body_too_large", { ipHash, bodyBytes: Buffer.byteLength(rawBody, "utf8") });
    return json({ message: "Request body too large." }, 413);
  }

  let body: SubmissionInput;
  try {
    body = JSON.parse(rawBody) as SubmissionInput;
  } catch {
    return json({ message: "Invalid JSON body." }, 400);
  }

  const title = asTrimmed(body.title);
  const summary = asTrimmed(body.summary);
  const sourceUrlInput = asTrimmed(body.sourceUrl);
  const city = asTrimmed(body.city);
  const sector = asTrimmed(body.sector);
  const date = asTrimmed(body.date);
  const submitterName = asTrimmed(body.submitterName);
  const submitterEmail = asTrimmed(body.submitterEmail);
  const notes = asTrimmed(body.notes);
  const company = asTrimmed(body.company);

  if (company) {
    devLog("reject_honeypot", { ipHash });
    return json({ message: "Submission rejected." }, 400);
  }

  if (title.length < 10 || title.length > 140) {
    return json({ message: "Title must be between 10 and 140 characters." }, 400);
  }

  if (summary.length < 30 || summary.length > 600) {
    return json({ message: "Summary must be between 30 and 600 characters." }, 400);
  }

  if (countLinks(summary) > MAX_LINKS_IN_SUMMARY) {
    devLog("reject_summary_links", { ipHash, links: countLinks(summary) });
    return json({ message: "Summary contains too many links. Please keep it to 3 or fewer." }, 400);
  }

  if (!isValidOptionalDate(date)) {
    return json({ message: "Date must use YYYY-MM-DD format." }, 400);
  }

  if (submitterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitterEmail)) {
    return json({ message: "Submitter email format is invalid." }, 400);
  }

  let sourceUrl: string;
  try {
    sourceUrl = normalizeHttpUrl(sourceUrlInput);
    await assertSafeTarget(sourceUrl);
  } catch (error) {
    devLog("reject_source_url", { ipHash, reason: error instanceof Error ? error.message : "unknown" });
    return json({ message: error instanceof Error ? error.message : "Source URL validation failed." }, 400);
  }

  const submission: SubmissionRecord = {
    title,
    summary,
    sourceUrl,
    city,
    sector,
    date,
    submitterName,
    submitterEmail,
    notes,
    submittedAt: new Date(now).toISOString(),
    ipHash,
    userAgent: request.headers.get("user-agent") || "unknown",
  };

  const githubToken = import.meta.env.GITHUB_TOKEN;
  const repoOwner = import.meta.env.GITHUB_REPO_OWNER || "SunshineFM";
  const repoName = import.meta.env.GITHUB_REPO_NAME || "aicoachellavalley-site";

  if (!githubToken) {
    memoryQueue.push(submission);
    devLog("queued_memory_missing_token", { ipHash, titleLen: title.length });
    return json(
      {
        ok: true,
        message: "Thanks — queued for review.",
        storage: "memory",
        warning: "GITHUB_TOKEN is missing; this submission is only stored in memory for this runtime.",
      },
      200,
    );
  }

  try {
    const issue = await createGithubIssue({
      token: githubToken,
      owner: repoOwner,
      repo: repoName,
      submission,
    });

    return json(
      {
        ok: true,
        message: "Thanks — queued for review.",
        storage: "github",
        issueUrl: issue.html_url,
      },
      200,
    );
  } catch (error) {
    memoryQueue.push(submission);
    devLog("queued_memory_github_error", { ipHash, error: error instanceof Error ? error.message : "unknown" });
    return json(
      {
        ok: true,
        message: "Thanks — queued for review.",
        storage: "memory",
        warning: `GitHub issue creation failed; submission kept in memory queue. ${error instanceof Error ? error.message : ""}`.trim(),
      },
      200,
    );
  }
};

async function createGithubIssue(input: {
  token: string;
  owner: string;
  repo: string;
  submission: SubmissionRecord;
}): Promise<{ html_url: string }> {
  const issueTitle = `Brief Submission: ${input.submission.title}`;
  const templateDate = input.submission.date || "YYYY-MM-DD";
  const escapedNotes = input.submission.notes.replace(/\n+/g, " ").trim();
  const draftBodyLines = [
    input.submission.summary.trim(),
    "",
    `Source: ${input.submission.sourceUrl}`,
    escapedNotes ? "" : undefined,
    escapedNotes ? `Submitted notes: ${escapedNotes}` : undefined,
  ].filter(Boolean) as string[];

  const issueBody = [
    "<!-- brief-submission-v1 -->",
    "Title: " + input.submission.title,
    "Summary: " + input.submission.summary,
    "Source URL: " + input.submission.sourceUrl,
    "City: " + (input.submission.city || ""),
    "Sector: " + (input.submission.sector || ""),
    "Date: " + (input.submission.date || ""),
    "Submitter: " + (input.submission.submitterName || ""),
    "Email: " + (input.submission.submitterEmail || ""),
    "Notes: " + (input.submission.notes || ""),
    "",
    "Timestamp: " + input.submission.submittedAt,
    "IP Hash: " + input.submission.ipHash,
    "User Agent: " + input.submission.userAgent,
    "",
    "Ready-to-paste signal draft:",
    "```md",
    "---",
    `title: ${yamlQuote(input.submission.title)}`,
    `date: ${templateDate}`,
    input.submission.city ? `city: ${yamlQuote(input.submission.city)}` : undefined,
    input.submission.sector ? `sector: ${yamlQuote(input.submission.sector)}` : undefined,
    "signal_type: adoption",
    "confidence: medium",
    "sources:",
    `  - ${input.submission.sourceUrl}`,
    `summary: ${yamlQuote(truncate(input.submission.summary, 260))}`,
    "---",
    "",
    ...draftBodyLines,
    "```",
  ].join("\n");

  const response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "AICV-Submit-Brief/1.0",
    },
    body: JSON.stringify({
      title: issueTitle.slice(0, 220),
      body: issueBody,
      labels: ["brief-submission", "needs-review"],
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }

  return (await response.json()) as { html_url: string };
}

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function countLinks(value: string): number {
  return (value.match(/https?:\/\/[^\s)]+/gi) || []).length;
}

function isValidOptionalDate(value: string): boolean {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeHttpUrl(input: string): string {
  if (!input) {
    throw new Error("Source URL is required.");
  }
  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input) ? input : `https://${input}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Source URL must be a valid URL.");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Source URL must start with http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Source URL must not include credentials.");
  }
  if (!parsed.hostname) {
    throw new Error("Source URL hostname is required.");
  }
  return parsed.toString();
}

async function assertSafeTarget(input: string): Promise<void> {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local and private network targets are blocked.");
  }

  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) {
      throw new Error("Private/internal IP targets are blocked.");
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

function consumeRateLimit(
  ip: string,
  now: number,
):
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number } {
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
    };
  }

  if (state.tokens < 1) {
    rateState.set(ip, state);
    const secondsPerToken = BURST_WINDOW_MS / BURST_TOKENS / 1000;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - state.tokens) * secondsPerToken)),
    };
  }

  state.tokens -= 1;
  state.dayCount += 1;
  rateState.set(ip, state);
  return { allowed: true };
}

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(".")) {
    const parts = ip.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.replace("::ffff:", "");
    if (mapped.includes(".")) {
      return isPrivateAddress(mapped);
    }
  }
  return false;
}

function getForwardedIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  return real?.trim() || null;
}

function json(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 1) return "…";
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function devLog(event: string, details: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }
  console.info("[submit-brief]", event, details);
}
