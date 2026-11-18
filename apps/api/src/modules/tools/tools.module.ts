import { Module } from '@nestjs/common';
import { ConverterService } from './converter.service.js';
import { ToolsController } from './tools.controller.js';
import { UzcryptoService, VENDOR_FETCH, fetchVendorText } from './uzcrypto.service.js';

/**
 * Tools section: links config, Uzcrypto version lookup, downloads (AnyDesk cleaner, Uzbek 2026
 * keyboard), the managers directory and the document converter. No database tables.
 */
@Module({
  controllers: [ToolsController],
  providers: [ConverterService, UzcryptoService, { provide: VENDOR_FETCH, useValue: fetchVendorText }],
})
export class ToolsModule {}
