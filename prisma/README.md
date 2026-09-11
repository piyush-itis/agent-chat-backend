# Prisma

PostgreSQL is the only application database.

## Forward (this migration)

`20260911120000_init` creates the Day 1 relational model: User, credits, Chat, Message, AgentRun, tools, skills, waitpoints, attachments, generated assets.

Partial unique index `AgentRun_one_active_per_chat` enforces one non-terminal run per chat.

## Rollback

```sql
DROP TABLE IF EXISTS "GeneratedAsset", "Attachment", "Waitpoint", "RunSkill", "ToolInvocation", "CreditLedger", "CreditAccount", "Message", "Chat", "AgentRun", "User" CASCADE;
DROP TYPE IF EXISTS "LedgerKind", "MessageRole", "MessageStatus", "AgentRunStatus", "ToolProvider", "ToolInvocationStatus", "WaitpointKind", "WaitpointStatus", "AttachmentSource", "AssetKind";
```

Drop child tables before parents if you split the rollback. Do not drop `Message` / `AgentRun` in the same release as a breaking content-block change.

## Compatibility

`Message.blocks` is JSONB validated by Zod on write. Unknown block types fail closed on write and render as a safe fallback on read.

## Commands

```bash
pnpm --filter backend prisma migrate dev
pnpm --filter backend prisma migrate deploy
```
