import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  ExtensionSchema,
  OPERATOR_PHOTO_MAX_BYTES,
  type OperatorPhotosInfo,
  OperatorPhotosSchema,
  type SessionUser,
} from '@cc/shared';
import {
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Res,
  SerializeOptions,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { type IncomingPhoto, OperatorPhotosService } from './operator-photos.service.js';

/**
 * Operator photos: managed in Settings → "Operator rasmlari" (`settings.manage`), shown in the operator cards.
 * The image itself is readable by anyone signed in: the cards show it on the dashboard, the operators page and
 * the situation board (different permissions), and a staff portrait is not sensitive inside the app.
 */
@Controller('operator-photos')
export class OperatorPhotosController {
  constructor(private readonly photos: OperatorPhotosService) {}

  @Get()
  @RequirePermission('settings.manage')
  @SerializeOptions({ schema: OperatorPhotosSchema })
  list(): Promise<OperatorPhotosInfo> {
    return this.photos.info();
  }

  /** Sets or replaces the photo (multipart, field `file`; JPG/PNG/WEBP checked by content). */
  @Put(':extension')
  @RequirePermission('settings.manage')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      // One byte over the limit is enough to answer 413 without buffering a huge upload.
      limits: { fileSize: OPERATOR_PHOTO_MAX_BYTES + 1, files: 1, fields: 0, parts: 1 },
    }),
  )
  @SerializeOptions({ schema: OperatorPhotosSchema })
  upload(
    @Param('extension', { schema: ExtensionSchema }) extension: string,
    @UploadedFile() file: IncomingPhoto | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<OperatorPhotosInfo> {
    return this.photos.upload(extension, file, user);
  }

  @Delete(':extension')
  @RequirePermission('settings.manage')
  @SerializeOptions({ schema: OperatorPhotosSchema })
  remove(
    @Param('extension', { schema: ExtensionSchema }) extension: string,
    @CurrentUser() user: SessionUser,
  ): Promise<OperatorPhotosInfo> {
    return this.photos.remove(extension, user);
  }

  /**
   * The image (inline, its detected type, nosniff + sandbox CSP). URLs carry the upload time (`?v=`), so a
   * replaced photo gets a new URL and the old one can be cached for long.
   */
  @Get(':extension/image')
  async image(
    @Param('extension', { schema: ExtensionSchema }) extension: string,
    @Res() res: Response,
  ): Promise<void> {
    const { path, row } = await this.photos.image(extension);
    res.status(200);
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', String(row.sizeBytes));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    await pipeline(createReadStream(path), res).catch(() => undefined);
  }
}
