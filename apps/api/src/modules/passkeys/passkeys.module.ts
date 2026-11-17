import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { PasskeysController, UserPasskeysController } from './passkeys.controller.js';
import { PasskeysRepository } from './passkeys.repository.js';
import { PasskeysService } from './passkeys.service.js';

@Module({
  imports: [UsersModule],
  controllers: [PasskeysController, UserPasskeysController],
  providers: [PasskeysService, PasskeysRepository],
})
export class PasskeysModule {}
