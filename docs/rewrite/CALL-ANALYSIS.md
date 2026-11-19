# ИИ-анализ записей звонков

Статус: **пилот** (решение владельца 19.11.2026, `DECISIONS.md`). Работает на собственных моделях компании; в прод не включено. Отчёт пилота — `CALL-ANALYSIS-PILOT.md`.

Что делает: по записи разговора строит диалог «оператор ↔ клиент» с таймкодами, определяет тему, проблему клиента и исход, ставит оценки оператору по рубрике, отмечает нарушения и настроение клиента. Результаты лежат в нашей базе и видны в интерфейсе: в карточке звонка (вкладка «Suhbat va tahlil») и на странице «Tahlil» (`/analysis`).

## 1. Схема

```
 Сеть колл-центра                                   Сеть ИИ (10.100.100.251)
 ┌───────────────────────────────┐                  ┌──────────────────────────────┐
 │ api (NestJS)                  │   HTTPS, токен    │ apps/analysis-worker (Node)  │
 │  call_analysis_jobs  ◀────────┼──────────────────┤  1. lease                    │
 │  /api/call-analysis/worker/*  │  (воркер сам      │  2. скачать WAV              │──▶ STT (Whisper uz + pyannote)
 │  записи через SFTP-хранилище  │   ходит в API)    │  3. STT → реплики            │──▶ LLM (DeepSeek V4 Flash, OpenAI API)
 │  call_transcripts / analyses  │                  │  4. LLM → рубрика (JSON)     │
 └───────────────────────────────┘                  │  5. result / fail / skip     │
                                                    └──────────────────────────────┘
```

- Серверы ИИ недоступны из сети колл-центра (нет маршрута), поэтому обработка — **отдельный воркер, который сам забирает задачи (pull)**. Пилот: воркер на Mac владельца против локального API. Потом тот же воркер без изменений переезжает на машину в сети ИИ и ходит в `https://uniconsoft.ddns.net`.
- Воркер не ходит в базу и на АТС, не использует SSH. Только HTTP API с сервисным токеном. API хранит только SHA-256 токена (`CALL_ANALYSIS_WORKER_TOKEN_SHA256`).
- Записи — персональные данные. Воркер держит WAV только в памяти, на STT отправляет под именем `call.wav` (в настоящем имени файла есть номер клиента). В логах воркера и API — только id звонка, этапы, время, коды ошибок.

## 2. Данные (`apps/api/src/database/migrations/202611191200_call_analysis.ts`)

| Таблица | Что |
|---|---|
| `call_analysis_jobs` | очередь: `call_id` (= `CallListItem.id`, linkedid), начало звонка, дата (Ташкент), направление, финальный оператор, `talk_sec`, файл записи, `source` (`auto`/`manual`), `mode` (`full` / `llm_only` — переоценка), `status` `queued → processing → done / failed / skipped`, `attempts`, `not_before` (задержка повтора), `lease_owner`/`lease_until`, `last_error`, `skip_reason` |
| `call_transcripts` | реплики `[{start, end, role: operator/client/unknown, speaker, text}]`, язык, стратегия и модель STT, время STT, был ли перезапуск на русском |
| `call_analyses` | рубрика (см. §5), тема, тексты `{uz, ru}`, **версия промпта**, модель LLM, thinking, время LLM, число попыток |
| `call_topics` | список тем: `code`, `name_uz`, `name_ru`, `active`, `sort` (черновик — в миграции, финальный утверждает владелец) |
| `call_analysis_workers` | id воркера и когда он последний раз приходил (для карточки очереди) |

Повторный анализ звонка (новая версия промпта) перезаписывает транскрипт и анализ; версия хранится в каждой строке.

## 3. Очередь

- **Что ставится в очередь:** отвеченный входящий или исходящий звонок (`status = answered`, не внутренний), с записью, разговор ≥ `CALL_ANALYSIS_MIN_TALK_SEC` (20 с). Звонок собирается из CDR теми же функциями, что история и статистика (`PbxCallsService`). Правило — `domain/job-policy.ts` `isAnalyzable`.
- **Автоматически** (`CALL_ANALYSIS_ENABLED=true`, по умолчанию выключено): каждые `CALL_ANALYSIS_ENQUEUE_INTERVAL_SEC` (300) берутся звонки последних `CALL_ANALYSIS_LOOKBACK_HOURS` (6) часов.
- **Вручную** (superuser): `POST /api/call-analysis/backfill` — период (`from`, `to`, не больше `STATS_MAX_DAYS`) или список id (пилот); кнопка «Backfill» на странице «Tahlil».
- **Аренда (lease):** `POST /worker/lease` выдаёт самые новые открытые задачи (`ORDER BY call_started_at DESC`, `FOR UPDATE SKIP LOCKED` — два воркера не получат одну задачу). Аренда на `leaseSec` (воркер просит 20 мин). Не вернул результат — аренда истекает, задачу берёт следующий воркер; результат старого держателя отклоняется (409).
- **Ошибки:** воркер сообщает `retryable`. Повторяемая → снова в очередь с задержкой 1 / 5 / 15 / 60 мин, пока попыток меньше `CALL_ANALYSIS_MAX_ATTEMPTS` (3); иначе `failed`. Кнопка «Retry failed» возвращает все `failed` в очередь с нуля. Текст ошибки — одна строка без длинных цифр.
- **Пропуск (`skipped`)** с причиной: `no_recording`, `empty_recording`, `no_speech`, `too_long` (> 1800 с — предел STT), `unsupported_audio`.

