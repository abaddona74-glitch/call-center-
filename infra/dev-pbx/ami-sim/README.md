# AMI simulator (dev only)

Speaks the Asterisk Manager Interface (Asterisk 13 / Issabel field names) on `127.0.0.1:15038` and plays
realistic call traffic, so the live dashboard can be developed without a PBX. No dependencies.

```bash
node infra/dev-pbx/ami-sim/ami-sim.mjs                      # continuous random traffic (5 calls/min)
node infra/dev-pbx/ami-sim/ami-sim.mjs --speed 2 --rate 8   # faster
node infra/dev-pbx/ami-sim/ami-sim.mjs --scenario transfer --scenario outbound-failed
```

API side (`apps/api/.env.local`): `AMI_HOST=127.0.0.1`, `AMI_PORT=15038`, `AMI_USER=ccmonitor`,
`AMI_PASSWORD=sim-dev-secret` (override with `AMI_SIM_USER` / `AMI_SIM_SECRET`; dev-only values).

Scenarios: `queue-answered`, `queue-answered-long` (crosses the 3/7-minute timer thresholds), `queue-abandoned`,
`ring-no-answer-then-reject`, `queue-timeout`, `transfer` (blind), `outbound-answered`, `outbound-failed`,
`hidden-caller`, `ivr-only`, `after-hours`, `zangiota-queue`. Operators 101–120 / 200–201 (120 flaps
registration every 2 minutes, 119 starts paused).

Actions answered like Asterisk: `Login`, `Ping`, `Logoff`, `Events`, `CoreShowChannels`, `QueueStatus`, `SIPpeers`,
`QueuePause`, `Hangup`, `Redirect`, `Originate` (Async only), `DBPut`/`DBGet`/`DBDel`; `Command` is refused.

`record.mjs` regenerates the reducer test fixtures in `apps/api/src/modules/live/domain/__fixtures__/`
(deterministic: seeded random + virtual clock). Re-run it after changing `pbx-model.mjs`.
