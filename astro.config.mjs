// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

// On Vercel we must emit serverless functions (@astrojs/vercel).
// Locally (`npm run dev` / `npm start`) we use the standalone Node server.
const onVercel = !!process.env.VERCEL;

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: onVercel ? vercel() : node({ mode: 'standalone' }),
  vite: {
    plugins: [tailwindcss()],
    // Keep Prisma + the pg driver adapter external in the SSR bundle.
    ssr: { external: ['@prisma/client', '.prisma/client', '@prisma/adapter-pg', 'pg'] },
  },
});
