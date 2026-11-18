# Operator baholash (1–5) — Issabel

> PBX-side package for the post-call operator survey (Issabel dialplan, AGI, sounds, table).
> Run by the owner on the PBX console, never by the app (AGENTS.md). The app only reads
> `asteriskcdrdb.operator_baho` (docs/rewrite/METRICS.md §3, DEPLOY.md §11.1).

## Hozirgi holat (18.11.2026)

- 14:08 — `install.sh` bilan o'rnatildi; backup: `/root/backup_baho_20261118_140834.tar.gz`.
- 14:27 — serverda oldindan bor `[sub-evaluate]` so'rovnomasi (12:32 da qo'shilgan; butun
  `tanlash.wav` ni qo'yib, bahoni `CDR(userfield)` ga yozardi va qo'lda tahrirlangan
  `extensions_additional.conf` dagi `gotocontinue` qatoriga ulangan edi) `redirect_sub_evaluate.sh` bilan
  `Goto(operator-baho,s,1)` ga almashtirildi; nusxa: `/etc/asterisk/extensions_custom.conf.bak_142719`.
  Endi `gotocontinue` qatori bo'lsa ham, Apply Config'dan keyin yo'qolsa ham — qo'ng'iroq `[operator-baho]` ga boradi.
- 14:28 — test qo'ng'iroq: operator 111 → baho 4 jadvalga yozildi (operator to'g'ri aniqlandi),
  CDR'da ortiqcha qator yo'q, suhbat yozuvi joyida.

## Qanday ishlaydi

Mijoz → IVR (`ivr-4`) → navbat `2020159` → operator javob beradi → suhbat →
**operator go'shakni qo'yadi** → mijoz `baho-savol` ni eshitadi → 1..5 dan birini bosadi →
`baho-rahmat` → baho `asteriskcdrdb.operator_baho` jadvaliga yoziladi.

- Mijoz o'zi birinchi go'shakni qo'ysa — so'rovnoma bo'lmaydi (u allaqachon chiqib ketgan).
- Operator qo'ng'iroqni boshqa raqamga transfer qilsa — so'rovnoma bo'lmaydi.
- 7 soniyada bosmasa yoki 1–5 dan boshqa tugma bossa — yana bir marta so'raydi, keyin tugatadi.

Texnik jihatdan: IssabelPBX yaratgan `ext-queues` da `QOPTIONS` ga `${VQ_CONTINUE}` qo'shiladi va
navbatdan keyin `${VQ_DEST}` ga o'tiladi. Biz bu ikkalasini `globals_custom.conf` da beramiz
(`c` = operator go'shakni qo'ysa mijoz dialplanda davom etadi). IssabelPBX GUI va
avto-generatsiya qilinadigan fayllarga tegilmaydi.

## Baho qayerda saqlanadi: CDR emas, alohida jadval

`asteriskcdrdb.operator_baho` — CDR bilan bitta bazada, `uniqueid` orqali bog'lanadi.

CDR'ning o'ziga yozmaslik sababi:
1. Operator go'shakni qo'yganda suhbatning CDR qatori **yopilib bo'lgan** bo'ladi. Asterisk so'rovnoma
   qismi uchun yangi CDR qatori ochadi — `CDR(userfield)` ga yozilgan baho suhbat qatoriga emas,
   shu yangi "bo'sh" qatorga tushadi.
2. Bu qo'shimcha qatorlar Issabel hisobotlarida va dashboard'da (`issabelDbService.js` dagi
   `channel LIKE 'SIP/712020159%'` sharti) ortiqcha qo'ng'iroq bo'lib ko'rinadi. Shuning uchun so'rovnoma
   qismida `CDR_PROP(disable)=1` qilinadi — CDR'ga hech narsa qo'shilmaydi.
3. `cdr` jadvalini Issabel o'zi boshqaradi; unga ustun qo'shish yangilanishda muammo beradi.
   Alohida jadvalda: 1 qo'ng'iroq = 1 baho (`UNIQUE uniqueid`), operator bo'yicha indeks, tez hisobot.

## Fayllar

