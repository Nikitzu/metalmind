import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://metalmind.mzyx.dev',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
});
