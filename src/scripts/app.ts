import { highlight, looksLikeCode, detectLanguage, LANGUAGES, type Language } from '../lib/highlight';
import { downloadImage, downloadPdf } from '../lib/export';

/* ============================== types ============================== */
interface Card {
  id: string;
  title: string;
  content: string;
  color: string;
  isCode: boolean;
  language: Language;
  font: string;
  pinned: boolean;
  favorite: boolean;
  position: number;
  boardId: string;
}
interface Board {
  id: string;
  name: string;
  position: number;
  cards: Card[];
}
interface User { id: string; email: string; username: string; }

/* ============================ color palette ========================= */
const PALETTE: Record<string, { hex: string }> = {
  violet: { hex: '#7c5cff' }, rose: { hex: '#f43f5e' }, amber: { hex: '#f59e0b' },
  emerald: { hex: '#10b981' }, sky: { hex: '#0ea5e9' }, fuchsia: { hex: '#d946ef' },
  lime: { hex: '#84cc16' }, orange: { hex: '#f97316' }, cyan: { hex: '#06b6d4' },
  indigo: { hex: '#6366f1' },
};
const COLOR_NAMES = Object.keys(PALETTE);
const hex = (c: string) => PALETTE[c]?.hex ?? PALETTE.violet.hex;

// Per-card fonts (alphabetical). Values are real Google font-family names.
const FONTS = [
  'Arima', 'Arimo', 'Caveat', 'Dancing Script', 'DM Sans', 'Indie Flower',
  'Merienda', 'Playwrite AU VIC Guides', 'Playwrite GB J', 'Poppins', 'Source Serif 4',
];
const fontOf = (c: Card) => (FONTS.includes(c.font) ? c.font : 'DM Sans');

/* ============================== state ============================== */
const state = {
  user: (window as any).__CLIDESK_USER__ as User,
  boards: [] as Board[],
  activeBoardId: null as string | null,
};

// click selection (multi-select; double-click opens the card)
const selectedCardIds = new Set<string>();
let cardClickTimer: number | undefined;

// sortable drag state (mouse): clone follows cursor; a placeholder opens a gap
let dragState: {
  ids: string[]; board: Board; tile: HTMLElement;
  sx: number; sy: number; offX: number; offY: number; started: boolean;
  ghost: HTMLElement | null; ph: HTMLElement | null; overTab: string | null;
} | null = null;
let dragSuppressClick = false;

function onCardDragMove(e: PointerEvent) {
  if (!dragState) return;
  const st = dragState;
  if (!st.started) {
    if (Math.hypot(e.clientX - st.sx, e.clientY - st.sy) < 6) return;
    const inner = gridInner();
    if (!inner) { dragState = null; return; }
    const r = st.tile.getBoundingClientRect();
    st.offX = st.sx - r.left;
    st.offY = st.sy - r.top;
    // ghost
    const ghost = st.tile.cloneNode(true) as HTMLElement;
    ghost.classList.add('card-ghost');
    ghost.classList.remove('is-selected');
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    if (st.ids.length > 1) {
      const badge = document.createElement('div');
      badge.className = 'drag-count';
      badge.textContent = String(st.ids.length);
      ghost.appendChild(badge);
    }
    document.body.appendChild(ghost);
    st.ghost = ghost;
    // placeholder where the first dragged tile was; remove the dragged tiles
    const ph = document.createElement('div');
    ph.className = 'drag-placeholder rounded-2xl';
    ph.style.height = `${r.height}px`;
    st.ph = ph;
    inner.insertBefore(ph, inner.querySelector(`.card-tile[data-card="${st.ids[0]}"]`));
    st.ids.forEach((id) => inner.querySelector(`.card-tile[data-card="${id}"]`)?.remove());
    document.body.style.cursor = 'grabbing';
    st.started = true;
  }

  st.ghost!.style.transform = `translate(${e.clientX - st.offX}px, ${e.clientY - st.offY}px) rotate(2deg) scale(1.03)`;

  const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  document.querySelectorAll('.tab-row.tab-drop').forEach((x) => x.classList.remove('tab-drop'));
  st.overTab = null;
  const tab = el?.closest('.tab-row') as HTMLElement | null;
  if (tab?.dataset.board && tab.dataset.board !== st.board.id) {
    tab.classList.add('tab-drop');
    st.overTab = tab.dataset.board;
    if (st.ph) st.ph.style.display = 'none';
    return;
  }
  if (st.ph) st.ph.style.display = '';
  const inner = gridInner();
  if (inner && el?.closest('#card-grid')) {
    const ref = dragInsertRef(inner, e.clientX, e.clientY);
    if (ref !== st.ph && ref !== st.ph!.nextElementSibling) {
      flipMove(inner, () => inner.insertBefore(st.ph!, ref));
    }
  }
}

function onCardDragUp() {
  if (!dragState) return;
  const st = dragState;
  dragState = null;
  if (!st.started) return;
  document.body.style.cursor = '';
  st.ghost?.remove();
  document.querySelectorAll('.tab-row.tab-drop').forEach((x) => x.classList.remove('tab-drop'));
  dragSuppressClick = true;
  setTimeout(() => { dragSuppressClick = false; }, 60);

  if (st.overTab) { st.ph?.remove(); moveCardsToBoard(st.ids, st.overTab); return; }

  const inner = gridInner();
  let index = 0;
  if (inner && st.ph) index = [...inner.children].indexOf(st.ph);
  st.ph?.remove();

  const board = st.board;
  const remaining = sortedCards(board).map((c) => c.id).filter((id) => !st.ids.includes(id));
  const at = Math.max(0, Math.min(remaining.length, index));
  const order = [...remaining.slice(0, at), ...st.ids, ...remaining.slice(at)];
  const changed: string[] = [];
  order.forEach((id, i) => {
    const c = board.cards.find((x) => x.id === id);
    if (c) { if (c.position !== i) changed.push(id); c.position = i; }
  });
  renderBoard();
  changed.forEach((id) => {
    const c = board.cards.find((x) => x.id === id);
    if (c) patchCard(id, { position: c.position });
  });
}

// touch devices: tap opens, long-press selects, tap-while-selecting toggles
const isTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
let lpTimer: number | undefined;
let lpFired = false;
let lpX = 0;
let lpY = 0;

/* ============================ dom helpers ========================== */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  const stack = $('toast-stack');
  const el = document.createElement('div');
  el.className =
    'glass px-4 py-2.5 rounded-xl text-base animate-rise shadow-xl ' +
    (kind === 'err' ? 'text-rose-300 border-rose-500/30' : 'text-mist-100');
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 300);
  }, 2200);
}

/* ===================== custom dialogs (prompt/confirm) ===================== */
type DialogOpts = {
  kind: 'prompt' | 'confirm';
  title: string;
  message?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmText?: string;
  danger?: boolean;
};

function openDialog(o: DialogOpts): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    closePopovers();
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4';

    const bigTrash = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>';
    const bigInfo = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>';

    if (o.kind === 'confirm') {
      // square, iOS-style alert
      const tint = o.danger ? 'rgba(244,63,94,.15)' : 'rgba(249,115,22,.15)';
      const fg = o.danger ? '#fb7185' : '#fbbf24';
      root.innerHTML = `
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade" data-cancel></div>
        <div class="dialog-panel relative w-[min(330px,90vw)] glass rounded-3xl p-7 shadow-2xl animate-pop text-center">
          <div class="mx-auto mb-4 w-14 h-14 rounded-2xl grid place-items-center" style="background:${tint};color:${fg}">${o.danger ? bigTrash : bigInfo}</div>
          <h3 class="font-heading text-2xl mb-1.5">${esc(o.title)}</h3>
          ${o.message ? `<p class="text-mist-300 text-base mb-6 leading-relaxed">${esc(o.message)}</p>` : '<div class="mb-5"></div>'}
          <div class="grid grid-cols-2 gap-2.5">
            <button class="btn btn-ghost w-full justify-center" data-cancel>Cancel</button>
            <button class="btn ${o.danger ? 'btn-danger' : 'btn-primary'} w-full justify-center" data-ok>${esc(o.confirmText || 'OK')}</button>
          </div>
        </div>`;
    } else {
      root.innerHTML = `
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade" data-cancel></div>
        <div class="dialog-panel relative w-[min(340px,92vw)] glass rounded-3xl p-7 shadow-2xl animate-pop">
          <h3 class="font-heading text-2xl mb-1.5">${esc(o.title)}</h3>
          ${o.message ? `<p class="text-mist-300 text-base mb-4 leading-relaxed">${esc(o.message)}</p>` : ''}
          ${o.label ? `<label class="label-sm block mb-1.5">${esc(o.label)}</label>` : ''}<input id="dlg-input" class="field mb-6" autocomplete="off" />
          <div class="grid grid-cols-2 gap-2.5">
            <button class="btn btn-ghost w-full justify-center" data-cancel>Cancel</button>
            <button class="btn btn-primary w-full justify-center" data-ok>${esc(o.confirmText || 'OK')}</button>
          </div>
        </div>`;
    }
    document.body.appendChild(root);

    const input = root.querySelector('#dlg-input') as HTMLInputElement | null;
    if (input) {
      input.value = o.value ?? '';
      if (o.placeholder) input.placeholder = o.placeholder;
    }

    let done = false;
    const cancelVal = o.kind === 'prompt' ? null : false;
    const okVal = () => (o.kind === 'prompt' ? input?.value ?? '' : true);

    function finish(result: string | boolean | null) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      const panel = root.querySelector('.dialog-panel') as HTMLElement;
      panel.style.transition = 'opacity .15s ease, transform .15s ease';
      panel.style.opacity = '0';
      panel.style.transform = 'scale(.96)';
      setTimeout(() => root.remove(), 150);
      resolve(result);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        finish(cancelVal);
      } else if (e.key === 'Enter' && (o.kind === 'confirm' || document.activeElement === input)) {
        e.preventDefault(); e.stopPropagation();
        finish(okVal());
      }
    }
    document.addEventListener('keydown', onKey, true);
    root.querySelectorAll('[data-cancel]').forEach((el) =>
      el.addEventListener('click', () => finish(cancelVal))
    );
    root.querySelector('[data-ok]')!.addEventListener('click', () => finish(okVal()));

    requestAnimationFrame(() => {
      if (input) { input.focus(); input.select(); }
      else (root.querySelector('[data-ok]') as HTMLElement).focus();
    });
  });
}

