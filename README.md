# Galaxy Agent Chat — Backend

Next.js App Router API on **port 3001**. Postgres is the source of truth. REST accepts work (**202** + `runId`); Trigger.dev executes `agent.turn`. OpenRouter is **Free only** (`openrouter/free`, no paid fallback). Magica runs image/video tools server-to-server.

This package lives in the Galaxy Agent Chat monorepo. The product UI is [`../frontend`](../frontend/README.md). Shared types are exported from this package into `frontend/src/generated/api.ts`.

## Stack

| Piece | Role |
| --- | --- |
| Next.js 16 route handlers | `/api` (Clerk) and `/v1` (API keys) |
| PostgreSQL 16 + Prisma | Users, chats, runs, credits, waitpoints, uploads |
| Clerk | Session JWT for the web app |
| OpenRouter | Chat / tool-calling model (`openrouter/free`) |
| Magica | `crop_image`, `gpt_image_2`, `merge_videos` |
| Trigger.dev | Durable `agent.turn`, child `magica.run`, cron `run.reconcile` |
| Transloadit | Signed upload assemblies |
| Optional S3 | Durable copy of uploads and generated media |

## Local setup

From the **monorepo root**:

```bash
docker compose up -d          # Postgres on localhost:55432
cp backend/.env.example backend/.env
# fill secrets — never commit .env
pnpm install
pnpm --filter backend prisma migrate deploy
pnpm --filter backend contracts:export
pnpm dev                      # backend :3001 + frontend :3000
pnpm dev:trigger              # required when DISPATCH_MODE=trigger
```

From this directory only:

```bash
pnpm dev                      # next dev -p 3001
pnpm trigger:dev              # Trigger worker
pnpm prisma migrate deploy
pnpm contracts:export
pnpm test
pnpm typecheck
```

The HTTP process is not enough for durable runs. With `DISPATCH_MODE=trigger` (the `.env.example` default) you also need `pnpm dev:trigger` and a valid `TRIGGER_SECRET_KEY` + `TRIGGER_PROJECT_REF`.

`DISPATCH_MODE=inline` runs `runAgentTurn` inside the Next process. Use it only for local debug. Magica then polls in-process instead of the `magica.run` child task.

## Environment

Copy [`.env.example`](./.env.example) to `.env`. Names only:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres (`postgresql://galaxy:galaxy@localhost:55432/galaxy_chat?schema=public` with compose) |
| `CLERK_SECRET_KEY` | yes | Verify session JWTs on `/api` |
| `CLERK_PUBLISHABLE_KEY` | no | Present in the example; handlers only read the secret |
| `FRONTEND_ORIGIN` | yes in prod | CORS origin (default `http://localhost:3000`) |
| `PORT` | no | Documented as 3001; Next scripts hard-bind 3001 |
| `OPENROUTER_API_KEY` | yes | Free route only |
| `OPENROUTER_BASE_URL` | no | Default `https://openrouter.ai/api/v1` |
| `MAGICA_API_KEY` | yes for tools | Magica inference |
| `MAGICA_BASE_URL` | yes for tools | e.g. `https://inference.magica.com` — do not hard-code a host in code |
| `TRIGGER_SECRET_KEY` | yes for trigger mode | Worker + task dispatch |
| `TRIGGER_PROJECT_REF` | yes for trigger mode | `proj_…` from the Trigger dashboard |
| `DISPATCH_MODE` | no | `trigger` (default) or `inline` |
| `TRANSLOADIT_KEY` / `TRANSLOADIT_SECRET` | yes for attach | Signed assemblies. Key must be the Transloadit **Auth Key**, not a workspace nickname |
| `TRANSLOADIT_TEMPLATE_ID` | no | Optional template; not in `.env.example` |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_REGION` | no | Durable copy of uploads and generated assets |

Never commit secrets. Do not paste API keys into chat or docs.

## How a turn works

1. Client `POST /api/chats/:chatId/turns` (or `/v1/...`) with text, optional attachments, `planMode`, and `clientIdempotencyKey`.
2. Backend checks the model is `openrouter/free`, rate-limits (20/min/user), and requires balance ≥ `admissionReserve` (1).
3. A transaction creates the user + assistant messages, reserves 1 credit, writes an `AgentRun` (`queued`), and sets `Chat.activeRunId`. One non-terminal run per chat (409 `ACTIVE_RUN` otherwise).
4. Route returns **202** `{ chatId, messageId, runId, realtime }` immediately.
5. `agent.turn` claims a lease and runs the orchestrator (`src/lib/orchestrator.ts`).
6. **Chat-only hops** (no attachments, no generate/crop/merge intent, no pending Magica work): short system prompt, **no tools**, reasoning excluded, 12s OpenRouter timeout.
7. **Magica hops**: model returns `tool_calls`; backend starts a Magica node run and polls via `magica.run` (or inline `pollNodeRun`). Tool output is fed back as `role: tool`.
8. Finalize releases unused admission, writes status (`complete` / `failed` / `cancelled`), and emits webhooks. Failed turns are stubbed in later history — they cannot be resumed. Send a new message.

Postgres stays authoritative. Trigger streams (`thinking`, `assistant`) are overlay; clients also poll `GET /api/runs/:runId`.

```
Client  --202+runId-->  Next /api or /v1
                           |
                           +-- dispatch --> Trigger agent.turn
                                              |
                                              +-- OpenRouter free
                                              +-- Magica tools --> Trigger magica.run (poll)
                                              +-- persist messages / credits
