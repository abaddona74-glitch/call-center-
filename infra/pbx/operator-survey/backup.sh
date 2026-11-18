#!/bin/bash
# Operator baholashdan OLDIN to'liq backup (hech narsani o'zgartirmaydi, faqat /root ga arxiv yozadi):
#   /etc/asterisk (barcha *_custom.conf bilan), sounds/custom, agi-bin,
#   asterisk DB (to'liq — IssabelPBX sozlamalari), asteriskcdrdb (faqat sxema — cdr ma'lumotiga tegilmaydi)
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

TS=$(date +%Y%m%d_%H%M%S); NAME=backup_baho_$TS; D=/root/$NAME
mkdir -p "$D"
cp -a /etc/asterisk                  "$D/etc_asterisk"
cp -a /var/lib/asterisk/sounds/custom "$D/sounds_custom"
cp -a /var/lib/asterisk/agi-bin      "$D/agi-bin"
mysqldump --defaults-extra-file="$ADMIN_CNF" --single-transaction asterisk > "$D/asterisk.sql"
mysqldump --defaults-extra-file="$ADMIN_CNF" --no-data asteriskcdrdb   > "$D/asteriskcdrdb_schema.sql"
tar -czf "/root/$NAME.tar.gz" -C /root "$NAME" && rm -rf "$D"
tar -tzf "/root/$NAME.tar.gz" > /dev/null   # arxiv o'qiladimi — tekshiruv
echo "BACKUP TAYYOR: /root/$NAME.tar.gz ($(du -h "/root/$NAME.tar.gz" | cut -f1))"
