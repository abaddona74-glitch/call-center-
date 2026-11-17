import {
  type CategoryInput,
  type CategoryPatch,
  type CityInput,
  type CityPatch,
  type RegionInput,
  type RegionPatch,
  type SessionUser,
  type TicketCategory,
  type TicketCity,
  type TicketDirectories,
  type TicketExecutive,
  type TicketRegion,
  ticketActorKind,
  ticketCapabilities,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { TicketDirectoriesRepository } from './ticket-directories.repository.js';
import { TicketsRepository } from './tickets.repository.js';
import type { TicketCategoryRow, TicketCityRow, TicketRegionRow } from './tickets.tables.js';

const toRegion = (r: TicketRegionRow): TicketRegion => ({
  id: r.id,
  code: r.code,
  nameUz: r.nameUz,
  nameRu: r.nameRu,
  sortOrder: r.sortOrder,
  isActive: r.isActive,
});
const toCity = (c: TicketCityRow): TicketCity => ({
  id: c.id,
  regionId: c.regionId,
  nameUz: c.nameUz,
  nameRu: c.nameRu,
  isActive: c.isActive,
});
const toCategory = (c: TicketCategoryRow): TicketCategory => ({
  id: c.id,
  nameUz: c.nameUz,
  nameRu: c.nameRu,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
});

/** Postgres unique violation → 409 with a readable message. */
async function unique<T>(run: () => Promise<T>, message: string): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ConflictException(message);
    throw err;
  }
}

/** Role names that work as regional executives (current `admin`, S1's `executive`). */
const EXECUTIVE_ROLES = ['admin', 'executive'];

/**
 * Ticket directories. Everyone with ticket access reads them (forms, filters); only the superuser
 * edits them. Every change is audited. Rows used by tickets are deactivated, not deleted.
 */
@Injectable()
export class TicketDirectoriesService {
  constructor(
    private readonly repo: TicketDirectoriesRepository,
    private readonly tickets: TicketsRepository,
    private readonly audit: AuditService,
  ) {}

  private assertManager(user: SessionUser): void {
    if (!ticketCapabilities(user).manageDirectories)
      throw new ForbiddenException('Only the superuser edits ticket directories');
  }

  async all(user: SessionUser): Promise<TicketDirectories> {
    if (ticketActorKind(user) === 'none') throw new ForbiddenException('No access to tickets');
    const [regions, cities, categories] = await Promise.all([
      this.repo.regions(),
      this.repo.cities(),
      this.repo.categories(),
    ]);
    return {
      regions: regions.map((r) => ({ ...toRegion(r), cities: cities.filter((c) => c.regionId === r.id).map(toCity) })),
      categories: categories.map(toCategory),
    };
  }

  // --- regions -----------------------------------------------------------------------------------

  @Transactional()
  async createRegion(user: SessionUser, input: RegionInput): Promise<TicketRegion> {
    this.assertManager(user);
    const row = await unique(
      () =>
        this.repo.insertRegion({
          code: input.code,
          nameUz: input.nameUz,
          nameRu: input.nameRu,
          sortOrder: input.sortOrder ?? 100,
          isActive: input.isActive ?? true,
        }),
      'A region with this code already exists',
    );
    await this.audit.record('tickets.region.create', { target: `ticket-region:${row.id}`, details: input });
    return toRegion(row);
  }

  @Transactional()
  async updateRegion(user: SessionUser, id: number, patch: RegionPatch): Promise<TicketRegion> {
    this.assertManager(user);
    const row = await unique(() => this.repo.updateRegion(id, patch), 'A region with this code already exists');
    if (!row) throw new NotFoundException('Region not found');
    await this.audit.record('tickets.region.update', { target: `ticket-region:${id}`, details: patch });
    return toRegion(row);
  }

  @Transactional()
  async deleteRegion(user: SessionUser, id: number): Promise<void> {
    this.assertManager(user);
    if (!(await this.repo.findRegion(id))) throw new NotFoundException('Region not found');
    if (await this.repo.regionInUse(id))
      throw new ConflictException('The region has tickets or cities; deactivate it instead');
    await this.repo.deleteRegion(id);
    await this.audit.record('tickets.region.delete', { target: `ticket-region:${id}` });
  }

  // --- cities ------------------------------------------------------------------------------------

