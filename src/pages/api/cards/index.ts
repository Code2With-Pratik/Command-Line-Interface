import { prisma } from '../../../lib/db';
import { getUser } from '../../../lib/auth';
import { json, error, handle } from '../../../lib/http';

export const prerender = false;

const COLORS = ['violet', 'rose', 'amber', 'emerald', 'sky', 'fuchsia', 'lime', 'orange', 'cyan', 'indigo'];

// Create a new card inside a board.
export const POST = handle(async ({ request, cookies }) => {
  const user = await getUser(cookies);
  if (!user) return error('Not authenticated.', 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const boardId = String(body?.boardId ?? '');
  const title = String(body?.title ?? 'Untitled').trim() || 'Untitled';

  const board = await prisma.board.findUnique({ where: { id: boardId } });
  if (!board || board.userId !== user.id) return error('Board not found.', 404);

  const count = await prisma.card.count({ where: { boardId } });
  const color = body?.color && COLORS.includes(body.color)
    ? body.color
    : COLORS[count % COLORS.length];

  const card = await prisma.card.create({
    data: { title, boardId, color, position: count },
  });

  return json({ card }, 201);
});
