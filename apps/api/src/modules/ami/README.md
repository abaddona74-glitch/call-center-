# Модуль `ami` — подключение к Asterisk Manager Interface

Свой минимальный AMI-клиент (TCP, `Login`, корреляция по `ActionID`, list-действия, `Ping` keepalive, переподключение с
backoff). Значения заголовков с CR/LF/NUL отклоняются до записи в сокет (защита от инъекции второго действия). Модули
`live` и `actions` используют `AmiService`, остальные — порт `AMI_COMMANDS` (`@InjectAmiCommands()`, модуль глобальный).
Никакого SSH и `asterisk -rx`: всё только через AMI.

## Какие права AMI нужны

Asterisk проверяет **действия** по классам `write`, а **события** доставляет по классам `read`
(`manager show command <Action>` показывает класс действия, если у действия их несколько — достаточно любого).

### Что делает приложение

| Действие / события                                                                                                                  | Класс              | Кто вызывает                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| события `Newchannel`, `Newstate`, `Hangup`, `HangupRequest`, `DialBegin/End`, `BridgeEnter/Leave`, `*Transfer`, `DeviceStateChange` | read `call`        | `live` — звонки, присутствие                                                            |
| события `QueueCaller*`, `Agent*`, `QueueMemberStatus/Pause`                                                                         | read `agent`       | `live` — очереди, ответ оператора, пауза                                                |
| события `PeerStatus`, `ContactStatus` (не обязательно)                                                                              | read `system`      | `live` — быстрее видна потеря регистрации; без них хватает `DeviceStateChange` и опроса |
| `CoreShowChannels`, `SIPpeers`                                                                                                      | write `reporting`  | `live` — сверка состояния при подключении и раз в `AMI_POLL_INTERVAL_SEC`               |
| `QueueStatus`, `Ping`                                                                                                               | — (класс не нужен) | `live`, keepalive                                                                       |
| `QueuePause`                                                                                                                        | write `agent`      | `actions` — пауза оператора; `AMI_COMMANDS.queuePause`                                  |
| `Redirect`, `Hangup`                                                                                                                | write `call`       | `actions` — перевод, завершение звонка                                                  |
| `Originate` (только `Channel`+`Exten`+`Context`, `Async`, без `Application`)                                                        | write `originate`  | `actions` — click-to-call                                                               |
| `DBPut`, `DBDel` (`DBGet` — `system` или `reporting`)                                                                               | write `system`     | `AMI_COMMANDS` — чёрный список (S4)                                                     |

Не используется и не нужно: `command`, `config`, `dialplan`, `user`, `cdr`, `cel`, `QueueReset` (статистику очередей
Asterisk новая система **не** сбрасывает — свои счётчики дня живут в приложении, legacy-баг B50), `PJSIPShowEndpoints`
(см. ниже).

### Правило: `originate` и `system` — у разных пользователей

`Originate` с `Application=System` выполняет команду ОС на АТС, поэтому один пользователь никогда не должен иметь и
`originate`, и `system` (а `command` — никому). Приложение поддерживает **два** AMI-пользователя:

| Переменная                              | Пользователь АТС | Права                                                                  |
| --------------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| `AMI_USER` / `AMI_PASSWORD`             | `cc_monitor`     | `read = call,agent` · `write = call,agent,originate,reporting`         |
| `AMI_ASTDB_USER` / `AMI_ASTDB_PASSWORD` | `cc_astdb`       | `read =` (пусто, приложение входит с `Events: off`) · `write = system` |

Если `AMI_ASTDB_*` не заданы, `DBPut`/`DBDel`/`DBGet` идут через `AMI_USER` — так только в разработке (симулятор).
В проде без чёрного списка второй пользователь не нужен вовсе: тогда `DBPut`/`DBDel` просто вернут ошибку.

### `/etc/asterisk/manager_custom.conf` (Issabel/FreePBX перегенерирует `manager.conf`)

`<APP_VM_IP>` — IP ВМ нового стека, пароли — `openssl rand -hex 24`.

```ini
; события + действия со звонками; без system/command
[cc_monitor]
secret = <STRONG_PASSWORD_1>
deny = 0.0.0.0/0.0.0.0
permit = <APP_VM_IP>/255.255.255.255
read = call,agent
write = call,agent,originate,reporting
writetimeout = 5000
displayconnects = no
; шумные события, которые приложению не нужны
eventfilter = !Event: VarSet
eventfilter = !Event: Newexten
eventfilter = !Event: RTCP
eventfilter = !Event: Cdr
eventfilter = !Event: CEL

; только AstDB (чёрный список); без событий и без originate
[cc_astdb]
secret = <STRONG_PASSWORD_2>
deny = 0.0.0.0/0.0.0.0
permit = <APP_VM_IP>/255.255.255.255
read =
write = system
writetimeout = 5000
displayconnects = no
```

После правки: `asterisk -rx "manager reload"`, проверка — `asterisk -rx "manager show user cc_monitor"`,
`asterisk -rx "manager show command QueuePause"` (строка `Privilege`), `asterisk -rx "manager show connected"`
(два подключения с IP ВМ). В приложении: `GET /api/ami/status` → `connected`, в логе API —
`AMI connected to …` и `AMI AstDB connection ready`.

### Фаза параллельного запуска (только чтение)

Пока работает legacy: `cc_monitor` с `write = reporting`, `cc_astdb` не создавать. `QueuePause`, `Redirect`, `Hangup`,
`Originate` Asterisk отклонит («Permission denied»), API вернёт 502 и запишет `telephony.<action>.failed` в аудит —
кнопки действий в UI не работают, это ожидаемо. Живая панель работает полностью.

### Замечания

- **PJSIP** (`AMI_CHANNEL_TECH=PJSIP`): `PJSIPShowEndpoints` может требовать `system` — его **не** добавлять пользователю
  `cc_monitor`. Опрос регистрации тогда завершится «Permission denied» (в логе предупреждение), остальная сверка работает,
  а регистрация берётся из событий `ContactStatus`/`DeviceStateChange`. Проверить на реальной версии Asterisk (§10 `telephony.md`).
- `system` у `cc_astdb` всё равно позволяет reload модулей и т.п. Поэтому — отдельный пароль, `permit` только IP ВМ,
  порт 5038 закрыт файрволом для всех остальных.
- AMI идёт по LAN открытым текстом (пароль в `Login`), TLS-порт AMI клиент пока не поддерживает — отсюда требование
  `permit` + файрвол.
- Классы событий и действий выше — по исходникам Asterisk 13; на живой АТС сверить `manager show command`.

## Разработка

Симулятор: `node infra/dev-pbx/ami-sim/ami-sim.mjs` (см. `infra/dev-pbx/ami-sim/README.md`), в `.env.local`
`AMI_HOST=127.0.0.1`, `AMI_PORT=15038`, `AMI_USER=ccmonitor`, `AMI_PASSWORD=sim-dev-secret`.
