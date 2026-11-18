#!/bin/bash
# Tests for lib-conf.sh (pure config helpers) on fixture files. Runs anywhere with bash + GNU sed, e.g.:
#   docker run --rm -v "$PWD/infra/pbx/operator-survey:/s:ro" debian:trixie-slim bash /s/test/conf-test.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../lib-conf.sh"
FX=$HERE/fixtures
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
fail=0
eq() { if [ "$2" == "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$3], got [$2]"; fail=1; fi; }

eq "list_queues: one queue" "$(list_queues "$FX/queues_additional.conf")" "2020159"
eq "list_queues: two queues, no [general]" "$(list_queues "$FX/queues_two.conf" | tr '\n' ' ')" "200 2020159 "
eq "detect_failover: ext-queues GotoIf" "$(detect_failover "$FX/extensions_additional.conf" 2020159)" "ivr-4^s^1"
eq "detect_failover: unknown queue" "$(detect_failover "$FX/extensions_additional.conf" 999)" ""
eq "valid_dest: ok" "$(valid_dest 'app-blackhole^hangup^1' && echo y)" "y"
eq "valid_dest: no loop into operator-baho" "$(valid_dest 'operator-baho^s^1' || echo n)" "n"
eq "valid_dest: no variables" "$(valid_dest '${CUT(QDEST,^,1)}^s^1' || echo n)" "n"

part=$W/part
sed -e 's/@BAHO_QUEUE@/2020159/g' -e 's/@BAHO_FAILOVER@/ivr-4^s^1/g' "$HERE/../conf/extensions_custom.conf.part" > "$part"

cp "$FX/extensions_custom.conf" "$W/ext.conf"
eq "replace_block: first install" "$(replace_block "$W/ext.conf" "$part")" "added"
eq "replace_block: keeps the existing dialplan" "$(grep -c '^\[sub-evaluate\]' "$W/ext.conf")" "1"
eq "replace_block: block lines" "$(block_lines "$W/ext.conf")" "$(wc -l < "$part" | tr -d ' ')"
cp "$W/ext.conf" "$W/ext.first"
eq "replace_block: re-run is a no-op" "$(replace_block "$W/ext.conf" "$part")" "unchanged"
eq "replace_block: re-run leaves the file byte-identical" "$(cmp -s "$W/ext.conf" "$W/ext.first" && echo same)" "same"

cp "$FX/extensions_custom_old_install.conf" "$W/old.conf"
eq "replace_block: upgrades the 18.11 block" "$(replace_block "$W/old.conf" "$part")" "updated"
eq "replace_block: one [operator-baho] after upgrade" "$(grep -c '^\[operator-baho\]' "$W/old.conf")" "1"
eq "replace_block: the new failover branch is in" "$(grep -cF 'CUT(BAHO_FAILOVER,^,1)' "$W/old.conf")" "1"
eq "replace_block: the old hang-up-on-everything rule is gone" "$(grep -c '!= "CONTINUE"' "$W/old.conf" || true)" "0"

touch "$W/empty.conf"
eq "replace_block: empty file" "$(replace_block "$W/empty.conf" "$part")" "added"
eq "replace_block: empty file gets no leading blank line" "$(head -1 "$W/empty.conf")" "; ==== OPERATOR-BAHO BOSHI ===="

eq "remove_block: rollback" "$(remove_block "$W/ext.conf")" "removed"
eq "remove_block: back to the original content (+1 separator line)" \
  "$(diff <(cat "$FX/extensions_custom.conf"; echo) "$W/ext.conf" && echo same)" "same"
eq "remove_block: absent" "$(remove_block "$W/ext.conf")" "absent"

eq "mask_secrets: MariaDB 5.5 password hash" \
  "$(echo "GRANT USAGE ON *.* TO 'cc_readonly'@'192.168.0.30' IDENTIFIED BY PASSWORD '*DFB0B1844EEA8BF5A8100D91D4C39FA104461446'" | mask_secrets)" \
  "GRANT USAGE ON *.* TO 'cc_readonly'@'192.168.0.30' IDENTIFIED BY PASSWORD '***'"
eq "mask_secrets: auth plugin string" "$(echo "IDENTIFIED VIA mysql_native_password USING '*ABC'" | mask_secrets)" \
  "IDENTIFIED VIA mysql_native_password USING '***'"
eq "mask_secrets: table grants untouched" "$(echo "GRANT SELECT ON \`asteriskcdrdb\`.\`cdr\` TO 'cc_readonly'@'h'" | mask_secrets)" \
  "GRANT SELECT ON \`asteriskcdrdb\`.\`cdr\` TO 'cc_readonly'@'h'"

exit $fail
