#!/bin/bash
# Operator baholash (1..5) — Issabel'ga o'rnatish.
# Ishga tushirish (Issabel serverda, root):  bash /root/operator_baho/install.sh
# Qayta ishga tushirish xavfsiz: allaqachon qo'shilgan bloklar ikkinchi marta qo'shilmaydi.
set -euo pipefail
cd "$(dirname "$0")"
sed -i 's/\r$//' lib.sh backup.sh rollback.sh agi-bin/operator_baho.php conf/*.part operator_baho.sql
. ./lib.sh

echo "== 0/6 Tekshiruv =="
grep -q 'VQ_CONTINUE' "$AST/extensions_additional.conf" && grep -q 'QDEST=${VQ_DEST}' "$AST/extensions_additional.conf" \
  || { echo "XATO: ext-queues da VQ_CONTINUE/VQ_DEST topilmadi — to'xtatildi, hech narsa o'zgarmadi"; exit 1; }
if [ -f "$AST/globals_custom.conf" ] && ! grep -qF "$MARK" "$AST/globals_custom.conf" \
   && grep -qE '^\s*VQ_(CONTINUE|DEST)\s*=' "$AST/globals_custom.conf"; then
  echo "XATO: globals_custom.conf da VQ_CONTINUE/VQ_DEST allaqachon bor — qo'lda ko'ring"; exit 1
fi
if [ -f "$AST/extensions_custom.conf" ] && ! grep -qF "$MARK" "$AST/extensions_custom.conf" \
   && grep -q '^\[operator-baho\]' "$AST/extensions_custom.conf"; then
  echo "XATO: extensions_custom.conf da [operator-baho] konteksti allaqachon bor"; exit 1
fi
echo "  OK"

echo "== 1/6 Backup =="
bash ./backup.sh

echo "== 2/6 Ovozlar -> /var/lib/asterisk/sounds/custom =="
install -o asterisk -g asterisk -m 644 sounds/baho-savol.wav sounds/baho-rahmat.wav /var/lib/asterisk/sounds/custom/
echo "  OK"

echo "== 3/6 AGI skript =="
install -o asterisk -g asterisk -m 755 agi-bin/operator_baho.php /var/lib/asterisk/agi-bin/
php -l /var/lib/asterisk/agi-bin/operator_baho.php
touch /var/log/asterisk/operator_baho.log && chown asterisk:asterisk /var/log/asterisk/operator_baho.log

echo "== 4/6 Jadval asteriskcdrdb.operator_baho =="
mysql --defaults-extra-file="$ADMIN_CNF" < operator_baho.sql
# AGI foydalanuvchisi ($AMPUSER) yoza oladimi — sinov qatori yozib, darhol o'chiramiz
if mysql --defaults-extra-file="$AMP_CNF" asteriskcdrdb -e \
   "INSERT INTO operator_baho (rated_at,uniqueid,baho) VALUES (NOW(),'install-test',5); DELETE FROM operator_baho WHERE uniqueid='install-test';"; then
  echo "  OK ($AMPUSER yoza oladi)"
else
  echo "  OGOHLANTIRISH: $AMPUSER jadvalga yoza olmadi. Root bilan bajaring:"
  echo "  GRANT SELECT, INSERT, UPDATE ON asteriskcdrdb.operator_baho TO '$AMPUSER'@'localhost';"
fi

echo "== 5/6 Konfiguratsiya (*_custom.conf ga qo'shish) =="
append_part() {
  local dst="$AST/$1" part="conf/$1.part"
  if [ -f "$dst" ] && grep -qF "$MARK" "$dst"; then echo "  $1: allaqachon bor"; return; fi
  cat "$part" >> "$dst"; chown asterisk:asterisk "$dst"; echo "  $1: qo'shildi"
}
append_part extensions_custom.conf
# setinterfacevar faqat queues_post_custom.conf queues_additional.conf DAN KEYIN include bo'lsa qo'shiladi,
# aks holda [2020159](+) xato beradi. Qo'shilmasa ham ishlaydi: operator queue_log'dan topiladi.
QA=$(grep -nE '^#include\s+"?queues_additional\.conf' "$AST/queues.conf" | head -1 | cut -d: -f1 || true)
QP=$(grep -nE '^#include\s+"?queues_post_custom\.conf' "$AST/queues.conf" | head -1 | cut -d: -f1 || true)
if [ -n "$QA" ] && [ -n "$QP" ] && [ "$QP" -gt "$QA" ]; then
  append_part queues_post_custom.conf
else
  echo "  queues_post_custom.conf: queues.conf da mos include yo'q — o'tkazib yuborildi (queue_log zaxira yo'li ishlaydi)"
fi
append_part globals_custom.conf      # eng oxirida — shu qadamdan keyin so'rovnoma yoqiladi

echo "== 6/6 Reload =="
asterisk -rx "dialplan reload"
asterisk -rx "module reload app_queue.so"
echo
asterisk -rx "dialplan show operator-baho" | grep -E "operator-baho|Read|AGI" || true
asterisk -rx "dialplan show globals" | grep -E "VQ_(CONTINUE|DEST)" || echo "OGOHLANTIRISH: VQ_* global o'zgaruvchilar ko'rinmadi"
echo
echo "TAYYOR. Endi test qo'ng'iroq qiling (README.md, 'Test' bo'limi)."
echo "Log: tail -f /var/log/asterisk/operator_baho.log"
