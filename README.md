# Call Center — Backend & Desktop Agent

Asterisk/Issabel-based call center monitoring tizimi. Ushbu repo quyidagilarni o'z ichiga oladi:



## Tarkib

| Qism | Tavsif |
|---|---|
| `app.js` | Express backend (REST API + WebSocket + Swagger) |
| `services/` | AMI, SFTP, Redis, SQLite/Issabel DB xizmatlari |
| `public/` | Statik dashboard (HTML/CSS/JS) |
| `3cx-desktop-agent/` | Operatorlar uchun ish stoli agenti (Node.js manba) |
| `config.js` | Umumiy konfiguratsiya |

## O'rnatish

```bash
npm install
cp .env.example .env   # so'ng kerakli qiymatlarni kiriting
npm start
```

## Ishga tushirish

```bash
npm start        # production
npm run dev      # development (nodemon)
```

## Muhim izohlar

- `.env` fayli **maxfiy** — repo'ga commit qilinmaydi (`.gitignore` da)
- SQLite ma'lumotlar bazasi (`data/`) va qurilgan `agent.exe` fayllari ham repo'ga kirmaydi
- Agent dist fayllari: `3cx-desktop-agent` manba kodidan qayta quriladi