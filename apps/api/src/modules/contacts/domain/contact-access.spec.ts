import { describe, expect, it } from 'vitest';
import { contactAccessFor } from './contact-access.js';

describe('contactAccessFor', () => {
  it('role map: superusers have full access; observers read only; executives ("Mas’ul") none', () => {
    expect(contactAccessFor({ role: 'executive' })).toEqual({ canView: false, canEdit: false });
    expect(contactAccessFor({ role: 'superuser' })).toEqual({ canView: true, canEdit: true });
    expect(contactAccessFor({ role: 'observer' })).toEqual({ canView: true, canEdit: false });
    expect(contactAccessFor({ role: 'operator' })).toEqual({ canView: true, canEdit: true });
  });

  it('session permissions (role + operator group flags) decide', () => {
    expect(contactAccessFor({ role: 'operator', permissions: ['monitor.view'] })).toEqual({
      canView: false,
      canEdit: false,
    });
    expect(contactAccessFor({ role: 'operator', permissions: ['monitor.view', 'contacts.view'] })).toEqual({
      canView: true,
      canEdit: false,
    });
    // Editing needs view as well
    expect(contactAccessFor({ role: 'operator', permissions: ['monitor.view', 'contacts.manage'] })).toEqual({
      canView: false,
      canEdit: false,
    });
  });
});
