import { Module } from '@nestjs/common';
import { PbxCallsModule } from '../../pbx/calls/pbx-calls.module.js';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';

@Module({
  imports: [PbxCallsModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
