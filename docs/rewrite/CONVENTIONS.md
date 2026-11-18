# Правила разработки

Обязательны для всех (людей и ИИ-сессий). Если правило мешает — сначала обсудить, потом менять этот файл.

## Общее
- Node 26 LTS, pnpm 10, TypeScript 6 (strict), ESM везде: относительные импорты в api оканчиваются на `.js`, `__dirname` нет — `import.meta.dirname`.
- Перед коммитом зелёные: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Формат кода — prettier (`pnpm format`), линт — oxlint, во фронте ещё steiger (FSD).
- Код и комментарии — по-английски; UI-тексты — через i18n (uz, ru).
- Секреты — только в `.env.local` / `infra/.env`, никогда в коде, логах, тестах, коммитах.
- Контракты (zod-схемы запросов/ответов, типы WS-событий, роли) — только в `packages/shared`. Фронт и бэк импортируют одно и то же.

## Бэкенд (`apps/api`) — модульный монолит

```
src/modules/<module>/
  <module>.module.ts        # регистрация; модуль добавляется одной строкой в app.module.ts
  <module>.controller.ts    # только HTTP: валидация входа и выхода, вызов сервиса
  <module>.service.ts       # сценарии (use cases); @Transactional() при нескольких записях
  <module>.repository.ts    # запросы Kysely (Postgres) или к АТС (PbxDb)
  <module>.tables.ts        # интерфейсы таблиц + `declare module '../../database/db.js'`
  domain/*.ts               # чистые функции: метрики, правила callback'ов, нормализация. Без Nest и БД
  domain/*.spec.ts          # unit-тесты к ним
```

- **Валидация.** Вход: `@Body({ schema })`, `@Query({ schema })`, `@Param('id', { schema })` со схемой из `@cc/shared` (встроенный в Nest 12 Standard Schema, глобальный `StandardSchemaValidationPipe`). Выход: `@SerializeOptions({ schema })` — лишние поля (хеши, токены) отрезаются автоматически.
- **Доступ.** Глобальный `SessionAuthGuard`: всё закрыто по умолчанию. `@Public()` — только осознанно. Доступ — по разрешениям, не по ролям: `@RequirePermission('blacklist.manage')`; в коде сервисов — `can(user, 'tickets.process')` / `hasPermission` из `@cc/shared`. Какая роль что может — только в `ROLE_PERMISSIONS` (`packages/shared/src/permissions.ts`); роли `superuser`/`executive`/`observer`/`operator`, роли `admin` нет, проверок по имени роли в коде нет. Личность — только из сессии (`@CurrentUser()` / CLS `user`), **никогда** из тела запроса (`operatorId`, `editorId` и т.п.).
- **БД.** `@InjectDb() private readonly txHost: DbHost` → `this.txHost.tx...`. Никакой склейки SQL-строк; `sql\`\`` — только с параметрами, `sql.raw` с пользовательскими данными запрещён. Транзакция — декоратор `@Transactional()` (nestjs-cls), не передавать `trx` руками.
- **АТС.** MariaDB — `@InjectPbxDb()` (может быть `null` → вернуть 503 «PBX unavailable»), только SELECT. Asterisk — только через модуль AMI. **Запрещено:** `child_process` с shell, SSH, `asterisk -rx`. Python (STT/конвертер) — только `spawn` без shell, фиксированные аргументы, таймаут, лимиты.
- **Миграции.** `src/database/migrations/YYYYMMDDHHmm_<module>_<что>.ts` (UTC), `up` + `down`. Не править уже применённые — добавлять новые. Таблицы — snake_case, в TS — camelCase (CamelCasePlugin). Время — `timestamptz`.
- **Время и бизнес-правила.** Всё в `Asia/Tashkent` (`BUSINESS_TIMEZONE`, luxon). Рабочие часы/дни — из конфигурации, не хардкод.
- **Аудит.** Любое изменение пользователей, ролей, настроек, ручная правка статистики, удаление данных → `AuditService.record('<domain>.<action>', { target, details })`.
- **Realtime.** Новые события — `packages/shared/src/realtime/<domain>.ts` + одна строка в `extends` в `realtime.ts`. Отправка — `RealtimeService.broadcast(type, data, { permission })`. По WS нельзя отдавать то, что этой роли нельзя получить через REST.
- **Связь модулей.** Через доменные события (`common/events/domain-events.ts`, `@nestjs/event-emitter`), а не прямые вызовы чужих сервисов. Новые события добавлять туда же.
- **Конфигурация.** Новая переменная → `config/env.schema.ts` + `apps/api/.env.example` + `infra/.env.example`.
- **Ошибки.** Бросать `HttpException`-наследников с понятным сообщением; фильтр сам приведёт к формату `ApiError` с `requestId`.
- **Тесты.** `domain/` — unit обязательно. Эндпоинты — e2e (`*.e2e-spec.ts`, supertest + реальный Postgres из `DATABASE_URL`, своя БД на сессию).

