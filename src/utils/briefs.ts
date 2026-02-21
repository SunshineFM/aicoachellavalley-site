import { CITIES } from "../data/cities";

export const normalizeMeta = (value?: string) =>
  (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const resolveSummary = (entry: {
  data: { summary?: string; description?: string };
  body?: string;
}) => {
  const summary = entry.data.summary || entry.data.description;
  if (summary && summary.trim().length > 0) return summary.trim();

  const excerpt = (entry.body ?? "")
    .replace(/[#>*_`[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (excerpt.length > 0) return excerpt.length > 160 ? `${excerpt.slice(0, 157)}...` : excerpt;

  return "No summary available.";
};

export const CITY_ENTRIES = CITIES.map(({ name, slug }) => ({ name, slug }));

export const labelFromSlug = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
