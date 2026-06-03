import { prisma } from '../../../lib/db';
import { verifyPassword, createSession, setSessionCookie } from '../../../lib/auth';
import { json, error, handle } from '../../../lib/http';

export const prerender = false;

export const POST = handle(async ({ request, cookies }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body.');
  }

  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');

  if (!email || !password) return error('Email and password are required.');

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return error('Incorrect email or password.', 401);
  }

  const token = await createSession(user.id);
  setSessionCookie(cookies, token);

  return json({ user: { id: user.id, email: user.email, username: user.username } });
});
