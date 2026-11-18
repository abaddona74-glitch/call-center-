#!/bin/bash
# Post-call operator survey (1..5) — install or upgrade on the Issabel PBX. Run by the owner as root, on the PBX:
#   bash /root/operator_baho/status.sh     # read-only: what is installed now, the queue and its failover
#   bash /root/operator_baho/install.sh
# Safe to re-run: it replaces its own marked blocks (an older install gets upgraded) and changes nothing else.
# Options (environment): BAHO_QUEUE=2020159   BAHO_FAILOVER=ctx^exten^prio (when it cannot be detected).
set -euo pipefail
cd "$(dirname "$0")"
# Files copied from Windows may have CRLF (not this script: bash is reading it right now).
sed -i 's/\r$//' lib.sh lib-conf.sh backup.sh rollback.sh status.sh verify.sh agi-bin/operator_baho.php conf/*.part operator_baho.sql
. ./lib.sh
EXT_ADD=$AST/extensions_additional.conf

echo "== 0/6 Проверки (ничего не меняют) =="
grep -q 'VQ_CONTINUE' "$EXT_ADD" && grep -q 'QDEST=${VQ_DEST}' "$EXT_ADD" \
  || { echo "СТОП: в ext-queues нет VQ_CONTINUE/VQ_DEST — эта версия IssabelPBX не подходит. Ничего не изменено."; exit 1; }

QUEUES=$(list_queues "$AST/queues_additional.conf")
echo "  очереди на АТС: $(echo "$QUEUES" | tr '\n' ' ')"
echo "$QUEUES" | grep -qx "$BAHO_QUEUE" || { echo "СТОП: очереди $BAHO_QUEUE нет. Ничего не изменено."; exit 1; }
if [ "$(echo "$QUEUES" | grep -c .)" -gt 1 ]; then
  echo "СТОП: очередей больше одной. VQ_CONTINUE/VQ_DEST — глобальные: опрос включится во ВСЕХ очередях, а их"
  echo "      failover заменится на failover очереди $BAHO_QUEUE. Нужна отдельная доработка. Ничего не изменено."
  exit 1
fi

FAILOVER=${BAHO_FAILOVER:-$(detect_failover "$EXT_ADD" "$BAHO_QUEUE")}
if ! valid_dest "$FAILOVER"; then
  echo "СТОП: не удалось определить failover очереди $BAHO_QUEUE. Строки ext-queues с QDEST:"
  grep -n "^exten => $BAHO_QUEUE,.*QDEST" "$EXT_ADD" || true
  echo "Задайте его вручную в формате контекст^экстеншн^приоритет, например:"
  echo "  BAHO_FAILOVER='app-blackhole^hangup^1' bash install.sh"
  exit 1
fi
echo "  failover очереди $BAHO_QUEUE: $FAILOVER (туда уйдут звонки без разговора, как и до опроса)"

if [ -f "$AST/globals_custom.conf" ] && [ "$(block_lines "$AST/globals_custom.conf")" = 0 ] \
   && grep -qE '^\s*(VQ_CONTINUE|VQ_DEST|BAHO_FAILOVER)\s*=' "$AST/globals_custom.conf"; then
  echo "СТОП: в globals_custom.conf уже есть VQ_*/BAHO_* вне нашего блока — разберитесь вручную."; exit 1
fi
if [ -f "$AST/extensions_custom.conf" ] && [ "$(block_lines "$AST/extensions_custom.conf")" = 0 ] \
   && grep -q '^\[operator-baho\]' "$AST/extensions_custom.conf"; then
  echo "СТОП: в extensions_custom.conf уже есть [operator-baho] вне нашего блока."; exit 1
fi
echo "  OK"

echo "== 1/6 Резервная копия =="
bash ./backup.sh

echo "== 2/6 Звуки -> /var/lib/asterisk/sounds/custom =="
install -o asterisk -g asterisk -m 644 sounds/baho-savol.wav sounds/baho-rahmat.wav /var/lib/asterisk/sounds/custom/
echo "  OK"

