#!/bin/bash
# Full backup BEFORE install/upgrade (changes nothing, only writes an archive to /root):
#   /etc/asterisk (all *_custom.conf), sounds/custom, agi-bin,
#   the asterisk DB (IssabelPBX settings, full), asteriskcdrdb (schema only — no CDR data).
# The archive holds SIP secrets from the asterisk DB: it stays in /root (root only), never copy it off the PBX.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
umask 077

TS=$(date +%Y%m%d_%H%M%S); NAME=backup_baho_$TS; D=/root/$NAME
mkdir -p "$D"
cp -a /etc/asterisk                  "$D/etc_asterisk"
cp -a /var/lib/asterisk/sounds/custom "$D/sounds_custom"
cp -a /var/lib/asterisk/agi-bin      "$D/agi-bin"
mysqldump --defaults-extra-file="$ADMIN_CNF" --single-transaction asterisk > "$D/asterisk.sql"
mysqldump --defaults-extra-file="$ADMIN_CNF" --no-data asteriskcdrdb   > "$D/asteriskcdrdb_schema.sql"
tar -czf "/root/$NAME.tar.gz" -C /root "$NAME" && rm -rf "$D"
tar -tzf "/root/$NAME.tar.gz" > /dev/null   # the archive is readable
echo "РЕЗЕРВНАЯ КОПИЯ: /root/$NAME.tar.gz ($(du -h "/root/$NAME.tar.gz" | cut -f1))"