## Фронтенд (`apps/web`) — Feature-Sliced Design

Слои (импорт только сверху вниз): `app → pages → widgets → features → entities → shared`.

| Слой | Что лежит | Пример |
|---|---|---|
| `app` | роутер, провайдеры, стили, файлы маршрутов `app/routes/*` (тонкие: `beforeLoad` + страница) | `app/routes/_app/history.tsx` |
| `pages` | экран целиком, собирается из виджетов | `pages/history` |
| `widgets` | крупные блоки | `widgets/app-shell`, `widgets/operators-board` |
| `features` | действие пользователя | `features/callbacks/dismiss`, `features/auth/login-form` |
| `entities` | бизнес-сущность: запросы, типы, маленькие UI | `entities/call`, `entities/operator`, `entities/session` |
| `shared` | без бизнес-логики: `api` (http, ws), `ui` (shadcn), `lib`, `config`, `i18n` | |

- У каждого слайса публичный API — `index.ts`; импорт только через него (`@/entities/session`, не `@/entities/session/api/...`). `pnpm --filter @cc/web lint` (steiger) должен проходить.
- **Маршруты** — TanStack Router, file-based, `src/app/routes`. Авторизованные — под `_app/`. Доступ — `beforeLoad: ({ context }) => requirePermission(context.user, 'blacklist.manage')`; в компонентах — `usePermission(...)`; пункт меню — поле `permission` в `nav.ts`. Данные для экрана — в `loader` через `context.queryClient.ensureQueryData(xQuery)`.
- **Данные** — TanStack Query: `queryOptions` и фабрики ключей в `entities/<x>/api`. Мутации инвалидируют ключи. Live-обновления: `useRealtimeEvent('x.updated', (d) => queryClient.setQueryData(...))`.
- **Формы** — TanStack Form + zod-схема из `@cc/shared`. **Таблицы** — TanStack Table (общий `shared/ui/data-table`, создать при первой необходимости).
- **Дизайн — как в старой системе.** Сверять с `legacy/public/css/style.css`, `docs/rewrite/legacy/frontend.md` и скриншотами в `docs/rewrite/design/`. Цвета только токенами (`bg-card`, `text-muted-foreground`, `text-success`, `text-warning`, `text-destructive`, `text-outbound`, `text-live`), шрифт Golos Text, иконки iconsax — `<Icon name="call" />` из `shared/ui/icon`. shadcn-компоненты — основа поведения, внешний вид подгоняем под legacy.
- **Тёмная / светлая тема.** Тёмная — по умолчанию (legacy), светлая включается кнопкой в шапке (`features/theme-switch`, класс на `<html>`, `cc.theme` в localStorage). Поэтому никаких hex/`text-white`/`border-white/8`: токены из `app/styles/index.css` — текст `text-ink`, `text-ink-2`, `text-mute`, `text-dim`; линии и hover `border-tint/8`, `bg-tint/5`; стекло `bg-glass/90`, утопленные поля `bg-well/30`; акценты `text-info`, `text-danger`, `text-caution`, `text-positive`, `text-link`, `text-violet` (+ `-soft`); тень `var(--shadow-color)`. Цвет статуса/оператора для *текста* — `text-shade-[#f59e0b]` или `accentText(color)` из `shared/lib/theme` (в тёмной теме цвет как есть, в светлой затемняется). Редкое исключение — вариант `light:`. Проверять страницу в обеих темах.
- **i18n** — uz и ru. Переводы слайса лежат в нём (`<slice>/i18n.ts` + `registerTranslations('<ns>', { uz, ru })`), общий файл — только для слов всего приложения.
- **Безопасность.** Никакого `dangerouslySetInnerHTML` (исключение — санитизированный DOMPurify контент). Никаких токенов в `localStorage`/URL. Роли в UI — только удобство; проверка всегда на сервере.

## Работа в параллельных сессиях
- Ветка от `rewrite/foundation`, своя папка модуля/слайсов. Общие файлы трогать минимально, одной строкой: `app.module.ts` (импорт модуля), `widgets/app-shell/model/nav.ts` (пункт меню), `packages/shared/src/index.ts` (экспорт), `realtime.ts` (`extends`).
- Конфликт в `pnpm-lock.yaml` — взять любую сторону и выполнить `pnpm install`.
- Dev-инфраструктура общая (`pnpm dev:infra`, уже может быть запущена): Postgres `127.0.0.1:54320`, заглушка АТС MariaDB `127.0.0.1:33060`. **Каждая сессия использует свою базу**: `docker exec callcenter-dev-postgres-1 createdb -U callcenter callcenter_<slice>` и свои порты (таблица в ROADMAP.md).
- Не пушить, не мержить, ничего не деплоить. Коммиты — в свою ветку. В конце — краткий отчёт: что сделано, что проверено, что осталось.
