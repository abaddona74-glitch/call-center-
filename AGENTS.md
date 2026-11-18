# AGENTS.md — для ИИ-ассистентов и разработчиков

Call-center monitoring system for an Asterisk/Issabel PBX. Being rewritten from `legacy/` (Express + vanilla JS, insecure) into a pnpm monorepo.

Read before changing anything:
1. `docs/rewrite/ARCHITECTURE.md` — stack and decisions.
2. `docs/rewrite/CONVENTIONS.md` — mandatory rules (module layout, validation, FSD, security, parallel work).
3. `docs/rewrite/ROADMAP.md` — who owns which module, ports, contracts, business-rule decisions.
4. `docs/rewrite/legacy/*.md` — what the old system does (API, data, telephony, frontend). `legacy/` is read-only reference.

Hard rules:
- Never shell out with user input, never SSH to the PBX, never `asterisk -rx`; PBX DB is read-only via `PbxDb`, Asterisk via the AMI module.
- Identity and role come from the session (`@CurrentUser()`), never from request bodies.
- Validate every input and output with zod schemas from `@cc/shared`.
- The UI must look like the legacy UI (palette/fonts/icons are already ported); compare with `docs/rewrite/design/` screenshots.
- No secrets in code, logs or commits. Every push to `main` deploys to production automatically (no approval step), so never push to or merge into `main`, and never run the Deploy workflow, without the owner's explicit word. Other branches: push or merge only when the owner asks.
- NestJS here is v12 (ESM, built-in Standard Schema validation). Docs index: https://docs.nestjs.com/llms.txt. Tests use Vitest (`vi.fn()`).

Commands: `pnpm dev:infra`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm --filter @cc/api db:migrate`.
