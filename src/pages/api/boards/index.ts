import { prisma } from '../../../lib/db';
import { getUser } from '../../../lib/auth';
import { json, error, handle } from '../../../lib/http';

export const prerender = false;

// Create a new board (tab).
export const POST = handle(async ({ request, cookies }) => {
  const user = await getUser(cookies);
  if (!user) return error('Not authenticated.', 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const name = String(body?.name ?? 'New Board').trim() || 'New Board';

  const count = await prisma.board.count({ where: { userId: user.id } });
  const board = await prisma.board.create({
    data: { name, userId: user.id, position: count },
  });

  return json({ board: { ...board, cards: [] } }, 201);
});
