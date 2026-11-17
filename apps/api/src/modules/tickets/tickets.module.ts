import { TICKET_MAX_FILES_PER_UPLOAD } from '@cc/shared';
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfig } from '../../config/app-config.js';
import { TicketFilesStore } from './ticket-files.store.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsRepository } from './tickets.repository.js';
import { TicketsService } from './tickets.service.js';

/** Operator tickets (former viewer portal, port 3005): board, state machine, chat, attachments. */
@Module({
  imports: [
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
  controllers: [TicketsController],
  providers: [TicketsService, TicketsRepository, TicketFilesStore],
})
export class TicketsModule {}
