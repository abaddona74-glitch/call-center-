import { TICKET_MAX_FILES_PER_UPLOAD } from '@cc/shared';
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfig } from '../../config/app-config.js';
import { PbxCallsModule } from '../../pbx/calls/pbx-calls.module.js';
import { ActionsModule } from '../actions/actions.module.js';
import { LiveModule } from '../live/live.module.js';
import { RecordingsModule } from '../recordings/recordings.module.js';
import { TicketCallLookup } from './ticket-call-lookup.service.js';
import { TicketCallbacksService } from './ticket-callbacks.service.js';
import { TicketDirectoriesController } from './ticket-directories.controller.js';
import { TicketDirectoriesRepository } from './ticket-directories.repository.js';
import { TicketDirectoriesService } from './ticket-directories.service.js';
import { TicketFilesStore } from './ticket-files.store.js';
import { TicketNotifier } from './ticket-notifier.service.js';
import { TicketPresenter } from './ticket-presenter.service.js';
import { TicketRecordingsService } from './ticket-recordings.service.js';
import { TicketReportsService } from './ticket-reports.service.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsRepository } from './tickets.repository.js';
import { TicketsService } from './tickets.service.js';

/**
 * Tickets (docs/rewrite/TICKETS.md): operator → regional executive → callback to the citizen.
 * Uses the live AMI state (ticket from a call in progress), the CDR (past calls, recordings),
 * click-to-call (callback) and the recordings storage — read-only, through their exported services.
 */
@Module({
  imports: [
    LiveModule,
    ActionsModule,
    PbxCallsModule,
    RecordingsModule,
    MulterModule.registerAsync({
      inject: [AppConfig],
      // Memory storage: bytes are checked (magic numbers) before anything touches the disk.
      useFactory: (config: AppConfig) => ({
        limits: {
          fileSize: config.get('TICKETS_MAX_FILE_MB') * 1024 * 1024,
          files: TICKET_MAX_FILES_PER_UPLOAD,
          fields: 10,
          fieldSize: 64 * 1024,
          parts: TICKET_MAX_FILES_PER_UPLOAD + 10,
        },
      }),
    }),
  ],
  // Directories first: `tickets/directories/*` must win over `tickets/:id`.
  controllers: [TicketDirectoriesController, TicketsController],
  providers: [
    TicketsService,
    TicketsRepository,
    TicketDirectoriesService,
    TicketDirectoriesRepository,
    TicketPresenter,
    TicketNotifier,
    TicketCallLookup,
    TicketCallbacksService,
    TicketRecordingsService,
    TicketReportsService,
    TicketFilesStore,
  ],
})
export class TicketsModule {}
