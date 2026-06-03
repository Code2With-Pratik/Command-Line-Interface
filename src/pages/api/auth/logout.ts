import { clearSession } from '../../../lib/auth';
import { json, handle } from '../../../lib/http';

export const prerender = false;

export const POST = handle(async ({ cookies }) => {
  await clearSession(cookies);
  return json({ ok: true });
});
