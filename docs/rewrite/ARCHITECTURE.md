# Новая архитектура call-center

Статус: каркас готов (ветка `rewrite/foundation`). Старая система лежит в `legacy/` только как справочник.

## Цели
- Безопасность по умолчанию: никакого root/SSH к АТС, никаких shell-команд из пользовательских данных, токены не попадают в JS.
- Те же функции и **тот же внешний вид**, что у старой системы (с исправлением багов).
- Один бэкенд, один фронт, одна база; тесты и CI; деплой из git с бэкапом и откатом.

## Схема

```
 Браузер (React SPA)                         Сервер (Docker)
 ┌────────────────────┐   HTTPS   ┌───────────────────────────────────────────┐
 │ apps/web            │─────────▶│ web: Caddy — статика SPA, /api и /ws → api │
 │ React 19 + TS, FSD  │◀── WSS ──│ api: NestJS 12 (Node 26)                   │
 └────────────────────┘           │   ├─ PostgreSQL 18 (наши данные, Kysely)   │
                                  │   ├─ PBX MariaDB (только чтение, mysql2)   │──▶ Issabel 192.168.0.124
                                  │   ├─ Asterisk AMI (TCP 5038)               │──▶   :3306 cdr, asterisk.users
                                  │   └─ SFTP записи (только чтение, ключ)     │──▶   :5038 AMI, :22 SFTP
                                  └───────────────────────────────────────────┘
```

## Монорепо (pnpm workspaces)

| Путь | Что | Технологии |
|---|---|---|
| `apps/api` | Бэкенд (модульный монолит) | NestJS 12 (ESM), Express, Kysely + pg, mysql2, nestjs-cls (AsyncLocalStorage) + @nestjs-cls/transactional, nestjs-pino, @nestjs/schedule, @nestjs/throttler, @nestjs/platform-ws, zod 4 (Standard Schema, встроен в Nest 12) |
| `apps/web` | Единое SPA для админов и операторов (вместо 3535 + 3005) | React 19, TypeScript, Vite 8, TanStack Router (file-based) + Query + Table + Form, Tailwind 4 + shadcn/ui (Radix), i18next (uz, ru), Feature-Sliced Design, steiger |
| `apps/analysis-worker` | ИИ-анализ записей (запускается в сети ИИ, ходит в API по токену) | Node 26, TypeScript, zod; без ffmpeg |
| `packages/shared` | Контракты api ↔ web | zod-схемы, роли, типы WS-событий, утилиты телефонов |
| `infra` | Docker | `compose.dev.yml` (Postgres + заглушка АТС), `compose.yml` (prod: postgres + api + web/Caddy), Caddyfile |
| `legacy` | Старая система | только для чтения, не запускается в новой схеме |
| `docs/rewrite` | Документы | этот файл, CONVENTIONS, ROADMAP, `legacy/*.md` — опись старой системы |

## Ключевые решения
- **Viewer (3005) упразднён.** Операторы работают в том же SPA, права — по роли из сессии, проверяются на сервере. Внутренний прокси и «доверие localhost» исчезают.
- **SQLite → PostgreSQL.** Схема — миграции Kysely (`apps/api/src/database/migrations`). `tickets.json` и прочие JSON-файлы → таблицы.
- **АТС без root.** MariaDB — отдельный пользователь `SELECT`-only, сеть только с IP сервера. Пауза операторов и чёрный список — через AMI (`QueuePause`, `DBPut`/`DBDel`) вместо `asterisk -rx` по SSH. Записи — SFTP-пользователь только на папку `monitor`, по ключу.
- **Redis убран.** Один процесс API, кэш в памяти (`lru-cache`) там, где нужен.
- **Сессии:** cookie `cc_session` (HttpOnly, Secure, SameSite=Lax), в БД хранится только `sha256(token)`. WebSocket аутентифицируется той же cookie.
- **Пароли пользователей переносятся без сброса:** формат scrypt совместим со старым (`modules/auth/password-hasher.ts`, функция `fromLegacy`). Passkeys переносятся при том же `WEBAUTHN_RP_ID`.
- **Время:** все бизнес-правила в `Asia/Tashkent` (luxon), даты CDR читаются строками (`dateStrings`) и трактуются как ташкентские.
- **ИИ-анализ звонков** (решение 19.11.2026, вместо отказа от 18.11): собственные модели компании (Whisper uz + pyannote, DeepSeek), отдельный воркер `apps/analysis-worker` в сети ИИ забирает задачи из API по сервисному токену — `CALL-ANALYSIS.md`. Gemini не используется.
- **«Прочее»:** «Инструменты» (конвертер, ссылки Ijro/Uzcrypto) и руководство для операторов переносятся позже без изменения поведения. Telegram-уведомления, Proxmox watchdog, RustDesk и speedtest не переносятся (18.11.2026).

## Запуск локально
```bash
pnpm install
pnpm dev:infra                         # Postgres :54320 + заглушка АТС MariaDB :33060
cp apps/api/.env.example apps/api/.env.local   # задать BOOTSTRAP_SUPERUSER_PASSWORD (12+ символов)
pnpm --filter @cc/shared build
pnpm dev                               # api :3000, web :5173 (прокси /api и /ws на api)
```
Prod-подобный стек целиком: `docker compose -f infra/compose.yml --env-file infra/.env up -d --build`.
