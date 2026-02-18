import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { normalizeMeta, resolveSummary } from "../utils/briefs";

const MAX_ITEMS = 100;

export const GET: APIRoute = async () => {
  const briefs = (await getCollection("signals"))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
    .slice(0, MAX_ITEMS);

  const items = briefs.map((brief) => {
    const cityRaw = brief.data.city?.trim();
    const citySlug = normalizeMeta(cityRaw);
    const sectorRaw = brief.data.sector?.trim();
    const sectorSlug = normalizeMeta(sectorRaw);
    const updatedAtRaw = (brief.data as { updatedAt?: string | Date }).updatedAt;
    const updatedAt =
      updatedAtRaw instanceof Date
        ? updatedAtRaw.toISOString()
        : typeof updatedAtRaw === "string" && updatedAtRaw.length > 0
          ? updatedAtRaw
          : undefined;

    return {
      title: brief.data.title,
      date: brief.data.date.toISOString(),
      summary: resolveSummary(brief),
      city: cityRaw
        ? {
            raw: cityRaw,
            slug: citySlug || undefined,
          }
        : null,
      sector: sectorRaw
        ? {
            raw: sectorRaw,
            slug: sectorSlug || undefined,
          }
        : null,
      url: `/briefs/${brief.slug}`,
      ...(updatedAt ? { updatedAt } : {}),
    };
  });

  return new Response(JSON.stringify(items, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
