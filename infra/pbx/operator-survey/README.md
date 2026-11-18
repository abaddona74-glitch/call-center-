# Опрос после звонка (оценка оператора 1–5) — пакет для Issabel

Пакет для АТС: диалплан, AGI, звуки, таблица, скрипты установки/отката/проверки. **Ставит и снимает его только владелец
на консоли АТС под root.** Приложение и ИИ-сессии к АТС не подключаются и ничего на ней не запускают (`AGENTS.md`).
Обе системы только читают `asteriskcdrdb.operator_baho`: старая — `issabelDbService.fetchSurveyStats()` (карточки операторов
«Mijoz bahosi»), новая — `GET /api/stats/operators` (`docs/rewrite/METRICS.md` §3; права — `docs/rewrite/DEPLOY.md` §11.1).

## Что сейчас на АТС

**Установлена эта версия (v2): 18.11.2026 в 18:38**, по слову владельца, из `/root/operator_baho_v2`, с
`BAHO_FAILOVER='app-blackhole^hangup^1'`; резервная копия перед установкой — `/root/backup_baho_20261118_183855.tar.gz`.

Как это устроено на АТС (по данным установки 18.11):
- очередь `2020159`: failover (`asterisk.queues_config.dest`) **пустой** — звонок без разговора после очереди заканчивается;
- continue destination очереди (`asterisk.queues_config.destcontinue`, поле настроек очереди в Issabel) = `sub-evaluate,s,1`.
  Это штатная настройка в базе Issabel: из неё генерируется переход `gotocontinue` в `ext-queues`, и она **переживает
  «Apply Config»**. `[sub-evaluate]` (в `extensions_custom.conf`) перенаправлен в `[operator-baho]`, поэтому его нельзя
  удалять, пока continue destination указывает на него;
- в CDR (`asteriskcdrdb.cdr`) нет колонки `linkedid` (стандартная схема Issabel): новая система работает с
  `PBX_CDR_HAS_LINKEDID=false`, `verify.sh` проверяет наличие колонки.

История (со слов автора первой версии):
- 12:32 — добавлен `[sub-evaluate]` (проигрывал `tanlash.wav`, писал оценку в `CDR(userfield)`) и назначен continue
  destination очереди;
- 14:08 — первая версия (v1): `install.sh`, резервная копия `/root/backup_baho_20261118_140834.tar.gz`;
- 14:27 — `redirect_sub_evaluate.sh`: `[sub-evaluate]` перенаправлен в `[operator-baho]`, старые строки закомментированы
  (`;OLD`), копия `/etc/asterisk/extensions_custom.conf.bak_142719`;
- 14:28 — проверочный звонок: оператор 111, оценка 4 записана, лишней строки в CDR нет, запись разговора на месте;
- 18:38 — v2 (эта версия), см. выше.

### Ошибка версии v1 (исправлена в v2)

`globals_custom.conf` задаёт **глобальные** `VQ_CONTINUE=c` и `VQ_DEST=operator-baho^s^1`. IssabelPBX в `ext-queues` после
`Queue()` уходит в `VQ_DEST` **вместо failover-назначения очереди** — для любого исхода, не только «оператор положил трубку».
В v1 `[operator-baho]` при любом `QUEUESTATUS`, кроме `CONTINUE`, кладёт трубку. Значит:
- клиент, не дождавшийся оператора (таймаут очереди), или звонок при пустой очереди (все на паузе / не в сети)
  **сбрасывается**, а не идёт в failover очереди, настроенный в Issabel (Queues → 2020159 → Fail Over Destination);
- если на АТС есть другие очереди, это касается и их, и опрос включается в них тоже.

На этой АТС failover очереди 2020159 пустой (то есть «положить трубку»), а очередь одна, поэтому с 14:08 до 18:38 для
клиентов ничего не изменилось. Ошибка проявилась бы, если бы failover был задан или появилась вторая очередь; v2 это учитывает.

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
| `status.sh` | только чтение: очереди, failover и continue destination из базы Issabel, что установлено, права `cc_readonly` (хеши паролей скрыты) |
| `install.sh` | установка и обновление (заменяет только свои блоки между `OPERATOR-BAHO BOSHI/OXIRI`) |
| `backup.sh` | полная резервная копия перед установкой (вызывается из `install.sh`) |
| `verify.sh` | только чтение: последние оценки, строки CDR, запись разговора, звонки, закончившиеся в `operator-baho` |
| `rollback.sh` | выключить опрос (убирает свои блоки, оценки остаются) |
| `redirect_sub_evaluate.sh` | одноразовый, **выполнен 18.11, повторно не запускать** |
| `lib.sh`, `lib-conf.sh` | общие функции |
| `test/` | тесты пакета (запускаются у разработчика в Docker, не на АТС) |

