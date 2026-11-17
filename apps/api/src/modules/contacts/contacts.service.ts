import {
  BUSINESS_TIMEZONE,
  type Contact,
  type ContactAccess,
  type ContactInputParsed,
  type ContactListQuery,
  type ContactListResponse,
  type SessionUser,
  type TopActiveQuery,
  type TopActiveResponse,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { AppConfig } from '../../config/app-config.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ContactsRepository } from './contacts.repository.js';
import {
  type ContactAccessUser,
  type ExtensionRange,
  contactAccessFor,
  parseExtensionRanges,
} from './domain/contact-access.js';
import { topCallers } from './domain/top-callers.js';

@Injectable()
export class ContactsService {
  private readonly deniedRanges: ExtensionRange[];

  constructor(
    private readonly repo: ContactsRepository,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    config: AppConfig,
  ) {
    this.deniedRanges = parseExtensionRanges(config.get('CONTACTS_DENIED_EXTENSION_RANGES'));
  }

  access(user: SessionUser): ContactAccess {
    return contactAccessFor(user as ContactAccessUser, this.deniedRanges);
  }

  private assertView(user: SessionUser): void {
    if (!this.access(user).canView) throw new ForbiddenException('Your operator group may not see client contacts');
  }

  private assertEdit(user: SessionUser): void {
    if (!this.access(user).canEdit) throw new ForbiddenException('Your operator group may not edit client contacts');
  }

  async list(q: ContactListQuery, user: SessionUser): Promise<ContactListResponse> {
    this.assertView(user);
    const { items, total } = await this.repo.list(q);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(phone: string, user: SessionUser): Promise<Contact> {
    this.assertView(user);
    const c = await this.repo.get(phone);
    if (!c) throw new NotFoundException('Contact not found');
    return c;
  }

  async create(input: ContactInputParsed, user: SessionUser): Promise<Contact> {
    this.assertEdit(user);
    const contact = await this.createTx(input, user);
    this.changed();
    return contact;
  }

  @Transactional()
  private async createTx(input: ContactInputParsed, user: SessionUser): Promise<Contact> {
    const before = await this.repo.get(input.phone);
    const contact = await this.repo.upsert(input, user.id);
    await this.audit.record(before ? 'contacts.update' : 'contacts.create', {
      target: `contact:${input.phone}`,
      details: before ? { before, after: contact } : { after: contact },
    });
    return contact;
  }

  /** Updates a contact; a different `phone` in the body moves it to that number. */
  async update(phone: string, input: ContactInputParsed, user: SessionUser): Promise<Contact> {
    this.assertEdit(user);
    const contact = await this.updateTx(phone, input, user);
    this.changed();
    return contact;
  }

  @Transactional()
  private async updateTx(phone: string, input: ContactInputParsed, user: SessionUser): Promise<Contact> {
    const before = await this.repo.get(phone);
    if (!before) throw new NotFoundException('Contact not found');
    if (input.phone !== phone) {
      if (await this.repo.get(input.phone)) throw new ConflictException('A contact with this phone already exists');
      await this.repo.delete(phone);
    }
    const contact = await this.repo.upsert(input, user.id);
    await this.audit.record('contacts.update', { target: `contact:${phone}`, details: { before, after: contact } });
    return contact;
  }

  async delete(phone: string, user: SessionUser): Promise<void> {
    this.assertEdit(user);
    await this.deleteTx(phone);
    this.changed();
  }

  @Transactional()
  private async deleteTx(phone: string): Promise<void> {
    const before = await this.repo.get(phone);
    if (!before || !(await this.repo.delete(phone))) throw new NotFoundException('Contact not found');
    await this.audit.record('contacts.delete', { target: `contact:${phone}`, details: { before } });
  }

  async topActive(q: TopActiveQuery, user: SessionUser): Promise<TopActiveResponse> {
    this.assertView(user);
    if (!this.repo.pbxAvailable) throw new ServiceUnavailableException('PBX unavailable');
    const today = DateTime.now().setZone(BUSINESS_TIMEZONE).startOf('day');
    let from: DateTime;
    let to: DateTime;
    if (q.date === 'today') [from, to] = [today, today.plus({ days: 1 })];
    else if (q.date === 'week') [from, to] = [today.minus({ days: 6 }), today.plus({ days: 1 })];
    else if (q.date === 'month') [from, to] = [today.minus({ days: 29 }), today.plus({ days: 1 })];
    else {
      from = DateTime.fromISO(q.date, { zone: BUSINESS_TIMEZONE }).startOf('day');
      to = from.plus({ days: 1 });
    }
    const fmt = 'yyyy-LL-dd HH:mm:ss';
    const rows = await this.repo.callerAggregates(from.toFormat(fmt), to.toFormat(fmt));
    const top = topCallers(rows, q.limit);
    const contacts = await this.repo.getMany(top.map((t) => t.phone));
    return {
      items: top.map((t) => ({
        phone: t.phone,
        totalCalls: t.totalCalls,
        answeredCalls: t.answeredCalls,
        totalTalkSeconds: t.totalTalkSeconds,
        lastCallAt:
          DateTime.fromSQL(t.lastCall, { zone: BUSINESS_TIMEZONE }).toUTC().toISO() ?? new Date().toISOString(),
        contact: contacts.get(t.phone) ?? null,
      })),
    };
  }

  /** No payload: clients refetch over REST, where the group restriction is enforced. */
  private changed(): void {
    this.realtime.broadcast('contacts.changed', { at: new Date().toISOString() });
  }
}
