import { Module } from '@nestjs/common';
import { BlacklistController } from './blacklist.controller.js';
import { BlacklistService } from './blacklist.service.js';

/**
 * Blocked numbers applied to Asterisk AstDB through the AmiCommands port (token AMI_COMMANDS,
 * implemented by the AMI module). Without it a disconnected stub is used and changes stay pending.
 */
@Module({
  controllers: [BlacklistController],
  providers: [BlacklistService],
})
export class BlacklistModule {}
