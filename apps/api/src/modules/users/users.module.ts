import { Module } from '@nestjs/common';
import { OperatorGroupsController } from './operator-groups.controller.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController, OperatorGroupsController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