const customPrompt = (o: Omit<DialogOpts, 'kind'>) =>
  openDialog({ ...o, kind: 'prompt' }) as Promise<string | null>;
const customConfirm = (o: Omit<DialogOpts, 'kind'>) =>
  openDialog({ ...o, kind: 'confirm' }) as Promise<boolean>;

/* ===================== mobile sidebar (off-canvas) ======================== */
const sidebarOpen = () => document.getElementById('sidebar')?.classList.contains('is-open') ?? false;
function openSidebar() {
  document.getElementById('sidebar')?.classList.add('is-open');
  document.getElementById('sidebar-backdrop')?.classList.remove('hidden');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('is-open');
  document.getElementById('sidebar-backdrop')?.classList.add('hidden');
}

/* ============================== api ================================ */
async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error((body as any).error || 'Request failed');
  return body as T;
}

/* ============================ icons ================================ */
const ICON = {
  pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>',
  star: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.8 14 8l5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4L9 8z"/></svg>',
  starFill: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M11.48 3.05a.6.6 0 0 1 1.04 0l2.4 4.86 5.36.78c.5.07.7.69.34 1.04l-3.88 3.78.92 5.34c.08.5-.45.88-.9.64L12 17.78l-4.8 2.52c-.45.24-.98-.14-.9-.64l.92-5.34-3.88-3.78c-.36-.35-.16-.97.34-1.04l5.36-.78 2.4-4.86Z"/></svg>',
  palette: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.7 1.7-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16c3.3 0 6-2.7 6-6 0-4.9-4.5-8-10-8z"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  code: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>',
  text: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
};

/* ====================== content rendering ========================== */
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"])/g;

function linkify(text: string): string {
  return esc(text).replace(URL_RE, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

// Renders card content: highlighted code block, or prose with clickable links.
function renderContent(card: Card, opts: { full?: boolean } = {}): string {
  if (!card.content.trim()) {
    return `<span class="text-mist-400 italic">${opts.full ? 'Empty — click edit to add content.' : 'No content yet…'}</span>`;
  }
  if (card.isCode) {
    return `<pre class="code-block ${opts.full ? 'p-4' : 'p-3'} overflow-auto"><code>${highlight(card.content, card.language)}</code></pre>`;
  }
  return `<div class="rich-content whitespace-pre-wrap break-words leading-relaxed" style="font-family:'${esc(fontOf(card))}'">${linkify(card.content)}</div>`;
}

/* ============================ accessors ============================ */
const activeBoard = () => state.boards.find((b) => b.id === state.activeBoardId) || null;
const findCard = (id: string): { board: Board; card: Card } | null => {
  for (const b of state.boards) {
    const c = b.cards.find((x) => x.id === id);
    if (c) return { board: b, card: c };
  }
  return null;
};
const sortedCards = (b: Board) =>
  [...b.cards].sort((a, c) =>
    a.pinned !== c.pinned ? (a.pinned ? -1 : 1) : a.position - c.position);

/* ============================ rendering ============================ */
function renderUser() {
  const u = state.user;
  $('user-name').textContent = u.username;
  $('user-email').textContent = u.email;
  $('user-avatar').textContent = (u.username || u.email || '?').trim().charAt(0).toUpperCase();
}

function renderTabs() {
  const list = $('tab-list');
  if (state.boards.length === 0) {
    list.innerHTML = `<p class="text-mist-400 text-sm px-2 py-4">No boards yet. Create one above ↑</p>`;
    return;
  }
  list.innerHTML = state.boards
    .map((b) => {
      const active = b.id === state.activeBoardId;
      return `<div class="tab-row group flex items-center rounded-xl ${active ? 'bg-ink-600' : 'hover:bg-white/5'}" data-board="${b.id}">
        <button class="tab-open flex-1 min-w-0 text-left px-3 py-2.5 flex items-center gap-2" data-board="${b.id}">
          <span class="w-2 h-2 rounded-full shrink-0" style="background:${active ? 'var(--color-accent-soft)' : '#3a3a44'}"></span>
          <span class="truncate text-base ${active ? 'text-white' : 'text-mist-200'}">${esc(b.name)}</span>
          <span class="ml-auto text-xs text-mist-400 shrink-0">${b.cards.length}</span>
        </button>
        <button class="tab-rename icon-btn !w-7 !h-7 mr-1 opacity-0 group-hover:opacity-100" title="Rename" data-board="${b.id}">${ICON.edit}</button>
        <button class="tab-delete icon-btn !w-7 !h-7 mr-2 opacity-0 group-hover:opacity-100" title="Delete" data-board="${b.id}">${ICON.trash}</button>
      </div>`;
    })
    .join('');
}

function renderBoard() {
  const b = activeBoard();
  const titleEl = $('board-title');
  const countEl = $('card-count');
  const grid = $('card-grid');

  // drop any selected ids that no longer belong to the active board
  if (selectedCardIds.size) {
    const valid = new Set((b?.cards ?? []).map((c) => c.id));
    for (const id of [...selectedCardIds]) if (!valid.has(id)) selectedCardIds.delete(id);
  }
  updateDeleteBtn();

  if (!b) {
    titleEl.textContent = 'CLIDesk';
    countEl.textContent = '';
    grid.innerHTML = `<div class="h-full grid place-items-center text-center">
      <div class="animate-rise">
        <p class="font-heading text-3xl mb-2">Welcome, ${esc(state.user.username)} 👋</p>
        <p class="text-mist-300 text-lg">Create your first board from the sidebar to get started.</p>
      </div></div>`;
    return;
  }

  titleEl.textContent = b.name;
  const cards = sortedCards(b);
  countEl.textContent = cards.length ? `· ${cards.length} card${cards.length > 1 ? 's' : ''}` : '';

  if (cards.length === 0) {
    grid.innerHTML = `<div class="h-full grid place-items-center text-center">
      <div class="animate-rise">
        <p class="font-heading text-2xl mb-2">This board is empty</p>
        <p class="text-mist-300 text-lg mb-5">Add commands, snippets, links or tools as cards.</p>
        <button class="btn btn-primary text-base" data-add-card>+ Create your first card</button>
      </div></div>`;
    return;
  }

  grid.innerHTML =
    `<div class="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">` +
    cards.map(cardHtml).join('') +
    `</div>`;
}

function cardHtml(c: Card): string {
  const h = hex(c.color);
  // Coloured border on a dark surface (not a fully coloured card).
  return `<article class="card-tile group relative rounded-2xl p-4 h-[210px] cursor-grab active:cursor-grabbing animate-rise overflow-hidden flex flex-col ${selectedCardIds.has(c.id) ? 'is-selected' : ''}"
      data-card="${c.id}"
      style="background:linear-gradient(160deg, ${h}14, rgba(15,15,17,.92));border:1.5px solid ${h}80;box-shadow:0 12px 30px -18px ${h}, inset 0 1px 0 ${h}1f;">
    <span class="absolute left-0 top-0 h-full w-1" style="background:${h}"></span>
    <div class="flex items-start gap-2 mb-2 pl-1.5">
      <h3 class="font-heading text-xl leading-snug flex-1 min-w-0 truncate text-mist-100" title="${esc(c.title)}">${esc(c.title)}</h3>
      <div class="flex items-center gap-1.5 shrink-0">
        ${c.pinned ? `<span style="color:${h}" title="Pinned">${ICON.pin}</span>` : ''}
        ${c.favorite ? `<span class="drop-shadow" style="color:#fbbf24" title="Favourite">${ICON.starFill}</span>` : ''}
      </div>
    </div>
    <div class="pl-1.5 pb-1 text-base text-mist-300 flex-1 min-h-0 overflow-hidden pointer-events-none [mask-image:linear-gradient(180deg,#000_74%,transparent)]">
      ${renderContent(c)}
    </div>
    ${c.isCode ? `<span class="absolute bottom-3 right-3 text-[11px] px-2 py-0.5 rounded-md font-medium" style="background:${h}26;color:${h}">${esc(c.language)}</span>` : ''}
    <div class="card-actions absolute top-2.5 right-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition" data-stop>
      <button class="mini-btn act-pin" title="${c.pinned ? 'Unpin' : 'Pin'}" data-card="${c.id}" style="${c.pinned ? `color:${h}` : ''}">${ICON.pin}</button>
      <button class="mini-btn act-fav" title="${c.favorite ? 'Unfavourite' : 'Favourite'}" data-card="${c.id}" style="${c.favorite ? 'color:#fbbf24' : ''}">${c.favorite ? ICON.starFill : ICON.star}</button>
      <button class="mini-btn act-color" title="Colour" data-card="${c.id}">${ICON.palette}</button>
      <button class="mini-btn act-edit" title="Edit name" data-card="${c.id}">${ICON.edit}</button>
    </div>
  </article>`;
}

/* small button style injected once */
const style = document.createElement('style');
style.textContent = `
.mini-btn{display:inline-flex;align-items:center;justify-content:center;width:1.85rem;height:1.85rem;border-radius:.55rem;color:#c8c8d2;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(6px);transition:background .15s,color .15s,transform .1s}
.mini-btn:hover{background:rgba(0,0,0,.7);color:#fff}
.mini-btn:active{transform:scale(.9)}
.card-tile{transition:transform .16s ease, box-shadow .16s ease, outline-color .16s ease;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.card-tile:hover{transform:translateY(-3px)}
.card-tile.is-selected{outline:2.5px solid #fff;outline-offset:3px}
.card-tile.is-selected::after{content:"";position:absolute;inset:0;background:rgba(255,255,255,.05);pointer-events:none}
.swatch{width:1.6rem;height:1.6rem;border-radius:.5rem;cursor:pointer;border:2px solid transparent;transition:transform .1s}
.swatch:hover{transform:scale(1.12)}
.swatch[data-active="1"]{border-color:#fff}
`;
document.head.appendChild(style);

function renderAll() {
  renderUser();
  renderTabs();
  renderBoard();
}

/* ---------------------- card selection (multi-select) --------------------- */
function selectCard(id: string) {
  if (selectedCardIds.has(id)) selectedCardIds.delete(id); // click again to deselect
  else selectedCardIds.add(id);
  applySelectionClasses();
  updateDeleteBtn();
}
function applySelectionClasses() {
  document.querySelectorAll<HTMLElement>('#card-grid .card-tile').forEach((t) =>
    t.classList.toggle('is-selected', selectedCardIds.has(t.dataset.card!))
  );
}
function clearSelection() {
  if (!selectedCardIds.size) return;
  selectedCardIds.clear();
  applySelectionClasses();
  updateDeleteBtn();
}
function selectedInBoard(): string[] {
  return [...selectedCardIds].filter((id) => {
    const f = findCard(id);
    return !!f && f.board.id === state.activeBoardId;
  });
}
function updateDeleteBtn() {
  const btn = document.getElementById('delete-card-btn');
  if (!btn) return;
  const n = selectedInBoard().length;
  btn.classList.toggle('hidden', n === 0);
  const count = document.getElementById('del-count');
  if (count) count.textContent = n > 1 ? String(n) : '';
  btn.setAttribute('title', n > 1 ? `Delete ${n} selected cards` : 'Delete selected card');
}

/* ========================= board actions =========================== */
async function createBoard() {
  const name = await customPrompt({
    title: 'Create new board',
    label: 'Board name',
    value: `Board ${state.boards.length + 1}`,
    placeholder: 'e.g. Shell commands',
    confirmText: 'Create',
  });
  if (name === null) return;
  try {
    const { board } = await api<{ board: Board }>('/api/boards', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim() || 'New Board' }),
    });
    state.boards.push(board);
    state.activeBoardId = board.id;
    renderAll();
    closeSidebar();
    toast('Board created');
  } catch (e: any) { toast(e.message, 'err'); }
}

