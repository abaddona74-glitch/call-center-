#!/bin/bash
# status.sh / verify.sh against a real MariaDB in a THROWAWAY container (never on a real PBX), with the production
# schema quirks: cdr WITHOUT linkedid (Issabel's default), asterisk.queues_config with dest/destcontinue,
# cc_readonly with a password hash. Then again with a linkedid column. Stub `asterisk`; mysql = mariadb.
#   docker run -d --name s12-scripts-test -e MARIADB_ROOT_PASSWORD=devroot \
#     -v "$PWD/infra/pbx/operator-survey:/src:ro" -v "$PWD/infra/dev-pbx/mariadb-init:/docker-entrypoint-initdb.d:ro" mariadb:11.8
#   docker exec s12-scripts-test bash /src/test/scripts-mariadb.sh; docker rm -f s12-scripts-test
set -euo pipefail
[ -f /.dockerenv ] || { echo "Run me only inside a throwaway container"; exit 1; }
for i in $(seq 1 40); do healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1 && break; sleep 2; done
fail=0
eq() { if [ "$2" == "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$3], got [$2]"; fail=1; fi; }
has() { if grep -qF -- "$2" "$3"; then echo "ok   $1"; else echo "FAIL $1: no [$2] in output"; fail=1; fi; }
hasnt() { if grep -qF -- "$2" "$3"; then echo "FAIL $1: [$2] in output"; fail=1; else echo "ok   $1"; fi; }

mkdir -p /stub /etc/asterisk /var/log/asterisk
command -v mysql >/dev/null || ln -s "$(command -v mariadb)" /stub/mysql
printf '#!/bin/bash\necho "stub asterisk $*"\n' > /stub/asterisk; chmod +x /stub/asterisk
export PATH=/stub:$PATH
printf 'AMPDBUSER=root\nAMPDBPASS=devroot\n' > /etc/amportal.conf
printf 'mysqlrootpwd=devroot\n' > /etc/issabel.conf
cp /src/test/fixtures/extensions_additional.conf /src/test/fixtures/queues_additional.conf /etc/asterisk/
touch /etc/asterisk/extensions_custom.conf
rm -rf /root/operator_baho && cp -r /src /root/operator_baho

mariadb -uroot -pdevroot <<'SQL'
ALTER TABLE asteriskcdrdb.cdr DROP COLUMN IF EXISTS linkedid;
CREATE TABLE IF NOT EXISTS asterisk.queues_config (extension VARCHAR(20) PRIMARY KEY, descr VARCHAR(35), dest VARCHAR(50) NOT NULL DEFAULT '', destcontinue VARCHAR(50) NOT NULL DEFAULT '');
REPLACE INTO asterisk.queues_config VALUES ('2020159', 'Call center', '', 'sub-evaluate,s,1');
INSERT INTO asteriskcdrdb.cdr (calldate, clid, src, dst, dcontext, channel, dstchannel, lastapp, lastdata, duration, billsec, disposition, uniqueid, recordingfile)
  VALUES (NOW() - INTERVAL 2 MINUTE, '"998901234567" <998901234567>', '998901234567', '2020159', 'ext-queues', 'SIP/712020159-0000aaaa', 'Local/111@from-queue-0000bbbb;1', 'Queue', '2020159', 90, 60, 'ANSWERED', '1795000000.42', 'q2020159-test.wav');
REPLACE INTO asteriskcdrdb.operator_baho (rated_at, uniqueid, linkedid, queue, operator_ext, operator_name, member_interface, src, baho)
  VALUES (NOW(), '1795000000.42', '1795000000.42', '2020159', '111', 'Oybek', 'Local/111@from-queue/n', '998901234567', 4);
SQL

bash /root/operator_baho/verify.sh > /stub/verify.out 2>&1 || true
hasnt "verify without cdr.linkedid: no SQL error" "Unknown column" /stub/verify.out
hasnt "verify without cdr.linkedid: no ERROR" "ERROR" /stub/verify.out
has "verify: finds the call's CDR row" "ext-queues" /stub/verify.out
has "verify: last rating shown" "Oybek" /stub/verify.out

mariadb -uroot -pdevroot -e "ALTER TABLE asteriskcdrdb.cdr ADD COLUMN linkedid VARCHAR(32) NOT NULL DEFAULT '';"
bash /root/operator_baho/verify.sh > /stub/verify2.out 2>&1 || true
hasnt "verify with cdr.linkedid: no SQL error" "ERROR" /stub/verify2.out
has "verify with cdr.linkedid: finds the call" "ext-queues" /stub/verify2.out

bash /root/operator_baho/status.sh > /stub/status.out 2>&1 || true
has "status: queue failover and continue destination from the DB" "sub-evaluate,s,1" /stub/status.out
has "status: cc_readonly grants listed" "GRANT SELECT ON \`asteriskcdrdb\`.*" /stub/status.out
has "status: password hash masked" "IDENTIFIED BY PASSWORD '***'" /stub/status.out
eq "status: no hash in the output" "$(grep -cE "PASSWORD '\*[0-9A-F]{40}'" /stub/status.out || true)" "0"
hasnt "status: no 'Apply Config wipes it' claim" "теряются при Apply Config" /stub/status.out

[ "$fail" = 0 ] || { echo "--- verify.out"; cat /stub/verify.out; echo "--- status.out"; cat /stub/status.out; }
exit $fail
