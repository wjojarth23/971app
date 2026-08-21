# Repository Guidelines

## Project Structure & Module Organization
- `app/` is the Next.js App Router (routes live in `page.tsx`, layouts in `layout.tsx`, APIs in `app/api`).
- `components/` holds shared UI building blocks; keep new components colocated by feature.
- `lib/` contains server/client utilities such as auth, API helpers, and DB access (`lib/db/schema`).
- `public/` stores static assets; global styles live in `app/globals.css`, while local styles use `*.module.css`.
- `drizzle/` is generated output/migrations for Drizzle ORM (schema source in `lib/db/schema`).
- `docker/` and `Dockerfile` capture container-related assets; `autocam/static` is an ancillary static asset area.

## Build, Test, and Development Commands
- `npm run dev` (or `bun dev`) starts the Next.js dev server at `http://localhost:3000`.
- `npm run build` creates a production build; `npm run start` serves it.
- `npm run lint` runs ESLint with Next.js core web vitals + TypeScript rules.

## Coding Style & Naming Conventions
- Use TypeScript and follow existing formatting; let ESLint catch style issues.
- React components use PascalCase file/dir names (e.g., `components/HeroBackground`).
- Functions and variables use `camelCase`; constants can be `SCREAMING_SNAKE_CASE`.
- Prefer CSS modules (`*.module.css`) for component styles and keep globals in `app/globals.css`.

## Testing Guidelines
- No automated test runner is configured in `package.json` yet.
- Validate changes with `npm run lint` and manual route checks in the browser.
- If you add tests, document the framework and add a script in `package.json`.

## Commit & Pull Request Guidelines
- Commit messages are short and imperative; use Conventional Commit prefixes when helpful (e.g., `fix: remove console.log`).
- PRs should include: a concise description, testing steps, linked issues, and screenshots for UI changes.
- If you touch DB schema, include relevant updates in `lib/db/schema` and generated artifacts in `drizzle/`.

## Configuration & Secrets
- Environment variables live in `.env`; `drizzle.config.ts` expects `ADMIN_DB_URL`.
- Do not commit secrets; add new env vars to documentation and keep them out of Git.
