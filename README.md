# Call Center

Мониторинг и аналитика call-центра на Issabel/Asterisk: живые звонки и операторы, история, отчёты, callback'и, записи разговоров, тикеты.

Идёт переписывание старой системы (`legacy/`) на NestJS + PostgreSQL + React. Документация: [`docs/rewrite`](docs/rewrite/ARCHITECTURE.md).

## Быстрый старт (разработка)
Нужны Node 26, pnpm 10, Docker.

```bash
pnpm install
pnpm dev:infra                                   # Postgres + заглушка БД АТС
cp apps/api/.env.example apps/api/.env.local     # задайте BOOTSTRAP_SUPERUSER_PASSWORD
pnpm --filter @cc/shared build
pnpm dev                                         # http://localhost:5173
```

Проверки: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
