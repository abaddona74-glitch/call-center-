import { describe, expect, it } from 'vitest';
import { canControlCall, resolveDialTarget, resolveExtension, validateTransferTarget } from './action-rules.js';

const OP = /^[0-9]{2,4}$/;
const ALLOWED = [/^(33|50|55|77|88|90|91|93|94|95|97|98|99|20|61|62|65|66|67|69|70|71|72|73|74|75|76|78|79)[0-9]{7}$/];
const admin = { role: 'admin' as const, extension: null };
const operator = { role: 'operator' as const, extension: '101' };

describe('resolveExtension', () => {
  it('admins act on any operator extension', () => {
    expect(resolveExtension(admin, '103', OP)).toEqual({ ok: true, value: '103' });
    expect(resolveExtension(admin, undefined, OP)).toMatchObject({ ok: false, status: 400 });
    expect(resolveExtension(admin, '712020159', OP)).toMatchObject({ ok: false, status: 400 });
  });

  it('operators only on their own extension (identity from the session, not the body)', () => {
    expect(resolveExtension(operator, undefined, OP)).toEqual({ ok: true, value: '101' });
    expect(resolveExtension(operator, '101', OP)).toEqual({ ok: true, value: '101' });
    expect(resolveExtension(operator, '103', OP)).toMatchObject({ ok: false, status: 403 });
    expect(resolveExtension({ role: 'operator', extension: null }, undefined, OP)).toMatchObject({ ok: false, status: 403 });
  });
});

describe('canControlCall', () => {
  it('operators control only their own calls', () => {
    expect(canControlCall(operator, { extension: '101' })).toBe(true);
    expect(canControlCall(operator, { extension: '103' })).toBe(false);
    expect(canControlCall(operator, { extension: null })).toBe(false);
    expect(canControlCall(admin, { extension: '103' })).toBe(true);
    expect(canControlCall({ role: 'superuser', extension: null }, { extension: null })).toBe(true);
  });
});

describe('resolveDialTarget', () => {
  it.each([
    ['901234567', '901234567'],
    ['+998 (90) 123-45-67', '901234567'],
    ['998901234567', '901234567'],
    ['8 90 123 45 67', '901234567'],
    ['71 200 00 00', '712000000'],
  ])('allows national number %s', (raw, dial) => {
    expect(resolveDialTarget(raw, ALLOWED, OP)).toEqual({ ok: true, value: { dial, phone: dial } });
  });

  it('allows internal extensions', () => {
    expect(resolveDialTarget('103', ALLOWED, OP)).toEqual({ ok: true, value: { dial: '103', phone: null } });
  });

  it.each([
    ['+7 495 123 45 67', 'International'],
    ['0074951234567', 'International'],
    ['8104951234567', 'International'],
    ['12345', '9-digit'],
    ['1234567', '9-digit'],
    ['901234', '9-digit'],
    ['001234567', 'not allowed'],
    ['801234567', 'not allowed'],
  ])('rejects %s', (raw, msg) => {
    const d = resolveDialTarget(raw, ALLOWED, OP);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toContain(msg);
  });
});

describe('validateTransferTarget', () => {
  it('only to another operator extension', () => {
    expect(validateTransferTarget('103', '101', OP)).toEqual({ ok: true, value: '103' });
    expect(validateTransferTarget('101', '101', OP)).toMatchObject({ ok: false });
    expect(validateTransferTarget('901234567', '101', OP)).toMatchObject({ ok: false });
  });
});
