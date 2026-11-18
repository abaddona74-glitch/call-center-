#!/bin/bash
# Turn the post-call survey OFF: removes the OPERATOR-BAHO blocks from the *_custom.conf files and reloads.
# Queues are back to their own failover destinations and to hanging up the caller when the operator hangs up.
# Kept: the table asteriskcdrdb.operator_baho with the ratings, the sounds, the AGI file.
# Not touched: the old [sub-evaluate] context (redirect_sub_evaluate.sh) — see README.md, "Откат".
# Full restore of every config: /root/backup_baho_<time>.tar.gz (README.md).
set -euo pipefail
cd "$(dirname "$0")"
. ./lib-conf.sh
AST=${AST:-/etc/asterisk}
for f in globals_custom.conf extensions_custom.conf queues_post_custom.conf; do
  [ -f "$AST/$f" ] || continue
  echo "$f: $(remove_block "$AST/$f")"
done
asterisk -rx "dialplan reload"
asterisk -rx "module reload app_queue.so"
asterisk -rx "dialplan show globals" | grep -E "VQ_(CONTINUE|DEST)|BAHO_FAILOVER" && echo "ВНИМАНИЕ: переменные ещё видны" \
  || echo "Опрос выключен."
