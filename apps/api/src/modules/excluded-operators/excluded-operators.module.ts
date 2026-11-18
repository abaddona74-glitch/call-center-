import { Global, Module } from '@nestjs/common';
import { ExcludedOperatorsController } from './excluded-operators.controller.js';
import { ExcludedOperatorsRepository } from './excluded-operators.repository.js';
import { ExcludedOperatorsService } from './excluded-operators.service.js';

/** Extensions hidden from the operators board and per-operator statistics. Global: consumers inject the service. */
@Global()
@Module({
  controllers: [ExcludedOperatorsController],
  providers: [ExcludedOperatorsService, ExcludedOperatorsRepository],
  exports: [ExcludedOperatorsService],
})
export class ExcludedOperatorsModule {}
