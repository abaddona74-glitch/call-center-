# Опрос после звонка (оценка оператора 1–5) — пакет для Issabel

Пакет для АТС: диалплан, AGI, звуки, таблица, скрипты установки/отката/проверки. **Ставит и снимает его только владелец
на консоли АТС под root.** Приложение и ИИ-сессии к АТС не подключаются и ничего на ней не запускают (`AGENTS.md`).
Обе системы только читают `asteriskcdrdb.operator_baho`: старая — `issabelDbService.fetchSurveyStats()` (карточки операторов
«Mijoz bahosi»), новая — `GET /api/stats/operators` (`docs/rewrite/METRICS.md` §3; права — `docs/rewrite/DEPLOY.md` §11.1).

## Что сейчас на АТС (со слов автора пакета, не проверено)

18.11.2026 пакет установлен на живую АТС в первой версии:
- 12:32 — до пакета в `extensions_custom.conf` добавлен контекст `[sub-evaluate]` (проигрывал `tanlash.wav`, писал оценку в
  `CDR(userfield)`), и он подключён строкой `gotocontinue`, **вписанной руками в автогенерируемый `extensions_additional.conf`**
  (её сотрёт первое же «Apply Config» в веб-интерфейсе Issabel);
- 14:08 — `install.sh`, резервная копия `/root/backup_baho_20261118_140834.tar.gz`;
- 14:27 — `redirect_sub_evaluate.sh`: `[sub-evaluate]` перенаправлен в `[operator-baho]`, старые строки закомментированы
  (`;OLD`), копия `/etc/asterisk/extensions_custom.conf.bak_142719`;
- 14:28 — проверочный звонок: оператор 111, оценка 4 записана, лишней строки в CDR нет, запись разговора на месте.

### Чем опасна установленная версия (исправлено в этом пакете)

`globals_custom.conf` задаёт **глобальные** `VQ_CONTINUE=c` и `VQ_DEST=operator-baho^s^1`. IssabelPBX в `ext-queues` после
`Queue()` уходит в `VQ_DEST` **вместо failover-назначения очереди** — для любого исхода, не только «оператор положил трубку».
В версии 18.11 `[operator-baho]` при любом `QUEUESTATUS`, кроме `CONTINUE`, кладёт трубку. Значит, сейчас:
- клиент, не дождавшийся оператора (таймаут очереди), или звонок при пустой очереди (все на паузе / не в сети)
  **сбрасывается**, а не идёт в failover очереди, настроенный в Issabel (Queues → 2020159 → Fail Over Destination);
- если на АТС есть другие очереди, это касается и их, и опрос включается в них тоже.

Если failover очереди 2020159 и так «положить трубку», поведение для клиента не изменилось; если там IVR, голосовая почта или
другая очередь — звонки теряются с 14:08 18.11. Насколько это касается АТС, покажет `status.sh` (ниже).

## Как работает (эта версия)

Клиент → IVR (`ivr-4`) → очередь `2020159` → разговор → **оператор кладёт трубку** → `baho-savol` → клиент нажимает 1–5 →
`baho-rahmat` → AGI пишет оценку в `asteriskcdrdb.operator_baho`.

- Клиент положил трубку первым — опроса нет. Оператор перевёл звонок вслепую — опроса нет.
- Нет нажатия за 7 с или не 1–5 — один повтор, потом конец.
- **Не было разговора** (таймаут, пустая очередь и т. п.) — звонок уходит в `BAHO_FAILOVER`: это failover очереди 2020159,
  `install.sh` берёт его из `extensions_additional.conf` и пишет в `globals_custom.conf`. Для клиента — как до опроса.
- `install.sh` отказывается ставить, если на АТС больше одной очереди: глобальные `VQ_*` включили бы опрос во всех очередях
  и подменили бы их failover на failover очереди 2020159. Для нескольких очередей нужна отдельная доработка.
- Часть с опросом не пишется в CDR (`CDR_PROP(disable)=1`): строка разговора к этому моменту уже закрыта и не меняется.

Оценка хранится не в `cdr`, а в отдельной таблице `asteriskcdrdb.operator_baho` (одна оценка на звонок, `UNIQUE uniqueid`):
`CDR(userfield)` после разговора попал бы в новую «пустую» строку CDR, а свои столбцы в `cdr` ломают обновления Issabel.

## Файлы

| Файл | Куда на АТС |
|---|---|
| `sounds/baho-savol.wav` (5,7 с), `sounds/baho-rahmat.wav` (2,0 с) — 8 кГц, моно, 16 бит | `/var/lib/asterisk/sounds/custom/` |
| `agi-bin/operator_baho.php` (PHP 5.4+) | `/var/lib/asterisk/agi-bin/` |
| `operator_baho.sql` | таблица `asteriskcdrdb.operator_baho` |
| `conf/extensions_custom.conf.part` | блок `[operator-baho]` в `/etc/asterisk/extensions_custom.conf` |
| `conf/globals_custom.conf.part` | блок `VQ_CONTINUE`, `VQ_DEST`, `BAHO_FAILOVER` в `/etc/asterisk/globals_custom.conf` (включает опрос) |
| `conf/queues_post_custom.conf.part` | `setinterfacevar=yes` для очереди в `/etc/asterisk/queues_post_custom.conf` |
| `status.sh` | только чтение: очереди, их failover, что установлено, ручные правки, права `cc_readonly` |
| `install.sh` | установка и обновление (заменяет только свои блоки между `OPERATOR-BAHO BOSHI/OXIRI`) |
| `backup.sh` | полная резервная копия перед установкой (вызывается из `install.sh`) |
| `verify.sh` | только чтение: последние оценки, строки CDR, запись разговора, звонки, закончившиеся в `operator-baho` |
| `rollback.sh` | выключить опрос (убирает свои блоки, оценки остаются) |
| `redirect_sub_evaluate.sh` | одноразовый, **выполнен 18.11, повторно не запускать** |
| `lib.sh`, `lib-conf.sh` | общие функции |
| `test/` | тесты пакета (запускаются у разработчика в Docker, не на АТС) |

