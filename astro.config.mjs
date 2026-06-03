// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    plugins: [tailwindcss()],
    // Keep Prisma + the pg driver adapter external in the SSR bundle.
    ssr: { external: ['@prisma/client', '.prisma/client', '@prisma/adapter-pg', 'pg'] },
  },
});
