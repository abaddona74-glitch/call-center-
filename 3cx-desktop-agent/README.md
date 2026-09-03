# 🎧 3CX Desktop Reject Monitor Agent

Ushbu agent operator kompyuterlarida (Windows) fonda ishlaydi va 3CX dasturi orqali qo'ng'iroq kelib, operator **Qizil tugma (Reject / Отклонить)** bosganda, soniyaning o'zida asosiy Call Center Dashboard serveriga xabar jo'natadi.

---

## ⚙️ O'rnatish va Sozlash (1 daqiqalik ish)

Har bir operator kompyuterida quyidagi oddiy qadamlar bajariladi:

### 1. `config.json` faylini sozlash
`config.json` faylini oching va quyidagi 2 ta qiymatni kiriting:
```json
{
  "serverUrl": "http://192.168.0.124:3000",
  "operatorId": "101"
}
```
* **`serverUrl`** — Dashboard serveri ishlayotgan IP manzil va port (masalan: `http://192.168.0.124:3000` yoki lokal `http://localhost:3000`).
* **`operatorId`** — Shu kompyuterdagi operatorning ichki raqami (masalan: `101`, `103`, `106`...).

---

### 2. Windows Startup'ga qo'yish (Avtomatik ishga tushish)
* **`install_startup.bat`** faylini bir marta sichqoncha bilan ikki marta bosib ishga tushiring.
* Bo'ldi! Agent kompyuter yonganda fonda (oynasiz, ko'rinmasdan) ishlab turadi.

---

### 3. Qo'lda tekshirish uchun:
* **`start_agent.bat`** faylini bosib konsolda loglarni ko'rishingiz mumkin.
