import { defineCollection, z } from "astro:content";

const signals = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    timestamp: z.string().optional(),
    city: z.string().optional(),
    sector: z.string().optional(),
    sources: z.array(z.string()).optional(),
    summary: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  }),
});

export const collections = { signals };
