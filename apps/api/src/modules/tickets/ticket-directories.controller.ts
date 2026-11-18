import {
  type CategoryInput,
  CategoryInputSchema,
  type CategoryPatch,
  CategoryPatchSchema,
  type CityInput,
  CityInputSchema,
  type CityPatch,
  CityPatchSchema,
  DirectoryIdSchema,
  type RegionInput,
  RegionInputSchema,
  type RegionPatch,
  RegionPatchSchema,
  type SessionUser,
  type SetExecutiveRegions,
  SetExecutiveRegionsSchema,
  type TicketCategory,
  TicketCategorySchema,
  type TicketCity,
  TicketCitySchema,
  type TicketDirectories,
  TicketDirectoriesSchema,
  type TicketExecutive,
  TicketExecutiveSchema,
  TICKET_ORGANIZATION_IMPORT_MAX_MB,
  type TicketOrganizationImportResult,
  TicketOrganizationImportResultSchema,
  type TicketOrganizationSearchResult,
  TicketOrganizationSearchResultSchema,
  TicketOrganizationSearchQuerySchema,
  type TicketOrganizationSummary,
  TicketOrganizationSummarySchema,
  type TicketRegion,
  TicketRegionSchema,
} from '@cc/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import { TicketDirectoriesService } from './ticket-directories.service.js';
import { TicketOrganizationsService } from './ticket-organizations.service.js';
import type { IncomingFile } from './tickets.service.js';

/** Ticket directories: read by every ticket user, edited by the superuser (checked in the service). */
@Controller('tickets/directories')
export class TicketDirectoriesController {
  constructor(
    private readonly dirs: TicketDirectoriesService,
    private readonly orgs: TicketOrganizationsService,
  ) {}

  @Get()
  @SerializeOptions({ schema: TicketDirectoriesSchema })
  all(@CurrentUser() user: SessionUser): Promise<TicketDirectories> {
    return this.dirs.all(user);
  }

  @Post('regions')
  @SerializeOptions({ schema: TicketRegionSchema })
  createRegion(
    @Body({ schema: RegionInputSchema }) body: RegionInput,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketRegion> {
    return this.dirs.createRegion(user, body);
  }

  @Patch('regions/:id')
  @SerializeOptions({ schema: TicketRegionSchema })
  updateRegion(
    @Param('id', { schema: DirectoryIdSchema }) id: number,
    @Body({ schema: RegionPatchSchema }) body: RegionPatch,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketRegion> {
    return this.dirs.updateRegion(user, id, body);
  }

  @Delete('regions/:id')
  @HttpCode(204)
  deleteRegion(
    @Param('id', { schema: DirectoryIdSchema }) id: number,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    return this.dirs.deleteRegion(user, id);
  }

  @Post('regions/:id/cities')
  @SerializeOptions({ schema: TicketCitySchema })
  createCity(
    @Param('id', { schema: DirectoryIdSchema }) regionId: number,
    @Body({ schema: CityInputSchema }) body: CityInput,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketCity> {
    return this.dirs.createCity(user, regionId, body);
  }

  @Patch('cities/:id')
  @SerializeOptions({ schema: TicketCitySchema })
  updateCity(
    @Param('id', { schema: DirectoryIdSchema }) id: number,
    @Body({ schema: CityPatchSchema }) body: CityPatch,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketCity> {
    return this.dirs.updateCity(user, id, body);
  }

  @Delete('cities/:id')
  @HttpCode(204)
  deleteCity(@Param('id', { schema: DirectoryIdSchema }) id: number, @CurrentUser() user: SessionUser): Promise<void> {
    return this.dirs.deleteCity(user, id);
  }

  @Post('categories')
  @SerializeOptions({ schema: TicketCategorySchema })
  createCategory(
    @Body({ schema: CategoryInputSchema }) body: CategoryInput,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketCategory> {
    return this.dirs.createCategory(user, body);
  }

  @Patch('categories/:id')
  @SerializeOptions({ schema: TicketCategorySchema })
  updateCategory(
    @Param('id', { schema: DirectoryIdSchema }) id: number,
    @Body({ schema: CategoryPatchSchema }) body: CategoryPatch,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketCategory> {
    return this.dirs.updateCategory(user, id, body);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  deleteCategory(
    @Param('id', { schema: DirectoryIdSchema }) id: number,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    return this.dirs.deleteCategory(user, id);
  }

  // --- organizations (registry) -----------------------------------------------------------------

  /** Ticket form: organizations by name words or INN; the ticket's region ranks first. */
  @Get('organizations')
  @SerializeOptions({ schema: TicketOrganizationSearchResultSchema })
  searchOrganizations(
    @Query({ schema: TicketOrganizationSearchQuerySchema }) query: { q: string; regionId?: number },
    @CurrentUser() user: SessionUser,
  ): Promise<TicketOrganizationSearchResult> {
    return this.orgs.search(user, query.q, query.regionId ?? null);
  }

  @Get('organizations/summary')
  @SerializeOptions({ schema: TicketOrganizationSummarySchema })
  organizationsSummary(@CurrentUser() user: SessionUser): Promise<TicketOrganizationSummary> {
    return this.orgs.summary(user);
  }

  /** Superuser: the registry export (.xlsx, field `file`) replaces the list. */
  @Post('organizations/import')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: TICKET_ORGANIZATION_IMPORT_MAX_MB * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    }),
  )
  @SerializeOptions({ schema: TicketOrganizationImportResultSchema })
  importOrganizations(
    @UploadedFile() file: IncomingFile | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketOrganizationImportResult> {
    return this.orgs.import(user, file);
  }

  @Get('executives')
  // Arrays are serialized item by item.
  @SerializeOptions({ schema: TicketExecutiveSchema })
  executives(@CurrentUser() user: SessionUser): Promise<TicketExecutive[]> {
    return this.dirs.executives(user);
  }

  @Put('executives/:userId/regions')
  @SerializeOptions({ schema: TicketExecutiveSchema })
  setExecutiveRegions(
    @Param('userId', { schema: DirectoryIdSchema }) userId: number,
    @Body({ schema: SetExecutiveRegionsSchema }) body: SetExecutiveRegions,
    @CurrentUser() user: SessionUser,
  ): Promise<TicketExecutive> {
    return this.dirs.setExecutiveRegions(user, userId, body.regionIds);
  }
}
