# Contributing

## Development

Install dependencies with Bun:

```bash
bun install
```

Run checks before opening a pull request:

```bash
npm run lint
npm test -- --run
npm run build
```

## Pull Requests

Include a short summary, testing performed, and screenshots for UI changes.

Keep changes focused. If a change touches database schema, include the matching Drizzle updates and migration instructions.
