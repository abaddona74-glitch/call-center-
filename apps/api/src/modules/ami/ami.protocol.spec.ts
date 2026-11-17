import { describe, expect, it } from 'vitest';
import { AmiHeaderInjectionError, AmiParser, parseAmiDuration, serializeAction } from './ami.protocol.js';

describe('serializeAction', () => {
  it('writes headers in order and ends with a blank line', () => {
    expect(serializeAction('QueuePause', '7', { Interface: 'Local/101@from-queue/n', Paused: true, Queue: undefined })).toBe(
      'Action: QueuePause\r\nActionID: 7\r\nInterface: Local/101@from-queue/n\r\nPaused: true\r\n\r\n',
    );
  });

  it.each([
    ['CR/LF in a value', { Channel: 'SIP/101\r\nAction: Originate' }],
    ['LF only', { Exten: '101\nAction: Command' }],
    ['NUL', { Val: 'a\0b' }],
    ['bad key', { 'Bad Key': 'x' }],
    ['ActionID override', { actionid: 'x' }],
  ])('rejects header injection: %s', (_name, fields) => {
    expect(() => serializeAction('Redirect', '1', fields)).toThrow(AmiHeaderInjectionError);
  });

  it('rejects an unsafe action name', () => {
    expect(() => serializeAction('Ping\r\nAction: Command', '1')).toThrow(AmiHeaderInjectionError);
  });
});

describe('AmiParser', () => {
  it('skips the banner, lowercases keys and handles split chunks', () => {
    const p = new AmiParser();
    expect(p.push('Asterisk Call Manager/2.10.6\r\nResponse: Succ')).toEqual([]);
    expect(p.banner).toBe('Asterisk Call Manager/2.10.6');
    const out = p.push('ess\r\nActionID: 1\r\nMessage: Authentication accepted\r\n\r\nEvent: FullyBooted\r\nStatus: Fully Booted\r\n\r\n');
    expect(out).toEqual([
      { response: 'Success', actionid: '1', message: 'Authentication accepted' },
      { event: 'FullyBooted', status: 'Fully Booted' },
    ]);
  });

  it('keeps colons in values and joins repeated keys', () => {
    const p = new AmiParser();
    const out = p.push('Banner\nEvent: VarSet\nValue: a:b:c\nOutput: line1\nOutput: line2\n\n');
    expect(out).toEqual([{ event: 'VarSet', value: 'a:b:c', output: 'line1\nline2' }]);
  });

  it('refuses unbounded messages', () => {
    const p = new AmiParser(64);
    p.push('Banner\r\n');
    expect(() => p.push(`Event: X\r\nData: ${'x'.repeat(100)}`)).toThrow(/maximum size/);
  });
});

describe('parseAmiDuration', () => {
  it.each([
    ['00:01:05', 65],
    ['1:05', 65],
    ['65', 65],
    ['', 0],
    [undefined, 0],
    ['x', 0],
  ])('%s -> %s', (raw, expected) => expect(parseAmiDuration(raw)).toBe(expected));
});
