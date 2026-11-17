import { describe, expect, it } from 'vitest';
import { contactAccessFor, inRanges, parseExtensionRanges } from './contact-access.js';

const ranges = parseExtensionRanges(['200-999']);

describe('parseExtensionRanges / inRanges', () => {
  it('parses ranges and single extensions', () => {
    expect(parseExtensionRanges(['200-299', '305', '410-400'])).toEqual([
      { from: 200, to: 299 },
      { from: 305, to: 305 },
      { from: 400, to: 410 },
    ]);
  });

  it.each([
    ['199', false],
    ['200', true],
    ['205', true],
    ['999', true],
    ['1000', false],
    [null, false],
    ['abc', false],
  ])('%s in 200-999 → %s', (ext, expected) => {
    expect(inRanges(ext, ranges)).toBe(expected);
  });
});

describe('contactAccessFor', () => {
  it('executives and superusers have full access whatever their extension; observers read only', () => {
    expect(contactAccessFor({ role: 'executive', extension: '205' }, ranges)).toEqual({ canView: true, canEdit: true });
    expect(contactAccessFor({ role: 'superuser', extension: null }, ranges)).toEqual({ canView: true, canEdit: true });
    expect(contactAccessFor({ role: 'observer', extension: null }, ranges)).toEqual({ canView: true, canEdit: false });
  });

  it('legacy rule (user without session permissions): operators of the 200 group are denied', () => {
    expect(contactAccessFor({ role: 'operator', extension: '205' }, ranges)).toEqual({
      canView: false,
      canEdit: false,
    });
    expect(contactAccessFor({ role: 'operator', extension: '101' }, ranges)).toEqual({ canView: true, canEdit: true });
    expect(contactAccessFor({ role: 'operator', extension: null }, ranges)).toEqual({ canView: true, canEdit: true });
  });

  it('session permissions (role + operator group flags) override the extension rule', () => {
    expect(
      contactAccessFor({ role: 'operator', extension: '205', permissions: ['monitor.view', 'contacts.view'] }, ranges),
    ).toEqual({ canView: true, canEdit: false });
    expect(
      contactAccessFor({ role: 'operator', extension: '101', permissions: ['monitor.view', 'contacts.manage'] }, ranges),
    ).toEqual({ canView: false, canEdit: false });
  });
});
