export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

import type { APIRoute } from 'astro';

/** Wrap an API handler so thrown errors become clean JSON instead of HTML 500s. */
export function handle(fn: APIRoute): APIRoute {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (e: any) {
      const name = e?.constructor?.name ?? '';
      if (name.startsWith('PrismaClientInitialization') || /database|connect|ECONNREFUSED|ENOTFOUND/i.test(e?.message ?? '')) {
        return error(
          'Database unavailable. Set a valid Neon DATABASE_URL in .env and run `npm run db:push`.',
          503
        );
      }
      console.error('[api error]', e);
      return error(import.meta.env.DEV ? e?.message ?? 'Server error' : 'Server error', 500);
    }
  };
}