## Что сделать на АТС (владельцу, по порядку)

1. **Решить**, оставляем ли опрос. Если нет — сразу шаг «Откат» ниже.
2. Скопировать пакет на АТС (как обычно, через Kerio):
   `scp -r infra/pbx/operator-survey issabel:/root/operator_baho`
3. `bash /root/operator_baho/status.sh` и посмотреть:
   - очередей ровно одна (`2020159`), иначе остановиться и написать разработчику;
   - «определённый failover» совпадает с Queues → 2020159 → Fail Over Destination в веб-интерфейсе;
   - есть ли ручные правки в `extensions_additional.conf` (`gotocontinue`, `sub-evaluate`).
4. `bash /root/operator_baho/install.sh` — сделает резервную копию и **обновит** блоки 18.11 (в выводе `updated`).
   Если failover не определился, скрипт остановится и покажет строки; тогда
   `BAHO_FAILOVER='контекст^экстеншн^приоритет' bash install.sh`.
5. Проверочные звонки с мобильного на номер колл-центра:
   1. оператор отвечает и **кладёт трубку первым** → звучит вопрос → нажать `4` → «rahmat»;
   2. клиент кладёт трубку первым → опроса нет;
   3. **все операторы на паузе** (или дождаться таймаута очереди) → звонок идёт туда же, куда шёл до опроса (failover),
      а не сбрасывается — это главная проверка исправления;
   4. оператор переводит звонок другому: при слепом переводе опроса нет; при сопровождаемом (по логике Asterisk) опрос
      будет, когда трубку положит второй оператор, и новая система засчитает оценку ему — это стоит проверить звонком.
6. `bash /root/operator_baho/verify.sh` — оценка записана, лишних строк в CDR нет, запись разговора на месте, нет звонков,
   закончившихся в `operator-baho`.
7. Ручная правка `gotocontinue` в `extensions_additional.conf`, если `status.sh` её показал: в спокойное время нажать
   «Apply Config» в веб-интерфейсе Issabel (он перегенерирует файл; перед этим убедиться, что в интерфейсе нет чужих
   неприменённых изменений), затем снова `status.sh`. После этого `[sub-evaluate]` никем не используется, его можно удалить
   из `extensions_custom.conf` руками (копия уже есть в резервной копии).
8. Чтобы оценки появились в новой системе — GRANT для `cc_readonly` из `docs/rewrite/DEPLOY.md` §11.1.

## Откат

- Выключить опрос (оценки, звуки и AGI остаются): `bash /root/operator_baho/rollback.sh`. Очереди снова уходят в свой
  failover, при «оператор положил трубку» звонок просто заканчивается.
- Остаётся `[sub-evaluate]` с переходом в несуществующий после отката `[operator-baho]`: если ручная строка `gotocontinue`
  ещё в `extensions_additional.conf`, звонок после разговора просто завершится. Убрать её — шаг 7 выше.
- Полный возврат любой версии конфигов: `/root/backup_baho_<время>.tar.gz` → `etc_asterisk/*_custom.conf` в `/etc/asterisk/`,
  затем `asterisk -rx "dialplan reload"`. Архив содержит пароли SIP из базы `asterisk` — не выносить с АТС.

## Отчёт по оценкам (SQL на АТС)

```sql
SELECT b.operator_ext, b.operator_name,
       COUNT(*) AS ratings, ROUND(AVG(b.baho), 2) AS avg,
       SUM(b.baho = 5) AS fives, SUM(b.baho <= 2) AS low
FROM asteriskcdrdb.operator_baho b
WHERE b.rated_at >= CURDATE() - INTERVAL 30 DAY
  AND LENGTH(b.src) >= 7                       -- без внутренних тестовых звонков
GROUP BY b.operator_ext, b.operator_name
ORDER BY avg DESC;
```

## Тесты пакета (у разработчика, в Docker; к АТС не подключаются)

```bash
# функции разбора конфигов на фикстурах (GNU bash/sed, как на CentOS)
docker run --rm -v "$PWD/infra/pbx/operator-survey:/s:ro" debian:trixie-slim bash /s/test/conf-test.sh
# install.sh / повтор / обновление версии 18.11 / отказ при 2 очередях / rollback.sh — в одноразовом контейнере с заглушками
docker run --rm -v "$PWD/infra/pbx/operator-survey:/src:ro" debian:trixie-slim bash /src/test/install-sandbox.sh
# AGI по протоколу Asterisk против MariaDB с таблицей (своя копия dev-АТС, не общая и не прод)
TEST_DB_PORT=33061 TEST_USER=baho_writer TEST_PASS=... bash infra/pbx/operator-survey/test/agi-test.sh
```

Фикстура `test/fixtures/extensions_additional.conf` повторяет формат FreePBX 2.11 по памяти; реальный формат на АТС
показывает `status.sh`, и `install.sh` остановится, если строка failover выглядит иначе.
