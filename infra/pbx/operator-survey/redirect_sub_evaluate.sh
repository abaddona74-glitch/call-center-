#!/bin/bash
# ONE-OFF, ALREADY RUN on the PBX on 18.11.2026 at 14:27 (README.md, "Что сейчас на АТС"). Do not run again:
# kept only as the record of what was changed by hand. The SELECTs at the end are that day's debug queries.
# Eski [sub-evaluate] -> [operator-baho]. Faqat extensions_custom.conf (nusxa bilan); asl qatorlar ;OLD bo'ladi.
set -euo pipefail
F=/etc/asterisk/extensions_custom.conf
grep -q '^\[sub-evaluate\]' $F || { echo "XATO: [sub-evaluate] yo'q"; exit 1; }
if ! grep -q '^exten => s,1,Goto(operator-baho' $F; then
  B=$F.bak_$(date +%H%M%S); cp -a $F $B; echo "Nusxa: $B"
  awk '/^\[sub-evaluate\]/{print;print "; 18.11: [operator-baho] ga yonaltirildi";print "exten => s,1,Goto(operator-baho,s,1)";s=1;next}
    s&&/^\[/{s=0} s&&/^[[:space:]]*(exten|same)[[:space:]]*=>/{print ";OLD " $0;next} {print}' $B > $F
  chown asterisk:asterisk $F
fi
asterisk -rx "dialplan reload"
asterisk -rx "dialplan show sub-evaluate"
cd /root/operator_baho; . ./lib.sh
Q() { mysql --defaults-extra-file=$ADMIN_CNF -t asteriskcdrdb -e "$1"; }
Q "SELECT calldate,dst,dcontext,LEFT(dstchannel,25) ch,disposition,billsec,userfield,recordingfile FROM cdr WHERE uniqueid='1794993024.2542722'"
Q "SELECT calldate,src,uniqueid,userfield FROM cdr WHERE calldate>=CURDATE() AND userfield LIKE 'rating:%'"
