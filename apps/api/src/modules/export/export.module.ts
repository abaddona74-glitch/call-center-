import { Module } from '@nestjs/common';
import { PbxCallsModule } from '../../pbx/calls/pbx-calls.module.js';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';

@Module({
  imports: [PbxCallsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
