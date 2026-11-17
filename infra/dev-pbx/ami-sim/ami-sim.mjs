#!/usr/bin/env node
// AMI simulator for local development: speaks the Asterisk Manager Interface on 127.0.0.1:15038 and replays
// realistic call scenarios (see pbx-model.mjs). No dependencies.
//
//   node infra/dev-pbx/ami-sim/ami-sim.mjs                 # continuous random traffic
//   node infra/dev-pbx/ami-sim/ami-sim.mjs --scenario queue-answered --scenario outbound-failed
//   node infra/dev-pbx/ami-sim/ami-sim.mjs --speed 3 --rate 6
//
// Options: --port 15038  --host 127.0.0.1  --speed <x>  --rate <calls per minute>  --seed <n>
//          --scenario <name> (repeatable; plays the list once, then idles)  --quiet
// Credentials: AMI_SIM_USER / AMI_SIM_SECRET (defaults are dev-only: ccmonitor / sim-dev-secret).
import { createServer } from 'node:net';
import { SimPbx, realClock, seededRandom } from './pbx-model.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const scenarios = args.flatMap((a, i) => (a === '--scenario' ? [args[i + 1]] : []));
const HOST = opt('host', '127.0.0.1');
const PORT = Number(opt('port', '15038'));
const SPEED = Number(opt('speed', '1'));
const RATE = Number(opt('rate', '5'));
const QUIET = args.includes('--quiet');
const USER = process.env.AMI_SIM_USER ?? 'ccmonitor';
const SECRET = process.env.AMI_SIM_SECRET ?? 'sim-dev-secret';

const log = (...m) => QUIET || console.log(new Date().toISOString().slice(11, 19), ...m);

const clients = new Set();
const pbx = new SimPbx({
  clock: realClock(SPEED),
  random: opt('seed') ? seededRandom(Number(opt('seed'))) : Math.random,
  onEvent: (evt) => {
    const frame = serialize(evt);
    for (const c of clients) if (c.loggedIn && c.events) c.socket.write(frame);
  },
});

function serialize(fields) {
  return `${Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n')}\r\n\r\n`;
}