async function renameBoard(id: string) {
  const b = state.boards.find((x) => x.id === id);
  if (!b) return;
  const name = await customPrompt({
    title: 'Rename board',
    label: 'Board name',
    value: b.name,
    confirmText: 'Rename',
  });
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    await api(`/api/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ name: trimmed }) });
    b.name = trimmed;
    renderAll();
  } catch (e: any) { toast(e.message, 'err'); }
}

async function deleteBoard(id: string) {
  const b = state.boards.find((x) => x.id === id);
  if (!b) return;
  const ok = await customConfirm({
    title: 'Delete board?',
    message: `"${b.name}" and all its cards will be permanently deleted. This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/boards/${id}`, { method: 'DELETE' });
    state.boards = state.boards.filter((x) => x.id !== id);
    if (state.activeBoardId === id) state.activeBoardId = state.boards[0]?.id ?? null;
    renderAll();
    toast('Board deleted');
  } catch (e: any) { toast(e.message, 'err'); }
}

/* ========================== card actions =========================== */
async function createCard() {
  const b = activeBoard();
  if (!b) { toast('Create a board first', 'err'); return; }
  const title = await customPrompt({
    title: 'Create new card',
    label: 'Card name',
    placeholder: 'e.g. git reset --hard',
    confirmText: 'Create',
  });
  if (title === null) return;
  try {
    const { card } = await api<{ card: Card }>('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ boardId: b.id, title: title.trim() || 'Untitled' }),
    });
    b.cards.push(card);
    renderAll();
    openModal(card.id); // open immediately so they can add content
  } catch (e: any) { toast(e.message, 'err'); }
}

async function patchCard(id: string, data: Partial<Card>) {
  const found = findCard(id);
  if (!found) return;
  Object.assign(found.card, data); // optimistic
  try {
    await api(`/api/cards/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  } catch (e: any) { toast(e.message, 'err'); }
}

