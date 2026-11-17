# 📞 Call Center AI — Monitoring, Analytics & Quality Control System

Ushbu tizim call-center operatorlari faoliyatini real vaqt rejimida monitoring qilish, Asterisk/Issabel PBX bilan integratsiya, qo'ng'iroqlarni tahlil qilish (STT & Semantic Analysis) va xizmat sifatini nazorat qilish uchun ishlab chiqilgan.

---

## 🏗️ Tizim Arxitekturasi

Loyiha ikki asosiy mustaqil portaldan iborat:

1. **Asosiy Tizim (Core Monitoring & Management):**
   * **Port:** `3535`
   * **Vazifalari:** Asterisk AMI hodisalarini jonli o'qish, navbatlar (queues) va operatorlar holati, biometrik ovoz identifikatsiyasi, mavzular bo'yicha tahlil (topic analytics), WebAuthn (Passkeys) va ERI (UzCrypto) orqali kirish.
2. **Viewer Portali (Operatorlar & Biletlar Nazorati):**
   * **Port:** `3005`
   * **Vazifalari:** Ichki boshqaruv xodimlari uchun yengillashtirilgan ko'rinish, shikoyat va murojaatlar biletlari (tickets), qora ro'yxat (blacklist) boshqaruvi.

---

## 📁 Loyiha Strukturasi

```text
├── app.js                   # Asosiy Express & WebSocket serveri (Port 3535)
├── config.js                # Umumiy konfiguratsiya parametrlari
├── swaggerSpec.js           # REST API hujjatlari (Swagger)
├── system_settings.json     # Proxmox / VM tiklash va xizmat parametrlari
├── .env.example             # Muhit o'zgaruvchilari shabloni
│
├── services/                # Asosiy biznes-mantiq va integratsiyalar
│   ├── amiService.js        # Asterisk Manager Interface (jonli qo'ng'iroqlar)
│   ├── issabelDbService.js  # CDR bazasi bilan integratsiya
│   ├── converter.py         # Audio konvertatsiya va ovoz tahlili moduli
│   ├── topicAnalyticsService.js # Qo'ng'iroq mavzulari va mazmunini tahlil qilish
│   ├── uzcryptoService.js   # UzCrypto / ERI kaliti orqali autentifikatsiya
│   ├── webauthnService.js   # FIDO2 / WebAuthn (Passkeys) biometrik kirish
│   ├── rateLimitService.js  # DDoS va so'rovlar chastotasini cheklash
│   └── ...                  # Boshqa yordamchi servislar
│
├── public/                  # Asosiy portal frontend interfeysi (SPA, Chart.js, Icons)
│   ├── index.html           # Asosiy monitoring paneli
│   ├── login.html           # UzCrypto / Passkeys / Login oynasi
│   ├── js/dashboard.js      # Real-time WebSocket va grafiklar logikasi
│   └── ...
│
├── viewer/                  # Qo'shimcha nazorat portali (Port 3005)
│   ├── app.js               # Viewer serveri
│   ├── services/            # Viewer xizmatlari
│   └── public/              # Viewer UI (tickets.html, index.html)
│
├── scripts/                 # Deploy, yuklama testlari (k6, node) va monitoring skriptlari
└── data/                    # Tizim ma'lumotlari (tree.json bilimlari daraxti)
```

---

## 🚀 O'rnatish va Ishga Tushirish

### 1. Talablar:
* **Node.js:** v18.0.0 yoki undan yuqori
* **Python:** 3.10+ (ovoz tahlili va konvertatsiya uchun)
* **Asterisk PBX / Issabel:** AMI ruxsatlari bilan

### 2. Sozlash:
1. `.env.example` faylidan nusxa oling va nomini `.env` qiling:
   ```bash
   cp .env.example .env
   ```
2. `.env` ichidagi Asterisk AMI, Redis va pochta parametrlarini o'z serveringizga moslang.

### 3. Bog'liqliklarni o'rnatish:
```bash
npm install
```

### 4. Tizimni ishga tushirish:
```bash
# Asosiy tizim (Port 3535)
npm start

# Yoki fon rejimida (PM2 orqali):
pm2 start app.js --name "call-center"
```