## 4. STT

Сервис: Whisper (узбекский чекпойнт) + pyannote 3.1. Записи АТС — WAV PCM 16 бит, 8 кГц, моно; оператор и клиент в одном канале.

Сравнивали две стратегии (пилот, `CALL-ANALYSIS-PILOT.md`):
- **`chunks`** — один запрос `transcriptions?diarize=true`. Сервер режет звук на куски ≤ 29,5 с и даёт **каждому куску одного говорящего**. В диалоге это абзацы, где смешаны обе стороны: ролей по репликам нет.
- **`turns`** (выбрана) — `POST /v1/diarizations` (min 2 / max 3 говорящих), затем реплики одного говорящего с паузой ≤ 0,8 с склеиваются, реплики < 0,4 с и короткие (< 1,5 с) поддакивания внутри чужой реплики отбрасываются, каждая реплика вырезается локально (с полем 0,2 с) и распознаётся отдельно. Резка WAV — на чистом TypeScript (`apps/analysis-worker/src/wav.ts`), ffmpeg не нужен. Лимит токенов на реплику ~9 токенов/с (меньше галлюцинаций и быстрее). Внутри звонка — `CC_STT_TURN_CONCURRENCY` (3) параллельных запросов.
- Очистка текста: зацикленные повторы n-грамм («mana bu yerda mana bu yerda…») схлопываются, стандартные галлюцинации на музыке («musiqa», «Продолжение следует») выбрасываются (`text/cleanup.ts`).
- **Одновременная речь:** кусок одного говорящего содержит и голос другого, и одни и те же слова распознаются дважды. Из двух перекрывающихся по времени реплик разных говорящих с почти одинаковыми словами (Жаккар ≥ 0,5) остаётся начавшаяся раньше (`dropEchoedTurns`; в пилоте ~1 % реплик).
- **Русский язык:** узбекский чекпойнт пишет русскую речь латинской транслитерацией («pechite, obnosteloye, potomu chto») — **и с `language=ru` тоже** (проверено в пилоте), поэтому повторное распознавание на русском по умолчанию выключено (`CC_STT_RU_THRESHOLD=1`). Механизм оставлен: по словам-маркерам (`text/language.ts`) считается доля русского; при пороге < 1 звонок или отдельные реплики распознаются заново с `language=ru` — включать с многоязычным чекпойнтом. DeepSeek понимает транслитерацию, но точность распознавания русской речи ниже узбекской.
- Нестандартный WAV (GSM и т. п.) нельзя резать локально — тогда стратегия `chunks`.

## 5. LLM и рубрика

Модель: DeepSeek V4 Flash (OpenAI-совместимый API, `temperature 0.2`, `separate_reasoning`). Промпт — `apps/analysis-worker/src/llm/prompt.ts`, версия — `CALL_ANALYSIS_PROMPT_VERSION` в `@cc/shared` хранится в каждом результате. **Любая правка промпта, тем или рубрики → новая версия.**
- `v1-2026-11-19` — первая рубрика пилота: модель ставила почти всем 7–10 и почти не отмечала нарушений.
- `v2-2026-11-19` — оценки привязаны к стандарту из руководства оператора (шаблон приветствия, уточнение проблемы, фраза перед ожиданием, запрещённые «Bu bizning ishimiz emas» / «Bilmayman», фраза завершения), шкала `overall` откалибрована (10 — редко, только при полном стандарте), у каждого флага — определение.
- `v3-2026-11-19` — v2 + строки транскрипта пронумерованы, модель может поправить роль отдельной строки (`role_fixes`), если диаризация отдала её не той стороне. Пилот оценён этой версией.
- `v4-draft-2026-11-19` (в коде, ещё не прогонялась) — v3 + правки, утверждённые владельцем 19.11: молчание во время объявленной удалённой работы (AnyDesk и т. п.) — не `long_hold`; переведённым звонкам и записям, начатым с середины разговора, — ни флага `no_greeting`, ни снижения за приветствие (`greeting` = 5); в текстах нет букв диаризации («оператор B»), воркер дополнительно их вычищает (`stripSpeakerLetters`). Темы и стандарт приветствия ещё решаются; финальная `v4` добавит их, после чего пилот переоценивается (`llm_only`).
- **Переоценка без STT:** `POST /api/call-analysis/reanalyze` (период или id, superuser; кнопка «Qayta baholash (LLM)») ставит проанализированные звонки в очередь в режиме `llm_only`: воркер берёт сохранённый транскрипт (`GET /worker/jobs/:id/transcript`) и запускает только LLM текущей версии — секунды на звонок вместо минуты STT.

