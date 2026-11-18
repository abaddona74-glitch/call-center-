import { describe, expect, it } from 'vitest';
import { ticketActorKind, ticketCapabilities } from './ticket-access.js';

describe('ticket access', () => {
  it('maps current and S1 role names to ticket actors', () => {
    expect(ticketActorKind({ role: 'superuser' })).toBe('superuser');
    expect(ticketActorKind({ role: 'admin' })).toBe('executive');
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
});
