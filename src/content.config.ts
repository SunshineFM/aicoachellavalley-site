import { defineCollection, z } from "astro:content";

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
    sources: z.array(z.string().url()).optional(),
    tags: z.array(z.string()).optional(),
    summary: z.string(),
  }),
});

export const collections = { signals };
