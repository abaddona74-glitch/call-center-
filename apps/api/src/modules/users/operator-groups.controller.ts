import {
  CreateOperatorGroupSchema,
  GroupIdParamSchema,
  type OperatorGroup,
  type OperatorGroupList,
  OperatorGroupListSchema,
  OperatorGroupSchema,
  UpdateOperatorGroupSchema,
} from '@cc/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, SerializeOptions } from '@nestjs/common';
import type { z } from 'zod';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { UsersService } from './users.service.js';

/** Operator groups and their permission flags (admin+). */
@Controller('operator-groups')
@RequirePermission('users.manage')
export class OperatorGroupsController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @SerializeOptions({ schema: OperatorGroupListSchema })
  async list(): Promise<OperatorGroupList> {
    return { items: await this.users.listGroups() };
  }

  @Post()
  @SerializeOptions({ schema: OperatorGroupSchema })
  create(
    @Body({ schema: CreateOperatorGroupSchema }) body: z.output<typeof CreateOperatorGroupSchema>,
  ): Promise<OperatorGroup> {
    return this.users.createGroup(body);
  }

  @Patch(':id')
  @SerializeOptions({ schema: OperatorGroupSchema })
  update(
    @Param('id', { schema: GroupIdParamSchema }) id: number,
    @Body({ schema: UpdateOperatorGroupSchema }) body: z.output<typeof UpdateOperatorGroupSchema>,
  ): Promise<OperatorGroup> {
    return this.users.updateGroup(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', { schema: GroupIdParamSchema }) id: number): Promise<void> {
    await this.users.deleteGroup(id);
  }
}
