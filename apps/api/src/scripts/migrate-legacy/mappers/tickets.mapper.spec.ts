import { describe, expect, it } from 'vitest';
import { legacyFileName, transformLegacyTicket } from './tickets.mapper.js';

const NOW = new Date('2026-11-17T10:00:00Z');

function legacy(over: Record<string, unknown> = {}) {
  return {
    id: 'TK-1042',
    creatorId: '201',
    creatorName: 'Operator 201',
    creatorIp: '10.0.0.5',
    customerPhone: '+998 90 123 45 67',
    title: 'Mijoz qayta...',
    comment: 'Mijoz qayta qo‘ng‘iroq so‘radi',
    files: [],
    isUrgent: true,
    targetOperatorId: '101',
    targetOperatorName: 'Oybek',
    status: 'pending',
    acceptedBy: null,
    completedBy: null,
    rejectedBy: null,
    createdAt: 1763370000000,
    updatedAt: 1763370060000,
    comments: [],
    ...over,
  };
}

describe('transformLegacyTicket', () => {
  it('maps a pending ticket into the new model (no region, phone normalized, urgency kept as a prefix)', () => {
    const r = transformLegacyTicket(legacy(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toMatchObject({
      id: 1042,
      status: 'new',
      description: '[Shoshilinch] Mijoz qayta qo‘ng‘iroq so‘radi',
      customerPhone: '901234567',
      creator: { extension: '201', label: 'Operator 201' },
      assignee: null,
      resolution: null,
      closedAt: null,
    });
    expect(r.values.createdAt.toISOString()).toBe('2025-11-17T09:00:00.000Z');
    // the addressed operator has no place in the new workflow
    expect(r.warnings).toEqual([expect.stringContaining('addressed to operator 101')]);
  });

  it.each([
    ['pending', 'new', null],
    ['in_progress', 'in_progress', null],
    ['completed', 'closed', 'done'],
    ['rejected', 'closed', 'rejected'],
  ])('maps status %s → %s (resolution %s)', (from, to, resolution) => {
    const r = transformLegacyTicket(legacy({ status: from }), NOW);
    expect(r.ok && r.values.status).toBe(to);
    expect(r.ok && r.values.resolution).toBe(resolution);
  });

  it('keeps who took and who rejected it, with times and the reason', () => {
    const r = transformLegacyTicket(
      legacy({
        status: 'rejected',
        acceptedBy: { id: '101', name: 'Oybek', at: 1763370100000 },
        rejectedBy: { id: '101', name: 'Oybek', at: 1763370200000, reason: 'Raqam noto‘g‘ri' },
      }),
      NOW,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.values.assignee).toEqual({ extension: '101', label: 'Oybek' });
    expect(r.values.assignedAt?.getTime()).toBe(1763370100000);
    expect(r.values.resolvedBy).toEqual({ extension: '101', label: 'Oybek' });
    expect(r.values.resolvedAt?.getTime()).toBe(1763370200000);
    expect(r.values.closedAt?.getTime()).toBe(1763370200000);
    expect(r.values.resolutionNote).toBe('Raqam noto‘g‘ri');
  });

  it('admin creators keep their label; unusable phones are dropped with a warning', () => {
    const r = transformLegacyTicket(
      legacy({ targetOperatorId: 'all', creatorId: 'admin', creatorName: null, customerPhone: '12' }),
      NOW,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.values.creator).toEqual({ extension: null, label: 'admin' });
    expect(r.values.customerPhone).toBeNull();
    expect(r.warnings).toEqual([expect.stringContaining('phone')]);
  });

  it('turns legacy system reject comments into system comments holding only the reason', () => {
    const r = transformLegacyTicket(
      legacy({
        comments: [
          {
            id: 'cm_1_sys',
            operatorId: '101',
            operatorName: 'Oybek',
            text: '🚫 Ticket rad etildi. Sabab: Dublikat',
            isSystem: true,
            files: [],
            createdAt: 1763370300000,
          },
          {
            id: 'cm_2',
            operatorId: 101,
            operatorName: 'Oybek',
            text: 'Qabul qildim',
            files: [],
            createdAt: 1763370400000,
          },
        ],
      }),
      NOW,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.values.comments).toEqual([
      expect.objectContaining({ isSystem: true, body: 'Dublikat', author: { extension: '101', label: 'Oybek' } }),
      expect.objectContaining({ isSystem: false, body: 'Qabul qildim' }),
    ]);
  });

  it('skips unreadable tickets with a reason', () => {
    expect(transformLegacyTicket(legacy({ id: 'X-1' }), NOW)).toMatchObject({ ok: false });
    expect(transformLegacyTicket(legacy({ status: 'archived' }), NOW)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('status'),
    });
    expect(transformLegacyTicket({ foo: 1 }, NOW)).toMatchObject({ ok: false, key: '?' });
  });

  it('warns about missing times', () => {
    const r = transformLegacyTicket(legacy({ createdAt: null, targetOperatorId: 'all' }), NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(r.values.createdAt).toEqual(NOW);
    expect(r.warnings).toEqual(['createdAt missing or invalid; set to now']);
  });
});

describe('legacyFileName', () => {
  it('accepts stored names and refuses paths', () => {
    expect(legacyFileName({ fileName: 'tk_1763370000000_ab12c_shot.png' })).toBe('tk_1763370000000_ab12c_shot.png');
    expect(legacyFileName({ url: '/uploads/tickets/tk_1_a_x.pdf' })).toBe('tk_1_a_x.pdf');
    expect(legacyFileName({ fileName: '../../etc/passwd' })).toBeNull();
    expect(legacyFileName({ fileName: '' })).toBeNull();
  });
});