- На вход: список тем, направление звонка, длительность и реплики `[A 01:23] текст` (буквы — говорящие из диаризации). Номеров телефонов и имён файлов в промпте нет.
- Ответ — строгий JSON по схеме: `response_format: json_schema` (constrained decoding на сервере sglang — проверено: перечисления, диапазоны чисел и `maxLength` соблюдаются, поэтому зациклившаяся генерация обрывается на пределе поля, а не на `max_tokens`) + проверка zod в воркере. Не прошёл проверку или обрезан по `max_tokens` — один повтор с перечнем ошибок; второй провал — повторяемая ошибка задачи.
- Модель **сама определяет, кто оператор** (`speaker_roles`: буква → operator/client/unknown) по приветствию с названием колл-центра, вопросам «чем помочь» и т. п. Роли переносятся на реплики транскрипта; отдельные строки модель может поправить (`role_fixes`).
- `thinking`: выключен (`CC_LLM_THINKING=false`). В пилоте thinking давал те же темы/исходы, но в 3–8 раз дольше (14–40 с против ~5 с) и один раз не уложился в `max_tokens` (рассуждение съело лимит).
- Защита ПДн в текстах: промпт запрещает номера карт, паспортов, ПИНФЛ/СТИР, телефонов, паролей, кодов удалённого доступа, адресов и ФИО; воркер дополнительно маскирует длинные цифры, серию паспорта и e-mail (`llm/output.ts` `maskPersonalData`). Транскрипт хранится как есть (как запись) и доступен тем же, кому запись.

Рубрика (`CallAnalysisSchema` в `packages/shared/src/call-analysis.ts`, определения KPI — `METRICS.md` §8):

| Поле | Значения |
|---|---|
| `scores.greeting` | 1–5: поздоровался, назвал колл-центр, предложил помощь |
| `scores.politeness` | 1–5: вежливость и терпение |
| `scores.understanding` | 1–5: задал нужные вопросы, правильно понял проблему |
| `scores.solution` | 1–5: решил или дал верный полный следующий шаг (верная заявка/перевод — тоже решение) |
| `scores.closing` | 1–5: подтвердил результат, спросил «что-то ещё», попрощался |
| `overall` | 1–10: общее качество работы оператора в звонке |
| `outcome` | `resolved`, `ticket_opened`, `callback_promised`, `transferred`, `unresolved`, `info_only` |
| `redFlags[]` | `rudeness`, `wrong_information`, `interrupting`, `no_greeting`, `long_hold`, `refused_help`, `unprofessional` + заметка и секунда |
| `sentimentStart` / `sentimentEnd` | настроение клиента в начале и в конце: `positive`, `neutral`, `negative` |
| `topicCode` + `subtopic` | тема из `call_topics` (неизвестная → `other`) + свободная подтема |
| `problem`, `summary`, `recommendation` | тексты на узбекском и русском |
| `language` | `uz`, `ru`, `mixed` |

**Исход и реальность:** рядом с `outcome` показываются тикеты, реально созданные из этого звонка (`tickets.origin_call_id` или `ticket_calls.call_id`). В агрегатах: сколько раз модель сказала «тикет», сколько из них подтверждено, сколько реальных тикетов модель не увидела.

## 6. API

| Метод | Доступ | Что |
|---|---|---|
| `GET /api/call-analysis/calls/:callId` | `CDR_ACCESS['analysis.call']` = `recordings.listen` (как кнопка «Tinglash») | задача, транскрипт, анализ, тикеты звонка |
| `GET /api/call-analysis/status?ids=` | то же | статус и оценка для строк истории (≤ 200 id) |
| `GET /api/call-analysis/stats?from&to&operator&topic` | `CDR_ACCESS['analysis.stats']` = `reports.view` (как страница статистики) | агрегаты (§ METRICS 8); `topic` сужает только список проблем |
| `GET /api/call-analysis/topics` | то же | список тем |
| `GET /api/call-analysis/queue` | `analysis.manage` (только superuser) | прогресс очереди, воркеры, последние ошибки |
| `POST /api/call-analysis/backfill` | `analysis.manage` | поставить в очередь период или список id |
| `POST /api/call-analysis/queue/retry-failed` | `analysis.manage` | вернуть `failed` в очередь |
| `POST /api/call-analysis/worker/lease` | токен воркера | аренда задач + активные темы |
| `POST /api/call-analysis/reanalyze` | `analysis.manage` | переоценить период или список id текущей версией промпта (`llm_only`) |
| `GET /api/call-analysis/worker/jobs/:id/recording?workerId=` | токен + аренда | WAV задачи (через то же SFTP-хранилище, что «Tinglash»; аудит `callAnalysis.recordingFetch`) |
| `GET /api/call-analysis/worker/jobs/:id/transcript?workerId=` | токен + аренда | сохранённый транскрипт задачи `llm_only` |
| `POST /api/call-analysis/worker/jobs/:id/result` | токен + аренда | результат (`WorkerResultSchema`); тип `application/vnd.cc.analysis-result+json`, до 4 МБ |
| `POST /api/call-analysis/worker/jobs/:id/fail` / `skip` | токен + аренда | ошибка (`retryable`) / пропуск с причиной |

