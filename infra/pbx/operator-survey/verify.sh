#!/bin/bash
# Test qo'ng'iroqdan keyingi tekshiruv. Faqat O'QIYDI, hech narsani o'zgartirmaydi.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
q() { mysql --defaults-extra-file="$ADMIN_CNF" asteriskcdrdb "$@"; }

echo "== AGI log (oxirgi 5 qator) =="
tail -n 5 /var/log/asterisk/operator_baho.log 2>/dev/null || true
echo
echo "== operator_baho (oxirgi 5 baho) =="
q -t -e "SELECT id, rated_at, uniqueid, operator_ext, operator_name, src, baho FROM operator_baho ORDER BY id DESC LIMIT 5"

LAST=$(q -N -e "SELECT uniqueid FROM operator_baho ORDER BY id DESC LIMIT 1")
if [ -z "$LAST" ]; then echo "Hali birorta baho yo'q."; exit 0; fi
case "$LAST" in *[!0-9.]*) echo "Kutilmagan uniqueid: $LAST"; exit 1 ;; esac

echo
echo "== CDR: $LAST qo'ng'irog'ining qatorlari (so'rovnoma qatori bo'lmasligi kerak) =="
q -t -e "SELECT calldate, src, dst, dcontext, LEFT(dstchannel, 32) AS dstchannel, disposition, billsec, recordingfile
         FROM cdr WHERE uniqueid = '$LAST' ORDER BY calldate"

REC=$(q -N -e "SELECT recordingfile FROM cdr WHERE uniqueid = '$LAST' AND recordingfile <> '' LIMIT 1")
echo
if [ -z "$REC" ]; then
  echo "OGOHLANTIRISH: bu qo'ng'iroqning CDR'ida recordingfile bo'sh"
else
  F=$(find /var/spool/asterisk/monitor -name "$REC" 2>/dev/null | head -1)
  if [ -n "$F" ]; then echo "Suhbat yozuvi joyida: $F ($(du -h "$F" | cut -f1))"; else echo "OGOHLANTIRISH: $REC fayli diskda topilmadi"; fi
fi
