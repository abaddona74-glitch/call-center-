import {
  type SessionUser,
  TICKET_ORGANIZATION_SEARCH_LIMIT,
  type TicketOrganization,
  type TicketOrganizationImportResult,
  type TicketOrganizationSearchResult,
  type TicketOrganizationSummary,
  ticketActorKind,
  ticketCapabilities,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import {
  ORGANIZATION_COLUMNS,
  type OrganizationRecord,
  regionMatcher,
  searchTokens,
  toOrganizationRecord,
} from './domain/organization-import.js';
import { xlsxRecords } from './organization-xlsx.js';
import { TicketDirectoriesRepository } from './ticket-directories.repository.js';
import { TicketOrganizationsRepository } from './ticket-organizations.repository.js';
import type { TicketOrganizationRow } from './tickets.tables.js';
import type { IncomingFile } from './tickets.service.js';

export const toOrganization = (r: TicketOrganizationRow): TicketOrganization => ({
  id: r.id,
  name: r.name,
  tin: r.tin,
  regionId: r.regionId,
  district: r.district,
});

/** .xlsx is a zip: it starts with "PK\x03\x04". */
const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * The organization registry: searched by everyone with ticket access (the ticket form), imported by the
 * superuser from the registry's .xlsx export. An import upserts by registry id and deactivates what the
 * new file no longer has, in one transaction; it is audited with its counts.
 */
@Injectable()
export class TicketOrganizationsService {
  private readonly logger = new Logger(TicketOrganizationsService.name);

  constructor(
    private readonly repo: TicketOrganizationsRepository,
    private readonly dirs: TicketDirectoriesRepository,
    private readonly audit: AuditService,
  ) {}

  async search(user: SessionUser, q: string, regionId: number | null): Promise<TicketOrganizationSearchResult> {
    if (ticketActorKind(user) === 'none') throw new ForbiddenException('No access to tickets');
    const tokens = searchTokens(q);
    if (tokens.length === 0) return { items: [] };
    const rows = await this.repo.search(tokens, regionId, TICKET_ORGANIZATION_SEARCH_LIMIT);
    return { items: rows.map(toOrganization) };
  }

  async summary(user: SessionUser): Promise<TicketOrganizationSummary> {
    this.assertManager(user);
    const s = await this.repo.summary();
    return { active: s.active, total: s.total, importedAt: s.importedAt?.toISOString() ?? null };
  }

  async import(user: SessionUser, file: IncomingFile | undefined): Promise<TicketOrganizationImportResult> {
    this.assertManager(user);
    if (!file?.buffer.length) throw new BadRequestException('Attach the registry .xlsx file');
    if (!isZip(file.buffer)) throw new BadRequestException('Not an .xlsx file');

    let table: Array<Record<string, string>>;
    try {
      table = xlsxRecords(file.buffer);
    } catch (err) {
      this.logger.warn(`Organization import: unreadable file (${(err as Error).message})`);
      throw new BadRequestException('The .xlsx file could not be read');
    }
    const c = ORGANIZATION_COLUMNS;
    const head = table[0];
    if (head && (!(c.id in head) || !(c.nameLatin in head || c.nameCyr in head || c.nameRu in head))) {
      throw new BadRequestException(
        `Not the organization registry: the first row must name the columns "${c.id}" and "${c.nameLatin}" / "${c.nameCyr}" / "${c.nameRu}"`,
      );
    }

    const regionOf = regionMatcher(await this.dirs.regions());
    const records: OrganizationRecord[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const row of table) {
      const rec = toOrganizationRecord(row, regionOf);
      // A repeated registry id would hit the same row twice in one INSERT … ON CONFLICT.
      if (!rec || seen.has(rec.externalId)) {
        skipped++;
        continue;
      }
      seen.add(rec.externalId);
      records.push(rec);
    }
    if (records.length === 0) throw new BadRequestException('The file has no organizations');
    const rows = table.length;

    const { added, updated, deactivated } = await this.persist(records);
    const result: TicketOrganizationImportResult = {
      rows,
      added,
      updated,
      deactivated,
      skipped,
      withoutRegion: records.filter((r) => r.regionId === null).length,
    };
    await this.audit.record('tickets.organizations.import', {
      target: 'ticket-organizations',
      details: { fileName: file.originalname, ...result },
    });
    return result;
  }

  @Transactional()
  private async persist(records: OrganizationRecord[]) {
    const importedAt = new Date();
    const { added, updated } = await this.repo.upsert(records, importedAt);
    const deactivated = await this.repo.deactivateMissing(importedAt);
    return { added, updated, deactivated };
  }

  private assertManager(user: SessionUser): void {
    if (!ticketCapabilities(user).manageDirectories)
      throw new ForbiddenException('Only the superuser manages the organization registry');
  }
}