  @Transactional()
  async createCity(user: SessionUser, regionId: number, input: CityInput): Promise<TicketCity> {
    this.assertManager(user);
    if (!(await this.repo.findRegion(regionId))) throw new NotFoundException('Region not found');
    const row = await unique(
      () =>
        this.repo.insertCity({
          regionId,
          nameUz: input.nameUz,
          nameRu: input.nameRu,
          isActive: input.isActive ?? true,
        }),
      'This region already has a city/district with this name',
    );
    await this.audit.record('tickets.city.create', {
      target: `ticket-city:${row.id}`,
      details: { regionId, ...input },
    });
    return toCity(row);
  }

  @Transactional()
  async updateCity(user: SessionUser, id: number, patch: CityPatch): Promise<TicketCity> {
    this.assertManager(user);
    const row = await unique(
      () => this.repo.updateCity(id, patch),
      'This region already has a city/district with this name',
    );
    if (!row) throw new NotFoundException('City not found');
    await this.audit.record('tickets.city.update', { target: `ticket-city:${id}`, details: patch });
    return toCity(row);
  }

  @Transactional()
  async deleteCity(user: SessionUser, id: number): Promise<void> {
    this.assertManager(user);
    if (!(await this.repo.findCity(id))) throw new NotFoundException('City not found');
    if (await this.repo.cityInUse(id))
      throw new ConflictException('Tickets refer to this city/district; deactivate it instead');
    await this.repo.deleteCity(id);
    await this.audit.record('tickets.city.delete', { target: `ticket-city:${id}` });
  }

  // --- categories --------------------------------------------------------------------------------

  @Transactional()
  async createCategory(user: SessionUser, input: CategoryInput): Promise<TicketCategory> {
    this.assertManager(user);
    const row = await unique(
      () =>
        this.repo.insertCategory({
          nameUz: input.nameUz,
          nameRu: input.nameRu,
          sortOrder: input.sortOrder ?? 100,
          isActive: input.isActive ?? true,
        }),
      'A category with this name already exists',
    );
    await this.audit.record('tickets.category.create', { target: `ticket-category:${row.id}`, details: input });
    return toCategory(row);
  }

  @Transactional()
  async updateCategory(user: SessionUser, id: number, patch: CategoryPatch): Promise<TicketCategory> {
    this.assertManager(user);
    const row = await unique(() => this.repo.updateCategory(id, patch), 'A category with this name already exists');
    if (!row) throw new NotFoundException('Category not found');
    await this.audit.record('tickets.category.update', { target: `ticket-category:${id}`, details: patch });
    return toCategory(row);
  }

  @Transactional()
  async deleteCategory(user: SessionUser, id: number): Promise<void> {
    this.assertManager(user);
    if (!(await this.repo.findCategory(id))) throw new NotFoundException('Category not found');
    if (await this.repo.categoryInUse(id))
      throw new ConflictException('Tickets use this category; deactivate it instead');
    await this.repo.deleteCategory(id);
    await this.audit.record('tickets.category.delete', { target: `ticket-category:${id}` });
  }

  // --- executives ↔ regions ----------------------------------------------------------------------

  async executives(user: SessionUser): Promise<TicketExecutive[]> {
    this.assertManager(user);
    const [users, links, names] = await Promise.all([
      this.repo.usersWithRoles(EXECUTIVE_ROLES),
      this.tickets.allExecutiveRegions(),
      this.tickets.operatorNames(),
    ]);
    return users.map((u) => ({
      userId: u.id,
      username: u.username,
      extension: u.extension,
      name: (u.extension && names.get(u.extension)) || null,
      regionIds: (links.get(u.id) ?? []).sort((a, b) => a - b),
    }));
  }

  @Transactional()
  async setExecutiveRegions(user: SessionUser, userId: number, regionIds: number[]): Promise<TicketExecutive> {
    this.assertManager(user);
    const target = await this.repo.findActiveUser(userId);
    if (!target || ticketActorKind(target) !== 'executive')
      throw new BadRequestException('The user is not an executive');
    const ids = [...new Set(regionIds)].sort((a, b) => a - b);
    const known = new Set((await this.repo.regions()).map((r) => r.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) throw new BadRequestException(`Unknown regions: ${missing.join(', ')}`);
    const before = await this.tickets.regionIdsOf(userId);
    await this.repo.setExecutiveRegions(userId, ids);
    await this.audit.record('tickets.executive.regions', { target: `user:${userId}`, details: { before, after: ids } });
    return (await this.executives(user)).find((e) => e.userId === userId) as TicketExecutive;
  }
}
