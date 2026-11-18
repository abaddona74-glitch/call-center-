#!/bin/bash
# Check after the test calls (README.md, "Проверка"). Read-only: changes nothing.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
q() { mysql --defaults-extra-file="$ADMIN_CNF" asteriskcdrdb "$@"; }

echo "== Лог AGI (последние 5 строк)"
tail -n 5 /var/log/asterisk/operator_baho.log 2>/dev/null || true
echo
echo "== operator_baho (последние 5 оценок)"
q -t -e "SELECT id, rated_at, uniqueid, queue, operator_ext, operator_name, src, baho FROM operator_baho ORDER BY id DESC LIMIT 5"

LAST=$(q -N -e "SELECT uniqueid FROM operator_baho ORDER BY id DESC LIMIT 1")
if [ -z "$LAST" ]; then echo "Оценок пока нет."; exit 0; fi
case "$LAST" in *[!0-9.]*) echo "Неожиданный uniqueid: $LAST"; exit 1 ;; esac

echo
echo "== CDR звонка $LAST (строки опроса быть не должно)"
q -t -e "SELECT calldate, src, dst, dcontext, LEFT(dstchannel, 32) AS dstchannel, disposition, billsec, recordingfile
         FROM cdr WHERE uniqueid = '$LAST' OR linkedid = '$LAST' ORDER BY calldate"
EXTRA=$(q -N -e "SELECT COUNT(*) FROM cdr WHERE (uniqueid = '$LAST' OR linkedid = '$LAST') AND dcontext = 'operator-baho'")
[ "$EXTRA" = 0 ] || echo "ВНИМАНИЕ: в CDR есть строки опроса (dcontext=operator-baho): $EXTRA"

REC=$(q -N -e "SELECT recordingfile FROM cdr WHERE uniqueid = '$LAST' AND recordingfile <> '' LIMIT 1")
echo
if [ -z "$REC" ]; then
  echo "ВНИМАНИЕ: у звонка пустой recordingfile в CDR"
else
  F=$(find /var/spool/asterisk/monitor -name "$REC" 2>/dev/null | head -1)
  if [ -n "$F" ]; then echo "Запись разговора на месте: $F ($(du -h "$F" | cut -f1))"; else echo "ВНИМАНИЕ: файла $REC нет на диске"; fi
fi

echo
echo "== Звонки, закончившиеся в operator-baho за сутки (после исправления failover их быть не должно)"
q -t -e "SELECT calldate, src, dst, dcontext, lastapp, LEFT(lastdata, 40) AS lastdata FROM cdr
         WHERE calldate >= NOW() - INTERVAL 1 DAY AND dcontext = 'operator-baho' ORDER BY calldate DESC LIMIT 10"
