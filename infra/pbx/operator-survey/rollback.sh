#!/bin/bash
# Operator baholashni O'CHIRISH: *_custom.conf dagi OPERATOR-BAHO bloklari olib tashlanadi.
# Jadval (asteriskcdrdb.operator_baho), yig'ilgan baholar, ovozlar va AGI fayli JOYIDA QOLADI.
# To'liq qaytarish kerak bo'lsa: /root/backup_baho_*.tar.gz (README.md).
set -euo pipefail
for f in globals_custom.conf extensions_custom.conf queues_post_custom.conf; do
  [ -f "/etc/asterisk/$f" ] || continue
  sed -i '/==== OPERATOR-BAHO BOSHI ====/,/==== OPERATOR-BAHO OXIRI ====/d' "/etc/asterisk/$f"
  echo "$f: tozalandi"
done
asterisk -rx "dialplan reload"
asterisk -rx "module reload app_queue.so"
echo "So'rovnoma o'chirildi."
