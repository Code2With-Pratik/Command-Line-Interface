import { prisma } from '../../../lib/db';
import { getUser } from '../../../lib/auth';
import { json, error, handle } from '../../../lib/http';

export const prerender = false;

async function ownBoard(userId: string, id: string) {
  const board = await prisma.board.findUnique({ where: { id } });
  if (!board || board.userId !== userId) return null;
  return board;
}

// Rename a board.
export const PATCH = handle(async ({ params, request, cookies }) => {
  const user = await getUser(cookies);
  if (!user) return error('Not authenticated.', 401);
  const id = params.id!;
  if (!(await ownBoard(user.id, id))) return error('Board not found.', 404);

  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const name = String(body?.name ?? '').trim();
  if (!name) return error('Board name cannot be empty.');

  const board = await prisma.board.update({ where: { id }, data: { name } });
  return json({ board });
});

// Delete a board (and its cards via cascade).
export const DELETE = handle(async ({ params, cookies }) => {
  const user = await getUser(cookies);
  if (!user) return error('Not authenticated.', 401);
  const id = params.id!;
  if (!(await ownBoard(user.id, id))) return error('Board not found.', 404);

  await prisma.board.delete({ where: { id } });
  return json({ ok: true });
});
