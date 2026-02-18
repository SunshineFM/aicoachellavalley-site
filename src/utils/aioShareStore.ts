import { randomUUID } from "node:crypto";

export type ShareTopFix = {
  title: string;
  why: string;
  how: string;
  snippet?: string;
};

export type PublicSharePayload = {
  url: string;
  fetchedAt: string;
  rubricVersion: string;
  score: number;
  grade: string;
  confidence: string;
  categories: Array<{ id: string; name: string; score: number; max: number }>;
  topFixes: ShareTopFix[];
};

type MemoryEntry = {
  expiresAt: number;
  payload: PublicSharePayload;
};

const memoryStore = new Map<string, MemoryEntry>();

function envConfig() {
  const env = (import.meta as ImportMeta & {
    env?: {
      KV_REST_API_URL?: string;
      KV_REST_API_TOKEN?: string;
      UPSTASH_REDIS_REST_URL?: string;
      UPSTASH_REDIS_REST_TOKEN?: string;
    };
  }).env;

  const url = env?.KV_REST_API_URL || env?.UPSTASH_REDIS_REST_URL;
  const token = env?.KV_REST_API_TOKEN || env?.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ""),
    token,
  };
}

async function redisCommand(args: string[]): Promise<unknown> {
  const config = envConfig();
  if (!config) {
    throw new Error("KV config missing");
  }

  const encoded = args.map((arg) => encodeURIComponent(arg)).join("/");
  const res = await fetch(`${config.url}/${encoded}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`KV command failed with ${res.status}`);
  }

  const data = (await res.json()) as { result?: unknown };
  return data.result;
}

function sanitizeSharePayload(payload: PublicSharePayload): PublicSharePayload {
  return {
    url: payload.url,
    fetchedAt: payload.fetchedAt,
    rubricVersion: payload.rubricVersion,
    score: payload.score,
    grade: payload.grade,
    confidence: payload.confidence,
    categories: payload.categories.slice(0, 4).map((category) => ({
      id: category.id,
      name: category.name,
      score: category.score,
      max: category.max,
    })),
    topFixes: payload.topFixes.slice(0, 7).map((fix) => ({
      title: fix.title.slice(0, 140),
      why: fix.why.slice(0, 300),
      how: fix.how.slice(0, 300),
      ...(fix.snippet ? { snippet: fix.snippet.slice(0, 400) } : {}),
    })),
  };
}

export async function createShareRecord(
  rawPayload: PublicSharePayload,
  ttlSeconds: number,
): Promise<{ id: string; payload: PublicSharePayload; persistent: boolean }> {
  const payload = sanitizeSharePayload(rawPayload);
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  const key = `aio:${id}`;

  try {
    await redisCommand(["SET", key, JSON.stringify(payload), "EX", String(ttlSeconds)]);
    return { id, payload, persistent: true };
  } catch {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    memoryStore.set(key, { payload, expiresAt });
    return { id, payload, persistent: false };
  }
}

export async function getShareRecord(id: string): Promise<PublicSharePayload | null> {
  const key = `aio:${id}`;

  try {
    const raw = await redisCommand(["GET", key]);
    if (typeof raw === "string" && raw.length > 0) {
      return sanitizeSharePayload(JSON.parse(raw) as PublicSharePayload);
    }
  } catch {
    // no-op: fall back to memory store
  }

  const memory = memoryStore.get(key);
  if (!memory) {
    return null;
  }

  if (memory.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }

  return memory.payload;
}
