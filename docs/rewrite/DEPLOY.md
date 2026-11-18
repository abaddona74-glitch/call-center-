# Деплой и эксплуатация

Runbook для владельца и тех, кто сопровождает прод. Код и команды — по-английски, пояснения — по-русски.
**Деплой автоматический:** каждое изменение ветки `main` после проверок само уходит в прод (решение владельца 18.11.2026,
без ручного «Approve»). Поэтому граница — то, что попадает в `main`: туда сливает только владелец или по его явному слову.

Файлы:

| Файл                                                     | Назначение                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy.yml`                           | деплой при push в `main` (и ручной для повтора/отката): проверки → образы в GHCR → деплой на ВМ                 |
| `infra/server/bootstrap.sh`                              | разовая подготовка ВМ (root, можно перезапускать)                                             |
| `infra/server/deploy.sh`                                 | деплой одного релиза на сервере: бэкап → pull → миграции → up → проверка → авто-откат         |
| `infra/server/backup.sh`, `restore.sh`                   | бэкап `pg_dump` и восстановление (с тестовым режимом)                                         |
| `infra/server/check-env.sh`                              | проверка `.env` без вывода значений                                                           |
| `infra/server/compose.override.yml`                      | прод-настройки поверх `infra/compose.yml` (не собирать на сервере, не мигрировать при старте) |
| `infra/server/systemd/callcenter-backup.{service,timer}` | ежедневный бэкап в 02:30 по Ташкенту                                                          |
| `infra/.env.example`                                     | шаблон `/opt/callcenter/.env`                                                                 |

## 1. Схема

### Где что работает

```
                      Интернет
                         │  только TCP 443
              ┌──────────▼───────────┐
              │ VM 101 Kerio Control │  публичный IP, port-forward внутрь
              └──────────┬───────────┘
                         │ LAN 192.168.0.0/24 (vmbr0)
   ┌─────────────────────┼─────────────────────────────────────────────────────┐
   │ Proxmox VE host 192.168.0.2 (гипервизор, сюда ничего нового НЕ ставим)    │
   │   legacy PM2 (root): call-center :3535, call-center-viewer :3005,          │
   │   telegram-form-dashboard :3006, isabella-connector, call-center-tg-bridge │
   │                                                                            │
   │   VM 200 Issabel PBX 192.168.0.124 ── :3306 MariaDB  :5038 AMI  :22 SFTP   │
   │        ▲  только с IP новой ВМ (SELECT-only, AMI с минимальными правами,    │
   │        │  SFTP только чтение в chroot)                                     │
   │   VM <новая> callcenter 192.168.0.<VM> (Ubuntu 24.04 + Docker)             │
   │   ┌──────────────────────────────────────────────────────────────────┐     │
   │   │ web: Caddy :443 (TLS Let's Encrypt) — SPA, /api и /ws → api       │     │
   │   │ api: NestJS — postgres (volume pg-data), АТС по LAN               │     │
   │   │ gha-runner: self-hosted GitHub runner (исходящий HTTPS к GitHub)  │     │
   │   │ /opt/callcenter: compose, .env, bin/, backups/, logs/             │     │
   │   └──────────────────────────────────────────────────────────────────┘     │
   └────────────────────────────────────────────────────────────────────────────┘
```

### Как идёт деплой

```
 push в main  (или Actions → "Deploy" → Run workflow: повтор / откат на SHA из main)
   resolve ── SHA полный и входит в main?
   check   ── lint, typecheck, test, build (как CI)              GitHub-hosted runner
   build   ── образы api и web → ghcr.io/nuriddin2468/...:<SHA>   GitHub-hosted runner
   deploy  ── self-hosted runner на ВМ ─ одно SSH-соединение ─▶ deploy@127.0.0.1
                tar infra/ → /opt/callcenter/releases/<SHA>/
                deploy.sh <SHA>:
                  lock → check-env → pg_dump → docker pull → compose-файлы →
                  миграции (старая версия ещё работает) → compose up → health →
                  OK: записать состояние │ FAIL: вернуть прежние образы (БД не трогаем)
```

## 2. Что должен решить и предоставить владелец

1. **ВМ**: создать на Proxmox (п. 3.1) — IP в 192.168.0.0/24, Ubuntu 24.04 (или Debian 13), 2 vCPU, 3 ГБ RAM (баллон 2 ГБ), 40 ГБ диск.
2. **Домен** для TLS. Рекомендуется оставить текущий домен legacy (значение `WEBAUTHN_RP_ID` из старого `.env`) — тогда passkeys продолжат работать.
3. **Kerio**: правило TCP 443 → ВМ:443; убрать веб-админку Kerio с внешнего 443 (см. п. 12).
4. **IP админов** (`ADMIN_IPS`): адреса рабочих мест в LAN/VPN, с которых разрешён SSH на ВМ.
5. ~~Кто одобряет деплой~~ — не нужно: деплой автоматический при изменении `main` (решение 18.11.2026).
6. **Куда копировать бэкапы вне этого сервера** (off-site): S3-совместимое хранилище, другой сервер, NAS — п. 6.
7. **Окно переключения** (вне рабочих часов Пн–Пт 08:00–21:00) и критерии отката на legacy — п. 10.
8. **Учётки на АТС** (п. 11): MariaDB `cc_readonly`, пользователь AMI, SFTP-пользователь записей.
9. **Отдельная задача**: защита самого гипервизора и Kerio (п. 12).

## 3. Первичная настройка

### 3.1 ВМ на Proxmox

**Никогда не ставить новый стек на сам гипервизор**: там уже живут legacy-приложения под root (порт 3006 занят
`telegram-form-dashboard`), Docker на хосте нет, а любая уязвимость в приложении на хосте = root над всеми ВМ
(Kerio, АТС). `bootstrap.sh` отказывается работать на хосте Proxmox.

**Бюджет памяти.** Хост: 15 ГБ RAM, ВМ уже выделено ~12 ГБ, занято ~9,8 ГБ → запас около 3 ГБ.

| Компонент                    | Ожидаемо                               |
| ---------------------------- | -------------------------------------- |
| ОС Ubuntu (minimal/cloud)    | ~300 МБ                                |
| PostgreSQL 18 (маленькая БД) | 150–300 МБ                             |
| api (Node)                   | 200–400 МБ                             |
| Caddy                        | ~30 МБ                                 |
| GitHub runner                | ~150 МБ в простое, больше во время job |
| **итого в работе**           | **~1–1,3 ГБ**                          |

Рекомендация: `memory 3072`, `balloon 2048` (Proxmox может забрать до 1 ГБ при нехватке) и swap 2 ГБ внутри ВМ
(`bootstrap.sh --swap 2G`). Если памяти не хватает:

- ВМ 100 ElastixN остановлена и RAM не занимает, но при запуске заберёт своё. Отключить автозапуск:
  `qm set 100 --onboot 0`; после бэкапа (`vzdump 100`) решить, нужна ли она вообще.
- После переключения освободится память legacy-приложений `call-center` и `call-center-viewer` на хосте.
- Свободное место на хосте проверить заранее: `pvesm status` (диск хоста 94 ГБ; на lvm-thin диск ВМ растёт по мере заполнения).

**Создание ВМ (PVE 7.1, на хосте под root).** В 7.1 ещё нет `import-from`, поэтому `qm importdisk`.
`<VMID>`, `<STORAGE>` (см. `pvesm status`), `<VM_IP>`, `<KERIO_LAN_IP>` (шлюз), `<DNS_IP>` — подставить.

```bash
cd /var/lib/vz/template/iso
wget https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
wget https://cloud-images.ubuntu.com/noble/current/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS

qm create <VMID> --name callcenter --ostype l26 --cores 2 --cpu host \
  --memory 3072 --balloon 2048 --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-pci --serial0 socket --vga serial0 --agent enabled=1 --onboot 1
qm importdisk <VMID> noble-server-cloudimg-amd64.img <STORAGE>
qm config <VMID> | grep unused        # -> unused0: <STORAGE>:vm-<VMID>-disk-0 (имя зависит от типа хранилища)
qm set <VMID> --scsi0 <STORAGE>:vm-<VMID>-disk-0,discard=on --boot order=scsi0
qm resize <VMID> scsi0 40G
qm set <VMID> --ide2 <STORAGE>:cloudinit
qm set <VMID> --ciuser ccadmin --sshkeys /root/admin_keys.pub \
  --ipconfig0 ip=<VM_IP>/24,gw=<KERIO_LAN_IP> --nameserver <DNS_IP>
qm start <VMID>
```

`admin_keys.pub` — публичные ключи админов (только `.pub`, приватные ключи на гипервизор не класть).
Debian 13: образ `https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2`,
остальное так же. Через веб-интерфейс можно сделать то же самое (Create VM → без ISO → импорт диска из CLI).

Проверка: `ssh ccadmin@<VM_IP>` с машины админа; с ВМ должны открываться `192.168.0.124:3306` и `:5038`
(после настройки АТС, п. 11).

### 3.2 bootstrap.sh

Скрипт ставит пакеты и Docker (официальный репозиторий, отпечаток GPG проверяется), создаёт пользователей,
закрывает SSH, включает ufw, автообновления безопасности, лимиты журналов, каталог `/opt/callcenter` и таймер
бэкапов. Приложение он не запускает. Повторный запуск безопасен.

```bash
# с машины админа: скопировать infra/ и ключи на ВМ
scp -r infra ci_deploy.pub admin_keys.pub ccadmin@<VM_IP>:/tmp/
ssh ccadmin@<VM_IP>
sudo ADMIN_IPS="192.168.0.<ADMIN1>,192.168.0.<ADMIN2>" bash /tmp/infra/server/bootstrap.sh \
  --admin-user ccadmin --admin-keys /tmp/admin_keys.pub \
  --runner-user --ci-key /tmp/ci_deploy.pub --ci-key-from 127.0.0.1,::1 \
  --swap 2G --upgrade
```

| Что делает                     | Подробности                                                                                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| пользователь `deploy`          | без пароля (`*`), только ключ, в группе `docker`, без sudo. Ключ CI получает `restrict,from="127.0.0.1,::1"` — снаружи ВМ он бесполезен                                                                                                                   |
| админ (`--admin-user`)         | SSH только по ключу, sudo с паролем (скрипт попросит задать) или `--sudo-nopasswd`. В cloud-образах `/etc/sudoers.d/90-cloud-init-users` даёт sudo без пароля — скрипт предупредит; удалить файл, когда `sudo -k; sudo true` спрашивает пароль и работает |
| `gha-runner` (`--runner-user`) | пользователь для self-hosted runner: без sudo, без docker, без SSH-входа                                                                                                                                                                                  |
| sshd                           | drop-in `/etc/ssh/sshd_config.d/00-callcenter-hardening.conf`: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `AllowUsers <admin> deploy`, без форвардинга. Проверяется `sshd -t` и `sshd -T` до reload            |
| Docker                         | `docker-ce` + compose plugin; `daemon.json`: драйвер логов `local` (5 × 20 МБ на контейнер), `live-restore`                                                                                                                                               |
| ufw                            | входящие запрещены; 22/tcp только с `ADMIN_IPS` (пустой список — отказ, чтобы не потерять доступ; адрес вашей текущей SSH-сессии должен входить в список); 80, 443 открыты                                                                                |
| обновления                     | unattended-upgrades только security; авто-перезагрузка выключена (или `--reboot-time 23:00` — это UTC, 04:00 по Ташкенту)                                                                                                                                 |
| время                          | системный пояс UTC, NTP включён. Бизнес-время приложения — `Asia/Tashkent` из его конфигурации                                                                                                                                                            |
| журналы                        | journald ≤ 1 ГБ / 3 мес.; `/opt/callcenter/logs/*.log` — logrotate еженедельно, 12 копий                                                                                                                                                                  |
| `/opt/callcenter`              | владелец `deploy`; `.env` создаётся из примера с правами 600 (существующий не трогается); `backups/` и `secrets/` — 700                                                                                                                                   |

**Важно:** не закрывайте текущую сессию, пока не проверите вход в новом терминале (`ssh ccadmin@<VM_IP>`).

**Docker и ufw:** порты, опубликованные Docker, обходят ufw. Наружу публикует порты только контейнер `web`
(`HTTP_PORT`, `HTTPS_PORT`). Поэтому граница доступа из Интернета — правило Kerio (только 443).

### 3.3 Как CI попадает на сервер

| Вариант                                                           | Что открыть                                          | Оценка                                                                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Self-hosted runner на самой ВМ (по умолчанию)**              | ничего входящего: runner сам ходит к GitHub по HTTPS | job деплоя подключается к `deploy@127.0.0.1` по тому же SSH-пути; ключ CI ограничен loopback; Kerio не участвует                        |
| B. Runner на другой машине в LAN                                  | SSH ВМ с IP этой машины (`ADMIN_IPS`)                | то же, но нужна ещё одна машина/ВМ (а RAM на хосте мало)                                                                                |
| C. Tailscale / WireGuard                                          | SSH ВМ только с туннельного интерфейса               | GitHub-hosted runner входит в сеть через `tailscale/github-action`; плюс сторонний сервис, агент на ВМ и ещё секреты                    |
| D. Pull-модель                                                    | ничего                                               | ВМ по таймеру сама забирает «желаемый» SHA. Нужен токен к репозиторию на сервере, нет живого лога и одобрения в Actions. Не реализовано |
| E. Проброс SSH через Kerio (нестандартный порт, только IP GitHub) | порт SSH в Интернет                                  | **не рекомендуется**: диапазоны IP GitHub огромны и меняются, Kerio банит IP после нескольких SSH-соединений, SSH к проду из Интернета  |

Выбран **A**: ноль входящих портов для деплоя, тот же проверенный путь `deploy.sh` по SSH, утёкший ключ CI
нельзя использовать вне ВМ, не нужна лишняя память. Цена — runner работает на проде, поэтому:

- runner запущен под `gha-runner` без docker/sudo; секреты (SSH-ключ) получает только job `deploy` из `main` (environment `production`, Deployment branches: `main`);
- метку `callcenter-deploy` использует только `deploy.yml`; не добавлять её в другие workflow;
- репозиторий приватный; в Settings → Actions → General включить обязательное одобрение workflow из форков;
- одно SSH-соединение на запуск (`ControlMaster`): загрузка файлов и запуск `deploy.sh` идут через него.

Переключиться на другой вариант: репозиторная переменная `DEPLOY_RUNNER` (метка runner'а, например
`ubuntu-latest` для варианта C) и соответствующие `DEPLOY_HOST` / `DEPLOY_KNOWN_HOSTS`.

### 3.4 Регистрация self-hosted runner

```bash
ssh ccadmin@<VM_IP>
sudo -iu gha-runner
mkdir actions-runner && cd actions-runner
# версия и SHA-256 — со страницы https://github.com/actions/runner/releases (последний релиз, linux-x64)
curl -fsSLO https://github.com/actions/runner/releases/download/v<VER>/actions-runner-linux-x64-<VER>.tar.gz
echo "<SHA256>  actions-runner-linux-x64-<VER>.tar.gz" | sha256sum -c
tar xzf actions-runner-linux-x64-<VER>.tar.gz
# токен: GitHub → Settings → Actions → Runners → New self-hosted runner (живёт 1 час)
./config.sh --url https://github.com/nuriddin2468/call-center --token <TOKEN> \
  --name callcenter-vm --labels callcenter-deploy --work _work --unattended
exit
sudo /home/gha-runner/actions-runner/bin/installdependencies.sh
cd /home/gha-runner/actions-runner && sudo ./svc.sh install gha-runner && sudo ./svc.sh start
```

Runner обновляется сам. Статус: GitHub → Settings → Actions → Runners (должен быть Idle).

### 3.5 GitHub: environment, секреты, настройки

1. **Ключ CI** (на машине админа):
   `ssh-keygen -t ed25519 -N '' -C github-actions-deploy -f ci_deploy` → `ci_deploy.pub` передать в `bootstrap.sh --ci-key`,
   содержимое `ci_deploy` — в секрет `DEPLOY_SSH_KEY`, затем удалить оба файла с машины.
2. **Settings → Environments → New environment `production`:**
   - Required reviewers — **не включать** (деплой автоматический, решение 18.11.2026);
   - Deployment branches — «Selected branches»: `main`;
   - Environment secrets (не repository secrets):

     | Секрет               | Значение (вариант A)                           |
     | -------------------- | ---------------------------------------------- |
     | `DEPLOY_HOST`        | `127.0.0.1`                                    |
     | `DEPLOY_PORT`        | `22`                                           |
     | `DEPLOY_SSH_KEY`     | приватный ключ `ci_deploy` целиком             |
     | `DEPLOY_KNOWN_HOSTS` | вывод `ssh-keyscan -t ed25519 127.0.0.1` на ВМ |

     Отпечаток из `DEPLOY_KNOWN_HOSTS` сверить с `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` на ВМ.
     `StrictHostKeyChecking=no` не используется: при смене ключа хоста деплой остановится — так и задумано.
3. **Settings → Actions → General:** Workflow permissions — «Read repository contents» (workflow сам просит то, что нужно);
   Fork pull request workflows — require approval.
4. Переменная `DEPLOY_RUNNER` — только если нужен не вариант A.

### 3.6 Доступ к GHCR

- Образы: `ghcr.io/nuriddin2468/call-center-api:<SHA>` и `call-center-web:<SHA>`, тег — полный SHA коммита (неизменяемый).
- **По умолчанию постоянных учётных данных на сервере нет**: job деплоя передаёт свой короткоживущий `GITHUB_TOKEN`
  (`packages: read`) в `deploy.sh` через stdin, тот логинится во временный `DOCKER_CONFIG` только на время pull и удаляет его.
  Пакеты связаны с репозиторием меткой `org.opencontainers.image.source`, поэтому токен репозитория их читает.
  Проверить после первой сборки: GitHub → Packages → пакет → Package settings → Manage Actions access — репозиторий есть в списке.
- Для ручных операций на сервере вне workflow (pull образа, которого нет локально): classic PAT **только** с
  `read:packages`, лучше от отдельного бот-аккаунта, со сроком действия:
  `sudo -iu deploy docker login ghcr.io -u <user> --password-stdin`, после работы `docker logout ghcr.io`
  (токен хранится в `~deploy/.docker/config.json` в открытом виде). Альтернатива — сделать пакеты публичными
  (секретов в образах нет, но код приложения станет виден). Рекомендуется не держать PAT, а откатываться через workflow (п. 5).

### 3.7 `.env` на сервере

Создаётся один раз владельцем, хранится только на сервере (копия — в менеджере паролей владельца), в git не попадает.

```bash
sudo -iu deploy
cd /opt/callcenter
ls -l .env                         # -rw------- deploy deploy (bootstrap создал из .env.example)
openssl rand -hex 32               # для POSTGRES_PASSWORD; так же генерировать остальные пароли
nano .env
/opt/callcenter/bin/check-env.sh   # ошибки и предупреждения по именам ключей, значения не печатаются
```

| Ключ                           | Прод                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`            | ≥ 24 символа, только `A-Za-z0-9._~-` (входит в `DATABASE_URL`)                           |
| `REGISTRY`                     | `ghcr.io/nuriddin2468`                                                                   |
| `IMAGE_TAG`                    | не трогать — переписывает `deploy.sh`                                                    |
| `SITE_ADDRESS`                 | домен (п. 3.8)                                                                           |
| `HTTP_PORT` / `HTTPS_PORT`     | `80` / `443`                                                                             |
| `COOKIE_SECURE`                | `true`                                                                                   |
| `BOOTSTRAP_SUPERUSER_PASSWORD` | только на первый запуск, потом удалить строку. Пустое значение (`KEY=`) API не принимает |
| `PBX_DB_*`                     | `cc_readonly` (п. 11)                                                                    |
| `AMI_*`                        | пользователь AMI `cc_monitor`; `AMI_ASTDB_*` — `cc_astdb` для чёрного списка (п. 11.2)   |
| `SFTP_*`                       | позже (S5): `SFTP_MONITOR_PATH=/monitor` при chroot                                      |
| `TOOLS_*`                      | раздел «Инструменты», п. 14: ссылка Telegram Form, проверка Uzcrypto, лимиты конвертера   |

`check-env.sh` запускается и перед каждым деплоем: с ошибками деплой не начнётся. Он же предупреждает о ключах, которые
появились в новом `.env.example`, но отсутствуют в `.env`. Новые переменные приложения (WebAuthn, почта, Telegram и т.д.)
добавляют другие сессии — после их слияния дополнить `.env`.

### 3.8 TLS и Kerio

- `SITE_ADDRESS=<домен>`: Caddy сам получает и продлевает сертификат Let's Encrypt. Если Kerio пробрасывает только 443,
  Caddy проходит проверку TLS-ALPN-01 на 443 (порт 80 не нужен). Без проброса 80 адрес `http://` не будет редиректиться —
  при желании пробросить и 80 → ВМ:80.
- **Kerio:** правило «Internet TCP 443 → `<VM_IP>`:443», обычный port-forward (без TLS-инспекции), адрес клиента сохраняется.
  Сейчас на внешнем 443 висит веб-админка Kerio — её нужно убрать из Интернета (п. 12), иначе 443 не освободить.
- Домен legacy динамический (DDNS) — для Caddy это не проблема.
- Без публичного домена (только LAN): `SITE_ADDRESS=<VM_IP>` — Caddy выпустит сертификат своим внутренним CA, браузеры
  будут предупреждать, passkeys не работают. Годится только для проверки.
- Если когда-нибудь TLS будет завершать Kerio (reverse proxy): `SITE_ADDRESS=:80`, `TRUSTED_PROXIES` с адресом Kerio и
  правка Caddyfile для доверия заголовкам прокси — отдельная задача.

### 3.9 Первый деплой

1. `.env` заполнен, `check-env.sh` без ошибок; runner в статусе Idle; секреты environment заданы.
2. Слить `rewrite/foundation` в `main` (PR) — деплой запустится сам. Если `main` уже содержит нужный коммит:
   GitHub → Actions → **Deploy** → Run workflow: ветка `main`, `ref` пустой (или SHA), `skip_build` выключен.
3. Дождаться `check`, `build` и `deploy`.
4. В логе job `deploy` — `DEPLOY OK`. Открыть `https://<домен>`, войти `superuser` с паролем из `BOOTSTRAP_SUPERUSER_PASSWORD`,
   сменить пароль, удалить строку `BOOTSTRAP_SUPERUSER_PASSWORD` из `.env`.
5. На ВМ: `sudo -iu deploy /opt/callcenter/bin/deploy.sh --status`, `systemctl list-timers callcenter-backup.timer`,
   разовый бэкап `sudo systemctl start callcenter-backup.service` и `restore.sh --test` (п. 6).

## 4. Регулярный деплой

- **Когда:** сам при каждом push в `main`; вручную (Run workflow) — повтор или откат на коммит из `main`. Ручного одобрения нет,
  поэтому в `main` сливает только владелец или по его явному слову.
- **Что деплоится:** только коммиты из `main` (job `resolve` это проверяет). Тег образов — полный SHA.
- **Шаги** (`deploy.yml` → `deploy.sh`):
  1. `resolve`: SHA полный и в `main`. `check`: lint, typecheck, test, build (как `ci.yml`). `build`: образы api и web в GHCR (кэш GHA).
  2. Job `deploy` на runner'е ВМ: одно SSH-соединение к `deploy@127.0.0.1`, файлы `infra/` → `/opt/callcenter/releases/<SHA>/`.
  3. `deploy.sh <SHA>`: блокировка `flock` (два деплоя одновременно невозможны; ещё и `concurrency` в workflow) →
     `check-env.sh` → бэкап `pg_dump` (`backups/pre-deploy/`, проверяется непустота и читаемость) → `docker pull` обоих образов
     (если образа нет — ничего не меняется) → установка `compose.yml` и `compose.override.yml` из релиза (старые сохраняются для отката) →
     **миграции** отдельным одноразовым контейнером нового образа (`node dist/database/migrate.js latest`), пока старая версия ещё работает →
     `docker compose up -d` → **проверка здоровья** (до 180 с): контейнеры api и web на новом теге, `/api/health` внутри контейнера api
     и `/api/health` через Caddy (`https://<домен>` с подстановкой 127.0.0.1) →
     запись состояния (`.deploy-state`, `.deploy-history`, `IMAGE_TAG` в `.env`), обновление `bin/`, чистка старых образов и релизов.
  4. Обрыв SSH во время деплоя не ломает его: весь вывод идёт через `tee -p` в `logs/deploy.log`, скрипт доходит до конца или откатывается.
- **Простой:** секунды (пересоздание контейнеров api и web).
- **Правило для миграций:** только обратно совместимые (expand → deploy → contract). Миграции идут до переключения,
  а откат возвращает старый код на новую схему. Удалять/переименовывать колонки — следующим релизом, когда старый код их уже не читает.
  Почему приложение не мигрирует при старте: `compose.override.yml` ставит `DB_MIGRATE_ON_START=false`, иначе старый образ
  после отката не стартует (kysely: «previously executed migration … is missing»). Это проверено.
- **Ломающая миграция** (нельзя сделать совместимой): окно обслуживания — `docker compose stop api` перед деплоем; откат в этом случае —
  через восстановление бэкапа (п. 7).
- **Логи:** лог job в Actions; на ВМ `/opt/callcenter/logs/deploy.log`, история `/opt/callcenter/.deploy-history`.

## 5. Откат

### 5.1 Автоматический

Если `docker compose up` или проверка здоровья не прошли, `deploy.sh` возвращает прежние compose-файлы и образы
`PREVIOUS` (они ещё лежат локально), проверяет здоровье и печатает путь к бэкапу перед деплоем. Job всё равно красный.
Если упали миграции — переключения не было вовсе: kysely применяет пачку в одной транзакции, старая версия продолжает работать.

**БД автоматически не восстанавливается**: миграции обязаны быть совместимыми, а восстановление стёрло бы всё, что
записано после бэкапа (callback'и, правки, аудит). Восстанавливать — только если старая версия не работает с новой схемой (п. 7).

### 5.2 Вручную на предыдущий релиз

```bash
sudo -iu deploy /opt/callcenter/bin/deploy.sh --status     # текущий, предыдущий, история
sudo -iu deploy /opt/callcenter/bin/deploy.sh --rollback   # деплой PREVIOUS_TAG (образы локально, без pull)
```

### 5.3 На любой прошлый SHA

Actions → Deploy → `ref` = нужный SHA (из `main`), `skip_build` = включён (образы уже есть в GHCR; если их нет — выключить,
соберётся из того коммита). `deploy.sh` увидит, что в БД больше миграций, чем знает образ, и **пропустит миграции**
с предупреждением (никаких `migrate down`). Работает, пока старый код совместим с новой схемой; иначе — восстановление
бэкапа, сделанного до нужной миграции (с потерей более поздних данных).

### 5.4 Если и откат не поднялся

```bash
cd /opt/callcenter
docker compose ps -a
docker compose logs --tail 100 api web
tail -n 100 logs/deploy.log
```

Затем: восстановить БД из `backups/pre-deploy/<файл этого деплоя>` (п. 7) и выполнить `deploy.sh --rollback`
или задеплоить заведомо рабочий SHA.

## 6. Бэкапы

|            |                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Где        | `/opt/callcenter/backups/{daily,weekly,pre-deploy,manual}/callcenter_<UTC>_<вид>[_метка].dump` + `.sha256`, права 600                                                       |
| Формат     | `pg_dump -Fc` (сжатый custom-формат) из контейнера `postgres`; принимается только непустой файл, который читает `pg_restore --list` и в котором есть данные таблиц          |
| Расписание | `callcenter-backup.timer`: ежедневно 02:30 Asia/Tashkent; воскресный бэкап считается недельным; плюс перед каждым деплоем и перед каждым восстановлением                    |
| Хранение   | 14 ежедневных, 8 недельных, 10 перед деплоем, ручные — бессрочно. Изменить: `sudo systemctl edit callcenter-backup.service` → `[Service]` `Environment=KEEP_DAILY=30`       |
| Состояние  | `systemctl status callcenter-backup.service`, `journalctl -u callcenter-backup.service`, `systemctl list-timers callcenter-backup.timer`; сбой виден в `systemctl --failed` |
| Вручную    | `sudo -iu deploy /opt/callcenter/bin/backup.sh --kind manual --label before-something`                                                                                      |

**Не входит в бэкап:** `.env` (хранить в менеджере паролей), volume `caddy-data` (сертификаты перевыпустятся сами), записи
разговоров (лежат на АТС), данные legacy.

**Off-site обязателен.** ВМ, АТС и Kerio — на одном физическом хосте с одним диском: его отказ уносит всё. Скрипт вызывает
хук `/opt/callcenter/hooks/backup-offsite <файл>` после ежедневных и недельных бэкапов (исполняемый, владелец `deploy`;
ошибка хука делает unit «failed», локальный бэкап остаётся). Хост назначения выбирает владелец; пример (restic в S3-совместимое хранилище):

```bash
#!/usr/bin/env bash
# /opt/callcenter/hooks/backup-offsite — пример, хосты и ключи подставляет владелец
set -euo pipefail
set -a; . /opt/callcenter/secrets/restic.env; set +a   # RESTIC_REPOSITORY, RESTIC_PASSWORD, AWS_* (chmod 600)
restic backup --tag callcenter "$1"
restic forget --tag callcenter --keep-daily 30 --keep-weekly 12 --keep-monthly 12 --prune
```

Дополнительно — `vzdump` всей ВМ средствами Proxmox на внешнее хранилище (не на тот же диск).

**Проверка восстановления — раз в месяц** (записывать дату и результат):

```bash
sudo -iu deploy /opt/callcenter/bin/restore.sh --test "$(ls /opt/callcenter/backups/daily/*.dump | tail -n 1)"
```

Восстанавливает в отдельную временную БД, печатает таблицу «строк в бэкапе / строк сейчас» и последнюю миграцию, удаляет
временную БД. Прод не трогается. Раз в квартал так же проверить копию из off-site (скачать на ВМ и прогнать `--test`).

## 7. Восстановление из бэкапа

```bash
sudo -iu deploy
cd /opt/callcenter
ls -lt backups/*/ | head
bin/restore.sh --test backups/pre-deploy/<файл>.dump                       # сначала посмотреть, что внутри
bin/restore.sh --yes-destroy-current-data backups/pre-deploy/<файл>.dump   # заменить данные прода
```

Что делает `restore.sh --yes-destroy-current-data` (всё или ничего):

1. останавливает `api` (Caddy продолжает отдавать SPA, API недоступен) и делает страховочный бэкап текущих данных (`manual/*pre-restore*`);
2. `pg_restore` в **новую** временную БД — если сломается, рабочая БД не тронута, api поднимается обратно;
3. меняет имена: `callcenter` → `callcenter_before_restore_<время>`, временная → `callcenter`;
4. доводит восстановленные данные до миграций работающего образа (если дамп новее образа — пропускает); при ошибке меняет имена обратно;
5. запускает api, проверяет здоровье. Старая БД остаётся до ручного удаления (команда печатается):
   `docker compose exec postgres dropdb -U callcenter callcenter_before_restore_<время>`.

Почему не `pg_restore --clean --if-exists` поверх рабочей БД: `--clean` удаляет только объекты из дампа, таблицы более новых
миграций остались бы, а `kysely_migration` о них «забыла» бы — следующий деплой упал бы.

**Аварийное восстановление на новой ВМ:** создать ВМ и `bootstrap.sh` (п. 3), вернуть `.env` из менеджера паролей,
задеплоить тот же SHA (`deploy.sh --status` в истории или по бэкапам), скопировать дамп в `backups/manual/` и выполнить `restore.sh`.

## 8. Ротация секретов

**Все секреты legacy считаются скомпрометированными**: `.env` уезжал tar-архивом на сервер вместе с кодом, архивы лежали
в `scratch/` на машинах разработчиков, часть значений по умолчанию была в коде (есть в истории git), SSH под root с паролем
открыт из Интернета. Новая система получает **свои, отдельные** учётные данные; старые меняются, когда legacy перестанет
их использовать (или сразу — с правкой `.env` legacy, если он ещё работает).

| Категория                          | Что было в legacy (без значений)                                                                                                                 | Что сделать                                                                                                                                     | Когда                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Хост Proxmox (он же сервер legacy) | root-пароль (`DEPLOY_PASS`), вход по SSH из Интернета                                                                                            | сменить, SSH только по ключам, закрыть 22 в Kerio (п. 12)                                                                                       | сейчас                                  |
| АТС: root SSH/SFTP                 | пароль root (`SSH_PASSWORD`/`SFTP_PASSWORD`), ключи хоста в `authorized_keys` АТС                                                                | сменить пароль, удалить ключи legacy из `/root/.ssh/authorized_keys` АТС                                                                        | при переключении (legacy им читает CDR) |
| АТС: AMI                           | пользователь AMI legacy (пароль в `.env`, значение по умолчанию в истории git)                                                                   | новая система — свой пользователь (п. 11); старого удалить                                                                                      | при переключении                        |
| АТС: MariaDB                       | пароль `ASTERISK_DB_USER`/`ASTERISK_DB_PASS`                                                                                                     | сменить/удалить пользователя; новая система — `cc_readonly`                                                                                     | при переключении                        |
| АТС: веб-админка Issabel           | пароль администратора (порт 3050 открыт в Интернет)                                                                                              | сменить, закрыть 3050 снаружи                                                                                                                   | сейчас                                  |
| Kerio                              | пароль веб-админки (открыта в Интернет на 80/443)                                                                                                | сменить, убрать админку из Интернета                                                                                                            | сейчас                                  |
| Proxmox API                        | `PROXMOX_USER`/`PROXMOX_PASSWORD` (watchdog)                                                                                                     | сменить; watchdog в новую систему не переносится (18.11.2026), приложению доступ к Proxmox не нужен                                                      | сейчас                                  |
| Почта                              | пароль SMTP ящика поддержки                                                                                                                      | сменить у почтового провайдера                                                                                                                  | этап 2 / сейчас                         |
| Resend                             | API-ключ                                                                                                                                         | отозвать, выпустить новый                                                                                                                       | этап 2                                  |
| Telegram                           | токен бота                                                                                                                                       | `@BotFather` → `/revoke`, новый токен. Внимание: `telegram-form-dashboard` и `tg-bridge` на хосте могут использовать того же бота — согласовать | этап 2 / сейчас                         |
| Gemini                             | API-ключ                                                                                                                                         | удалить в Google AI Studio/Cloud, новый с ограничением по API                                                                                   | этап 2                                  |
| Redis                              | `REDIS_PASSWORD`, Redis на адресе АТС :6379                                                                                                      | в новой системе Redis нет; после переключения выключить/закрыть порт                                                                            | при переключении                        |
| Приложение legacy                  | `BLACKLIST_ADMIN_PASSWORD`, `INTERNAL_API_TOKEN`/`data/.internal_token`, `DEFAULT_ADMIN_PASSWORD`                                                | не нужны (роли и сессии новой системы); удалить вместе с legacy                                                                                 | после переключения                      |
| 3CX desktop agent                  | `AGENT_API_KEY`                                                                                                                                  | новый ключ при переносе модуля агента, перенастроить агентов                                                                                    | при переносе агента                     |
| Пароли пользователей               | хеши переносятся как есть (scrypt); общий пароль `operator200…209` (`create_200.js`); аккаунты, чей пароль мог быть сброшен уязвимостью из ревью | принудительный сброс этих аккаунтов                                                                                                             | при переключении                        |
| TLS                                | `ssl/server.key`, `ssl/server.crt` (уезжали в tar), ключи аккаунта Let's Encrypt (`obtain_letsencrypt.js`)                                       | считать раскрытыми: после выпуска сертификата Caddy отозвать старый, удалить файлы с хоста                                                      | после переключения                      |
| GitHub                             | в `deploy.js` токенов нет; проверить на хосте `/opt/call-center/.git/config`, `~/.git-credentials`, `~/.npmrc`, env PM2                          | найденное отозвать                                                                                                                              | сейчас                                  |
| Сессии                             | токены сессий legacy хранились в SQLite открытым текстом                                                                                         | не переносятся: после переключения все входят заново                                                                                            | при переключении                        |
| WebAuthn                           | passkeys — открытые ключи, не секрет                                                                                                             | работают только при том же `WEBAUTHN_RP_ID` (домене) и перенесённом `webauthn_user_id` (S1)                                                     | при переключении                        |
| Копии                              | `.env` внутри `deploy_payload.tar.gz`, в `/tmp` хоста, у разработчиков                                                                           | удалить везде                                                                                                                                   | сейчас                                  |

Ротация секретов новой системы (раз в год, при уходе сотрудника, при подозрении на утечку):

- **`POSTGRES_PASSWORD`** (меняется не только в `.env`: пароль задаётся при создании volume):
  `docker compose exec -it postgres psql -U callcenter -d callcenter` → `\password callcenter` → новое значение в `.env` →
  `docker compose up -d api` (api пересоздаётся с новым `DATABASE_URL`).
- **`PBX_DB_PASSWORD`, `AMI_PASSWORD`:** сменить на АТС → `.env` → `docker compose up -d api`.
- **`DEPLOY_SSH_KEY`:** новая пара → `bootstrap.sh --ci-key new.pub --ci-key-from 127.0.0.1,::1` → удалить строку старого ключа из
  `/home/deploy/.ssh/authorized_keys` → обновить секрет.
- **Ключ SFTP:** новая пара в `/opt/callcenter/secrets/`, заменить публичный ключ на АТС.
- **Ключи хоста ВМ** (например, после клонирования ВМ): перегенерировать и обновить `DEPLOY_KNOWN_HOSTS`.
- **PAT для GHCR** (если заведён): короткий срок жизни, перевыпуск по истечении.

## 9. Параллельный запуск рядом с legacy

Цель — сверить данные и интерфейс новой системы с работающей старой, не мешая операторам.

- **Legacy не трогаем:** PM2 на хосте работает как раньше (`:3535`, `:3005`), операторы и 3CX desktop-агенты пользуются им.
- **Не входят в проект и должны продолжать работать:** `telegram-form-dashboard` (Next.js, порт 3006 на хосте),
  `isabella-connector`, `call-center-tg-bridge` (в `/root`). Новый стек живёт на отдельной ВМ и порт 3006 не занимает.
  До переключения выяснить, не обращаются ли они к API legacy (`pm2 describe <имя>`, их конфиги, `ss -tnp` на хосте).
- **Доступ к новой системе:** рекомендуется сразу освободить внешний 443 от админки Kerio и пробросить его на ВМ.
  Тогда новая система — `https://<домен>/`, legacy — `https://<домен>:3535`; RP ID один, поэтому passkeys можно проверить,
  как только S1 перенесёт `webauthn_user_id`. Вариант без Интернета — `https://<VM_IP>` из LAN (внутренний CA, без passkeys).
- **АТС только на чтение:** MariaDB `cc_readonly` (SELECT); AMI — пользователь фазы 1 (`write=reporting`, п. 11):
  `QueuePause`, `DBPut`/`DBDel`, `Hangup`, `Redirect` Asterisk отклонит с «Permission denied» — кнопки действий в новом UI
  не работают, это ожидаемо (сказать тестировщикам); SFTP записей — только чтение.
- **Данные:** своя БД Postgres. Для реалистичной проверки — `migrate-legacy` (п. 10, шаг 6) на свежей копии SQLite:
  сначала `--dry-run`, потом настоящий импорт. Перед переключением импорт повторяется в чистую БД (импорт «вставить, если нет»,
  изменения в legacy после первого импорта иначе не попадут).
- **Telegram-уведомлений в новой системе нет** (не переносятся, 18.11.2026) — дублей не будет.
- **Что сверять:** KPI дашборда и списки за одни и те же дни, история звонков, callback'и, операторы и паузы,
  воспроизведение записей, вход по паролю, права ролей. Найденные расхождения — задачами владельцам модулей.

## 10. Переключение (cutover)

### Готовность (за 1–7 дней)

- [ ] Параллельный запуск принят владельцем; известные расхождения закрыты или приняты.
- [ ] `migrate-legacy --dry-run` на свежей копии без ошибок, пропуски понятны; перенос passkeys готов (S1) или принято решение перерегистрировать.
- [ ] `restore.sh --test` проходит; off-site копия работает.
- [ ] Подготовлена конфигурация AMI фазы 2 (п. 11), но не применена.
- [ ] Выяснено, зависят ли `isabella-connector`, `tg-bridge`, `telegram-form-dashboard` от legacy API.
- [ ] Окно: вне рабочего времени (после 21:00 или в воскресенье); операторы предупреждены; согласованы критерии отката (например:
      не работает вход, живые звонки или история, и это не исправить за 1 час).

### В окне

1. **Копия legacy** (на хосте, root): `tar czf /root/cutover/legacy-$(date +%F).tgz /opt/call-center/data /opt/call-center-viewer/data /opt/call-center/system_settings.json`
   и забрать на машину админа (содержит персональные данные и секреты — хранить зашифрованно).
2. **Остановить только два приложения legacy:** `pm2 stop call-center call-center-viewer`; `pm2 ls` — `telegram-form-dashboard`,
   `isabella-connector`, `call-center-tg-bridge` остаются `online`. `pm2 kill` и `pm2 stop all` не использовать.
3. **Согласованная копия SQLite** (приложение остановлено — копия целостна): `cp -a /opt/call-center/data/callcenter.db* /root/cutover/`
   (вместе с `-wal`/`-shm`) или `sqlite3 /opt/call-center/data/callcenter.db ".backup /root/cutover/callcenter.db"`, если `sqlite3` установлен.
   JSON-файлы — по списку из `apps/api/src/scripts/migrate-legacy/README.md` в один каталог.
4. **Перенос на ВМ через машину админа** (без ключей на гипервизоре): `scp -3 -r root@192.168.0.2:/root/cutover ccadmin@<VM_IP>:/tmp/`,
   затем на ВМ `sudo install -d -o deploy -g deploy -m 700 /opt/callcenter/import && sudo cp -r /tmp/cutover/. /opt/callcenter/import/ && sudo chown -R deploy:deploy /opt/callcenter/import`.
5. **Чистая БД:**
   ```bash
   sudo -iu deploy
   cd /opt/callcenter
   bin/backup.sh --kind manual --label pre-cutover
   docker compose stop api
   docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
   docker compose run --rm -T --no-deps api node dist/database/migrate.js latest
   ```
6. **Импорт** — та же команда, что `pnpm --filter @cc/api migrate:legacy -- --sqlite <path> --data-dir <path> [--dry-run]`, но в образе
   (pnpm там нет, `migrate:legacy` = `node dist/scripts/migrate-legacy/main.js`; CLI пишет автор миграции, сверить флаги с его README):
   ```bash
   chmod -R a+rX /opt/callcenter/import
   docker compose run --rm -T --no-deps -v /opt/callcenter/import:/legacy api \
     node dist/scripts/migrate-legacy/main.js --sqlite /legacy/callcenter.db --data-dir /legacy/json --dry-run
   # отчёт без errors -> то же без --dry-run
   ```
   SQLite в режиме WAL при открытии только на чтение хочет писать `-shm` рядом с файлом: если CLI ругается, перевести **копию**
   в обычный журнал (`sudo apt install sqlite3`): `sqlite3 /opt/callcenter/import/callcenter.db 'PRAGMA journal_mode=DELETE'`.
7. **Запуск:** `docker compose up -d api`, затем `bin/deploy.sh --status` и `curl -fsS https://<домен>/api/health`.
8. **AMI фаза 2** на АТС (п. 11): добавить классы записи, `asterisk -rx "manager reload"` на консоли АТС (делает владелец).
9. **Kerio:** закрыть внешние 3535 и 3005; 443 → ВМ уже открыт.
10. **Проверка:** вход по паролю (superuser, admin, оператор); вход по passkey (если перенесены); дашборд обновляется в реальном
    времени при звонке; история за сегодня и вчера совпадает с АТС; callback'и; запись воспроизводится и скачивается; чёрный список —
    добавить и удалить тестовый номер (проверить AstDB на АТС); пауза/снятие паузы тестового оператора; тикеты; журнал аудита.
11. **Первый рабочий день:** наблюдать `docker compose logs -f api`, обратная связь операторов.

### После (через 2–4 недели без отката)

`pm2 delete call-center call-center-viewer && pm2 save`; архив `/opt/call-center*` (зашифрованно) и удаление с хоста вместе
с `ssl/` и `.env`; удалить AMI-пользователя и MariaDB-пользователя legacy, сменить root-пароль АТС, выключить Redis; остальное — по таблице п. 8.
Пока окно отката не прошло, после любой перезагрузки хоста проверять `pm2 ls`: legacy не должен подняться сам.

### Откат на legacy

1. Kerio: снова открыть 3535 и 3005 (443 можно оставить на ВМ).
2. На хосте: `pm2 start call-center call-center-viewer`.
3. AMI-пользователя новой системы вернуть в фазу 1 (только чтение), чтобы обе системы не выполняли действия.
4. Данные, созданные в новой системе за окно (закрытые callback'и, новые пользователи, тикеты), в legacy сами не вернутся —
   собрать по `audit_log` и перенести вручную; предупредить операторов.
5. Разобраться, исправить, назначить новое окно (импорт снова в чистую БД).

## 11. Что настроить на АТС (делает владелец на консоли АТС)

`<APP_VM_IP>` — IP новой ВМ, `<STRONG_PASSWORD>` — `openssl rand -hex 24`. Никаких SSH-подключений к АТС из приложения.

### 11.1 MariaDB: `cc_readonly`

Приложение читает только `asteriskcdrdb.cdr`, `asteriskcdrdb.operator_baho` (если опрос установлен) и колонки `extension`, `name` из `asterisk.users`
(`apps/api/src/pbx/pbx-db.types.ts`). В `asterisk.users` есть и другие колонки (в том числе пароли), поэтому права — на колонки.

```sql
CREATE USER 'cc_readonly'@'<APP_VM_IP>' IDENTIFIED BY '<STRONG_PASSWORD>';
GRANT SELECT ON asteriskcdrdb.cdr TO 'cc_readonly'@'<APP_VM_IP>';
-- Опрос после звонка (столбец «Mijoz bahosi», METRICS.md §3). Только после того, как таблица создана на АТС:
GRANT SELECT ON asteriskcdrdb.operator_baho TO 'cc_readonly'@'<APP_VM_IP>';
GRANT SELECT (extension, name) ON asterisk.users TO 'cc_readonly'@'<APP_VM_IP>';
ALTER USER 'cc_readonly'@'<APP_VM_IP>' WITH MAX_USER_CONNECTIONS 10;
SHOW GRANTS FOR 'cc_readonly'@'<APP_VM_IP>';
```

Если MariaDB слушает только `127.0.0.1`: в `my.cnf` `bind-address=192.168.0.124` (адрес АТС в LAN) и перезапуск MariaDB в окно
обслуживания. Модулям S2 при необходимости новых таблиц — отдельный GRANT, не `asteriskcdrdb.*`.

**Опрос после звонка (`operator_baho`).** Строка с `operator_baho` — единственная необязательная. Без неё API работает как раньше:
`/api/stats/operators` отдаёт `surveyAvailable: false`, столбец «Mijoz bahosi» скрыт, в логе API один раз предупреждение
`Survey ratings unavailable (ER_TABLEACCESS_DENIED_ERROR)`, ошибок 503 нет (`CdrRepository.surveyRatings`, тесты
`cdr.repository.spec.ts`, `pbx-mariadb.e2e-spec.ts`). Таблицу создаёт пакет `infra/pbx/operator-survey` (по его README она
уже создана на АТС 18.11.2026). Пользователь `cc_readonly` на проде создан раньше, поэтому достаточно одной команды под root MariaDB
на АТС, когда владелец решит показывать столбец:

```sql
GRANT SELECT ON asteriskcdrdb.operator_baho TO 'cc_readonly'@'<APP_VM_IP>';
SHOW GRANTS FOR 'cc_readonly'@'<APP_VM_IP>';
```

API подхватит права без перезапуска (при следующем запросе статистики). Отозвать: `REVOKE SELECT ON asteriskcdrdb.operator_baho FROM 'cc_readonly'@'<APP_VM_IP>';`.

### 11.2 AMI: пользователь в `/etc/asterisk/manager_custom.conf`

На Issabel/FreePBX `manager.conf` перегенерируется, свои пользователи — в `manager_custom.conf`. Действия AMI проверяются
по классам **write**, события доставляются по классам **read**.

Фаза 1 — параллельный запуск, только чтение:

```ini
[cc_monitor]
secret = <STRONG_PASSWORD>
deny = 0.0.0.0/0.0.0.0
permit = <APP_VM_IP>/255.255.255.255
read = call,agent,system
write = reporting
writetimeout = 5000
displayconnects = no
```

Фаза 2 — при переключении: два пользователя (подробно, с готовым конфигом — `apps/api/src/modules/ami/README.md`):

- `cc_monitor` (переменные `AMI_USER`/`AMI_PASSWORD`): `read = call,agent`, `write = call,agent,originate,reporting` —
  события, пауза, перевод, завершение, click-to-call. **Без `system` и `command`.**
- `cc_astdb` (`AMI_ASTDB_USER`/`AMI_ASTDB_PASSWORD`, только если нужен чёрный список): `read =` (пусто), `write = system` —
  только `DBPut`/`DBDel`/`DBGet`; приложение входит им с `Events: off`. Тот же `deny`/`permit`, свой пароль.

| Нужно приложению                                                                                             | Класс             | Для чего                                             |
| ------------------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------- |
| события `Newchannel`, `Hangup`, `Newstate`, `DialBegin/End`, `BridgeEnter/Leave`, `ExtensionStatus`          | read `call`       | живые звонки, присутствие                            |
| события `Agent*`, `QueueCaller*`, `QueueMemberStatus/Pause`                                                  | read `agent`      | очереди, ответ оператора                             |
| события `PeerStatus`/`ContactStatus` (не обязательно)                                                        | read `system`     | регистрация телефонов (есть и в `DeviceStateChange`) |
| `CoreShowChannels`, `SIPpeers` (или `PJSIPShowEndpoints` — может требовать `system`), `QueueStatus`, `DBGet` | write `reporting` | опрос состояния                                      |
| `Hangup`, `Redirect`                                                                                         | write `call`      | завершение и перевод звонка                          |
| `Originate` (только `Exten`+`Context`, `Async`)                                                              | write `originate` | click-to-call (пользователь без `system`)            |
| `QueuePause`                                                                                                 | write `agent`     | пауза оператора                                      |
| `DBPut`, `DBDel`                                                                                             | write `system`    | чёрный список — отдельный пользователь `cc_astdb`    |

Проверка на АТС: `asterisk -rx "manager show command QueuePause"` (строка Privilege), `asterisk -rx "manager show user cc_monitor"`,
`asterisk -rx "manager reload"` после правки.

Предупреждения:

- **Никогда `originate` вместе с `system`** у одного пользователя: `Originate` с `Application=System` выполняет команды ОС на АТС.
  Поэтому `system` (AstDB) вынесен в отдельного пользователя `cc_astdb`; click-to-call идёт через `cc_monitor` с контекстом
  `AMI_DIAL_CONTEXT` и номерами из `ORIGINATE_ALLOWED_PATTERNS`.
- Не выдавать `command`, `config`, `dialplan`. Legacy делал полночный сброс через `Command: queue reset stats` — новая система
  статистику очередей Asterisk не сбрасывает (свои счётчики дня), `QueueReset` не нужен.
- `system` нужен лишь для `DBPut`/`DBDel`, но заодно позволяет reload модулей и чтение конфигов. Поэтому: `permit` только IP ВМ,
  длинный случайный пароль, порт 5038 закрыт для всех остальных, пароль только в `.env` на ВМ.

### 11.3 SFTP записей: chroot, только чтение, по ключу

Issabel (CentOS 7, OpenSSH 7.4) поддерживает `internal-sftp -R`. Каталог записей подключается в chroot bind-mount'ом только на чтение.

```bash
useradd --system --no-create-home --home-dir / --shell /sbin/nologin cc_recordings
install -d -o root -g root -m 755 /srv/sftp /srv/sftp/cc_recordings /srv/sftp/cc_recordings/monitor
echo '/var/spool/asterisk/monitor /srv/sftp/cc_recordings/monitor none bind,ro 0 0' >> /etc/fstab
mount /srv/sftp/cc_recordings/monitor && mount -o remount,bind,ro /srv/sftp/cc_recordings/monitor
findmnt /srv/sftp/cc_recordings/monitor            # должно быть ro
install -d -m 755 /etc/ssh/authorized_keys
install -m 644 cc_recordings.pub /etc/ssh/authorized_keys/cc_recordings   # публичный ключ с ВМ
```

В конец `/etc/ssh/sshd_config` (если есть `AllowUsers` — добавить туда `cc_recordings`), затем `sshd -t && systemctl reload sshd`:

```
Match User cc_recordings
    ChrootDirectory /srv/sftp/cc_recordings
    ForceCommand internal-sftp -R
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    PasswordAuthentication no
    PubkeyAuthentication yes
    AllowTcpForwarding no
    X11Forwarding no
    AllowAgentForwarding no
    PermitTunnel no
    PermitTTY no
```

Если файлы записей не читаются «прочими» (права 640), добавить `cc_recordings` в группу `asterisk` — в chroot он всё равно видит
только `monitor`. Ключ создаётся на ВМ: `sudo -u deploy ssh-keygen -t ed25519 -N '' -C cc-recordings -f /opt/callcenter/secrets/sftp_recordings_key`
(каталог 700, файлу ключа 644 — его читает пользователь контейнера; подключение в контейнер — закомментированный блок в
`compose.override.yml`, включает S5). В `.env`: `SFTP_USER=cc_recordings`, `SFTP_MONITOR_PATH=/monitor`,
`SFTP_PRIVATE_KEY_PATH=/run/secrets/sftp_recordings_key`. Ключ хоста АТС приложение должно закреплять (S5).
Проверка с ВМ: `sftp -i ... cc_recordings@192.168.0.124` → `ls monitor` работает, `put` — отказ.

### 11.4 Firewall АТС

Через модуль Firewall Issabel (чтобы правила пережили перезагрузку) или iptables:

- 3306 и 5038 — только с `<APP_VM_IP>`; всем остальным DROP;
- 22 — только с IP админов и `<APP_VM_IP>`;
- Kerio не пробрасывает на АТС ничего из этого; внешний 3050 (админка Issabel) закрыть (п. 12).

```bash
iptables -I INPUT -p tcp -s <APP_VM_IP> -m multiport --dports 3306,5038 -j ACCEPT
iptables -A INPUT -p tcp -m multiport --dports 3306,5038 -j DROP
```

AMI передаёт данные открытым текстом — только внутри LAN (или VPN), никогда через Интернет.

## 12. Отдельная задача владельца: гипервизор и Kerio

Не блокирует новую систему, но это главный риск инфраструктуры:

1. **Kerio:** закрыть из Интернета 22 (root SSH хоста), 80/443 веб-админки Kerio, 3050 (админка Issabel); 3535/3005 — после переключения.
   Админ-доступ — через VPN Kerio или из LAN. 8006 (Proxmox) уже закрыт — оставить.
2. **SSH хоста Proxmox:** `PermitRootLogin prohibit-password`, `PasswordAuthentication no`, вход только по ключам, `LogLevel VERBOSE`,
   журнал входов (сейчас аутентификация не логируется), при желании fail2ban.
3. **PVE 7.1 (Debian 11) не обновлялся с 2021 и не поддерживается** (PVE 7 — EOL июль 2024): план обновления в окно обслуживания
   (Kerio и АТС перезагрузятся — пропадут Интернет и телефония):
   `vzdump` всех ВМ на внешнее хранилище → обновить до последней 7.4 → `pve7to8 --full` → обновление до 8.x (Debian 12) по официальной
   инструкции → позже `pve8to9` → 9.x (Debian 13).
4. **Убрать приложения с гипервизора:** legacy после переключения, а `telegram-form-dashboard`, `isabella-connector`,
   `call-center-tg-bridge` — в отдельную ВМ (любая уязвимость в них = root на хосте = все ВМ).
5. Бэкапы ВМ (`vzdump`) — на внешнее хранилище.

## 13. Эксплуатация

```bash
ssh ccadmin@<VM_IP>
sudo -iu deploy
cd /opt/callcenter
docker compose ps                         # compose.yml + compose.override.yml + .env подхватываются сами
docker compose logs -f --tail 100 api     # логи приложения (ротация драйвером local)
bin/deploy.sh --status                    # текущий/предыдущий релиз, история
bin/check-env.sh
bin/backup.sh --kind manual --label note
bin/restore.sh --test backups/daily/<файл>.dump
tail -f logs/deploy.log
df -h /opt/callcenter; docker system df
```

| Симптом                             | Что смотреть                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| деплой: `check-env` с ошибками      | вывод называет ключи; поправить `.env`, перезапустить workflow                                  |
| деплой: `cannot pull`               | образ собран? доступ пакета к репозиторию (п. 3.6)                                              |
| job `deploy` не стартует            | runner offline (Settings → Actions → Runners; `sudo systemctl status 'actions.runner.*'` на ВМ) |
| SSH: `Host key verification failed` | ключ хоста ВМ сменился — сверить отпечаток и обновить `DEPLOY_KNOWN_HOSTS`                      |
| `health check failed`               | `docker compose logs api web`; `edge:` — Caddy/домен/443, `api:` — приложение или Postgres      |
| сертификат не выпускается           | 443 из Интернета действительно приходит на ВМ (не на админку Kerio), DNS домена, логи `web`     |
| бэкап «failed»                      | `journalctl -u callcenter-backup.service`; место на диске; хук off-site                         |
| кончается место                     | `docker image prune`, старые `backups/manual`, `releases/` (чистятся сами при деплое), логи     |

Файлы на сервере: `.deploy-state` (CURRENT_TAG, PREVIOUS_TAG), `.deploy-history` (время, результат, тег, предыдущий),
`.rollback/` (compose-файлы прошлого релиза на время деплоя), `releases/<SHA>/` (последние 10), `logs/{deploy,backup,restore}.log`.

## 14. Раздел «Инструменты» (S8)

Страница `/tools`: ссылки на кабинеты, Uzcrypto, очиститель AnyDesk, справочник ответственных, клавиатура 2026,
универсальный конвертер. Своих таблиц в БД нет.

**Конвертер без внешних программ.** Legacy запускал Python (`converter.py`: pdf2docx, PyMuPDF, reportlab, Pillow).
В новой системе нет ни Python, ни LibreOffice, ни shell:

| Что | Где | Чем |
| --- | --- | --- |
| JPG / PNG / WEBP → JPG / PNG / WEBP / PDF | браузер | canvas; PDF из картинки собирается без библиотек |
| PDF → PNG / JPG (200 dpi, несколько страниц → ZIP), PDF → TXT / DOCX (текстовый слой) | браузер | pdf.js (`pdfjs-dist`, грузится только при открытии конвертера) |
| DOCX → PDF / TXT, DOC → DOCX / PDF / TXT, TXT → PDF / DOCX | сервер | `mammoth`, `pdfmake` (шрифт Roboto), `word-extractor`, `jszip` — чистый JavaScript |

Сервер не разбирает PDF вообще (у pdf.js были уязвимости с выполнением кода). Каждая серверная конвертация идёт в
отдельном `worker_thread` без переменных окружения, с лимитом памяти (`TOOLS_CONVERT_MEMORY_MB`, 512) и таймаутом
(`TOOLS_CONVERT_TIMEOUT_SEC`, 60 с), поток уничтожается после ответа. Одновременно — `TOOLS_CONVERT_CONCURRENCY`
(2), остальным 503. Лимит 10 запросов в минуту с одного IP, файл ≤ 35 МБ, проверка сигнатуры (DOCX = ZIP,
DOC = OLE, TXT без NUL-байтов и не PDF). Файл не пишется на диск: multer держит его в памяти, результат уходит
в ответ. Имя файла в логи не попадает (там бывают ФИО граждан).

**Влияние на образ `api`.** Новые prod-зависимости ≈ **33 МБ** в `node_modules` (pdfmake + pdfkit + fontkit ≈ 28 МБ,
вместе с браузерными сборками и source map; word-extractor, jszip, htmlparser2 — < 1 МБ, частично уже были). Нативных
модулей и системных пакетов нет, `Dockerfile` не менялся. Для сравнения: Python-стек legacy (python3 + pdf2docx
с opencv/numpy + PyMuPDF + reportlab + Pillow) дал бы +350–450 МБ, LibreOffice — +400–700 МБ. Файлы для скачивания
(`clean-anydesk.bat`, `uzb2026-klaviatura.zip`) — 268 КБ, лежат в `dist/modules/tools/files` (копирует `nest build`).
Проверено в собранном образе (`node:26-alpine`, 18.11.2026): `/app/node_modules` — 190 МБ; DOCX на 3000 абзацев
(≈ 60 страниц) → PDF за 0,8 с, пик памяти процесса ≈ +170 МБ; предел одной конвертации — лимит воркера.

**Сеть.** Версия Uzcrypto берётся с `https://edo.ijro.uz/` (только этот хост, TLS проверяется, кеш 1 час, при
ошибке — последняя известная или встроенная 2.2.4.24). Контейнеру `api` нужен исходящий HTTPS на `edo.ijro.uz`;
если он закрыт, поставить `TOOLS_UZCRYPTO_LOOKUP=false` — карточка покажет встроенную версию, кнопка «Yuklab olish»
всё равно ведёт на сайт поставщика (`302`). Остальные ссылки (кабинеты EDO / E-Huquqshunos, генератор писем Ijro,
Telegram Form) открывает браузер пользователя.

**Caddy (CSP).** «Shu yerda ochish» для генератора писем Ijro показывает внешний сайт во фрейме, поэтому в CSP
добавлен `frame-src https://xat-tayyorlash.vercel.app`. Кабинеты EDO и E-Huquqshunos сами запрещают показ во фрейме
(`X-Frame-Options`), у них только «Ochish» в новой вкладке. pdf.js работает без `wasm-unsafe-eval` (wasm выключен).

**Telegram Form.** Прокси `/telegram-form` из legacy не переносится: адрес отдельного приложения задаётся в
`TOOLS_TELEGRAM_FORM_URL`; пусто — карточка показывает «Sozlanmagan».

