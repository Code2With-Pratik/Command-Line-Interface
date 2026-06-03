import { prisma } from '../../lib/db';
import { getUser } from '../../lib/auth';
import { json, error, handle } from '../../lib/http';

export const prerender = false;

// Returns the full workspace (boards + cards) for the logged-in user.
export const GET = handle(async ({ cookies }) => {
  const user = await getUser(cookies);
  if (!user) return error('Not authenticated.', 401);

  const boards = await prisma.board.findMany({
    where: { userId: user.id },
    orderBy: { position: 'asc' },
    include: {
      cards: {
        orderBy: [{ pinned: 'desc' }, { position: 'asc' }],
      },
    },
  });

  return json({ user, boards });
});
