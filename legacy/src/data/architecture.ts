export type ClusterId =
  | 'telefoniya'
  | 'backend'
  | 'db'
  | 'frontend'
  | 'external'
  | 'infra';

export interface ClusterInfo {
  id: ClusterId;
  name: string;
  color: string;
  glowColor: string;
  description: string;
}

export const CLUSTERS: Record<ClusterId, ClusterInfo> = {
  telefoniya: {
    id: 'telefoniya',
    name: 'TELEFONIYA',
    color: '#ff9f43',
    glowColor: 'rgba(255, 159, 67, 0.45)',
    description: "Issabel PBX va Asterisk telephony infratuzilmasi (192.168.0.124)"
  },
  backend: {
    id: 'backend',
    name: 'BACKEND',
    color: '#7c6cff',
    glowColor: 'rgba(124, 108, 255, 0.45)',
    description: "Node.js 24 & Express markaziy yadro va xizmatlar (Port 3535)"
  },
  db: {
    id: 'db',
    name: "MA'LUMOTLAR OMBORI",
    color: '#2ed573',
    glowColor: 'rgba(46, 213, 115, 0.45)',
    description: "SQLite (WAL rejimi) va tezkor Redis RAM keshlash qatlami"
  },
  frontend: {
    id: 'frontend',
    name: 'FRONTEND & CLIENTLAR',
    color: '#18dcff',
    glowColor: 'rgba(24, 220, 255, 0.45)',
    description: "SPA Dashboard, Operator Viewer va 3CX Softphone agentlari"
  },
  external: {
    id: 'external',
    name: 'TASHQI SERVISLAR',
    color: '#ff6b81',
    glowColor: 'rgba(255, 107, 129, 0.45)',
    description: "Telegram Bot API va Google Gemini sun'iy intellekti"
  },
  infra: {
    id: 'infra',
    name: 'INFRASTRUKTURA',
    color: '#eccc68',
    glowColor: 'rgba(236, 204, 104, 0.45)',
    description: "Proxmox VE gipervizori (192.168.0.2) va virtual mashinalar"
  }
};