async function deleteCard(id: string) {
  const found = findCard(id);
  if (!found) return;
  const ok = await customConfirm({
    title: 'Delete card?',
    message: `"${found.card.title}" will be permanently deleted.`,
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/cards/${id}`, { method: 'DELETE' });
    found.board.cards = found.board.cards.filter((c) => c.id !== id);
    selectedCardIds.delete(id);
    closeModal();
    renderAll();
    toast('Card deleted');
  } catch (e: any) { toast(e.message, 'err'); }
}

// Delete all currently-selected cards (from the header Delete button).
async function deleteSelectedCards() {
  const ids = selectedInBoard();
  if (ids.length === 0) return;
  const ok = await customConfirm({
    title: ids.length === 1 ? 'Delete card?' : `Delete ${ids.length} cards?`,
    message:
      ids.length === 1
        ? `"${findCard(ids[0])!.card.title}" will be permanently deleted.`
        : `${ids.length} selected cards will be permanently deleted. This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;

  let failed = 0;
  for (const id of ids) {
    const found = findCard(id);
    if (!found) continue;
    try {
      await api(`/api/cards/${id}`, { method: 'DELETE' });
      found.board.cards = found.board.cards.filter((c) => c.id !== id);
      selectedCardIds.delete(id);
    } catch {
      failed++;
    }
  }
  renderAll();
  toast(
    failed ? `Deleted with ${failed} error(s)` : ids.length === 1 ? 'Card deleted' : `${ids.length} cards deleted`,
    failed ? 'err' : 'ok'
  );
}

/* ===================== drag: reorder & move boards ================= */
const gridInner = () => document.querySelector('#card-grid .grid') as HTMLElement | null;

// which tile to insert the placeholder before (grid-aware, reading order); null = append
function dragInsertRef(inner: HTMLElement, x: number, y: number): HTMLElement | null {
  const tiles = [...inner.querySelectorAll<HTMLElement>('.card-tile')];
  if (!tiles.length) return null;
  let nearest = tiles[0], nd = Infinity, ni = 0;
  tiles.forEach((t, i) => {
    const r = t.getBoundingClientRect();
    const d = (x - (r.left + r.width / 2)) ** 2 + (y - (r.top + r.height / 2)) ** 2;
    if (d < nd) { nd = d; nearest = t; ni = i; }
  });
  const r = nearest.getBoundingClientRect();
  const before = y < r.top + r.height / 2 || (y < r.bottom && x < r.left + r.width / 2);
  return before ? nearest : tiles[ni + 1] ?? null;
}

// FLIP: animate children sliding to their new spots when the DOM is mutated (the "make space" effect)
function flipMove(inner: HTMLElement, mutate: () => void) {
  const items = [...inner.children] as HTMLElement[];
  const before = items.map((el) => el.getBoundingClientRect());
  mutate();
  items.forEach((el, i) => {
    const a = before[i], b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (dx || dy) {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth;
      el.style.transition = 'transform .2s cubic-bezier(.22,1,.36,1)';
      el.style.transform = '';
    }
  });
}

function moveCardsToBoard(ids: string[], destBoardId: string) {
  const dest = state.boards.find((b) => b.id === destBoardId);
  if (!dest) return;
  let moved = 0;
  ids.forEach((id) => {
    const f = findCard(id);
    if (!f || f.board.id === destBoardId) return;
    f.board.cards = f.board.cards.filter((c) => c.id !== id);
    f.card.boardId = destBoardId;
    f.card.position = dest.cards.length;
    dest.cards.push(f.card);
    selectedCardIds.delete(id);
    patchCard(id, { boardId: destBoardId, position: f.card.position });
    moved++;
  });
  renderAll();
  if (moved) toast(moved > 1 ? `Moved ${moved} cards to ${dest.name}` : `Moved to ${dest.name}`);
}

/* ===================== colour & rename popovers ==================== */
function colorSwatches(active: string): string {
  return COLOR_NAMES.map(
    (c) => `<button class="swatch" data-color="${c}" data-active="${c === active ? 1 : 0}" title="${c}" style="background:${hex(c)}"></button>`
  ).join('');
}

function openColorPopover(cardId: string, anchor: HTMLElement) {
  closePopovers();
  const found = findCard(cardId);
  if (!found) return;
  const pop = document.createElement('div');
  pop.className = 'popover glass rounded-xl p-2.5 shadow-2xl animate-pop';
  pop.style.position = 'fixed';
  pop.style.zIndex = '80';
  pop.innerHTML = `<div class="grid grid-cols-5 gap-2">${colorSwatches(found.card.color)}</div>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 10)}px`;
  pop.style.left = `${Math.min(r.left, window.innerWidth - pop.offsetWidth - 10)}px`;

  pop.querySelectorAll<HTMLElement>('.swatch').forEach((sw) =>
    sw.addEventListener('click', async () => {
      const color = sw.dataset.color!;
      await patchCard(cardId, { color });
      closePopovers();
      renderBoard();
      if (modalCardId === cardId) refreshModalChrome();
    })
  );
}

function closePopovers() {
  document.querySelectorAll('.popover').forEach((p) => p.remove());
}

// iOS-style custom font dropdown (each option in its own font; width matches the button)
function openFontMenu(cardId: string, anchor: HTMLElement) {
  closePopovers();
  const found = findCard(cardId);
  if (!found) return;
  const c = found.card;
  const check = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="color:var(--card-accent,#f97316)"><path d="M20 6 9 17l-5-5"/></svg>';
  const pop = document.createElement('div');
  pop.className = 'popover font-menu glass rounded-2xl p-1.5 shadow-2xl animate-pop';
  pop.style.position = 'fixed';
  pop.style.zIndex = '90';
  pop.style.maxHeight = '56vh';
  pop.style.overflowY = 'auto';
  pop.innerHTML = FONTS.map(
    (f) => `<button class="font-opt w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left ${f === fontOf(c) ? 'bg-white/10' : 'hover:bg-white/5'}" data-font="${esc(f)}">
      <span class="truncate text-base" style="font-family:'${f}'">${esc(f)}</span>
      ${f === fontOf(c) ? check : ''}
    </button>`
  ).join('');
  document.body.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  pop.style.width = `${Math.round(r.width)}px`; // match the button width
  pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 10)}px`;
  pop.style.left = `${Math.min(r.left, window.innerWidth - pop.offsetWidth - 10)}px`;

  pop.querySelectorAll<HTMLElement>('.font-opt').forEach((el) =>
    el.addEventListener('click', () => {
      const f = el.dataset.font!;
      c.font = f;
      const lbl = document.getElementById('m-font-label');
      if (lbl) { lbl.textContent = f; lbl.style.fontFamily = `'${f}'`; }
      const ta = document.getElementById('m-content') as HTMLTextAreaElement | null;
      if (ta) ta.style.fontFamily = `'${f}'`;
      updatePreview();
      patchCard(c.id, { font: f });
      closePopovers();
    })
  );
}

/* ============================= MODAL =============================== */
let modalCardId: string | null = null;
let saveTimer: number | undefined;
let typeTimer: number | undefined;
let modalView: 'write' | 'preview' = 'write';

function setModalView(mode: 'write' | 'preview') {
  modalView = mode;
  const ta = document.getElementById('m-content');
  const pv = document.getElementById('m-preview');
  const slider = document.getElementById('m-seg-slider') as HTMLElement | null;
  const wBtn = document.getElementById('seg-write');
  const pBtn = document.getElementById('seg-preview');
  if (!ta || !pv || !slider || !wBtn || !pBtn) return;
  if (mode === 'preview') {
    updatePreview();
    pv.classList.remove('hidden');
    ta.classList.add('hidden');
    slider.style.transform = 'translateX(100%)';
    animatePreview();
  } else {
    ta.classList.remove('hidden');
    pv.classList.add('hidden');
    slider.style.transform = 'translateX(0)';
  }
  wBtn.classList.toggle('text-white', mode === 'write');
  wBtn.classList.toggle('text-mist-300', mode !== 'write');
  pBtn.classList.toggle('text-white', mode === 'preview');
  pBtn.classList.toggle('text-mist-300', mode !== 'preview');
}

function openModal(cardId: string) {
  const found = findCard(cardId);
  if (!found) return;
  modalCardId = cardId;
  modalView = 'write';
  const root = $('card-modal');
  root.classList.remove('hidden');
  root.innerHTML = modalHtml(found.card);
  // force reflow for animation then add visible
  requestAnimationFrame(() => root.querySelector('.modal-panel')?.classList.add('modal-in'));
  wireModal();
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (typeTimer) { clearInterval(typeTimer); typeTimer = undefined; }
  if (saveTimer) { clearTimeout(saveTimer); flushSave(); }
  const root = $('card-modal');
  const panel = root.querySelector('.modal-panel');
  if (panel) {
    panel.classList.remove('modal-in');
    panel.classList.add('modal-out');
    setTimeout(() => { root.classList.add('hidden'); root.innerHTML = ''; }, 200);
  } else {
    root.classList.add('hidden');
    root.innerHTML = '';
  }
  modalCardId = null;
  document.body.style.overflow = '';
  renderBoard();
}

function modalHtml(c: Card): string {
  const h = hex(c.color);
  return `
  <div class="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade" data-close></div>
  <div class="modal-panel relative mx-auto my-[3vh] h-[94vh] w-[min(1000px,94vw)] flex flex-col rounded-3xl overflow-hidden glass shadow-2xl"
       style="border:1px solid ${h}55; --card-accent:${h};">
    <div class="h-1.5 w-full" style="background:${h}"></div>

    <!-- header -->
    <header class="flex items-center gap-3 px-5 py-3 border-b border-white/5">
      <span class="w-3 h-3 rounded-full shrink-0" style="background:${h}"></span>
      <input id="m-title" class="flex-1 min-w-0 bg-transparent font-heading text-2xl outline-none rounded-lg px-3 py-1.5 transition-colors" style="border:1.6px solid ${h}99" value="${esc(c.title)}" />
      <div class="flex items-center gap-2 shrink-0">
        <div class="relative">
          <button id="m-download" class="icon-btn" title="Download">${ICON.download}</button>
        </div>
        <button id="m-close" class="icon-btn" title="Close (Esc)" data-close>${ICON.close}</button>
      </div>
    </header>

    <!-- toolbar -->
    <div class="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-white/5 text-sm">
      <div class="flex items-center gap-1.5">${colorSwatches(c.color)}</div>
      <span class="w-px h-6 bg-white/10 mx-1"></span>
      <button id="m-code" title="Toggle between code and plain text" class="btn btn-ghost !py-1.5 !px-2.5 text-sm min-w-0 sm:min-w-[6rem]"><span id="m-code-icon">${c.isCode ? ICON.text : ICON.code}</span> <span id="m-code-label" class="hidden sm:inline">${c.isCode ? 'Text' : 'Code'}</span></button>
      <button id="m-font-btn" type="button" title="Card font" class="field !w-28 sm:!w-44 !py-1.5 !px-2.5 text-sm flex items-center justify-between gap-1.5">
        <span id="m-font-label" class="truncate" style="font-family:'${esc(fontOf(c))}'">${esc(fontOf(c))}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-mist-400"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <span class="w-px h-6 bg-white/10 mx-1 hidden sm:block"></span>
      <button id="m-pin" class="btn btn-ghost !py-1.5 !px-2.5 text-sm min-w-0 sm:min-w-[6.5rem] ${c.pinned ? '!border-accent/40' : ''}" style="${c.pinned ? `color:${h}` : ''}">${ICON.pin} <span class="hidden sm:inline">${c.pinned ? 'Pinned' : 'Pin'}</span></button>
      <button id="m-fav" class="btn btn-ghost !py-1.5 !px-2.5 text-sm min-w-0 sm:min-w-[6.75rem]" style="${c.favorite ? 'color:#fbbf24' : ''}">${c.favorite ? ICON.starFill : ICON.star} <span class="hidden sm:inline">${c.favorite ? 'Starred' : 'Star'}</span></button>
      <button id="m-delete" class="btn !py-1.5 !px-2.5 text-sm ml-auto text-rose-400 border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20">${ICON.trash} <span class="hidden sm:inline">Delete</span></button>
    </div>

    <!-- body: compact Write/Preview switch (top-left) + single pane -->
    <div class="flex-1 min-h-0 px-4 sm:px-5 pt-3 pb-3 flex flex-col">
      <div class="mb-2.5">
        <div class="relative grid grid-cols-2 w-40 p-0.5 rounded-lg bg-ink-800 border border-ink-600 text-sm">
          <span id="m-seg-slider" class="absolute top-0.5 left-0.5 bottom-0.5 w-[calc(50%-0.125rem)] rounded-md bg-ink-600 transition-transform duration-200 ease-out"></span>
          <button id="seg-write" class="relative z-10 py-1 font-heading text-center text-white">Write</button>
          <button id="seg-preview" class="relative z-10 py-1 font-heading text-center text-mist-300">Preview</button>
        </div>
      </div>
      <textarea id="m-content" spellcheck="false" style="font-family:'${esc(fontOf(c))}'"
        class="flex-1 min-h-0 resize-none outline-none rounded-xl bg-black/30 border border-white/10 p-4 text-lg leading-relaxed break-words"
        placeholder="Type anything here. Paste a command or code snippet and toggle Code for syntax colours. URLs become clickable in the preview.">${esc(c.content)}</textarea>
      <div id="m-preview" class="hidden flex-1 min-h-0 overflow-auto rounded-xl bg-black/20 border border-white/10 p-4 text-lg break-words">${renderContent(c, { full: true })}</div>
    </div>
    <div class="px-5 py-1.5 text-xs text-mist-400 border-t border-white/5">Changes save automatically.</div>
  </div>`;
}

function currentModalCard(): Card | null {
  return modalCardId ? findCard(modalCardId)?.card ?? null : null;
}

function updatePreview() {
  const c = currentModalCard();
  if (!c) return;
  $('m-preview').innerHTML = renderContent(c, { full: true });
}

// replay a quick swap animation on the preview (used when switching to preview tab)
function animatePreview() {
  const pv = document.getElementById('m-preview');
  if (!pv) return;
  pv.classList.remove('preview-swap');
  void pv.offsetWidth; // force reflow so the animation restarts
  pv.classList.add('preview-swap');
}

// fast typewriter reveal of the preview (used when toggling code/text)
function typewritePreview() {
  const pv = document.getElementById('m-preview');
  const c = currentModalCard();
  if (!pv || !c) return;
  const html = renderContent(c, { full: true });

  // safe slice points: after each complete tag / entity / character
  const cuts: number[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      i = end === -1 ? html.length : end + 1;
    } else if (html[i] === '&') {
      const end = html.indexOf(';', i);
      i = end !== -1 && end - i <= 8 ? end + 1 : i + 1;
    } else {
      i += 1;
    }
    cuts.push(i);
  }

  if (typeTimer) clearInterval(typeTimer);
  const step = Math.max(2, Math.ceil(cuts.length / 55)); // ~55 ticks total → fast
  let k = 0;
  pv.innerHTML = '';
  typeTimer = window.setInterval(() => {
    k += step;
    if (k >= cuts.length) {
      pv.innerHTML = html;
      clearInterval(typeTimer);
      typeTimer = undefined;
      return;
    }
    pv.innerHTML = html.slice(0, cuts[k]);
  }, 12);
}

function refreshModalChrome() {
  // re-render whole modal to reflect color/pin/fav/code without losing focus is overkill;
  // just update accent-dependent bits cheaply by reopening preview + swatches active state.
  const c = currentModalCard();
  if (!c) return;
  document.querySelectorAll<HTMLElement>('#card-modal .swatch').forEach((sw) => {
    sw.dataset.active = sw.dataset.color === c.color ? '1' : '0';
  });
  updatePreview();
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 500);
}

function flushSave() {
  const c = currentModalCard();
  if (!c) return;
  const titleEl = document.getElementById('m-title') as HTMLInputElement | null;
  const contentEl = document.getElementById('m-content') as HTMLTextAreaElement | null;
  if (!titleEl || !contentEl) return;
  const title = titleEl.value.trim() || 'Untitled';
  const content = contentEl.value;
  patchCard(c.id, { title, content, isCode: c.isCode, language: c.language });
}

function wireModal() {
  const c = currentModalCard();
  if (!c) return;

  const titleEl = $('m-title') as HTMLInputElement;
  const contentEl = $('m-content') as HTMLTextAreaElement;

  titleEl.addEventListener('input', scheduleSave);

  contentEl.addEventListener('input', () => {
    c.content = contentEl.value;
    // auto-detect code on the fly (only flips ON automatically)
    if (!c.isCode && looksLikeCode(contentEl.value)) {
      c.isCode = true;
      c.language = detectLanguage(contentEl.value);
      syncCodeUi();
    }
    updatePreview();
    scheduleSave();
  });

  // colour swatches
  document.querySelectorAll<HTMLElement>('#card-modal .swatch').forEach((sw) =>
    sw.addEventListener('click', async () => {
      c.color = sw.dataset.color!;
      refreshModalChrome();
      // recolor header/border live
      const h = hex(c.color);
      const panel = $('card-modal').querySelector('.modal-panel') as HTMLElement;
      panel.style.borderColor = `${h}55`;
      panel.style.setProperty('--card-accent', h);
      (panel.querySelector('div') as HTMLElement).style.background = h;
      (panel.querySelector('header span') as HTMLElement).style.background = h;
      (document.getElementById('m-title') as HTMLInputElement).style.borderColor = `${h}99`;
      await patchCard(c.id, { color: c.color });
    })
  );

  const codeBtn = $('m-code');
  const fontBtn = $('m-font-btn');
  function syncCodeUi() {
    // The button is a toggle: label shows what clicking will switch the card TO.
    const iconEl = document.getElementById('m-code-icon');
    const labelEl = document.getElementById('m-code-label');
    if (iconEl) iconEl.innerHTML = c.isCode ? ICON.text : ICON.code;
    if (labelEl) labelEl.textContent = c.isCode ? 'Text' : 'Code';
  }
  codeBtn.addEventListener('click', () => {
    c.isCode = !c.isCode;
    if (c.isCode && c.language === 'plaintext') c.language = detectLanguage(c.content) || 'plaintext';
    syncCodeUi();
    if (modalView === 'preview') typewritePreview();
    else updatePreview();
    patchCard(c.id, { isCode: c.isCode, language: c.language });
  });
  // font selector — iOS-style dropdown (applies to the card's text; code stays monospace)
  fontBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.querySelector('.font-menu')) closePopovers();
    else openFontMenu(c.id, fontBtn);
  });

  // Update pin/favourite in place (rebuilding the modal would flash the backdrop blur).
  $('m-pin').addEventListener('click', async () => {
    c.pinned = !c.pinned;
    const btn = $('m-pin');
    btn.innerHTML = `${ICON.pin} <span class="hidden sm:inline">${c.pinned ? 'Pinned' : 'Pin'}</span>`;
    btn.style.color = c.pinned ? hex(c.color) : '';
    btn.classList.toggle('!border-accent/40', c.pinned);
    await patchCard(c.id, { pinned: c.pinned });
  });
  $('m-fav').addEventListener('click', async () => {
    c.favorite = !c.favorite;
    const btn = $('m-fav');
    btn.innerHTML = `${c.favorite ? ICON.starFill : ICON.star} <span class="hidden sm:inline">${c.favorite ? 'Starred' : 'Star'}</span>`;
    btn.style.color = c.favorite ? '#fbbf24' : '';
    await patchCard(c.id, { favorite: c.favorite });
  });
  $('m-delete').addEventListener('click', () => deleteCard(c.id));

  // download menu
  $('m-download').addEventListener('click', (e) => {
    e.stopPropagation();
    openDownloadMenu(c);
  });

  // write / preview switch
  document.getElementById('seg-write')?.addEventListener('click', () => setModalView('write'));
  document.getElementById('seg-preview')?.addEventListener('click', () => setModalView('preview'));
  setModalView(modalView); // apply the current view

  // close handlers
  $('card-modal').querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', closeModal)
  );
}

// some toggles benefit from a light re-render of the toolbar labels
function reopenModalPreserve() {
  const c = currentModalCard();
  if (!c) return;
  const contentEl = document.getElementById('m-content') as HTMLTextAreaElement | null;
  const titleEl = document.getElementById('m-title') as HTMLInputElement | null;
  const scroll = (document.getElementById('m-content') as HTMLElement)?.scrollTop ?? 0;
  const caret = contentEl?.selectionStart ?? 0;
  const root = $('card-modal');
  root.innerHTML = modalHtml(c);
  root.querySelector('.modal-panel')?.classList.add('modal-in');
  wireModal();
  const newContent = document.getElementById('m-content') as HTMLTextAreaElement;
  if (newContent && contentEl) { newContent.scrollTop = scroll; newContent.setSelectionRange(caret, caret); }
}

function openDownloadMenu(c: Card) {
  closePopovers();
  const anchor = $('m-download');
  const imgIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-4.5-4.5L5 21"/></svg>';
  const pdfIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  const pop = document.createElement('div');
  pop.className = 'popover glass rounded-2xl p-2 shadow-2xl animate-pop';
  pop.style.position = 'fixed';
  pop.style.zIndex = '90';
  pop.innerHTML = `
    <div class="grid grid-cols-2 gap-1.5">
      <button class="dl-png flex flex-col items-center justify-center gap-1.5 w-[4.5rem] h-[4.5rem] rounded-xl bg-white/5 hover:bg-white/15 text-mist-200 text-xs transition" title="Download as PNG image">${imgIcon}<span>PNG</span></button>
      <button class="dl-pdf flex flex-col items-center justify-center gap-1.5 w-[4.5rem] h-[4.5rem] rounded-xl bg-white/5 hover:bg-white/15 text-mist-200 text-xs transition" title="Download as PDF">${pdfIcon}<span>PDF</span></button>
    </div>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.min(r.left, window.innerWidth - pop.offsetWidth - 10)}px`;

  pop.querySelector('.dl-png')!.addEventListener('click', async () => {
    closePopovers();
    try {
      await downloadImage($('m-preview'), c.title);
      toast('Image downloaded');
    } catch { toast('Could not export image', 'err'); }
  });
  pop.querySelector('.dl-pdf')!.addEventListener('click', () => {
    closePopovers();
    downloadPdf(c.title, renderContent(c, { full: true }));
  });
}

/* modal animation styles */
const modalStyle = document.createElement('style');
modalStyle.textContent = `
.modal-panel{opacity:0;transform:scale(.94) translateY(20px);transition:opacity .26s cubic-bezier(.22,1,.36,1), transform .26s cubic-bezier(.22,1,.36,1)}
.modal-panel.modal-in{opacity:1;transform:scale(1) translateY(0)}
.modal-panel.modal-out{opacity:0;transform:scale(.96) translateY(10px)}
`;
document.head.appendChild(modalStyle);

/* ============================= SEARCH ============================== */
let searchIndex = 0;
let searchResults: Array<{ type: 'board' | 'card'; board: Board; card?: Card; label: string; sub: string }> = [];

function openSearch() {
  const root = $('search-overlay');
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade" data-close></div>
    <div class="relative mx-auto mt-[12vh] w-[min(640px,92vw)] glass rounded-[28px] shadow-2xl overflow-hidden animate-pop p-2.5">
      <div class="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white/[0.04]">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9a9aa6" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="s-input" class="flex-1 bg-transparent outline-none text-xl placeholder:text-mist-400" placeholder="Search boards, cards, commands, code…" autocomplete="off" />
        <span class="text-xs text-mist-400 border border-white/10 rounded-md px-2 py-1">Esc</span>
      </div>
      <div id="s-results" class="max-h-[54vh] overflow-y-auto mt-2 px-1 pb-1 space-y-1"></div>
    </div>`;
  root.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSearch));
  const input = $('s-input') as HTMLInputElement;
  input.addEventListener('input', () => runSearch(input.value));
  input.focus();
  runSearch('');
  document.body.style.overflow = 'hidden';
}

