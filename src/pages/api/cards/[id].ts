import { prisma } from '../../../lib/db';
import { getUser } from '../../../lib/auth';
import { json, error, handle } from '../../../lib/http';

export const prerender = false;

const COLORS = ['violet', 'rose', 'amber', 'emerald', 'sky', 'fuchsia', 'lime', 'orange', 'cyan', 'indigo'];
const FONTS = ['Arima', 'Arimo', 'Caveat', 'Dancing Script', 'DM Sans', 'Indie Flower', 'Merienda', 'Playwrite AU VIC Guides', 'Playwrite GB J', 'Poppins', 'Source Serif 4'];

async function ownCard(userId: string, id: string) {
  const card = await prisma.card.findUnique({ where: { id }, include: { board: true } });
  if (!card || card.board.userId !== userId) return null;
  return card;
}

// Update card fields (title, content, color, code flags, pin, favorite).
export const PATCH = handle(async ({ params, request, cookies }) => {
  const user = await getUser(cookies);
  if (!user) return error('Not authenticated.', 401);
  const id = params.id!;
  if (!(await ownCard(user.id, id))) return error('Card not found.', 404);

  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const data: Record<string, unknown> = {};
  if (typeof body.title === 'string') data.title = body.title.trim() || 'Untitled';
  if (typeof body.content === 'string') data.content = body.content;
  if (typeof body.color === 'string' && COLORS.includes(body.color)) data.color = body.color;
  if (typeof body.isCode === 'boolean') data.isCode = body.isCode;
  if (typeof body.language === 'string') data.language = body.language;
  if (typeof body.font === 'string' && FONTS.includes(body.font)) data.font = body.font;
  if (typeof body.pinned === 'boolean') data.pinned = body.pinned;
  if (typeof body.favorite === 'boolean') data.favorite = body.favorite;

  if (Object.keys(data).length === 0) return error('Nothing to update.');

  const card = await prisma.card.update({ where: { id }, data });
  return json({ card });
});

// Delete a card.
export const DELETE = handle(async ({ params, cookies }) => {
  const user = await getUser(cookies);
  if (!user) return error('Not authenticated.', 401);
  const id = params.id!;
  if (!(await ownCard(user.id, id))) return error('Card not found.', 404);

  await prisma.card.delete({ where: { id } });
  return json({ ok: true });
});
