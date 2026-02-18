import type { APIRoute } from "astro";
import { getShareRecord } from "../../utils/aioShareStore";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const sid = (url.searchParams.get("sid") || "").trim();
  if (!sid || !/^[a-zA-Z0-9_-]{6,40}$/.test(sid)) {
    return json({ message: "Invalid share id." }, 400);
  }

  const payload = await getShareRecord(sid);
  if (!payload) {
    return json({ message: "Share not found or expired." }, 404);
  }

  return json(payload, 200, { "Cache-Control": "public, max-age=120" });
};

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(headers || {}),
    },
  });
}