echo "== 3/6 AGI =="
install -o asterisk -g asterisk -m 755 agi-bin/operator_baho.php /var/lib/asterisk/agi-bin/
php -l /var/lib/asterisk/agi-bin/operator_baho.php
touch /var/log/asterisk/operator_baho.log && chown asterisk:asterisk /var/log/asterisk/operator_baho.log

echo "== 4/6 Таблица asteriskcdrdb.operator_baho =="
mysql --defaults-extra-file="$ADMIN_CNF" < operator_baho.sql
# Can the AGI user write? Insert a probe row and delete it right away.
if mysql --defaults-extra-file="$AMP_CNF" asteriskcdrdb -e \
   "INSERT INTO operator_baho (rated_at,uniqueid,baho) VALUES (NOW(),'install-test',5); DELETE FROM operator_baho WHERE uniqueid='install-test';"; then
  echo "  OK ($AMPUSER может писать)"
else
  echo "  ВНИМАНИЕ: $AMPUSER не может писать в таблицу. Выполните под root MariaDB:"
  echo "  GRANT SELECT, INSERT, UPDATE ON asteriskcdrdb.operator_baho TO '$AMPUSER'@'localhost';"
fi

echo "== 5/6 Конфигурация (*_custom.conf, только наши блоки) =="
TMP_PARTS=$(mktemp -d)
trap 'rm -rf "$TMP_PARTS"; rm -f "$AMP_CNF" "$ADMIN_CNF"' EXIT
for p in extensions_custom globals_custom queues_post_custom; do
  sed -e "s/@BAHO_QUEUE@/$BAHO_QUEUE/g" -e "s/@BAHO_FAILOVER@/$FAILOVER/g" "conf/$p.conf.part" > "$TMP_PARTS/$p.conf.part"
done
apply() {
  local name=$1 res
  [ -f "$AST/$name" ] || { touch "$AST/$name"; chown asterisk:asterisk "$AST/$name"; }
  res=$(replace_block "$AST/$name" "$TMP_PARTS/$name.part")
  echo "  $name: $res"
  [ "$res" != unchanged ]
}
apply extensions_custom.conf || true
# setinterfacevar only works when queues_post_custom.conf is included AFTER queues_additional.conf
# (otherwise "[queue](+)" fails). Without it the AGI still finds the operator in queue_log.
QUEUES_CHANGED=no
QA=$(grep -nE '^#include\s+"?queues_additional\.conf' "$AST/queues.conf" | head -1 | cut -d: -f1 || true)
QP=$(grep -nE '^#include\s+"?queues_post_custom\.conf' "$AST/queues.conf" | head -1 | cut -d: -f1 || true)
if [ -n "$QA" ] && [ -n "$QP" ] && [ "$QP" -gt "$QA" ]; then
  if apply queues_post_custom.conf; then QUEUES_CHANGED=yes; fi
else
  echo "  queues_post_custom.conf: нет подходящего #include в queues.conf — пропущено (оператор берётся из queue_log)"
fi
apply globals_custom.conf || true      # last: the survey switches on with this block

echo "== 6/6 Применение =="
asterisk -rx "dialplan reload"
if [ "$QUEUES_CHANGED" = yes ]; then asterisk -rx "module reload app_queue.so"; fi
echo
asterisk -rx "dialplan show operator-baho" | grep -E "operator-baho|CONTINUE|BAHO_FAILOVER|AGI" || true
asterisk -rx "dialplan show globals" | grep -E "VQ_(CONTINUE|DEST)|BAHO_FAILOVER" || echo "ВНИМАНИЕ: глобальные VQ_*/BAHO_FAILOVER не видны"
echo
echo "ГОТОВО. Дальше — проверочные звонки (README.md, «Проверка») и: bash verify.sh"
echo "Лог AGI: tail -f /var/log/asterisk/operator_baho.log"