## Установка и обновление (владельцу, по порядку)

v2 уже установлена (18.11 18:38). Эти шаги — для следующих обновлений пакета и для проверки после них.

1. **Решить**, оставляем ли опрос. Если нет — сразу шаг «Откат» ниже.
2. Скопировать пакет на АТС (как обычно, через Kerio):
   `scp -r infra/pbx/operator-survey issabel:/root/operator_baho`
3. `bash /root/operator_baho/status.sh` и посмотреть:
   - очередей ровно одна (`2020159`), иначе остановиться и написать разработчику;
   - failover очереди (`queues_config.dest`) совпадает с Queues → 2020159 → Fail Over Destination в веб-интерфейсе;
   - continue destination (`queues_config.destcontinue`) указывает на `sub-evaluate,s,1` (или прямо на опрос).
4. `bash /root/operator_baho/install.sh` — сделает резервную копию и **обновит** свои блоки (в выводе `updated` или
   `unchanged`). Если failover не определился, скрипт остановится и покажет строки; тогда задать его явно. При пустом
   failover (как сейчас) — так, как ставили v2:
   `BAHO_FAILOVER='app-blackhole^hangup^1' bash install.sh`.
5. Проверочные звонки с мобильного на номер колл-центра:
   1. оператор отвечает и **кладёт трубку первым** → звучит вопрос → нажать `4` → «rahmat»;
   2. клиент кладёт трубку первым → опроса нет;
   3. **все операторы на паузе** (или дождаться таймаута очереди) → звонок идёт туда же, куда шёл до опроса (failover),
      а не сбрасывается — это главная проверка исправления;
   4. оператор переводит звонок другому: при слепом переводе опроса нет; при сопровождаемом (по логике Asterisk) опрос
      будет, когда трубку положит второй оператор, и новая система засчитает оценку ему — это стоит проверить звонком.
6. `bash /root/operator_baho/verify.sh` — оценка записана, лишних строк в CDR нет, запись разговора на месте, нет звонков,
   закончившихся в `operator-baho`.
7. Continue destination очереди (`gotocontinue` в `ext-queues`) — штатная настройка Issabel в базе, «Apply Config» её не
   трогает, делать с ней ничего не нужно. `[sub-evaluate]` в `extensions_custom.conf` **не удалять**, пока continue
   destination указывает на него (иначе после разговора переход уйдёт в несуществующий контекст).
8. Чтобы оценки появились в новой системе — GRANT для `cc_readonly` из `docs/rewrite/DEPLOY.md` §11.1.

## Откат

- Выключить опрос (оценки, звуки и AGI остаются): `bash /root/operator_baho/rollback.sh`. Очереди снова уходят в свой
  failover, при «оператор положил трубку» звонок просто заканчивается.
- Continue destination очереди остаётся `sub-evaluate,s,1`, а `[sub-evaluate]` переходит в удалённый откатом
  `[operator-baho]`: после разговора звонок просто завершится (в логе Asterisk — предупреждение о несуществующем контексте).
  Чтобы убрать и это: в Issabel очистить continue destination очереди 2020159, «Apply Config» (перед этим убедиться, что в
  интерфейсе нет чужих неприменённых изменений), после чего `[sub-evaluate]` можно удалить из `extensions_custom.conf`.
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
# status.sh / verify.sh против настоящей MariaDB с прод-схемой (cdr без linkedid, queues_config, хеш пароля)
docker run -d --name s12-scripts-test -e MARIADB_ROOT_PASSWORD=devroot -v "$PWD/infra/pbx/operator-survey:/src:ro" \
  -v "$PWD/infra/dev-pbx/mariadb-init:/docker-entrypoint-initdb.d:ro" mariadb:11.8
docker exec s12-scripts-test bash /src/test/scripts-mariadb.sh; docker rm -f s12-scripts-test
# AGI по протоколу Asterisk против MariaDB с таблицей (своя копия dev-АТС, не общая и не прод)
TEST_DB_PORT=33061 TEST_USER=baho_writer TEST_PASS=... bash infra/pbx/operator-survey/test/agi-test.sh
```

Фикстура `test/fixtures/extensions_additional.conf` повторяет формат FreePBX 2.11 по памяти; реальный формат на АТС
показывает `status.sh`, и `install.sh` остановится, если строка failover выглядит иначе.
