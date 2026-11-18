import {
  type ExcludedOperatorsInfo,
  type ExcludedOperatorsInput,
  type SessionUser,
  normalizeExtensions,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type ExcludedOperatorsChangedEvent, SettingsEvents } from '../../common/events/domain-events.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { buildChoices, diffExtensions } from './domain/excluded-operators.js';
import { ExcludedOperatorsRepository } from './excluded-operators.repository.js';

/**
 * The excluded operators list (owner decision 2026-11-18), kept in memory for the synchronous checks of the
 * live board, statistics and export; loaded at startup (after migrations) and on every change. Consumers
 * re-publish / drop caches on `SettingsEvents.ExcludedOperatorsChanged`.
 */
@Injectable()
export class ExcludedOperatorsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExcludedOperatorsService.name);
  private list: string[] = [];
  private set: ReadonlySet<string> = new Set();
  private updatedAt: Date | null = null;

  constructor(
    private readonly repo: ExcludedOperatorsRepository,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly realtime: RealtimeService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reload();
    // Live views may have been published before the list was loaded.
    this.emitChanged();
  }

  /** The excluded extensions (sorted by number). */
  extensions(): ReadonlySet<string> {
    return this.set;
  }

  isExcluded(extension: string | null | undefined): boolean {
    return extension != null && this.set.has(extension);
  }

  /** The list with the PBX directory for the settings screen. */
  async info(): Promise<ExcludedOperatorsInfo> {
    // Someone may have changed the row outside this process (migrate-legacy while the API runs).
    if (await this.reload()) this.emitChanged();
    let directory: Array<{ extension: string; name: string | null }> | null = null;
    try {
      directory = await this.repo.pbxDirectory();
    } catch (err) {
      this.logger.warn(`PBX directory unavailable: ${(err as Error).message}`);
    }
    return {
      extensions: [...this.list],
      operators: buildChoices(directory ?? [], this.list),
      directoryAvailable: directory !== null,
      updatedAt: this.updatedAt?.toISOString() ?? null,
    };
  }

  async update(input: ExcludedOperatorsInput, user: SessionUser): Promise<ExcludedOperatorsInfo> {
    await this.save(normalizeExtensions(input.extensions), user);
    await this.reload();
    this.logger.log(`excluded operators changed by ${user.username}: [${this.list.join(', ')}]`);
    this.emitChanged();
    this.realtime.broadcast('excludedOperators.changed', { at: new Date().toISOString() });
    return this.info();
  }

  @Transactional()
  private async save(extensions: string[], user: SessionUser): Promise<void> {
    const before = (await this.repo.read()).extensions;
    await this.repo.write(extensions, user.id);
    await this.audit.record('excludedOperators.update', {
      target: 'excluded_operators',
      details: { before, after: extensions, ...diffExtensions(before, extensions) },
    });
  }

  /** Reads the row; true when the list differs from the one in memory. */
  private async reload(): Promise<boolean> {
    const row = await this.repo.read();
    const list = normalizeExtensions(row.extensions);
    const changed = list.join(',') !== this.list.join(',');
    this.list = list;
    this.set = new Set(list);
    this.updatedAt = row.updatedAt;
    return changed;
  }

  private emitChanged(): void {
    this.events.emit(SettingsEvents.ExcludedOperatorsChanged, {
      extensions: [...this.list],
    } satisfies ExcludedOperatorsChangedEvent);
  }
}
