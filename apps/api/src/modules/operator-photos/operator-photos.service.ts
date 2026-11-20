import {
  OPERATOR_PHOTO_MAX_BYTES,
  OPERATOR_PHOTO_MAX_MB,
  type OperatorPhotoEntry,
  type OperatorPhotosInfo,
  type SessionUser,
  compareExtensions,
  operatorPhotoUrl,
} from '@cc/shared';
import { Transactional } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type OperatorPhotosChangedEvent, SettingsEvents } from '../../common/events/domain-events.js';
import { AuditService } from '../audit/audit.service.js';
import { detectPhotoType } from './domain/photo-type.js';
import { type OperatorPhotoRow, OperatorPhotosRepository } from './operator-photos.repository.js';
import { OperatorPhotosStore } from './operator-photos.store.js';

/** A multipart file as multer (memory storage) hands it over. */
export interface IncomingPhoto {
  size: number;
  buffer: Buffer;
}

/**
 * Operator photos (owner, 20.11.2026). The extension → URL map is kept in memory for the live board, which
 * builds operator lists synchronously and often; it is loaded at startup and after every change, and
 * `SettingsEvents.OperatorPhotosChanged` makes the board re-publish so open dashboards show the new photo.
 */
@Injectable()
export class OperatorPhotosService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OperatorPhotosService.name);
  private urlByExt: ReadonlyMap<string, string> = new Map();

  constructor(
    private readonly repo: OperatorPhotosRepository,
    private readonly store: OperatorPhotosStore,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reload();
    // Live views may have been published before the photos were loaded.
    this.emitChanged();
  }

  /** extension → versioned image URL, for every operator with a photo. */
  urls(): ReadonlyMap<string, string> {
    return this.urlByExt;
  }

  /** The settings screen: the PBX directory with each operator's photo. */
  async info(): Promise<OperatorPhotosInfo> {
    const rows = await this.repo.list();
    let directory: Array<{ extension: string; name: string | null }> | null = null;
    try {
      directory = await this.repo.pbxDirectory();
    } catch (err) {
      this.logger.warn(`PBX directory unavailable: ${(err as Error).message}`);
    }
    const byExt = new Map<string, OperatorPhotoEntry>();
    for (const d of directory ?? []) {
      if (d.extension) byExt.set(d.extension, { extension: d.extension, name: d.name, photoUrl: null, updatedAt: null });
    }
    for (const r of rows) {
      byExt.set(r.extension, {
        extension: r.extension,
        name: byExt.get(r.extension)?.name ?? null,
        photoUrl: operatorPhotoUrl(r.extension, r.updatedAt),
        updatedAt: r.updatedAt.toISOString(),
      });
    }
    return {
      operators: [...byExt.values()].sort((a, b) => compareExtensions(a.extension, b.extension)),
      directoryAvailable: directory !== null,
    };
  }

  /** Sets (or replaces) the extension's photo. */
  async upload(extension: string, file: IncomingPhoto | undefined, user: SessionUser): Promise<OperatorPhotosInfo> {
    if (!file?.buffer?.length) throw new BadRequestException('Rasm fayli tanlanmagan');
    if (file.buffer.length > OPERATOR_PHOTO_MAX_BYTES) {
      throw new PayloadTooLargeException(`Rasm ${OPERATOR_PHOTO_MAX_MB} MB dan katta bo‘lmasin`);
    }
    const mimeType = detectPhotoType(file.buffer);
    if (!mimeType) throw new UnsupportedMediaTypeException('Faqat JPG, PNG yoki WEBP rasm');

    const storageKey = await this.store.save(file.buffer);
    let previous: OperatorPhotoRow | undefined;
    try {
      previous = await this.saveRow(extension, { storageKey, mimeType, sizeBytes: file.buffer.length }, user);
    } catch (err) {
      await this.store.remove(storageKey);
      throw err;
    }
    // The old file goes only after the new row is committed: a failed save keeps the old photo.
    if (previous) await this.store.remove(previous.storageKey);
    await this.changed(`photo of ${extension} set by ${user.username}`);
    return this.info();
  }

  async remove(extension: string, user: SessionUser): Promise<OperatorPhotosInfo> {
    const removed = await this.deleteRow(extension, user);
    if (!removed) throw new NotFoundException('Bu operatorning rasmi yo‘q');
    await this.store.remove(removed.storageKey);
    await this.changed(`photo of ${extension} removed by ${user.username}`);
    return this.info();
  }

  /** The file to serve for an extension; 404 when it has no photo. */
  async image(extension: string): Promise<{ path: string; row: OperatorPhotoRow }> {
    const row = await this.repo.find(extension);
    if (!row) throw new NotFoundException();
    return { path: this.store.pathOf(row.storageKey), row };
  }

  @Transactional()
  private async saveRow(
    extension: string,
    file: { storageKey: string; mimeType: string; sizeBytes: number },
    user: SessionUser,
  ): Promise<OperatorPhotoRow | undefined> {
    const previous = await this.repo.find(extension);
    await this.repo.upsert({ extension, ...file }, user.id);
    await this.audit.record('operatorPhotos.set', {
      target: `operator:${extension}`,
      details: { extension, mimeType: file.mimeType, sizeBytes: file.sizeBytes, replaced: Boolean(previous) },
    });
    return previous;
  }

  @Transactional()
  private async deleteRow(extension: string, user: SessionUser): Promise<OperatorPhotoRow | undefined> {
    const row = await this.repo.find(extension);
    if (!row) return undefined;
    await this.repo.delete(extension);
    await this.audit.record('operatorPhotos.remove', {
      target: `operator:${extension}`,
      details: { extension, by: user.username },
    });
    return row;
  }

  private async changed(what: string): Promise<void> {
    await this.reload();
    this.logger.log(what);
    this.emitChanged();
  }

  private async reload(): Promise<void> {
    const rows = await this.repo.list();
    this.urlByExt = new Map(rows.map((r) => [r.extension, operatorPhotoUrl(r.extension, r.updatedAt)]));
  }

  private emitChanged(): void {
    this.events.emit(SettingsEvents.OperatorPhotosChanged, {
      extensions: [...this.urlByExt.keys()],
    } satisfies OperatorPhotosChangedEvent);
  }
}
