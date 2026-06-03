import { prisma } from '../../../lib/db';
import { hashPassword } from '../../../lib/auth';
import { json, error, handle } from '../../../lib/http';

export const prerender = false;

// Simple password reset: set a new password for an existing account.
// (No email verification — suitable for this app's scope.)
export const POST = handle(async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body.');
  }

  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error('Please enter a valid email.');
  if (password.length < 6) return error('Password must be at least 6 characters.');

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return error('No account found with that email.', 404);

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password) } });
  return json({ ok: true });
});
