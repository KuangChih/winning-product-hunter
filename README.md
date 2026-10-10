# Winning Product Hunter

A SaaS for dropshipping sellers that finds products selling **right now**, backed by evidence from
multiple sources (ad libraries, social, search trends, marketplaces). Every score is explainable.

- Product direction and development protocol: [`CLAUDE.md`](CLAUDE.md)
- Roadmap and progress: [`docs/loop/`](docs/loop/)
- Research and decisions: [`docs/research/`](docs/research/), [`docs/loop/DECISIONS.md`](docs/loop/DECISIONS.md)

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Neon Postgres + Drizzle ·
Vitest · Playwright. Data collection, matching and scoring are one resumable pipeline runner
(ADR-013): on Vercel it runs in short ticks, started by the **Start discovery** button on
`/discover` and by a daily Vercel Cron; locally `npm run pipeline` runs the same runner.

## Local development

Requirements: Node.js 22+ and npm.

```bash
npm install
cp .env.example .env.local   # only DATABASE_URL is needed locally (see below)
npm run dev                  # http://localhost:3000
```

### Database

For a quick local demo without Neon, use the file-backed PGlite database and collect real data
(the website never shows sample data; fixtures are only for automated tests):

```bash
echo "DATABASE_URL=pglite:./.data/dev" > .env.local
npm run db:migrate
npm run pipeline
```

Tests use an in-memory Postgres (PGlite), so no database is needed to run them. For the app itself,
create a Neon database, set `DATABASE_URL`, then apply migrations:

```bash
npm run db:migrate
```

After changing `src/db/schema.ts`, generate a new migration with `npm run db:generate` and commit
the files in `drizzle/`.

### Quality gates

| Command                | What it checks        |
| ---------------------- | --------------------- |
| `npm run lint`         | ESLint                |
| `npm run typecheck`    | TypeScript            |
| `npm test`             | Vitest unit tests     |
| `npm run build`        | Production build      |
| `npm run e2e`          | Playwright end-to-end |
| `npm run format:check` | Prettier              |

Run `npx playwright install chromium` once before the first `npm run e2e`.

## Deployment

Deployed on Vercel. See [`docs/DEPLOY.md`](docs/DEPLOY.md).
