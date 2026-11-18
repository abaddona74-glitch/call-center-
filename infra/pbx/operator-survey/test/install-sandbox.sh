#!/bin/bash
# install.sh / rollback.sh end to end in a THROWAWAY container (never on a real PBX): fake /etc/asterisk from the
# fixtures, stub asterisk/mysql/mysqldump/php commands that only log. Checks first install, re-run, upgrade of the
# 18.11 block, the multi-queue stop and rollback.
#   docker run --rm -v "$PWD/infra/pbx/operator-survey:/src:ro" debian:trixie-slim bash /src/test/install-sandbox.sh
set -euo pipefail
[ -f /.dockerenv ] || { echo "Run me only inside a throwaway container"; exit 1; }
SRC=${SRC:-/src}
fail=0
eq() { if [ "$2" == "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$3], got [$2]"; fail=1; fi; }

# --- fake PBX ---
id asterisk >/dev/null 2>&1 || useradd -r asterisk
mkdir -p /etc/asterisk /var/lib/asterisk/sounds/custom /var/lib/asterisk/agi-bin /var/log/asterisk /root /stub
printf 'AMPDBUSER=asteriskuser\nAMPDBPASS=secret\n' > /etc/amportal.conf
cp "$SRC/test/fixtures/extensions_additional.conf" "$SRC/test/fixtures/queues_additional.conf" /etc/asterisk/
cp "$SRC/test/fixtures/extensions_custom.conf" /etc/asterisk/
printf '[general]\n#include queues_additional.conf\n#include queues_post_custom.conf\n' > /etc/asterisk/queues.conf
printf '; globals of the PBX\nRINGTIMER = 15\n' > /etc/asterisk/globals_custom.conf
chown asterisk:asterisk /etc/asterisk/*
for c in asterisk mysql mysqldump php; do
  printf '#!/bin/bash\necho "%s $*" >> /stub/calls.log\n' "$c" > "/stub/$c"; chmod +x "/stub/$c"
done
export PATH=/stub:$PATH

run_install() { rm -rf /root/operator_baho; cp -r "$SRC" /root/operator_baho; bash /root/operator_baho/install.sh > /stub/install.out 2>&1; }

# --- first install ---
run_install
eq "install: exit 0" "$?" "0"
G=/etc/asterisk/globals_custom.conf
eq "globals: VQ_DEST" "$(grep -c '^VQ_DEST = operator-baho^s^1$' $G)" "1"
eq "globals: failover detected from ext-queues" "$(sed -n 's/^BAHO_FAILOVER = //p' $G)" "ivr-4^s^1"
eq "globals: the PBX's own globals kept" "$(grep -c '^RINGTIMER = 15$' $G)" "1"
eq "extensions_custom: [operator-baho] once" "$(grep -c '^\[operator-baho\]' /etc/asterisk/extensions_custom.conf)" "1"
eq "extensions_custom: [sub-evaluate] kept" "$(grep -c '^\[sub-evaluate\]' /etc/asterisk/extensions_custom.conf)" "1"
eq "queues_post: queue template" "$(grep -c '^\[2020159\](+)$' /etc/asterisk/queues_post_custom.conf)" "1"
eq "owner stays asterisk" "$(stat -c %U /etc/asterisk/extensions_custom.conf /etc/asterisk/globals_custom.conf | sort -u)" "asterisk"
eq "AGI installed" "$(stat -c '%U %a' /var/lib/asterisk/agi-bin/operator_baho.php)" "asterisk 755"
eq "backup made" "$(ls /root/backup_baho_*.tar.gz | wc -l)" "1"
eq "app_queue reloaded (queues_post changed)" "$(grep -c 'module reload app_queue.so' /stub/calls.log)" "1"
cp -a /etc/asterisk /stub/after-first

# --- re-run: nothing changes, no app_queue reload ---
: > /stub/calls.log
run_install
eq "re-run: exit 0" "$?" "0"
eq "re-run: configs byte-identical" "$(diff -r /stub/after-first /etc/asterisk >/dev/null && echo same)" "same"
eq "re-run: reports unchanged" "$(grep -c ': unchanged' /stub/install.out)" "3"
eq "re-run: no app_queue reload" "$(grep -c 'module reload app_queue.so' /stub/calls.log || true)" "0"

# --- upgrade of the 18.11 install (old block, no BAHO_FAILOVER) ---
cp "$SRC/test/fixtures/extensions_custom_old_install.conf" /etc/asterisk/extensions_custom.conf
printf '; globals\n; ==== OPERATOR-BAHO BOSHI ====\nVQ_CONTINUE = c\nVQ_DEST = operator-baho^s^1\n; ==== OPERATOR-BAHO OXIRI ====\n' > $G
run_install
eq "upgrade: exit 0" "$?" "0"
eq "upgrade: extensions_custom updated" "$(grep -c 'extensions_custom.conf: updated' /stub/install.out)" "1"
eq "upgrade: globals updated" "$(grep -c 'globals_custom.conf: updated' /stub/install.out)" "1"
eq "upgrade: failover now set" "$(sed -n 's/^BAHO_FAILOVER = //p' $G)" "ivr-4^s^1"
eq "upgrade: one VQ_DEST" "$(grep -c '^VQ_DEST' $G)" "1"

# --- a second queue: stop before touching anything ---
cp "$SRC/test/fixtures/queues_two.conf" /etc/asterisk/queues_additional.conf
cp -a /etc/asterisk /stub/before-two
set +e; run_install; rc=$?; set -e
eq "two queues: refused" "$rc" "1"
eq "two queues: nothing changed" "$(diff -r /stub/before-two /etc/asterisk >/dev/null && echo same)" "same"
cp "$SRC/test/fixtures/queues_additional.conf" /etc/asterisk/queues_additional.conf

# --- failover that cannot be detected: stop, unless given explicitly ---
sed -i 's/^exten => 2020159,n,GotoIf.*QDEST.*$/exten => 2020159,n,Goto(${CUT(QDEST,^,1)},s,1)/' /etc/asterisk/extensions_additional.conf
set +e; run_install; rc=$?; set -e
eq "no failover: refused" "$rc" "1"
rm -rf /root/operator_baho; cp -r "$SRC" /root/operator_baho
BAHO_FAILOVER='app-blackhole^hangup^1' bash /root/operator_baho/install.sh > /stub/install.out 2>&1
eq "explicit failover" "$(sed -n 's/^BAHO_FAILOVER = //p' $G)" "app-blackhole^hangup^1"

# --- rollback ---
bash /root/operator_baho/rollback.sh > /stub/rollback.out 2>&1
for f in globals_custom.conf extensions_custom.conf queues_post_custom.conf; do
  eq "rollback: no block in $f" "$(grep -c 'OPERATOR-BAHO' /etc/asterisk/$f || true)" "0"
done
eq "rollback: PBX globals kept" "$(grep -c '^; globals$' $G)" "1"

exit $fail
