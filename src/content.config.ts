import { defineCollection, z } from "astro:content";

const sourceEntry = z.union([
  z.string().url(),
  z.object({
    url: z.string().url(),
    type: z.string().optional(),
    label: z.string().optional(),
    notes: z.string().optional(),
  }),
]);

const signals = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.date(),
    time: z.string().optional(),
    city: z.string().optional(),
    sector: z.string().optional(),
    signal_type: z.enum([
      "adoption",
      "infrastructure",
      "policy",
      "workforce",
      "investment",
      "research",
    ]),
    confidence: z.enum(["low", "medium", "high"]),
    sources: z.array(sourceEntry).optional(),
    tags: z.array(z.string()).optional(),
    summary: z.string(),
    dateUnknown: z.boolean().optional(),
    evidence: z
      .object({
        timestampOrPage: z.string().nullable().optional(),
        snippet: z.string().optional(),
      })
      .optional(),
    research: z
      .object({
        year: z.number(),
        citySlug: z.string(),
        lastScanDate: z.string(),
      })
      .optional(),
  }),
});

export const collections = { signals };
