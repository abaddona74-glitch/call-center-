import { Module } from '@nestjs/common';
import { CallbacksController } from './callbacks.controller.js';
import { CallbacksEventsListener } from './callbacks.events.js';
import { CallbacksReconciler, CdrLegsReader } from './callbacks.reconciler.js';
import { CallbacksRepository } from './callbacks.repository.js';
import { CallbacksService } from './callbacks.service.js';

/** Citizens to call back: live call events + CDR reconciliation → callbacks; list and manual actions. */
@Module({
  controllers: [CallbacksController],
  providers: [CallbacksRepository, CallbacksService, CallbacksEventsListener, CdrLegsReader, CallbacksReconciler],
})
export class CallbacksModule {}
