// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  redirects: {
    '/signals': '/briefs',
    '/blog': '/briefs',
    '/AIO': '/tools/aio',
  },
});
