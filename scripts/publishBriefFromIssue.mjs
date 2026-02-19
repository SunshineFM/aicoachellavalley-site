import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const issueNumber = process.env.ISSUE_NUMBER || "";
const issueBodyB64 = process.env.ISSUE_BODY_B64 || "";
const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
const outputFile = process.env.GITHUB_OUTPUT;

const issueBody = issueBodyB64 ? Buffer.from(issueBodyB64, "base64").toString("utf8") : "";

const fields = {
  title: readField(issueBody, "Title"),
  summary: readField(issueBody, "Summary"),
  sourceUrl: readField(issueBody, "Source URL"),
  city: readField(issueBody, "City"),
  sector: readField(issueBody, "Sector"),
  date: readField(issueBody, "Date"),
  submitter: readField(issueBody, "Submitter"),
  email: readField(issueBody, "Email"),
  notes: readField(issueBody, "Notes"),
};

const missing = [];
if (!fields.title) missing.push("Title");
if (!fields.summary) missing.push("Summary");
if (!fields.sourceUrl) missing.push("Source URL");
if (!fields.date) missing.push("Date");

if (fields.sourceUrl && !/^https?:\/\//i.test(fields.sourceUrl)) {
  missing.push("Source URL (must be http/https)");
}

if (fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) {
  missing.push("Date (must be YYYY-MM-DD)");
}

if (missing.length > 0) {
  setOutputs({
    publish_ready: "false",
    missing_message: `Cannot publish this submission yet. Missing/invalid fields: ${missing.join(", ")}.`,
  });
  process.exit(0);
}

const slugBase = slugify(fields.title, 80) || `brief-${issueNumber || "issue"}`;
const filename = `${fields.date}-${slugBase}.md`;
const relPath = `src/content/signals/${filename}`;
const absPath = join(repoRoot, relPath);

const lines = [];
lines.push("---");
lines.push(`title: ${yamlQuote(fields.title)}`);
lines.push(`date: ${fields.date}`);
if (fields.city) lines.push(`city: ${yamlQuote(fields.city)}`);
if (fields.sector) lines.push(`sector: ${yamlQuote(fields.sector)}`);
lines.push("signal_type: adoption");
lines.push("confidence: medium");
lines.push("sources:");
lines.push(`  - ${fields.sourceUrl}`);
lines.push(`summary: ${yamlQuote(truncate(fields.summary, 260))}`);
lines.push("---");
lines.push("");
lines.push(fields.summary.trim());
lines.push("");
lines.push(
  `This submission was reviewed from community input${fields.city ? ` in ${fields.city}` : ""}${fields.sector ? ` for the ${fields.sector} sector` : ""}.`,
);
lines.push("");
lines.push(`Source: ${fields.sourceUrl}`);
if (fields.notes) {
  lines.push("");
  lines.push(`Submitted notes: ${fields.notes}`);
}
if (fields.submitter || fields.email) {
  lines.push("");
  lines.push(
    `Submission contact: ${fields.submitter || "Unknown"}${fields.email ? ` (${fields.email})` : ""}.`,
  );
}
lines.push("");

mkdirSync(dirname(absPath), { recursive: true });
writeFileSync(absPath, lines.join("\n"), "utf8");

setOutputs({
  publish_ready: "true",
  file_path: relPath,
  slug: slugBase,
  brief_title: fields.title,
  source_url: fields.sourceUrl,
  brief_date: fields.date,
});

function readField(body, label) {
  const regex = new RegExp(`^${escapeRegex(label)}:\\s*(.*)$`, "mi");
  const match = body.match(regex);
  return (match?.[1] || "").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(value, maxLen) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return cleaned.slice(0, maxLen).replace(/-+$/g, "");
}

function truncate(value, max) {
  if (value.length <= max) return value;
  if (max <= 1) return "…";
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function setOutputs(values) {
  if (!outputFile) {
    return;
  }
  const lines = Object.entries(values).map(([key, val]) => `${key}=${String(val)}`);
  writeFileSync(outputFile, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}
