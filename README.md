# CLIDesk 

<img width="1919" height="1078" alt="image" src="https://github.com/user-attachments/assets/438d08e7-cc7e-4610-91d7-0bda311bb713" />


> Your personal, authenticated vault for **commands, shortcuts, snippets, websites, tools & links** — organised into boards, colour‑coded, searchable with `Ctrl/⌘ + K`, and exportable to images and PDFs.

Built with **Astro 5 (SSR) · Tailwind CSS v4 · Prisma 7 (pg driver adapter) · PostgreSQL**, deployable to Vercel or any Node host..

---

## ✨ Features

### Accounts
- Email + password **sign up / log in / log out** (server‑side sessions, scrypt‑hashed passwords, httpOnly cookie).
- **Forgot password** → in‑app reset dialog (`/api/auth/reset`).
- **Show/hide password** toggle, smooth animated switch between Sign in / Sign up, validation toasts.

### Boards (tabs)
- Create, **rename** (double‑click a tab or the ✎ button), and delete boards.
- Sidebar with logo, board list, search shortcut, user avatar + logout.
- On **mobile & tablet** the sidebar becomes an off‑canvas overlay (hamburger to open, ✕ / backdrop / `Esc` to close).

### Cards
- Add cards to a board; every card is a **fixed, uniform size** with a **coloured border** and a coloured accent bar.
- **Pin** (pinned float to the top) and **favourite** (filled ⭐).
- **10 colours** to choose from; long titles **truncate with an ellipsis**.
- Click a card to open a **full‑screen popup** with a smooth animation:
  - **Write / Preview** slide‑tab.
  - Write anything; **URLs become clickable blue links** in the preview.
  - **Code / Text** toggle with **Monokai** syntax highlighting and automatic language detection; a fast **typewriter** reveal plays in the preview when you switch.
  - **Per‑card font** picker (iOS‑style dropdown) — 11 fonts: Arima, Arimo, Caveat, Dancing Script, DM Sans, Indie Flower, Merienda, Playwrite AU VIC Guides, Playwrite GB J, Poppins, Source Serif Pro.
  - **Colour** picker, **rename**, **pin**, **favourite**, and a red **Delete**.
  - **⬇ Download** as **PNG** (canvas) or **PDF** (print) from a compact picker.
  - Changes **save automatically**.

### Selecting & deleting
- **Desktop:** single‑click selects, double‑click opens.
- **Touch (mobile/tablet):** tap opens, **long‑press selects**; once anything is selected, tapping others toggles selection.
- **Multi‑select** + a **Delete (N)** button (icon‑only on mobile).

### Search
- **`Ctrl/⌘ + K`** opens a Spotlight‑style search across tab names, card names, content and code. Arrow keys to move, **Enter** to open.

### AI assistant (voice)
- A **draggable, bouncing mascot** (gradient orb with a top hat, glasses, blinking eyes and happy/sad/angry/mad faces).
- **Click** it to play a sound and start **listening** (Web Speech API); **type** in the conversation bar as a fallback.
- **Domain‑limited on purpose:** it only ever **searches, opens and reads your own cards/boards** — e.g. *"open the windows shortcuts"* opens that card in the Preview tab; *"read the windows shortcuts"* reads it aloud.
- Uses the most **natural** browser voice available (Edge "Natural" neural voices sound the most human). A **Stop** button (or tapping the bot) halts speech mid‑sentence.
- Your words and its replies appear as a **live conversation** at the bottom of the screen.
- Optional: drop an **`ohhh.mp3`** into `public/` for the click sound (a synthesized tone is used if the file is absent).

### Look & feel
- Dark theme, **yellow → orange gradients** on black, rotated **white dotted** backgrounds (dashboard, auth page and intro splash).
- Animated intro splash: logo + an ASCII "COMMAND LINE INTERFACE" banner.
- Fonts: **Merienda** for headings, **DM Sans** for body. Toasts appear top‑centre.

---

## 🧱 Tech stack

