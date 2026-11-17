import { Module } from '@nestjs/common';
import { PresenceController } from './presence.controller.js';
import { PresenceService } from './presence.service.js';

/** "Who is online" list from the WebSocket connections (legacy presence widget, without cursors). */
@Module({
  controllers: [PresenceController],
  providers: [PresenceService],
})
export class PresenceModule {}
