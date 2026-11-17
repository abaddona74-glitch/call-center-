import type { TicketStatus, TicketTransition } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import {
  type TicketFacts,
  type TicketViewer,
  canDeleteTicket,
  canEditTicket,
  canRetargetTicket,
  canTransition,
  canViewTicket,
  isMine,
  nextStatus,
  ticketParty,
} from './ticket-policy.js';

const CREATOR_FROM = 200;
const admin: TicketViewer = { userId: 1, role: 'admin', extension: null };
const creator: TicketViewer = { userId: 2, role: 'operator', extension: '201' };
const otherCreator: TicketViewer = { userId: 3, role: 'operator', extension: '205' };
const receiver: TicketViewer = { userId: 4, role: 'operator', extension: '101' };
const otherReceiver: TicketViewer = { userId: 5, role: 'operator', extension: '103' };
const noExt: TicketViewer = { userId: 6, role: 'operator', extension: null };

const party = (v: TicketViewer) => ticketParty(v, CREATOR_FROM);

function ticket(over: Partial<TicketFacts> = {}): TicketFacts {
  return {
    status: 'open',
    creatorUserId: creator.userId,
    creatorParty: 'creator',
    targetAll: true,
    targetUserId: null,
    assigneeUserId: null,
    ...over,
  };
}

describe('ticketParty', () => {
  it('derives the party from role and extension', () => {
    expect(party(admin)).toBe('admin');
    expect(party({ userId: 9, role: 'superuser', extension: '101' })).toBe('admin');
    expect(party(creator)).toBe('creator');
    expect(party({ userId: 9, role: 'operator', extension: '200' })).toBe('creator');
    expect(party(receiver)).toBe('receiver');
    expect(party(noExt)).toBe('none');
    expect(party({ userId: 9, role: 'operator', extension: 'abc' })).toBe('none');
  });
});

describe('state machine', () => {
  const table: Array<[TicketStatus, TicketTransition, TicketStatus | null]> = [
    ['open', 'accept', 'accepted'],
    ['open', 'reject', 'rejected'],
    ['open', 'complete', null],
    ['accepted', 'complete', 'completed'],
    ['accepted', 'reject', 'rejected'],
    ['accepted', 'accept', null],
    ['rejected', 'accept', 'accepted'],
    ['rejected', 'complete', null],
    ['rejected', 'reject', null],
    ['completed', 'accept', null],
    ['completed', 'reject', null],
    ['completed', 'complete', null],
  ];
  it.each(table)('%s --%s--> %s', (from, transition, to) => {
    expect(nextStatus(from, transition)).toBe(to);
  });
});

describe('visibility', () => {
  it('creators see tickets opened by creators, not by admins', () => {
    expect(canViewTicket(ticket(), otherCreator, party(otherCreator))).toBe(true);
    expect(canViewTicket(ticket({ creatorParty: 'admin', creatorUserId: admin.userId }), creator, party(creator))).toBe(false);
  });

  it('receivers see tickets for everyone, for them, or accepted by them', () => {
    const forOther = ticket({ targetAll: false, targetUserId: otherReceiver.userId });
    expect(canViewTicket(ticket(), receiver, party(receiver))).toBe(true);
    expect(canViewTicket(forOther, receiver, party(receiver))).toBe(false);
    expect(canViewTicket(forOther, otherReceiver, party(otherReceiver))).toBe(true);
    expect(canViewTicket({ ...forOther, assigneeUserId: receiver.userId }, receiver, party(receiver))).toBe(true);
  });

  it('users without an extension see nothing; admins see everything', () => {
    expect(canViewTicket(ticket(), noExt, party(noExt))).toBe(false);
    expect(canViewTicket(ticket({ creatorParty: 'admin' }), admin, party(admin))).toBe(true);
  });
});

describe('transitions by actor', () => {
  it('accept: addressed receivers and admins, not creators or others', () => {
    const t = ticket({ targetAll: false, targetUserId: receiver.userId });
    expect(canTransition(t, receiver, party(receiver), 'accept')).toBe(true);
    expect(canTransition(t, otherReceiver, party(otherReceiver), 'accept')).toBe(false);
    expect(canTransition(t, creator, party(creator), 'accept')).toBe(false);
    expect(canTransition(t, admin, party(admin), 'accept')).toBe(true);
    expect(canTransition(ticket(), otherReceiver, party(otherReceiver), 'accept')).toBe(true);
  });

  it('complete: only the assignee or an admin', () => {
    const t = ticket({ status: 'accepted', assigneeUserId: receiver.userId });
    expect(canTransition(t, receiver, party(receiver), 'complete')).toBe(true);
    expect(canTransition(t, otherReceiver, party(otherReceiver), 'complete')).toBe(false);
    expect(canTransition(t, creator, party(creator), 'complete')).toBe(false);
    expect(canTransition(t, admin, party(admin), 'complete')).toBe(true);
  });

  it('reject: addressed receivers while open, the assignee once accepted', () => {
    expect(canTransition(ticket(), otherReceiver, party(otherReceiver), 'reject')).toBe(true);
    const accepted = ticket({ status: 'accepted', assigneeUserId: receiver.userId });
    expect(canTransition(accepted, receiver, party(receiver), 'reject')).toBe(true);
    expect(canTransition(accepted, otherReceiver, party(otherReceiver), 'reject')).toBe(false);
  });

  it('nothing moves a completed ticket', () => {
    const done = ticket({ status: 'completed', assigneeUserId: receiver.userId });
    for (const tr of ['accept', 'reject', 'complete'] as const) {
      expect(canTransition(done, admin, party(admin), tr)).toBe(false);
      expect(canTransition(done, receiver, party(receiver), tr)).toBe(false);
    }
  });
});

describe('edit and delete', () => {
  it('creator edits until completed and re-targets only while open', () => {
    expect(canEditTicket(ticket({ status: 'accepted' }), creator, party(creator))).toBe(true);
    expect(canEditTicket(ticket({ status: 'completed' }), creator, party(creator))).toBe(false);
    expect(canEditTicket(ticket(), otherCreator, party(otherCreator))).toBe(false);
    expect(canEditTicket(ticket(), receiver, party(receiver))).toBe(false);
    expect(canRetargetTicket(ticket({ status: 'accepted' }), creator, party(creator))).toBe(false);
    expect(canRetargetTicket(ticket(), creator, party(creator))).toBe(true);
  });

  it('creator deletes only while open; admin always', () => {
    expect(canDeleteTicket(ticket(), creator, party(creator))).toBe(true);
    expect(canDeleteTicket(ticket({ status: 'accepted' }), creator, party(creator))).toBe(false);
    expect(canDeleteTicket(ticket(), receiver, party(receiver))).toBe(false);
    expect(canDeleteTicket(ticket({ status: 'completed' }), admin, party(admin))).toBe(true);
  });
});

describe('isMine', () => {
  it('depends on the party', () => {
    expect(isMine(ticket(), creator, party(creator))).toBe(true);
    expect(isMine(ticket(), otherCreator, party(otherCreator))).toBe(false);
    expect(isMine(ticket({ targetAll: false, targetUserId: receiver.userId }), receiver, party(receiver))).toBe(true);
    expect(isMine(ticket(), receiver, party(receiver))).toBe(false);
  });
});
