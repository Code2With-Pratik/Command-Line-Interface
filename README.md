# CLIDesk

Your personal, authenticated vault for **commands, shortcuts, snippets, websites, tools & links** — organised into boards, colour-coded, searchable with `Ctrl/⌘ + K`, and exportable to image or PDF.

Built with **Astro (SSR) · Tailwind CSS v4 · Prisma ORM (v7, pg driver adapter) · Postgres**.

---

## ✨ Features

- **Auth** — email + password sign up / log in, server-side sessions (httpOnly cookie, scrypt-hashed passwords).
- **Boards (tabs)** — create, rename (double-click a tab or the ✎ button), delete. Each tab heads the board with its own name + a **New card** button.
- **Cards** — random colour on creation; click to open a **full-screen popup** with a smooth animation and a ✕ close button (top-right).
  - Write anything; **URLs become clickable links** automatically.
  - Paste code and it’s **auto-detected** and shown with **VS Code “Dark+” syntax colours** (toggle Code + pick a language manually too).
  - **Colour picker**, **rename**, **📌 Pin** (pinned cards float to the top of the board) and **⭐ Favourite**.
  - **⬇ Download** button (left of the ✕) → export the card as **PNG image** or **PDF**.
- **Global search** — press `Ctrl + K` (or `⌘ + K`) for a Spotlight-style search across **tab names, card names, content & code**. Arrow keys to move, **Enter** to open.
- **Dark UI** — black background, white/grey text, colourful cards, monospace VS Code code blocks.
- **Fonts** — `Merienda` for headings, `Indie Flower` for everything else.

---

## 🚀 Run it

The database is **already configured** (your Postgres connection string is in `.env`) and the
schema has been pushed. Just start the dev server:

```bash
npm run dev          # http://localhost:4321
```

Open the URL, sign up, and start adding cards.

### Moving to a different database
Edit `DATABASE_URL` (and `DIRECT_URL`) in `.env`, then push the schema:

```bash
npm run db:push      # creates User / Session / Board / Card tables
```

> **Prisma 7 note:** connection URLs live in `.env` and are wired up in two places —
> `prisma.config.ts` (for CLI commands like `db:push`) and `src/lib/db.ts` (the runtime
> connection, via the `@prisma/adapter-pg` driver adapter). There is no `url` in
> `schema.prisma` anymore — that's expected in v7.

---

## 📜 Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (http://localhost:4321) |
| `npm run build` | Production build (Node standalone server) |
| `npm run start` | Run the built server (`node ./dist/server/entry.mjs`) |
| `npm run db:push` | Push the Prisma schema to Neon (create/sync tables) |
| `npm run db:generate` | Regenerate the Prisma client |

---

## 🗂 Project structure

```
prisma/schema.prisma        # User, Session, Board, Card models
src/lib/
  db.ts                     # Prisma client singleton
  auth.ts                   # scrypt hashing + session cookies
  http.ts                   # json() / error() / handle() wrapper
  highlight.ts              # dependency-free VS Code syntax highlighter
  export.ts                 # PNG (canvas) + PDF (print) export
src/pages/
  index.astro               # login / sign up (redirects to /app if logged in)
  app.astro                 # main workspace (redirects to / if not logged in)
  api/auth/{signup,login,logout}.ts
  api/data.ts               # full workspace fetch
  api/boards/{index,[id]}.ts
  api/cards/{index,[id]}.ts
src/scripts/app.ts          # the whole client app (state, render, modal, search)
src/styles/global.css       # theme, fonts, animations, code colours
```

---

## 🔒 Notes

- Passwords are hashed with Node’s `scrypt`; sessions live in the DB and expire after 30 days.
- The Prisma client is bundled as an external (native engine) — already configured in `astro.config.mjs`.
- For deployment, run `npm run build` and host `dist/server/entry.mjs` on any Node host. Set `DATABASE_URL` (and `DIRECT_URL`) as real environment variables on the host; `npm start` also auto-loads a local `.env` if present (`node --env-file-if-exists=.env`).
