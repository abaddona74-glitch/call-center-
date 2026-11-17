import { Module } from '@nestjs/common';
import { CdrRepository } from './cdr.repository.js';
import { PbxCallsService } from './pbx-calls.service.js';

/** Calls assembled from the PBX CDR. Imported by the cdr, stats and export modules. */
@Module({
  providers: [CdrRepository, PbxCallsService],
  exports: [PbxCallsService],
})
export class PbxCallsModule {}
