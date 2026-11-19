# План переписывания

Справочник по старой системе: `docs/rewrite/legacy/{api,data,telephony,frontend}.md`. Отчёт ревью с багами (не публиковать): `docs/REVIEW-2026-11-17.md`.

## Этап 0 — каркас ✅
Монорепо, NestJS 12 + Kysely + Postgres + CLS-транзакции + аудит + сессии + WS, React + FSD + TanStack, Docker (dev и prod), CI.

## Этап 1 — параллельные сессии

| # | Сессия | Бэкенд (владеет) | Фронт (владеет) | API / web порты | БД |
|---|---|---|---|---|---|
| S1 | Авторизация и админка | `modules/{auth,users,passkeys,mail}` | `pages/settings-*`, `features/auth/*`, `entities/user` | 3001 / 5174 | `callcenter_s1` |
| S2 | История и отчёты (CDR) | `modules/{cdr,stats,export}`, `pbx/*` запросы | `pages/{history,statistics}`, `entities/call` | 3002 / 5175 | `callcenter_s2` |
| S3 | Живая телефония | `modules/{ami,live,actions}`, AMI-симулятор `infra/dev-pbx/ami-sim` | `pages/{dashboard,operators}`, `widgets/{operators-board,active-calls,queues}`, `entities/operator` | 3003 / 5176 | `callcenter_s3` |
| S4 | Callback'и, клиенты, чёрный список, агент | `modules/{callbacks,contacts,blacklist,agent}` | `pages/{clients}`, `widgets/callbacks-panel`, `features/{callbacks,contacts,blacklist}/*`, `entities/{contact,callback}` | 3004 / 5177 | `callcenter_s4` |
| S5 | Записи и тикеты (бывший viewer) | `modules/{recordings,tickets}` | `pages/{explorer,tickets}`, `entities/{recording,ticket}` | 3005 / 5178 | `callcenter_s5` |
| S6 | Платформа | миграция данных legacy → Postgres, деплой, бэкапы, скриншоты-эталоны дизайна | `docs/rewrite/design/*` | 3006 / 5179 | `callcenter_s6` |
| S7 | Тикеты: оператор → область → перезвон (`TICKETS.md`) | `modules/tickets` (принял от S5), маппер legacy-тикетов | `pages/{tickets,ticket-reports,settings-tickets}`, `widgets/{ticket-box,ticket-callback-queue}`, `features/tickets/*`, `entities/ticket` | 3007 / 5180 | `callcenter_s7` |
| S8 | Инструменты (этап 2) | `modules/tools` (конвертер, Uzcrypto), статика инструментов | `pages/tools`, `features/tools/*`, `entities/tool` | 3008 / 5181 | `callcenter_s8` |
| S9 | Руководство для операторов (этап 2) | `modules/guide` (если нужен API; иначе только фронт) | `pages/guide`, `widgets/guide-*`, `entities/guide` | 3009 / 5182 | `callcenter_s9` |
| S10 | Перенос данных legacy (этап 3) | `scripts/migrate-legacy/**` (кроме нового маппера исключённых операторов) | — | — / — | `callcenter_s10` |
| S11 | Исключённые операторы (этап 3) | настройка списка, фильтры в `modules/{live,stats,cdr,callbacks}`, маппер `excluded-operators` | раздел в `pages/settings*`, `features/excluded-operators/*` | 3011 / 5184 | `callcenter_s11` |
| S13 | Дашборд наблюдателя «Umumiy ko‘rinish» (19.11.2026) | `modules/overview` (только чтение: тикеты, CDR через `PbxCallsService`, итоги ИИ-анализа через `CallAnalysisService`), разрешение `overview.view` | `pages/overview`, `widgets/{region-map,ticket-overview}`, `entities/overview` | 3014 / 5187 | `callcenter_ov` |
| S14 | «KPI xodimlar» (19.11.2026) | `modules/kpi` (только чтение: CDR через `PbxCallsService` + функции статистики, тикеты и лента событий, итоги ИИ-анализа), `modules/operator-presence` (журнал онлайн/пауз `operator_presence_log`), разрешение `kpi.view` | `pages/staff-kpi`, `widgets/staff-kpi`, `entities/staff-kpi` | 3016 / 5189 | `callcenter_kpi` |
| AI | ИИ-анализ записей (после перехода, `CALL-ANALYSIS.md`) | `modules/call-analysis`, `apps/analysis-worker` | `pages/call-analysis`, `entities/call-analysis`, `features/call-analysis/*`, вкладка в `widgets/call-history-table` | 3000 / 5173 | `callcenter_ca` |

### Контракты между сессиями
- **S3 → S4:** события `call.*` из `apps/api/src/common/events/domain-events.ts`. S3 их публикует из AMI, S4 подписывается (закрытие callback'ов, учёт попыток). S4 пишет свои тесты на синтетических событиях, не дожидаясь S3.
- **S2 ↔ S3:** S3 даёт живые счётчики за сегодня, S2 — исторические из CDR. Определения метрик — одни (`docs/rewrite/legacy/telephony.md` §4 + решения ниже), чистые функции в `modules/stats/domain`.
- **S1 → все:** роли `operator | admin | superuser` и `useSessionUser()` уже есть в каркасе; S1 дорабатывает, не ломая API `SessionsService`/`AuthService`.
- **Группа «200»** (Zangiota, extension ≥ 200): ограничения — на сервере, по настройке «группы операторов» (S1 даёт модель групп, остальные проверяют).

### Принятые решения по бизнес-правилам (исправляем баги legacy)
- Рабочее время: Пн–Пт 08:00–21:00 Asia/Tashkent, настраиваемо. Звонки вне него → callback с источником `after_hours`, но **не теряются** при повторном звонке.
- Совпадение номеров — только точное после `normalizeUzPhone` (никаких `LIKE '%7 цифр%'`).
- Callback закрывается только состоявшимся разговором (answered + talk ≥ N секунд, по умолчанию 10) или вручную с причиной; фиксируется кто/когда/как.
- «Кто положил трубку» — только из реальных данных AMI (`Hangup` cause + сторона); если неизвестно — `unknown`, а не «клиент».
- Ручная правка статистики — только с причиной и в журнал аудита; в отчётах помечается.
- Темы звонков — только по реальным транскриптам; без транскрипта — «не классифицировано».

## Этап 2 — перенос «прочего» как есть
Раздел «Инструменты» (конвертер документов, ссылки Ijro / Uzcrypto, telegram-форма) и руководство для операторов (дерево знаний, инструкции).

**Не переносим** (решение владельца 18.11.2026): Telegram-уведомления, Proxmox watchdog, RustDesk, speedtest, распознавание речи и Gemini (темы звонков убраны ещё раньше). Автозапуск Kerio и АТС после отключения света чинится на самом хосте Proxmox, а не из приложения: это пункт отложенных правок прода (`docs/REVIEW-backlog-prod.md`, локальный файл).

## Этап 3 — переход
Прогон миграции данных на копии прод-БД → параллельный запуск новой системы рядом со старой (только чтение АТС) → проверка пользователем → переключение. **Деплой — только после явного подтверждения владельца.**