function parse(block) {
  const msg = {};
  for (const line of block.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) msg[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return msg;
}

/** Scenario catalogue (also used by --scenario). */
const SCENARIOS = {
  'queue-answered': () => pbx.inboundQueueCall({}),
  'queue-answered-long': () => pbx.inboundQueueCall({ talkSec: pbx.rand(200, 520) }),
  'queue-abandoned': () => pbx.inboundQueueCall({ patienceSec: pbx.rand(8, 40), memberOutcomes: ['noanswer'] }),
  'ring-no-answer-then-reject': () => pbx.inboundQueueCall({ memberOutcomes: ['noanswer', 'reject', 'answer'] }),
  'queue-timeout': () => pbx.inboundQueueCall({ maxWaitSec: 25, memberOutcomes: ['noanswer', 'noanswer'] }),
  transfer: () => {
    const target = pbx.pick(['103', '106', '111', '114']);
    return pbx.inboundQueueCall({ talkSec: pbx.rand(15, 60), transferTo: target });
  },
  'outbound-answered': () => outboundFromFreeOperator({ answer: true }),
  'outbound-failed': () => outboundFromFreeOperator({ answer: false }),
  'hidden-caller': () => pbx.inboundQueueCall({ hidden: true }),
  'ivr-only': () => pbx.inboundIvrOnly({}),
  'after-hours': () => pbx.inboundIvrOnly({ afterHours: true, durationSec: pbx.rand(6, 12) }),
  'zangiota-queue': () => pbx.inboundQueueCall({ queue: '2020142' }),
};
const WEIGHTS = [
  ['queue-answered', 30],
  ['queue-answered-long', 6],
  ['queue-abandoned', 10],
  ['ring-no-answer-then-reject', 8],
  ['queue-timeout', 4],
  ['transfer', 7],
  ['outbound-answered', 12],
  ['outbound-failed', 7],
  ['hidden-caller', 4],
  ['ivr-only', 6],
  ['after-hours', 3],
  ['zangiota-queue', 3],
];

function outboundFromFreeOperator(o) {
  const free = [...pbx.peers.values()].filter((p) => p.registered && !p.busy && !p.paused);
  if (!free.length) return Promise.resolve();
  return pbx.outbound({ ext: pbx.pick(free).ext, ...o });
}

function pickScenario() {
  const total = WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = pbx.random() * total;
  for (const [name, w] of WEIGHTS) if ((r -= w) <= 0) return name;
  return WEIGHTS[0][0];
}

function run(name) {
  const fn = SCENARIOS[name];
  if (!fn) {
    console.error(`unknown scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
    return Promise.resolve();
  }
  log(`▶ ${name}`);
  return Promise.resolve(fn()).catch((err) => console.error(`scenario ${name} failed:`, err));
}

function handleAction(client, msg) {
  const id = msg.actionid;
  const reply = (fields) => client.socket.write(serialize({ ...fields, ActionID: id }));
  const ok = (message, extra = {}) => reply({ Response: 'Success', ...extra, Message: message });
  const err = (message) => reply({ Response: 'Error', Message: message });
  const list = (items, completeEvent) => {
    ok(`${completeEvent.replace('Complete', '')} will follow`, { EventList: 'start' });
    for (const e of items) client.socket.write(serialize({ ...e, ActionID: id }));
    client.socket.write(serialize({ Event: completeEvent, ActionID: id, EventList: 'Complete', ListItems: String(items.length) }));
  };

  const action = (msg.action ?? '').toLowerCase();
  if (action === 'login') {
    if (msg.username === USER && msg.secret === SECRET) {
      client.loggedIn = true;
      client.events = !/^off$/i.test(msg.events ?? 'on');
      log(`client ${client.addr} logged in`);
      return ok('Authentication accepted');
    }
    log(`client ${client.addr} authentication failed`);
    return err('Authentication failed');
  }
  if (!client.loggedIn) return err('Permission denied');

  log(`← ${msg.action} ${Object.entries(msg).filter(([k]) => !['action', 'actionid'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  switch (action) {
    case 'ping':
      return reply({ Response: 'Success', Ping: 'Pong', Timestamp: (Date.now() / 1000).toFixed(6) });
    case 'logoff':
      reply({ Response: 'Goodbye', Message: 'Thanks for all the fish.' });
      return client.socket.end();
    case 'events':
      client.events = !/^off$/i.test(msg.eventmask ?? 'on');
      return reply({ Response: 'Success', Events: client.events ? 'On' : 'Off' });
    case 'coreshowchannels':
      return list(pbx.listCoreShowChannels(), 'CoreShowChannelsComplete');
    case 'queuestatus':
      return list(pbx.listQueueStatus(msg.queue), 'QueueStatusComplete');
    case 'sippeers':
      return list(pbx.listPeers(), 'PeerlistComplete');
    case 'queuepause': {
      const r = pbx.actionQueuePause(msg);
      return r.error ? err(r.error) : ok(r.message);
    }
    case 'hangup': {
      const r = pbx.actionHangup(msg.channel);
      return r.error ? err(r.error) : ok(r.message);
    }
    case 'redirect': {
      const r = pbx.actionRedirect(msg.channel, msg.exten, msg.context);
      return r.error ? err(r.error) : ok(r.message);
    }
    case 'originate': {
      if (!/^true|1|yes$/i.test(msg.async ?? '')) return err('Only Async originate is simulated');
      const r = pbx.actionOriginate(msg);
      return r.error ? err(r.error) : ok(r.message);
    }
    case 'dbput':
      pbx.astdb.set(`${msg.family}/${msg.key}`, msg.val ?? '');
      return ok('Updated database successfully');
    case 'dbdel':
      return pbx.astdb.delete(`${msg.family}/${msg.key}`) ? ok('Key deleted successfully') : err('Database entry not found');
    case 'dbget': {
      const key = `${msg.family}/${msg.key}`;
      if (!pbx.astdb.has(key)) return err('Database entry not found');
      ok('Result will follow', { EventList: 'start' });
      client.socket.write(serialize({ Event: 'DBGetResponse', ActionID: id, Family: msg.family, Key: msg.key, Val: pbx.astdb.get(key) }));
      return client.socket.write(serialize({ Event: 'DBGetComplete', ActionID: id, EventList: 'Complete', ListItems: '1' }));
    }
    case 'command':
      return err('Permission denied'); // the monitoring user has no "command" class on purpose
    default:
      return err('Invalid/unknown command');
  }
}

const server = createServer((socket) => {
  const client = { socket, loggedIn: false, events: true, buffer: '', addr: `${socket.remoteAddress}:${socket.remotePort}` };
  clients.add(client);
  socket.setEncoding('utf8');
  socket.write('Asterisk Call Manager/2.10.6\r\n');
  socket.on('data', (chunk) => {
    client.buffer += chunk;
    if (client.buffer.length > 65_536) return socket.destroy();
    let m;
    while ((m = /\r?\n\r?\n/.exec(client.buffer))) {
      const block = client.buffer.slice(0, m.index);
      client.buffer = client.buffer.slice(m.index + m[0].length);
      const msg = parse(block);
      if (msg.action) handleAction(client, msg);
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    clients.delete(client);
    log(`client ${client.addr} disconnected`);
  });
});

server.listen(PORT, HOST, () => {
  log(`AMI simulator on ${HOST}:${PORT} (speed ×${SPEED}${scenarios.length ? `, scenarios: ${scenarios.join(', ')}` : `, ${RATE} calls/min`})`);
});

if (scenarios.length) {
  (async () => {
    for (const name of scenarios) await run(name);
    log('scenario list finished; idling');
  })();
} else {
  // Continuous traffic: Poisson-ish arrivals, a flaky operator that drops off now and then.
  const next = () => {
    const meanMs = 60_000 / Math.max(0.1, RATE) / SPEED;
    setTimeout(() => {
      void run(pickScenario());
      next();
    }, meanMs * (0.3 + pbx.random() * 1.4));
  };
  setTimeout(() => {
    for (let i = 0; i < 3; i++) void run(pickScenario());
    next();
  }, 1_500);
  setInterval(() => {
    const peer = pbx.peers.get('120');
    if (peer && !peer.busy) pbx.setRegistered('120', !peer.registered);
  }, 120_000 / SPEED);
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
