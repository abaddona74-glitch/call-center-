import { createReadStream } from 'node:fs';
import path from 'node:path';
import {
  type ConvertRequest,
  ConvertRequestSchema,
  type ManagersDirectory,
  ManagersDirectorySchema,
  TOOLS_CONVERT_MAX_BYTES,
  type ToolFileName,
  ToolFileNameSchema,
  type ToolsConfig,
  ToolsConfigSchema,
  type UzcryptoDownloadQuery,
  UzcryptoDownloadQuerySchema,
  type UzcryptoInfo,
  UzcryptoInfoSchema,
} from '@cc/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  SerializeOptions,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { contentDisposition } from '../../common/http/content-disposition.js';
import { AppConfig } from '../../config/app-config.js';
import { ConverterService, type IncomingFile } from './converter.service.js';
import { MANAGERS_DIRECTORY } from './data/managers.js';
import { UzcryptoService } from './uzcrypto.service.js';

/** Files offered for download, shipped with the API (nest-cli copies them into dist). */
const FILES_DIR = path.join(import.meta.dirname, 'files');
const FILE_TYPES: Record<ToolFileName, string> = {
  // octet-stream: the browser saves the script instead of showing or running it
  'clean-anydesk.bat': 'application/octet-stream',
  'uzb2026-klaviatura.zip': 'application/zip',
};

/**
 * Tools section (legacy viewer tools zones + /api/converter + /api/tools/uzcrypto/*).
 * Everything needs `tools.view`; the converter needs `tools.use` (off for restricted operator groups).
 */
@Controller('tools')
@RequirePermission('tools.view')
export class ToolsController {
  constructor(
    private readonly config: AppConfig,
    private readonly uzcrypto: UzcryptoService,
    private readonly converter: ConverterService,
  ) {}

  @Get('config')
  @SerializeOptions({ schema: ToolsConfigSchema })
  toolsConfig(): ToolsConfig {
    return { telegramFormUrl: this.config.get('TOOLS_TELEGRAM_FORM_URL') ?? null };
  }

  @Get('uzcrypto')
  @SerializeOptions({ schema: UzcryptoInfoSchema })
  uzcryptoLatest(): Promise<UzcryptoInfo> {
    return this.uzcrypto.latest();
  }

  /** 302 to the vendor installer (legacy GET /api/tools/uzcrypto/download). */
  @Get('uzcrypto/download')
  @Header('Cache-Control', 'no-store')
  async uzcryptoDownload(
    @Query({ schema: UzcryptoDownloadQuerySchema }) q: UzcryptoDownloadQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    res.redirect(302, await this.uzcrypto.downloadUrl(q.os));
  }

  @Get('managers')
  @Header('Cache-Control', 'private, no-store')
  @SerializeOptions({ schema: ManagersDirectorySchema })
  managers(): ManagersDirectory {
    return MANAGERS_DIRECTORY;
  }

  @Get('files/:name')
  @Header('Cache-Control', 'private, max-age=300')
  file(
    @Param('name', { schema: ToolFileNameSchema }) name: ToolFileName,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    res.setHeader('Content-Disposition', contentDisposition('attachment', name));
    return new StreamableFile(createReadStream(path.join(FILES_DIR, name)), { type: FILE_TYPES[name] });
  }

  /**
   * Universal converter, documents (legacy POST /api/converter/convert, which took base64 JSON):
   * multipart `file` + `target`; answers with the converted file. Images are converted in the browser.
   */
  @Post('convert')
  @HttpCode(200)
  @RequirePermission('tools.use')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: TOOLS_CONVERT_MAX_BYTES, files: 1, fields: 1, parts: 2, fieldSize: 64 },
      // Browsers send UTF-8 file names (Cyrillic, Uzbek); multer's default would read them as latin1.
      defParamCharset: 'utf8',
    }),
  )
  async convert(
    @UploadedFile() file: IncomingFile | undefined,
    @Body({ schema: ConvertRequestSchema }) body: ConvertRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const out = await this.converter.convert(file, body.target);
    res.setHeader('Content-Disposition', contentDisposition('attachment', out.fileName));
    return new StreamableFile(out.buffer, { type: out.mimeType, length: out.buffer.length });
  }
}