| Area | Choice |
| --- | --- |
| Framework | Astro 5 (SSR, `output: 'server'`) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| ORM | Prisma 7 with the **`@prisma/adapter-pg`** driver adapter |
| Database | PostgreSQL (Prisma Postgres / Neon / any Postgres) |
| Adapter | `@astrojs/node` (local) · `@astrojs/vercel` (on Vercel, auto‑selected) |
| Auth | scrypt password hashing + DB session tokens (httpOnly cookie) |

---

## 🚀 Getting started

### 1. Install
```bash
npm install
```

### 2. Configure the database
Create a Postgres database (e.g. **Prisma Postgres** or **Neon**) and put the connection string in `.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require"
```
*(If you only have one URL, use it for both. See `.env.example`.)*

### 3. Create the tables
```bash
npm run db:push
```

### 4. Run
```bash
npm run dev          # http://localhost:4321
```
Open the URL, sign up, and start adding cards.

---

## 📜 Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Regenerate the Prisma client, then start the dev server |
| `npm run build` | Regenerate the Prisma client, then build for production |
| `npm run start` | Run the built Node server (`dist/server/entry.mjs`, loads `.env`) |
| `npm run db:push` | Push the Prisma schema to the database (create/sync tables) |
| `npm run db:generate` | Regenerate the Prisma client |

> **Why `prisma generate` is wired into `dev`/`build`:** Prisma 7 has no bundled engine — the client is generated code that must match the schema. Running it on every start/build prevents the classic "Prisma client out of sync" error.

---

## 🗂 Project structure

```
prisma/
  schema.prisma            # User, Session, Board, Card models
prisma.config.ts           # Prisma 7 config (connection URLs for the CLI)
vercel.json                # forces `prisma generate && astro build` on Vercel
astro.config.mjs           # SSR; @astrojs/vercel on Vercel, @astrojs/node locally
src/
  lib/
    db.ts                  # PrismaClient via @prisma/adapter-pg
    auth.ts                # scrypt hashing + session cookies
    http.ts                # json()/error()/handle() wrapper
    highlight.ts           # dependency-free Monokai syntax highlighter + detection
    export.ts              # PNG (canvas) + PDF (print) export
  layouts/Base.astro       # fonts + global styles
  pages/
    index.astro            # login / sign up / forgot-password (redirects to /app if logged in)
    app.astro              # main workspace (redirects to / if not logged in)
    api/
      auth/{signup,login,logout,reset}.ts
      data.ts              # full workspace fetch
      boards/{index,[id]}.ts
      cards/{index,[id]}.ts
  scripts/app.ts           # the whole client app (state, render, modal, search, selection)
  styles/global.css        # theme, fonts, animations, Monokai code colours, dotted bg
```

---

## 🔌 API

| Method & path | Purpose |
| --- | --- |
| `POST /api/auth/signup` | Create account + seed a first board, sets session |
| `POST /api/auth/login` | Verify credentials, sets session |
| `POST /api/auth/logout` | Clear session |
| `POST /api/auth/reset` | Set a new password for an existing email |
| `GET  /api/data` | Current user + all boards & cards |
| `POST /api/boards` · `PATCH/DELETE /api/boards/:id` | Board CRUD |
| `POST /api/cards` · `PATCH/DELETE /api/cards/:id` | Card CRUD (title, content, colour, code, **font**, pin, favourite) |

All data endpoints require a valid session; errors are returned as clean JSON.

---

## ☁️ Deployment (Vercel)

1. Import the GitHub repo into Vercel.
2. Add the env vars **`DATABASE_URL`** (and `DIRECT_URL`) in **Project → Settings → Environment Variables** (Production).
3. Deploy. `vercel.json` sets the build command to `prisma generate && astro build`, so the client always matches the schema.
4. Tables must already exist — run `npm run db:push` once against the same database.

> Pushing to `main` triggers an automatic redeploy. If a schema change ever seems "not saved", redeploy with **Clear build cache**.

Self‑hosting works too: `npm run build` then `npm run start` on any Node 20+ host with the same env vars.

---

## 🔒 Notes
- Passwords are hashed with Node's `scrypt`; sessions live in the DB and expire after 30 days.
- Password reset is a **direct reset** (email + new password, no email‑verification link) — suitable for this app's scope; harden with an emailed token before any public, multi‑user use.
- `.env` is git‑ignored — your database credentials are never committed.