function closeSearch() {
  $('search-overlay').classList.add('hidden');
  $('search-overlay').innerHTML = '';
  document.body.style.overflow = modalCardId ? 'hidden' : '';
}

function runSearch(q: string) {
  const query = q.trim().toLowerCase();
  const results: typeof searchResults = [];

  for (const b of state.boards) {
    if (!query || b.name.toLowerCase().includes(query)) {
      results.push({ type: 'board', board: b, label: b.name, sub: `Board · ${b.cards.length} cards` });
    }
    for (const c of b.cards) {
      const hay = `${c.title}\n${c.content}\n${c.language}`.toLowerCase();
      if (!query || hay.includes(query)) {
        results.push({
          type: 'card', board: b, card: c, label: c.title,
          sub: `${b.name}${c.isCode ? ' · ' + c.language : ''}`,
        });
      }
    }
  }
  searchResults = results.slice(0, 50);
  searchIndex = 0;
  renderSearchResults(query);
}

function highlightMatch(text: string, q: string): string {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + `<mark class="bg-accent/40 text-white rounded px-0.5">` + esc(text.slice(i, i + q.length)) + `</mark>` + esc(text.slice(i + q.length));
}

function renderSearchResults(query: string) {
  const box = $('s-results');
  if (searchResults.length === 0) {
    box.innerHTML = `<p class="text-mist-400 text-center py-8 text-base">No matches.</p>`;
    return;
  }
  box.innerHTML = searchResults
    .map((r, i) => {
      const h = r.card ? hex(r.card.color) : '#7c5cff';
      const icon = r.type === 'board'
        ? `<span class="w-7 h-7 rounded-lg grid place-items-center bg-white/5 text-mist-300"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg></span>`
        : `<span class="w-7 h-7 rounded-lg grid place-items-center" style="background:${h}26"><span class="w-2.5 h-2.5 rounded-full" style="background:${h}"></span></span>`;
      const snippet = r.card && r.card.content
        ? `<div class="text-mist-400 text-xs truncate mt-0.5">${highlightMatch(r.card.content.replace(/\s+/g, ' ').slice(0, 90), query)}</div>` : '';
      return `<button class="s-item w-full text-left flex items-center gap-3 px-3 py-3 rounded-2xl ${i === searchIndex ? 'bg-white/10 s-active' : 'hover:bg-white/5'}" data-idx="${i}">
        <span class="shrink-0">${icon}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-base text-mist-100">${highlightMatch(r.label, query)}</span>
          <span class="block truncate text-xs text-mist-400">${esc(r.sub)}</span>
          ${snippet}
        </span>
        <span class="text-[10px] text-mist-400 shrink-0 uppercase tracking-wide">${r.type}</span>
      </button>`;
    })
    .join('');

  box.querySelectorAll<HTMLElement>('.s-item').forEach((el) =>
    el.addEventListener('click', () => activateSearch(Number(el.dataset.idx)))
  );
}

