#!/usr/bin/env node
/**
 * Prepares the dev SFTP stand-in for the PBX recordings share (service `sftp` in compose.dev.yml):
 *   - an ed25519 client key pair for the API (private key stays in .data/, never committed),
 *   - a `monitor/` tree laid out like Asterisk (YYYY/MM/DD/*.wav) with small generated WAV files
 *     whose names match `recordingfile` in infra/dev-pbx/mariadb-init/02-seed.sql.
 *
 *   node infra/dev-pbx/sftp/setup.mjs
 *   docker compose -f infra/compose.dev.yml up -d sftp
 *
 * Idempotent: existing keys are kept, WAV files are rewritten.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '.data');
const keysDir = path.join(root, 'keys');
const monitorDir = path.join(root, 'monitor');

mkdirSync(keysDir, { recursive: true });
const keyFile = path.join(keysDir, 'id_ed25519');
if (!existsSync(keyFile)) {
  // Fixed arguments, no shell.
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'cc-dev-recordings', '-f', keyFile], {
    stdio: 'inherit',
  });
}

/** 8 kHz, 16-bit, mono PCM — the format Asterisk records in (16000 bytes per second). */
function wav(seconds, seed) {
  const rate = 8000;
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  // Alternating "speakers": two tones in 1.5 s turns with short pauses, so seeking is audible.
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const turn = Math.floor(t / 1.5);
    const inPause = t % 1.5 > 1.3;
    const freq = turn % 2 === 0 ? 330 + seed * 20 : 520 + seed * 15;
    const env = inPause ? 0 : 0.35 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
    buf.writeInt16LE(Math.round(env * 32767 * Math.sin(2 * Math.PI * freq * t)), 44 + i * 2);
  }
  return buf;
}

const files = [
  // CDR: inbound via queue, answered by 101
  ['2026/11/17/q-200-901234567-20261117-100000-1763370000.1.wav', wav(45, 1)],
  // CDR: outbound from 103
  ['2026/11/17/out-935551122-103-20261117-102000-1763371200.3.wav', wav(12, 2)],
  // Header-only file (no conversation) — shown as "empty", streaming is refused
  ['2026/11/17/q-200-935551122-20261117-101000-1763370600.2.wav', wav(0, 0)],
  // Another day, internal call
  ['2026/11/16/g101-20261116-153000-1763290200.7.wav', wav(6, 3)],
  ['2026/11/16/q-200-977778899-20261116-090500-1763273100.9.wav', wav(20, 4)],
];

rmSync(monitorDir, { recursive: true, force: true });
for (const [rel, data] of files) {
  const abs = path.join(monitorDir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
}
// Things the API must hide or refuse: a non-audio file and a symlink pointing outside the tree.
writeFileSync(path.join(monitorDir, '2026/11/16/notes.txt'), 'not a recording\n');
symlinkSync('/etc/passwd', path.join(monitorDir, '2026/11/16/escape.wav'));

console.log(`SFTP dev data ready in ${root}`);
console.log(`API settings: SFTP_HOST=127.0.0.1 SFTP_PORT=2222 SFTP_USER=recordings SFTP_PRIVATE_KEY_PATH=${keyFile}`);
