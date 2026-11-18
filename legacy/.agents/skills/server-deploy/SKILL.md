---
name: server-deploy
description: >-
  Use this skill whenever any code, UI, or configuration changes are made in the project
  to immediately deploy them to the production server (213.230.110.9). Always deploy
  changes right after editing files to keep production live and in sync.
---

# Production Server Deployment Skill

Bu skill Call Center va Viewer loyihasidagi har qanday o'zgarishlarni (HTML, CSS, JS, backend Node.js, botlar) darhol ishlab turgan jonli serverga (`213.230.110.9`) xavfsiz va tezkor yuklash uchun ishlatiladi.

---

## 🎯 Qachon ishlatiladi?
1. **Har qanday fayl tahrirlangandan so'ng:** Foydalanuvchi biror xatolikni tuzatishni, UI ni o'zgartirishni yoki yangi imkoniyat qo'shishni so'raganda va fayl saqlanganda.
2. **Foydalanuvchi "deploy qil" deganda:** Qo'lda buyruq berilganda.
3. **Bridge rejimida yangi so'rovlar kelganda:** Ish yakunlangach, darhol serverga o'tkazish uchun.

---

## ⚙️ Server Ma'lumotlari
* **Server IP:** `213.230.110.9` (Port: `22`)
* **Foydalanuvchi:** `root`
* **Avtorizatsiya:** Mahalliy SSH yordamchisi (`scratch/askpass_n.exe` / `.env`)
* **Jarayonlar:**
  * Viewer: `/opt/call-center-viewer` (Port 3005, PM2: `call-center-viewer`)
  * Asosiy backend: `/opt/call-center` (Port 3535, PM2: `call-center`)
  * Telegram Bridge: `/opt/call-center/scripts/telegram_bridge_bot.js` (PM2: `call-center-tg-bridge`)

---

## ⚠️ Kerio Control Firewall Qoidasi (Muhim!)
Server oldida Kerio Control xavfsizlik devori joylashgan. 
* Agar ketma-ket bir necha soniya ichida 2-3 tadan ko'p SSH/SCP ulanishlari amalga oshirilsa, Kerio 5 daqiqaga port 22 ni vaqtincha bloklaydi.
* **Shuning uchun:** Barcha fayllar bitta `.tar.gz` paketiga joylanadi va **yagona SCP** orqali yuklanib, **yagona SSH** orqali ochiladi.
* Buning uchun tayyor [deploy_changes.ps1](file:///d:/CallCenter_Enterprise_Clean_Source/call-center/scripts/deploy_changes.ps1) skriptidan foydalaning.

---

## 🛠️ Deploy qilish tartibi

### 1-usul: Aniq o'zgargan fayllarni deploy qilish (Eng tez va xavfsiz)
Agar aniq fayllar o'zgargan bo'lsa (masalan `viewer/public/index.html` yoki `viewer/public/css/style.css`):

```powershell
powershell -ExecutionPolicy Bypass -File "d:\CallCenter_Enterprise_Clean_Source\call-center\scripts\deploy_changes.ps1" -Files "viewer\public\index.html", "viewer\public\css\style.css"
```

Agar backend fayllari (`app.js`, `viewer/app.js` va h.k.) o'zgargan bo'lsa, PM2 ni qayta ishga tushirish uchun `-Restart` parametrini qo'shing:

```powershell
powershell -ExecutionPolicy Bypass -File "d:\CallCenter_Enterprise_Clean_Source\call-center\scripts\deploy_changes.ps1" -Files "viewer\app.js" -Restart
```

---

### 2-usul: Oxirgi barcha o'zgarishlarni avtomatik aniqlab deploy qilish
Fayllarni alohida sanab o'tmasdan, so'nggi 2-3 soatda tahrirlangan barcha fayllarni birvarakayiga serverga jo'natish:

```powershell
powershell -ExecutionPolicy Bypass -File "d:\CallCenter_Enterprise_Clean_Source\call-center\scripts\deploy_changes.ps1" -Restart
```

---

## 🔍 Tekshirish (Verification)
Deploy muvaffaqiyatli yakunlanganini tekshirish uchun:
1. Viewer versiyasi:
   ```powershell
   & curl.exe -k -s "https://213.230.110.9:3005/version.json"
   ```
2. Bridge Inbox holati:
   ```powershell
   & curl.exe -k -s "https://213.230.110.9:3005/api/dev/bridge-inbox"
   ```
3. Foydalanuvchiga brauzerni `Ctrl + F5` bilan yangilashni eslatish.
