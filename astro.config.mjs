// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  site: 'https://vulntrends.github.io',
  base: '/vulntrends/',
  integrations: [svelte()],
  vite: {
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  },
});
