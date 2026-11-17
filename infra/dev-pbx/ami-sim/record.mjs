#!/usr/bin/env node
// Records deterministic AMI event sequences from the simulator into JSON fixtures for the live-state
// reducer tests (apps/api/src/modules/live/domain/__fixtures__). Re-run after changing pbx-model.mjs:
//   node infra/dev-pbx/ami-sim/record.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimPbx, seededRandom, virtualClock } from './pbx-model.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/api/src/modules/live/domain/__fixtures__');
// 2026-11-17 10:00:00 Asia/Tashkent
const START = Date.UTC(2026, 10, 17, 5, 0, 0);

const SCENARIOS = {
  'queue-answered-client-hangup': (p) => p.inboundQueueCall({ phone: '998901234567', ivrSec: 3_000, talkSec: 95, hangupBy: 'client' }),
  'queue-answered-operator-hangup': (p) => p.inboundQueueCall({ phone: '935551122', ivrSec: 2_000, talkSec: 200, hangupBy: 'operator' }),
  'queue-abandoned': (p) => p.inboundQueueCall({ phone: '977001122', ivrSec: 2_000, patienceSec: 20, memberOutcomes: ['noanswer'] }),
  'ring-no-answer-then-reject': (p) =>
    p.inboundQueueCall({ phone: '901112233', ivrSec: 2_000, memberOutcomes: ['noanswer', 'reject', 'answer'], talkSec: 60, hangupBy: 'client' }),
  'queue-timeout': (p) => p.inboundQueueCall({ phone: '998331234567', ivrSec: 2_000, maxWaitSec: 25, memberOutcomes: ['noanswer', 'noanswer'] }),
  'blind-transfer': (p) =>
    p.inboundQueueCall({ phone: '909998877', ivrSec: 2_000, talkSec: 40, transferTo: '106', afterTransferTalkSec: 70, hangupBy: 'client' }),
  'outbound-answered': (p) => p.outbound({ ext: '103', phone: '991234567', answer: true, talkSec: 75, hangupBy: 'operator' }),
  'outbound-busy': (p) => p.outbound({ ext: '111', phone: '951234567', answer: false, failStatus: 'BUSY' }),
  'outbound-cancelled': (p) => p.outbound({ ext: '111', phone: '951234567', answer: false, failStatus: 'CANCEL' }),
  'click-to-call': (p) => p.outbound({ ext: '101', phone: '901234567', originate: true, answer: true, talkSec: 45, hangupBy: 'client' }),
  'hidden-caller': (p) => p.inboundQueueCall({ hidden: true, ivrSec: 2_000, talkSec: 30, hangupBy: 'client' }),
  'ivr-only': (p) => p.inboundIvrOnly({ phone: '998941112233', durationSec: 12 }),
  'after-hours': (p) => p.inboundIvrOnly({ phone: '998941112244', afterHours: true, durationSec: 8 }),
};

mkdirSync(OUT, { recursive: true });
for (const [name, play] of Object.entries(SCENARIOS)) {
  const clock = virtualClock(START);
  const events = [];
  const pbx = new SimPbx({ clock, random: seededRandom(42), onEvent: (e) => events.push({ t: clock.now() - START, e }) });
  const peers = pbx.listPeers();
  const queueStatus = pbx.listQueueStatus();
  await play(pbx);
  const file = join(OUT, `${name}.json`);
  writeFileSync(file, `${JSON.stringify({ scenario: name, start: START, peers, queueStatus, events }, null, 1)}\n`);
  console.log(`${name}: ${events.length} events`);
}
