import {
  CreateUserSchema,
  ResetUserPasswordResultSchema,
  ResetUserPasswordSchema,
  type ResetUserPasswordResult,
  type SessionUser,
  UpdateUserSchema,
  type User,
  UserIdParamSchema,
  type UserList,
  UserListQuerySchema,
  UserListSchema,
  type UserListQuery,
  UserSchema,
} from '@cc/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, SerializeOptions } from '@nestjs/common';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators.js';
import { UsersService } from './users.service.js';

/** User administration. Admins see everyone but manage only operators (see domain/user-policy.ts). */
@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @SerializeOptions({ schema: UserListSchema })
  async list(
    @CurrentUser() actor: SessionUser,
    @Query({ schema: UserListQuerySchema }) query: UserListQuery,
  ): Promise<UserList> {
    return { items: await this.users.list(actor, query) };
  }

  @Get(':id')
  @SerializeOptions({ schema: UserSchema })
  get(@CurrentUser() actor: SessionUser, @Param('id', { schema: UserIdParamSchema }) id: number): Promise<User> {
    return this.users.get(actor, id);
  }

  @Post()
  @SerializeOptions({ schema: UserSchema })
  create(
    @CurrentUser() actor: SessionUser,
    @Body({ schema: CreateUserSchema }) body: z.output<typeof CreateUserSchema>,
  ): Promise<User> {
    return this.users.create(actor, body);
  }

  @Patch(':id')
  @SerializeOptions({ schema: UserSchema })
  update(
    @CurrentUser() actor: SessionUser,
    @Param('id', { schema: UserIdParamSchema }) id: number,
    @Body({ schema: UpdateUserSchema }) body: z.output<typeof UpdateUserSchema>,
  ): Promise<User> {
    return this.users.update(actor, id, body);
  }

  @Post(':id/password')
  @HttpCode(200)
  @SerializeOptions({ schema: ResetUserPasswordResultSchema })
  resetPassword(
    @CurrentUser() actor: SessionUser,
    @Param('id', { schema: UserIdParamSchema }) id: number,
    @Body({ schema: ResetUserPasswordSchema }) body: z.output<typeof ResetUserPasswordSchema>,
  ): Promise<ResetUserPasswordResult> {
    return this.users.resetPassword(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() actor: SessionUser, @Param('id', { schema: UserIdParamSchema }) id: number): Promise<void> {
    await this.users.remove(actor, id);
  }
}