| Fayl | Serverda qayerga |
|---|---|
| `sounds/baho-savol.wav` (5.7 s, "...birini bosing.") | `/var/lib/asterisk/sounds/custom/` |
| `sounds/baho-rahmat.wav` (2.0 s, "Bahoyingiz uchun rahmat!") | `/var/lib/asterisk/sounds/custom/` |
| `agi-bin/operator_baho.php` | `/var/lib/asterisk/agi-bin/` |
| `operator_baho.sql` | `asteriskcdrdb.operator_baho` jadvali |
| `conf/extensions_custom.conf.part` | `/etc/asterisk/extensions_custom.conf` oxiriga |
| `conf/globals_custom.conf.part` | `/etc/asterisk/globals_custom.conf` oxiriga (yoqish tugmasi) |
| `conf/queues_post_custom.conf.part` | `/etc/asterisk/queues_post_custom.conf` oxiriga (`setinterfacevar=yes`) |
| `backup.sh`, `install.sh`, `rollback.sh`, `lib.sh` | skriptlar |
| `verify.sh` | test qo'ng'iroqdan keyin tekshiruv (faqat o'qiydi): oxirgi baholar, CDR qatorlari, yozuv fayli |
| `redirect_sub_evaluate.sh` | eski `[sub-evaluate]` ni `[operator-baho]` ga yo'naltirish (bir martalik, bajarilgan) |

`tanlash.mp3` → 8 kHz, mono, 16-bit PCM WAV (Asterisk formati) qilingan va 5.70 s dagi pauzadan
ikkiga bo'lingan. **O'rnatishdan oldin ikkala wav'ni eshitib ko'ring.**

## O'rnatish

Windows'dan (parol 2 marta so'raladi: avval kerio, keyin issabel):

```
scp -r infra\pbx\operator-survey issabel:/root/operator_baho
ssh issabel "bash /root/operator_baho/install.sh"
```

`install.sh` tartibi: tekshiruv → **to'liq backup** (`/root/backup_baho_<vaqt>.tar.gz`; xato bo'lsa
to'xtaydi) → ovozlar → AGI → jadval → `*_custom.conf` → `dialplan reload` + `module reload app_queue.so`.
So'rovnoma eng oxirgi qadamda (`globals_custom.conf`) yoqiladi.

## Test

1. Mobil telefondan call-center raqamiga qo'ng'iroq qiling → operator javob bersin → **operator** go'shakni qo'ysin.
2. Ovoz eshitiladi → masalan `4` ni bosing → "rahmat".
3. Serverda tekshiring:

```sql
-- baho yozildimi
SELECT * FROM asteriskcdrdb.operator_baho ORDER BY id DESC LIMIT 5;

-- MUHIM: suhbatning CDR qatori va yozuvi (recordingfile) joyidami, ortiqcha qator yo'qmi
SELECT calldate, dcontext, dst, dstchannel, disposition, billsec, recordingfile
FROM asteriskcdrdb.cdr WHERE uniqueid = '<yuqoridagi uniqueid>' ORDER BY calldate;
```

Agar `operator_ext` bo'sh bo'lsa: `tail /var/log/asterisk/operator_baho.log` va
`grep include /etc/asterisk/queues.conf` ni menga yuboring.

## Hisobot

```sql
SELECT b.operator_ext, b.operator_name,
       COUNT(*) AS baholar, ROUND(AVG(b.baho), 2) AS ortacha,
       SUM(b.baho = 5) AS besh, SUM(b.baho <= 2) AS past
FROM asteriskcdrdb.operator_baho b
WHERE b.rated_at >= CURDATE() - INTERVAL 30 DAY
  AND LENGTH(b.src) >= 7                       -- ichki test qo'ng'iroqlarsiz
GROUP BY b.operator_ext, b.operator_name
ORDER BY ortacha DESC;
```

## O'chirish / qaytarish

- Tez o'chirish (baholar saqlanib qoladi): `bash /root/operator_baho/rollback.sh` — navbatdagi `c`
  ham o'chadi, shuning uchun eski `[sub-evaluate]` ham ishlamaydi (so'rovnoma umuman bo'lmaydi).
- To'liq qaytarish: `/root/backup_baho_<vaqt>.tar.gz` ichidagi `etc_asterisk/` dan kerakli
  `*_custom.conf` fayllarni `/etc/asterisk/` ga qaytarib, `asterisk -rx "dialplan reload"`.