export interface ArchitectureNode {
  id: string;
  label: string;
  group: ClusterId;
  color: string;
  size: number;
  port?: string;
  host?: string;
  protocol?: string;
  description: string;
  // Dynamic fields computed by force-graph
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

export interface ArchitectureLink {
  source: string | ArchitectureNode;
  target: string | ArchitectureNode;
  label?: string;
  protocol?: string;
  speed?: number; // Particle stream speed
  particleDensity?: number; // Number of particles
  color?: string;
}

export interface ArchitectureData {
  nodes: ArchitectureNode[];
  links: ArchitectureLink[];
}

export const architectureData: ArchitectureData = {
  nodes: [
    // 1) TELEFONIYA (rang #ff9f43) — host 192.168.0.124
    {
      id: 'issabel-pbx',
      label: 'Issabel PBX (Asterisk)',
      group: 'telefoniya',
      color: CLUSTERS.telefoniya.color,
      size: 28,
      host: '192.168.0.124',
      description: "Markaziy telefon stansiyasi. Barcha kiruvchi/chiquvchi SIP qo'ng'iroqlar, navbatlar (queues) va IVR boshqaruvi."
    },
    {
      id: 'ami',
      label: 'Asterisk Manager Interface',
      group: 'telefoniya',
      color: CLUSTERS.telefoniya.color,
      size: 18,
      port: '5038/TCP',
      protocol: 'AMI TCP Socket',
      description: "Stansiyadan millisekundlik hodisalarni (Ring, Bridge, Hangup, Queue) uzatuvchi xavfsiz TCP soket interfeysi."
    },
    {
      id: 'mariadb-cdr',
      label: 'MariaDB (asteriskcdrdb)',
      group: 'telefoniya',
      color: CLUSTERS.telefoniya.color,
      size: 16,
      protocol: 'MySQL / MariaDB',
      description: "Stansiya ichidagi xom CDR (Call Detail Record) ma'lumotlar bazasi."
    },
    {
      id: 'call-recordings',
      label: 'Audio Yozuvlar Ombori',
      group: 'telefoniya',
      color: CLUSTERS.telefoniya.color,
      size: 16,
      host: '/var/spool/asterisk/monitor',
      description: "Barcha fuqaro va operator suhbatlarining .wav formatidagi xom audio fayllari arxivi."
    },

    // 2) BACKEND (rang #7c6cff) — Node.js 24, port 3535
    {
      id: 'express-core',
      label: 'Express Core (app.js)',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 38,
      port: '3535',
      protocol: 'Node.js 24 + Express 5.2',
      description: "Tizimning asosiy yuragi: API routerlar, real-vaqt kursorlari, xavfsizlik, hisobotlar va xizmatlar koordinatori."
    },
    {
      id: 'ami-service',
      label: 'amiService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 16,
      description: "Asterisk AMI bilan doimiy TCP soket ulanishini ushlab turadi, suhbat davomiyligini hisoblaydi."
    },
    {
      id: 'issabel-db-service',
      label: 'issabelDbService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 16,
      description: "MariaDB bazasidan har 15 soniyada SSH orqali CDR ma'lumotlarini yuklab, lokal bazaga sinxronlaydi."
    },
    {
      id: 'db-service',
      label: 'dbService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 18,
      description: "Node.js 24 native SQLite drayveri bilan ishlovchi optimallashgan ma'lumotlar qatlami."
    },
    {
      id: 'websocket-hub',
      label: 'WebSocket Hub (ws)',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 20,
      port: '3535/WSS',
      protocol: 'WebSocket (RFC 6455)',
      description: "Brauzerlar bilan 2 tomonlama doimiy kanal. Jonli qo'ng'iroqlar, kursorlar va sekundomer sinxroni."
    },
    {
      id: 'sftp-service',
      label: 'sftpService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 14,
      protocol: 'SFTP (SSH2)',
      description: "Stansiya serveridan audio fayllarni oqim (stream) ko'rinishida xavfsiz qabul qiluvchi modul."
    },
    {
      id: 'converter-service',
      label: 'converterService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 14,
      description: "Audio fayllarni on-the-fly MP3 formatga va AI tahlili uchun 16kHz mono WAV ga o'giradi."
    },
    {
      id: 'auth-service',
      label: 'authService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 14,
      description: "Scrypt xeshlash, sessiyalar boshqaruvi va 5 ta xato urinishdan so'ng 1 soatlik brute-force blokirovkasi."
    },
    {
      id: 'webauthn-service',
      label: 'webauthnService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 14,
      protocol: 'FIDO2 / WebAuthn',
      description: "Passkeys: Barmoq izi, Face ID yoki Windows Hello orqali xavfsiz biometrik kirish."
    },
    {
      id: 'topic-analytics-service',
      label: 'topicAnalyticsService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 16,
      description: "Murojaatlarni 4 asosiy mavzuga (Kalit uzaytirish, EDO, E-Huquqshunos, Boshqa) ajratuvchi tasniflagich."
    },
    {
      id: 'stt-service',
      label: 'sttService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 16,
      description: "Wav2Vec2 o'zbek tili nutq modelini ishga tushirib, audio suhbatlarni matnga o'giradi."
    },
    {
      id: 'gemini-service',
      label: 'geminiService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 16,
      description: "Google Gemini AI orqali dialogdagi xatolarni to'g'rilab, qisqacha mazmun va his-tuyg'uni baholaydi."
    },
    {
      id: 'telegram-service',
      label: 'telegramService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 14,
      description: "Kunlik soatbay hisobotlar, ishdan tashqari qo'ng'iroqlar va avariya signallarini Telegramga uzatadi."
    },
    {
      id: 'proxmox-service',
      label: 'proxmoxService.js',
      group: 'backend',
      color: CLUSTERS.backend.color,
      size: 14,
      description: "Virtual serverlarni kuzatuvchi avto-tiklash watchdog: muammo bo'lsa Issabel VM ni qayta ishga tushiradi."
    },

    // 3) MA'LUMOTLAR OMBORI (rang #2ed573)
    {
      id: 'sqlite-callcenter',
      label: 'SQLite (callcenter.db)',
      group: 'db',
      color: CLUSTERS.db.color,
      size: 26,
      description: "Asosiy relatsion baza (WAL rejimi, busy_timeout 10s). CDR, operatorlar reytingi, mijozlar va tizim loglari."
    },
    {
      id: 'redis-cache',
      label: 'Redis Cache (RAM)',
      group: 'db',
      color: CLUSTERS.db.color,
      size: 16,
      description: "Yuqori tezlikdagi in-memory kesh: navbatdagi qo'ng'iroqlar va jonli holatlar."
    },

    // 4) FRONTEND / CLIENTLAR (rang #18dcff)
    {
      id: 'dashboard',
      label: 'Dashboard (SPA Highcharts)',
      group: 'frontend',
      color: CLUSTERS.frontend.color,
      size: 22,
      port: '3535',
      description: "Asosiy nazorat paneli: 3D grafiklar, jonli qo'ng'iroqlar sekundomeri va multiplayer kursorlar."
    },
    {
      id: 'operator-viewer',
      label: 'Operator Viewer Portal',
      group: 'frontend',
      color: CLUSTERS.frontend.color,
      size: 18,
      port: '3005',
      description: "Operatorlar uchun ixtisoslashgan yengil portal va topshiriqlar (tickets) boshqaruvi."
    },
    {
      id: '3cx-softphones',
      label: '3CX Softphones (Agentlar)',
      group: 'frontend',
      color: CLUSTERS.frontend.color,
      size: 16,
      description: "Operatorlar kompyuterida o'rnatilgan SIP softphone dasturi va fon monitoring agentlari."
    },

    // 5) TASHQI SERVISLAR (rang #ff6b81)
    {
      id: 'telegram-bot-api',
      label: 'Telegram Bot API',
      group: 'external',
      color: CLUSTERS.external.color,
      size: 18,
      protocol: 'HTTPS REST',
      description: "Rasmiy Telegram API: ma'murlar va rahbarlar guruhiga operativ statistikani yetkazadi."
    },
    {
      id: 'google-gemini-api',
      label: 'Google Gemini AI Cloud',
      group: 'external',
      color: CLUSTERS.external.color,
      size: 18,
      protocol: 'HTTPS REST / JSON',
      description: "Google DeepMind'ning yirik sun'iy intellekt modeli servisi."
    },

    // 6) INFRA (rang #eccc68)
    {
      id: 'proxmox-ve',
      label: 'Proxmox VE Gipervizor',
      group: 'infra',
      color: CLUSTERS.infra.color,
      size: 22,
      host: '192.168.0.2',
      description: "Barcha virtual mashinalarni boshqaruvchi apparat darajasidagi klaster gipervizori."
    },
    {
      id: 'vm-101-kerio-control',
      label: 'VM 101: Kerio Control',
      group: 'infra',
      color: CLUSTERS.infra.color,
      size: 16,
      description: "Korporativ tarmoq xavfsizligi, shlyuz, trafik balansi va firewall xizmati."
    },
    {
      id: 'vm-200-issabel',
      label: 'VM 200: Issabel Asterisk',
      group: 'infra',
      color: CLUSTERS.infra.color,
      size: 18,
      description: "Issabel PBX o'rnatilgan maxsus ajratilgan virtual mashina."
    }
  ],

  links: [
    // Telefoniya ichki bog'lanishlari
    { source: 'issabel-pbx', target: 'ami', label: 'Event stream', protocol: 'AMI Event', speed: 0.025, particleDensity: 4 },
    { source: 'issabel-pbx', target: 'mariadb-cdr', label: 'CDR log', protocol: 'SQL Insert', speed: 0.008, particleDensity: 2 },
    { source: 'issabel-pbx', target: 'call-recordings', label: 'Audio record', protocol: 'WAV Write', speed: 0.008, particleDensity: 2 },

    // Telefoniya -> Backend
    { source: 'ami', target: 'ami-service', label: 'TCP 5038', protocol: 'TCP Stream', speed: 0.03, particleDensity: 5 },
    { source: 'mariadb-cdr', target: 'issabel-db-service', label: 'SSH sync (15s)', protocol: 'SSH Tunnel', speed: 0.012, particleDensity: 2 },
    { source: 'call-recordings', target: 'sftp-service', label: 'SFTP stream', protocol: 'SFTP / SSH2', speed: 0.01, particleDensity: 2 },

    // Backend integratsiyalari
    { source: 'ami-service', target: 'express-core', label: 'Live events', protocol: 'Internal IPC', speed: 0.025, particleDensity: 4 },
    { source: 'issabel-db-service', target: 'express-core', label: 'CDR records', protocol: 'Memory Object', speed: 0.012, particleDensity: 2 },
    { source: 'express-core', target: 'db-service', label: 'Database call', protocol: 'Node.js Call', speed: 0.02, particleDensity: 3 },
    { source: 'db-service', target: 'sqlite-callcenter', label: 'WAL write/read', protocol: 'node:sqlite', speed: 0.02, particleDensity: 3 },
    { source: 'express-core', target: 'redis-cache', label: 'Cache get/set', protocol: 'ioredis TCP', speed: 0.02, particleDensity: 2 },
    { source: 'express-core', target: 'websocket-hub', label: 'Broadcast feed', protocol: 'WS Dispatch', speed: 0.03, particleDensity: 5 },

    // WebSocket -> Frontend
    { source: 'websocket-hub', target: 'dashboard', label: 'WSS 3535', protocol: 'WebSocket', speed: 0.03, particleDensity: 4 },
    { source: 'websocket-hub', target: 'operator-viewer', label: 'WSS 3005', protocol: 'WebSocket', speed: 0.02, particleDensity: 3 },
    { source: '3cx-softphones', target: 'express-core', label: 'Heartbeat & audit', protocol: 'HTTP REST', speed: 0.01, particleDensity: 2 },

    // Audio STT Pipeline
    { source: 'sftp-service', target: 'converter-service', label: 'WAV binary', protocol: 'Stream Pipe', speed: 0.007, particleDensity: 2 },
    { source: 'converter-service', target: 'stt-service', label: '16kHz PCM', protocol: 'Audio Buffer', speed: 0.007, particleDensity: 2 },
    { source: 'stt-service', target: 'gemini-service', label: 'Raw text', protocol: 'Text String', speed: 0.007, particleDensity: 2 },
    { source: 'gemini-service', target: 'topic-analytics-service', label: 'Normalized text', protocol: 'NLP Flow', speed: 0.008, particleDensity: 2 },
    { source: 'topic-analytics-service', target: 'sqlite-callcenter', label: 'Save taxonomy', protocol: 'SQL Insert', speed: 0.01, particleDensity: 2 },

    // Auth & Passkeys
    { source: 'express-core', target: 'auth-service', label: 'Session auth', protocol: 'Scrypt Verify', speed: 0.01, particleDensity: 1 },
    { source: 'express-core', target: 'webauthn-service', label: 'FIDO2 Passkeys', protocol: 'WebAuthn v14', speed: 0.01, particleDensity: 1 },

    // Tashqi bildirishnoma va AI
    { source: 'express-core', target: 'telegram-service', label: 'Send alerts', protocol: 'Message Event', speed: 0.01, particleDensity: 2 },
    { source: 'telegram-service', target: 'telegram-bot-api', label: 'HTTPS push', protocol: 'Telegram API', speed: 0.012, particleDensity: 2 },
    { source: 'gemini-service', target: 'google-gemini-api', label: 'AI analysis', protocol: 'HTTPS REST', speed: 0.01, particleDensity: 2 },

    // Infra & Watchdog
    { source: 'proxmox-service', target: 'proxmox-ve', label: 'qm status', protocol: 'SSH2 Exec', speed: 0.006, particleDensity: 1 },
    { source: 'proxmox-ve', target: 'vm-101-kerio-control', label: 'VM 101', protocol: 'KVM Hypervisor', speed: 0.005, particleDensity: 1 },
    { source: 'proxmox-ve', target: 'vm-200-issabel', label: 'VM 200', protocol: 'KVM Hypervisor', speed: 0.005, particleDensity: 1 },
    { source: 'proxmox-service', target: 'telegram-service', label: 'Downtime alert', protocol: 'Alert Event', speed: 0.02, particleDensity: 3 }
  ]
};
