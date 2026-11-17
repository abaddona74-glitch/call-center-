import { Module } from '@nestjs/common';
import { PbxCallsModule } from '../../pbx/calls/pbx-calls.module.js';
import { CdrController } from './cdr.controller.js';
import { CdrService } from './cdr.service.js';

@Module({
  imports: [PbxCallsModule],
  controllers: [CdrController],
  providers: [CdrService],
})
export class CdrModule {}
