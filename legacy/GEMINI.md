# Call Center & Viewer Project Guidelines

## 🚨 QAT'IY QOIDA: Avtomatik Server Deploy
Ushbu loyihada foydalanuvchi talabi bilan yoki xatoliklarni to'g'rilash maqsadida har qanday fayl (`viewer/public/**`, `app.js`, `viewer/app.js`, CSS, HTML, JS va h.k.) tahrirlanganda:
1. **O'zgarishlarni DARHOL serverga (`213.230.110.9`) deploy qilish SHART!**
2. Foydalanuvchiga javob berishdan oldin har doim `server-deploy` skill'idan foydalanib yoki quyidagi buyruq orqali o'zgarishlarni serverga yuklang:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "d:\CallCenter_Enterprise_Clean_Source\call-center\scripts\deploy_changes.ps1" -Restart
   ```
3. Deploy tugagandan so'ng, foydalanuvchiga brauzerni `Ctrl + F5` bilan yangilashni eslatib o'ting.

---

## 📡 Bridge Mode
- Bridge watcher fonda (`scripts/watch_ui_inbox.ps1`) ishlaydi.
- Serverdagi vazifalar navbati: `/opt/call-center/scratch/ui_inbox_v2.json`.
- Eski kompyuter navbati (`ui_inbox.json`) bo'sh saqlanadi.
