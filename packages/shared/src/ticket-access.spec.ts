import { describe, expect, it } from 'vitest';
import { ticketActorKind, ticketCapabilities } from './ticket-access.js';

describe('ticket access', () => {
  it("derives the actor from the role's default permissions (no role names in the rules)", () => {
    expect(ticketActorKind({ role: 'superuser' })).toBe('superuser');
    expect(ticketActorKind({ role: 'admin' })).toBe('none'); // the old name has no permissions any more
    expect(ticketActorKind({ role: 'executive' })).toBe('executive');
    expect(ticketActorKind({ role: 'observer' })).toBe('observer');
    expect(ticketActorKind({ role: 'operator' })).toBe('operator');
    expect(ticketActorKind({ role: 'guest' })).toBe('none');
    expect(ticketActorKind(null)).toBe('none');
  });

  it('gives each actor only its own capabilities', () => {
    expect(ticketCapabilities({ role: 'operator' })).toMatchObject({
      create: true,
      callback: true,
      work: false,
      viewAll: false,
    });
    expect(ticketCapabilities({ role: 'executive' })).toMatchObject({
      create: false,
      callback: false,
      work: true,
      reports: true,
      regionAlerts: true,
    });
    expect(ticketCapabilities({ role: 'observer' })).toMatchObject({
      viewAll: true,
      comment: false,
      work: false,
      create: false,
      callback: false,
      administer: false,
      manageDirectories: false,
      reports: true,
      regionAlerts: false,
    });
    const { regionAlerts, ...superuser } = ticketCapabilities({ role: 'superuser' });
    expect(Object.values(superuser).every(Boolean)).toBe(true);
    // Sees every region: a chime for each new ticket in the country would be noise.
    expect(regionAlerts).toBe(false);
    expect(Object.values(ticketCapabilities({ role: 'nobody' })).some(Boolean)).toBe(false);
  });

  it("follows the session's own permission list (operator groups, future custom roles)", () => {
    // an operator whose group cannot call back
    expect(ticketCapabilities({ role: 'operator', permissions: ['tickets.create'] })).toMatchObject({
      create: true,
      callback: false,
      comment: true,
    });
    // a session without ticket permissions has no ticket access, whatever the role
    expect(ticketActorKind({ role: 'superuser', permissions: ['monitor.view'] })).toBe('none');
    // process without viewAll = region-scoped executive with alerts
    expect(ticketActorKind({ role: 'observer', permissions: ['tickets.process'] })).toBe('executive');
    expect(ticketCapabilities({ role: 'observer', permissions: ['tickets.process'] }).regionAlerts).toBe(true);
  });
});
