import { CDR_ACCESS, type ExportExcelQuery, ExportExcelQuerySchema } from '@cc/shared';
import { Controller, Get, Header, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/auth.decorators.js';
import { ExportService } from './export.service.js';

/** RFC 6266/5987: ASCII fallback + UTF-8 name (the file name may contain Cyrillic). */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@Controller('export')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  /** Excel report like legacy GET /api/export/excel ("cal stat" template). */
  @Get('excel')
  @Roles(CDR_ACCESS['reports.export'])
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async excel(
    @Query({ schema: ExportExcelQuerySchema }) q: ExportExcelQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.exports.excel(q);
    res.setHeader('Content-Disposition', contentDisposition(fileName));
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      length: buffer.length,
    });
  }
}