function activateSearch(i: number) {
  const r = searchResults[i];
  if (!r) return;
  state.activeBoardId = r.board.id;
  renderAll();
  closeSearch();
  if (r.type === 'card' && r.card) {
    setTimeout(() => openModal(r.card!.id), 120);
  }
}

/* ============================ global events ======================== */
function wireGlobal() {
  $('new-board-btn').addEventListener('click', createBoard);
  $('add-card-btn').addEventListener('click', createCard);
  $('open-search-btn').addEventListener('click', () => { closeSidebar(); openSearch(); });
  $('logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/';
  });

  // mobile sidebar overlay
  $('sidebar-toggle').addEventListener('click', () => (sidebarOpen() ? closeSidebar() : openSidebar()));
  $('sidebar-backdrop').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);

  // tab list delegation
  $('tab-list').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const open = t.closest('.tab-open') as HTMLElement | null;
    const rename = t.closest('.tab-rename') as HTMLElement | null;
    const del = t.closest('.tab-delete') as HTMLElement | null;
    if (rename) { renameBoard(rename.dataset.board!); return; }
    if (del) { deleteBoard(del.dataset.board!); return; }
    if (open) { state.activeBoardId = open.dataset.board!; renderAll(); closeSidebar(); }
  });
  // double-click tab to rename
  $('tab-list').addEventListener('dblclick', (e) => {
    const row = (e.target as HTMLElement).closest('.tab-open') as HTMLElement | null;
    if (row) renameBoard(row.dataset.board!);
  });

  // card grid delegation
  $('card-grid').addEventListener('click', (e) => {
    if (dragSuppressClick) return; // a drag just ended — don't treat it as a click
    const t = e.target as HTMLElement;
    if (t.closest('[data-add-card]')) { createCard(); return; }

    const actBtn = t.closest('.act-pin, .act-fav, .act-color, .act-edit') as HTMLElement | null;
    if (actBtn) {
      e.stopPropagation();
      const id = actBtn.dataset.card!;
      const found = findCard(id);
      if (!found) return;
      if (actBtn.classList.contains('act-pin')) { patchCard(id, { pinned: !found.card.pinned }).then(renderBoard); }
      else if (actBtn.classList.contains('act-fav')) { patchCard(id, { favorite: !found.card.favorite }).then(renderBoard); }
      else if (actBtn.classList.contains('act-color')) { openColorPopover(id, actBtn); }
      else if (actBtn.classList.contains('act-edit')) { editCardName(id); }
      return;
    }

    const tile = t.closest('.card-tile') as HTMLElement | null;
    if (tile) {
      const id = tile.dataset.card!;
      if (isTouch) {
        if (lpFired) { lpFired = false; return; }    // long-press already selected this card
        if (selectedCardIds.size > 0) selectCard(id); // in selection mode: tap toggles
        else openModal(id);                           // normal tap: open
        return;
      }
      // mouse: single click selects, double click opens
      if (cardClickTimer) return; // second click of a double — let dblclick handle it
      cardClickTimer = window.setTimeout(() => { cardClickTimer = undefined; selectCard(id); }, 230);
      return;
    }
    clearSelection(); // clicked empty space in the grid
  });

  // double-click a card to open it full-screen (mouse only)
  $('card-grid').addEventListener('dblclick', (e) => {
    if (isTouch) return;
    const tile = (e.target as HTMLElement).closest('.card-tile') as HTMLElement | null;
    if (!tile) return;
    if (cardClickTimer) { clearTimeout(cardClickTimer); cardClickTimer = undefined; }
    openModal(tile.dataset.card!);
  });

  // touch: long-press a card to select (enters selection mode)
  if (isTouch) {
    const grid = $('card-grid');
    grid.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.act-pin, .act-fav, .act-color, .act-edit, [data-add-card]')) return;
      const tile = t.closest('.card-tile') as HTMLElement | null;
      if (!tile) return;
      lpFired = false;
      lpX = e.clientX;
      lpY = e.clientY;
      const id = tile.dataset.card!;
      clearTimeout(lpTimer);
      lpTimer = window.setTimeout(() => {
        lpFired = true;
        selectCard(id);
        try { (navigator as any).vibrate?.(15); } catch {}
      }, 500);
    });
    grid.addEventListener('pointermove', (e) => {
      if (lpTimer !== undefined && (Math.abs(e.clientX - lpX) > 10 || Math.abs(e.clientY - lpY) > 10)) {
        clearTimeout(lpTimer);
        lpTimer = undefined;
      }
    });
    const cancelLp = () => { clearTimeout(lpTimer); lpTimer = undefined; };
    grid.addEventListener('pointerup', cancelLp);
    grid.addEventListener('pointercancel', cancelLp);
    grid.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // delete the selected card(s)
  $('delete-card-btn').addEventListener('click', deleteSelectedCards);

  // ---- sortable drag: hold a card to reorder (others make space), or drop on a tab to move boards ----
  $('card-grid').addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.act-pin, .act-fav, .act-color, .act-edit, [data-add-card]')) return;
    const tile = t.closest('.card-tile') as HTMLElement | null;
    if (!tile) return;
    const board = activeBoard();
    if (!board) return;
    const id = tile.dataset.card!;
    // if the grabbed card is part of a multi-selection, drag them all (in display order)
    const ids = selectedCardIds.has(id) && selectedInBoard().length > 1
      ? sortedCards(board).map((c) => c.id).filter((x) => selectedCardIds.has(x))
      : [id];
    dragState = { ids, board, tile, sx: e.clientX, sy: e.clientY, offX: 0, offY: 0, started: false, ghost: null, ph: null, overTab: null };
  });
  window.addEventListener('pointermove', onCardDragMove);
  window.addEventListener('pointerup', onCardDragUp);

  // close popovers on outside click
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.popover') && !t.closest('.act-color') && !t.closest('#m-download')) closePopovers();
  });

  // keyboard
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if ($('search-overlay').classList.contains('hidden')) openSearch();
      else closeSearch();
      return;
    }
    if (e.key === 'Escape') {
      if (!$('search-overlay').classList.contains('hidden')) { closeSearch(); return; }
      if (document.querySelector('.popover')) { closePopovers(); return; }
      if (modalCardId) { closeModal(); return; }
      if (sidebarOpen()) { closeSidebar(); return; }
      if (selectedCardIds.size) { clearSelection(); return; }
    }
    // search navigation
    if (!$('search-overlay').classList.contains('hidden')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); searchIndex = Math.min(searchIndex + 1, searchResults.length - 1); renderSearchResults(($('s-input') as HTMLInputElement).value.trim().toLowerCase()); scrollActive(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); searchIndex = Math.max(searchIndex - 1, 0); renderSearchResults(($('s-input') as HTMLInputElement).value.trim().toLowerCase()); scrollActive(); }
      if (e.key === 'Enter') { e.preventDefault(); activateSearch(searchIndex); }
    }
  });
}