Сессия пользователя не даёт доступа к API воркера, токен воркера — к пользовательскому API. Аудит: `callAnalysis.backfill`, `callAnalysis.reanalyze`, `callAnalysis.retryFailed`, `callAnalysis.recordingFetch`.

## 7. Воркер: запуск на Mac (runbook)

1. Секреты ИИ (уже есть): `~/.config/cc-analysis/worker.env` (chmod 600): `CC_AI_STT_URL`, `CC_AI_LLM_URL`, `CC_AI_LLM_MODEL`, `CC_AI_LLM_API_KEY`. Не печатать, не коммитить.
2. Токен и адрес API: `~/.config/cc-analysis/worker-api.env` (chmod 600):
   ```
   CC_API_URL=http://localhost:3000        # прод: https://uniconsoft.ddns.net
   CC_API_TOKEN=<случайная строка ≥ 32 символов>
   CC_WORKER_ID=mac-pilot
   ```
   На стороне API: `CALL_ANALYSIS_WORKER_TOKEN_SHA256=$(printf %s "$CC_API_TOKEN" | shasum -a 256 | cut -d' ' -f1)`.
3. Сборка и запуск:
   ```bash
   pnpm install && pnpm --filter @cc/shared build && pnpm --filter @cc/analysis-worker build
   pnpm --filter @cc/analysis-worker start                  # бесконечный цикл
   CC_WORKER_ONCE=true pnpm --filter @cc/analysis-worker start   # до пустой очереди и выход
   ```
4. Настройки (env): `CC_WORKER_CONCURRENCY` (2 звонка одновременно — GPU общий с TTS), `CC_STT_TURN_CONCURRENCY` (3), `CC_STT_STRATEGY` (`turns`), `CC_STT_RU_THRESHOLD` (1 = выключено), `CC_LLM_THINKING` (false), `CC_WORKER_POLL_SEC` (30), `CC_WORKER_LEASE_SEC` (1200), `CC_WORKER_MAX_AUDIO_SEC` (1800).
5. Остановка: Ctrl+C — новых задач не берёт, текущие доделывает (второй Ctrl+C — сразу).
6. Перенос в сеть ИИ: та же сборка на машине с доступом к `10.100.100.251` и к `https://uniconsoft.ddns.net`; `CC_API_URL` прод, новый токен (хеш — в `infra/.env` прода), `CALL_ANALYSIS_ENABLED=true` для постоянной работы. Порядок для прода — сначала backfill за 3 месяца (≈ 20 тыс. записей, самые новые первыми), потом автоматическая очередь.

Сравнение стратегий на локальных файлах (без API, результаты — вне репозитория):
```bash
node --env-file=$HOME/.config/cc-analysis/worker.env apps/analysis-worker/dist/tools/compare-stt.js \
  --calls ~/Documents/call-center-pilot/calls.json --monitor <папка monitor> --out ~/Documents/call-center-pilot/compare --n 10
```

## 8. Интерфейс

- **Карточка звонка** (история, дашборд): вкладка «Suhbat va tahlil» для тех, кому можно слушать запись — пузыри оператор/клиент с временем; клик по времени запускает общий плеер и перематывает; текущая реплика подсвечивается. Над диалогом — карточка анализа: тема, проблема, итог, исход рядом с реальными тикетами, оценки, нарушения (клик по времени), настроение в начале и в конце, совет оператору, версия промпта и модель. Если анализа нет — статус задачи.
- **История:** у отвеченных звонков с записью — значок оценки и число нарушений.
- **«Tahlil»** (`/analysis`, право страницы статистики): период, оператор, тема; итоги, средние по критериям, распределение тем (клик — фильтр проблем), исходы, настроение, нарушения, таблица KPI по операторам, последние проблемы, звонки с нарушениями (клик — карточка звонка). Superuser видит очередь: счётчики, воркеры, ошибки, «Retry failed», «Backfill».
