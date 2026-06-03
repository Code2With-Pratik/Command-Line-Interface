import { prisma } from '../../../lib/db';
import { hashPassword, createSession, setSessionCookie } from '../../../lib/auth';
import { json, error, handle } from '../../../lib/http';

export const prerender = false;

export const POST = handle(async ({ request, cookies }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body.');
  }

  const username = String(body?.username ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');

  if (!username || username.length < 2) return error('Please enter a name (2+ characters).');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error('Please enter a valid email.');
  if (password.length < 6) return error('Password must be at least 6 characters.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return error('An account with that email already exists.', 409);

  const user = await prisma.user.create({
    data: { username, email, passwordHash: hashPassword(password) },
  });

  // Seed a friendly first board so the app isn't empty.
  await prisma.board.create({ data: { name: 'My First Board', userId: user.id, position: 0 } });

  const token = await createSession(user.id);
  setSessionCookie(cookies, token);

  return json({ user: { id: user.id, email: user.email, username: user.username } }, 201);
});