function scrollActive() {
  document.querySelector('.s-item.s-active')?.scrollIntoView({ block: 'nearest' });
}

async function editCardName(id: string) {
  const found = findCard(id);
  if (!found) return;
  const name = await customPrompt({
    title: 'Rename card',
    label: 'Card name',
    value: found.card.title,
    confirmText: 'Rename',
  });
  if (name === null) return;
  await patchCard(id, { title: name.trim() || 'Untitled' });
  renderBoard();
}

/* ============================== boot =============================== */
/* ============================ AI ASSISTANT ========================= */
function initAssistant() {
  const root = $('assistant');
  const convo = $('assistant-convo');
  const logEl = $('ai-log');
  const statusEl = $('ai-status');
  const dot = $('ai-status-dot');
  const inputEl = $('ai-input') as HTMLInputElement;
  if (!root || !convo) return;

  const setFace = (f: 'happy' | 'sad' | 'angry' | 'mad') => { root.dataset.face = f; };

  // pick the most natural English voice the browser offers (neural/online > google > others)
  let aiVoice: SpeechSynthesisVoice | null = null;
  function pickVoice() {
    let voices: SpeechSynthesisVoice[] = [];
    try { voices = speechSynthesis.getVoices(); } catch { return; }
    if (!voices.length) return;
    const en = voices.filter((v) => /^en[-_]?/i.test(v.lang));
    const pool = en.length ? en : voices;
    const score = (v: SpeechSynthesisVoice) => {
      const n = v.name.toLowerCase();
      let s = 0;
      if (n.includes('natural')) s += 120;        // Edge neural ("… Online (Natural)")
      if (n.includes('online')) s += 80;
      if (n.includes('google')) s += 70;          // Chrome
      if (/\b(aria|jenny|emma|ava|libby|sonia|ryan|guy|andrew|brian)\b/.test(n)) s += 45;
      if (v.localService === false) s += 25;       // cloud voices are usually nicer
      if (/zira|david|mark|hazel|susan/.test(n)) s += 10;
      if (v.lang.toLowerCase() === 'en-us') s += 8;
      if (/microsoft|google|apple|samantha/.test(n)) s += 5;
      return s;
    };
    aiVoice = pool.slice().sort((a, b) => score(b) - score(a))[0] || null;
  }
  pickVoice();
  try { speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch {}

  const showStop = (on: boolean) => { const s = document.getElementById('ai-stop'); if (s) s.classList.toggle('hidden', !on); };
  function stopSpeaking() {
    try { speechSynthesis.cancel(); } catch {}
    showStop(false);
  }
  const speak = (t: string) => {
    try {
      if (!aiVoice) pickVoice();
      const u = new SpeechSynthesisUtterance(t);
      if (aiVoice) { u.voice = aiVoice; u.lang = aiVoice.lang; }
      u.rate = 1.0;
      u.pitch = 1.0;
      u.volume = 1;
      u.onstart = () => showStop(true);
      u.onend = () => showStop(false);
      u.onerror = () => showStop(false);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      showStop(true);
    } catch {}
  };
  const addLine = (who: 'you' | 'ai', text: string) => {
    const el = document.createElement('div');
    el.className = `ai-line ${who}`;
    el.textContent = text;
    logEl.appendChild(el);
    logEl.scrollTop = logEl.scrollHeight;
  };
  const reply = (text: string) => { statusEl.textContent = text; addLine('ai', text); speak(text); };

  // play the click sound — uses /public/ohhh.mp3 if present, else a synth "ohh"
  function synthOhh() {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(430, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(240, ctx.currentTime + 0.28);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.38);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.4);
    } catch {}
  }
  const SOUNDS = ['/Voicy_ouch.mp3', '/ohhh.mp3'];
  const playOhh = () => {
    let i = 0;
    const tryNext = () => {
      if (i >= SOUNDS.length) { synthOhh(); return; }
      try { const a = new Audio(SOUNDS[i++]); a.volume = 0.8; a.play().catch(tryNext); } catch { tryNext(); }
    };
    tryNext();
  };

  // ---- domain-limited command handling (only searches/opens your stuff) ----
  function findTarget(q: string): { type: 'card'; board: Board; card: Card } | { type: 'board'; board: Board } | null {
    const words = q.split(/\s+/).filter((w) => w.length > 1);
    let best: any = null, score = 0;
    for (const b of state.boards) for (const c of b.cards) {
      const title = c.title.toLowerCase();
      const hay = `${title} ${c.content.toLowerCase()}`;
      let s = 0;
      if (q && title.includes(q)) s = 100;
      else { s += words.filter((w) => title.includes(w)).length * 10; s += words.filter((w) => hay.includes(w)).length * 2; }
      if (s > score) { score = s; best = { type: 'card', board: b, card: c }; }
    }
    if (score >= 4) return best;
    for (const b of state.boards) {
      const n = b.name.toLowerCase();
      if (q && (n.includes(q) || words.some((w) => n.includes(w)))) return { type: 'board', board: b };
    }
    return null;
  }

  // open a card in the preview tab
  function showCard(board: Board, card: Card) {
    state.activeBoardId = board.id;
    renderAll();
    closeSidebar();
    setTimeout(() => { openModal(card.id); setModalView('preview'); }, 90);
    setFace('happy');
  }
  // tidy card content for speech
  function forSpeech(s: string) {
    return s.replace(/https?:\/\/\S+/g, 'link').replace(/`+/g, '').replace(/\s+/g, ' ').trim().slice(0, 1400);
  }
  // open a card and read its contents aloud
  function readCard(board: Board, card: Card) {
    showCard(board, card);
    const body = card.content.trim();
    statusEl.textContent = `Reading “${card.title}”…`;
    addLine('ai', `Reading “${card.title}”.`);
    speak(body ? `${card.title}. ${forSpeech(body)}` : `${card.title}. This card is empty.`);
  }

  function handle(raw: string) {
    const text = raw.trim();
    if (!text) return;
    addLine('you', text);
    const lower = text.toLowerCase();
    const readIntent = /\b(read|recite|narrate)\b/.test(lower);

    let q = lower
      .replace(/^(hey|hi|hello|ok|okay|yo|please)\b[,\s]*/g, '')
      .replace(/^(can|could|would|will)\s+you\b\s*/g, '')
      .replace(/\bplease\b/g, '')
      .replace(/^(read(\s+(out|aloud|me|to me))?|recite|narrate|search(\s+for)?|open|find|show(\s+me)?|go\s+to|pull\s+up|launch|bring\s+up|take\s+me\s+to)\b\s*/g, '')
      .replace(/\b(the\s+)?contents?\s+(of\s+)?/g, '')
      .replace(/\bcards?\b/g, '')
      .replace(/^(the|a|my|for|out|aloud)\b\s*/g, '')
      .replace(/[?.!]+$/g, '')
      .trim();

    // "read this / it / current" → read the card that's open
    if (readIntent && (q === '' || /^(this|it|current)$/.test(q)) && modalCardId) {
      const f = findCard(modalCardId);
      if (f) { readCard(f.board, f.card); return; }
    }
    if (!q) {
      setFace('sad');
      reply(readIntent ? 'Open a card, then say “read this”.' : 'What would you like me to open?');
      return;
    }

    const target = findTarget(q);
    if (target && target.type === 'card') {
      if (readIntent) { readCard(target.board, target.card); return; }
      showCard(target.board, target.card);
      reply(`Opening ${target.card.title}.`);
    } else if (target && target.type === 'board') {
      state.activeBoardId = target.board.id;
      renderAll();
      closeSidebar();
      setFace('happy');
      reply(`Opening board ${target.board.name}.`);
    } else {
      setFace('sad');
      reply(`I couldn't find "${q}" in your boards. I can only search, open and read your cards.`);
    }
  }

  // ---- speech recognition (Web Speech API) ----
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  let recog: any = null;
  if (SR) {
    recog = new SR();
    recog.lang = 'en-US';
    recog.interimResults = true;
    recog.maxAlternatives = 1;
    recog.onresult = (e: any) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      if (interim) statusEl.textContent = '“' + interim.trim() + '”';
      if (final) { stopListening(); handle(final); }
    };
    recog.onend = () => { root.classList.remove('listening'); dot.className = 'w-2 h-2 rounded-full bg-emerald-400 shrink-0'; };
    recog.onerror = () => { root.classList.remove('listening'); };
  }
  function startListening() {
    if (!recog) { setFace('mad'); reply("Voice isn't supported in this browser — type your request below."); inputEl.focus(); return; }
    try {
      root.classList.add('listening');
      setFace('happy');
      statusEl.textContent = 'Listening…';
      dot.className = 'w-2 h-2 rounded-full bg-rose-400 shrink-0 animate-pulse';
      recog.start();
    } catch {}
  }
  function stopListening() { try { recog && recog.stop(); } catch {} root.classList.remove('listening'); }

  const openConvo = () => { convo.classList.remove('hidden'); };
  function activate() {
    // if it's talking, a tap stops it instead of starting a new turn
    if ((window as any).speechSynthesis && speechSynthesis.speaking) { stopSpeaking(); openConvo(); return; }
    playOhh(); setFace('happy'); openConvo(); startListening();
  }

  $('ai-mic').addEventListener('click', startListening);
  $('ai-stop').addEventListener('click', stopSpeaking);
  $('assistant-close').addEventListener('click', () => { convo.classList.add('hidden'); stopListening(); stopSpeaking(); });
  $('ai-form').addEventListener('submit', (e) => { e.preventDefault(); const v = inputEl.value; inputEl.value = ''; handle(v); });

  // ---- drag (and tap = activate) ----
  let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
  root.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('#assistant-convo')) return;
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY;
    const r = root.getBoundingClientRect();
    ox = r.left; oy = r.top;
    root.style.left = `${ox}px`; root.style.top = `${oy}px`;
    root.style.right = 'auto'; root.style.bottom = 'auto';
    root.classList.add('dragging');
    try { root.setPointerCapture(e.pointerId); } catch {}
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
    const w = root.offsetWidth, hgt = root.offsetHeight;
    const nx = Math.max(6, Math.min(window.innerWidth - w - 6, ox + dx));
    const ny = Math.max(6, Math.min(window.innerHeight - hgt - 6, oy + dy));
    root.style.left = `${nx}px`; root.style.top = `${ny}px`;
  });
  root.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('dragging');
    if (!moved) activate();
    else { try { localStorage.setItem('clidesk:ai-pos', JSON.stringify({ left: root.style.left, top: root.style.top })); } catch {} }
  });

  // restore saved position
  try {
    const saved = JSON.parse(localStorage.getItem('clidesk:ai-pos') || 'null');
    if (saved?.left && saved?.top) { root.style.left = saved.left; root.style.top = saved.top; root.style.right = 'auto'; root.style.bottom = 'auto'; }
  } catch {}
}

async function boot() {
  wireGlobal();
  initAssistant();
  renderUser();
  try {
    const data = await api<{ user: User; boards: Board[] }>('/api/data');
    state.user = data.user;
    state.boards = data.boards;
    state.activeBoardId = data.boards[0]?.id ?? null;
  } catch (e: any) {
    toast(e.message || 'Could not load your data', 'err');
  }
  renderAll();
}

boot();
