// @ts-check
import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel/serverless";

export default defineConfig({
  output: "server",
  adapter: vercel(),
  redirects: {
    "/signals": "/briefs",
    "/blog": "/briefs",
    "/AIO": "/tools/aio",
  },
});
