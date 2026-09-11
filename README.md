# Galaxy Agent Chat — Backend

Next.js route handlers, Prisma, Clerk, OpenRouter Free, Trigger.dev (optional on Day 1).

## Setup

```bash
docker compose up -d   # Postgres on localhost:55432
cp .env.example .env
# fill CLERK_SECRET_KEY and OPENROUTER_API_KEY
pnpm install
pnpm prisma migrate dev
pnpm contracts:export
pnpm dev
```

Listens on http://localhost:3001.

`DISPATCH_MODE=inline` (default when Trigger.dev is unset) runs the same `runAgentTurn` function in-process.

Copy `MAGICA_API_KEY` from the Magica MCP config into `.env`. Never commit that key. `MAGICA_BASE_URL` must be set (do not hard-code a host).

Transloadit Community keys are required for composer uploads. Without them, attach fails with a config error; chat still works.