```

## Chat-only vs Magica routing

`src/lib/turn-intent.ts` sets `needsMagicaTools` when any of these is true:

- This-turn attachments
- Generate / crop / merge language in the user text
- Plan mode or pending tool calls
- A recent successful Magica tool plus a follow-up

Otherwise the hop is chat-only. Text always comes from OpenRouter, not a canned local reply.

## Tools

Registered in `src/lib/registry.ts`. Skills live under `backend/agent-skills/*/SKILL.md` and load on demand.

| Tool | Billable | What it does |
| --- | --- | --- |
| `load_skill` / `read_skill_asset` | no | Pull Magica skill docs into context |
| `ask_questions` | no | Opens a `questions` waitpoint (crop target, etc.) |
| `crop_image` | yes | Magica crop |
| `gpt_image_2` | yes | Magica generate (`gpt-image-2-text`) or edit (`gpt-image-2-edit`) |
| `merge_videos` | yes | Magica merge (2–100 clips) |

Public `/v1/tools/{crop_image,gpt_image_2,merge_videos}` uses the same Magica path and also returns **202** + `runId`.

Waitpoints the orchestrator actually opens: `plan` / `options`, `questions`, and `media` confirmation. `credit` is in the schema but not emitted (approval popups stay off). TTL is 30 minutes; cron reconcile expires them.

### Magica poll window

`pollNodeRun` defaults: **2s interval × 60 attempts ≈ 2 minutes** after the first fetch. If Magica is still `QUEUED` or `RUNNING`, the child throws `504 PROVIDER_TIMEOUT` (`Magica run timed out`). GPT Image 2 can finish after that window; the image is then orphaned on Magica and not copied into chat. Raise `maxAttempts` if long image jobs need to complete in-product.

## Credits

Wallet units are **Magica micro-units**. The UI shows `(balance / 1_000_000).toFixed(2)M`.

| Rule | Value |
| --- | --- |
| New-user grant | `10_000_000` → **10.00M** |
| Admission hold | `1` (released on finalize if unused) |
| Magica tool | exact `Math.round(creditUsed)` from Magica |
| OpenRouter | exact `promptTokens + completionTokens` (`model_charge`) |

Ledger kinds: `grant`, `admission_reserve`, `admission_release`, `tool_charge`, `model_charge`. `refund` exists on the Prisma enum but is unused.

`GET /api/me/credits` returns `{ balance }` as an integer. Tool estimates use a ~200k unit floor so a nearly empty wallet fails before Magica starts.

## Auth

- **`/api/*`**: `Authorization: Bearer <Clerk session JWT>`. First request upserts `User` and grants initial credits.
- **`/v1/*`**: `Authorization: Bearer gx_live_…`. Keys are SHA-256 hashed; the secret is shown once at create time (`POST /api/me/api-keys`).

CORS allows `FRONTEND_ORIGIN` with credentials.

## HTTP routes

### App API (`/api`, Clerk)

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/chats` | List (cursor, `q`) / create |
| GET / PATCH / DELETE | `/api/chats/:chatId` | Read, title/pin/favorite, soft-delete |
| GET | `/api/chats/:chatId/messages` | Paginated messages |
| POST | `/api/chats/:chatId/turns` | **202** start turn |
| GET | `/api/runs/:runId` | Poll run + waitpoint + assets |
| GET | `/api/runs/:runId/realtime-token` | Trigger public token |
| POST | `/api/runs/:runId/stop` | Request stop |
| POST | `/api/runs/:runId/waitpoints/:token/resume` | Approve / reject waitpoint |
| POST | `/api/uploads/signature` | Transloadit signed params |
| POST | `/api/uploads/complete` | Persist attachment |
| GET | `/api/uploads` | List attachments (`?chatId=`) |
| GET | `/api/me/credits` | Balance |
| GET / POST | `/api/me/api-keys` | List / create |
| DELETE | `/api/me/api-keys/:keyId` | Revoke |
| GET / POST | `/api/me/webhooks` | List / create |
| DELETE | `/api/me/webhooks/:endpointId` | Disable |

### Public API (`/v1`, API key)

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/v1/chats` | List / create |
| GET | `/v1/chats/:chatId/messages` | Messages |
| POST | `/v1/chats/:chatId/turns` | **202** turn |
| POST | `/v1/chat/completions` | OpenAI-shaped accept → **202** |
| POST | `/v1/tools/:toolName` | Direct Magica tool → **202** |
| GET | `/v1/runs/:runId` | Poll |
| POST | `/v1/runs/:runId/waitpoints/:token/resume` | Resume waitpoint |

Mintlify source for the public API lives in [`../docs/`](../docs/). Preview with `npx mint@latest dev --port 3333` from that folder. Live API: `https://agent-chat-backend.vercel.app`.

### Outbound webhooks

Events: `agent.started`, `agent.completed`, `agent.failed`, `tool.completed`.

Headers: `X-Galaxy-Event`, `X-Galaxy-Event-Id`, `X-Galaxy-Timestamp`, `X-Galaxy-Signature` (`sha256=` over `timestamp.body`). Up to 4 delivery attempts.

## Trigger tasks

Configured in [`trigger.config.ts`](./trigger.config.ts): tasks from `src/trigger`, `maxDuration` 3600s.

| Id | File | Role |
| --- | --- | --- |
| `agent.turn` | `src/trigger/agent-turn.ts` | Orchestrate one run |
| `magica.run` | `src/trigger/magica-run.ts` | Poll one Magica node until terminal or timeout |
| `run.reconcile` | `src/trigger/reconcile.ts` | Every 2 minutes: expire waitpoints, finalize stuck/stopping runs, recover orphans, optional S3 backfill |

## Uploads

- Sign + complete through `/api/uploads/*`.
- Caps in `src/lib/uploads.ts`: **0.5 GB / file**, **5 GB / month / user**, **8 attachments / turn**.
- MIME: image, video, audio.
- Without Transloadit keys, attach fails with a config error; text chat still works.

## Contracts

Zod lives in `src/contracts/` (`limits.ts`, `api.ts`, `blocks.ts`).

```bash
pnpm contracts:export
```

writes `../frontend/src/generated/api.ts`. Do not hand-edit the generated file. Re-export after changing `LIMITS` or public DTO shapes.

### Current limits (`src/contracts/limits.ts`)

| Key | Value |
| --- | --- |
| `model` | `openrouter/free` |
| `maxMessageChars` | 32_000 |
| `admissionReserve` | 1 |
| `initialGrant` | 10_000_000 |
| `pageSizeChats` / `pageSizeMessages` | 30 / 50 |
| `contextWindowMessages` | 40 |
| `rateLimitPerMinute` | 20 |
| `persistIntervalMs` | 400 |
| `chatOnlyTimeoutMs` | 12_000 |
| `openRouterMaxRetries` | 3 |
| `maxToolIterations` | 12 |
| `waitpointTtlMinutes` | 30 |

## Data

See [`prisma/README.md`](./prisma/README.md). Notable rules:

- One active (non-terminal) run per chat.
- `Message.blocks` is JSONB, Zod-validated on write.
- Soft-delete chats via `deletedAt`.

```bash
pnpm prisma migrate dev      # local
pnpm prisma migrate deploy   # apply existing
```

Do not run `prisma db push --accept-data-loss` against a live local DB unless you intend to drop drifted tables.

## Layout

```
backend/
  src/app/api/          Clerk app routes
  src/app/v1/           API-key public routes
  src/contracts/        Zod + LIMITS
  src/lib/              Domain (orchestrator, credits, magica, waitpoints, …)
  src/trigger/          Trigger tasks
  agent-skills/         On-demand SKILL.md files
  prisma/               Schema + migrations
  scripts/export-contracts.ts
```

## Scripts

| Script | Command |
| --- | --- |
| `pnpm dev` | Next on :3001 |
| `pnpm trigger:dev` | Trigger worker |
| `pnpm contracts:export` | Write frontend generated types |
| `pnpm prisma` | Prisma CLI |
| `pnpm test` | Vitest (`src/**/*.test.ts`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` / `pnpm start` | Production Next on :3001 |

## Tests

```bash
pnpm test
pnpm test src/lib/credits.test.ts
```

Vitest runs in Node with `@` → `src`. Prefer unit tests around credits, Magica mapping, turn intent, waitpoints, and finalize — not live OpenRouter/Magica.

## Operational notes

- OpenRouter **429 / timeout** surfaces as `MODEL_UNAVAILABLE` with “no paid fallback.”
- Magica **401 / 429** map to provider unauthorized / rate limited.
- Stream appends to Trigger are time-capped so a hung `flush()` cannot pin a chat in `thinking`.
- After changing Prisma enums, bump `PRISMA_CLIENT_REV` in `src/lib/db.ts` and restart `pnpm dev` / `pnpm dev:trigger`.
- Restart the Trigger worker after `.env` key changes.
