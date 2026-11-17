import {
  type Contact,
  type ContactAccess,
  ContactAccessSchema,
  ContactInputSchema,
  type ContactInputParsed,
  ContactListQuerySchema,
  type ContactListQuery,
  type ContactListResponse,
  ContactListResponseSchema,
  ContactSchema,
  type SessionUser,
  TopActiveQuerySchema,
  type TopActiveQuery,
  type TopActiveResponse,
  TopActiveResponseSchema,
  UzPhoneInputSchema,
} from '@cc/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, SerializeOptions } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import { ContactsService } from './contacts.service.js';

/**
 * Phonebook. Open to every role except operator groups that may not see contacts
 * (checked in the service on every call, not only hidden in the UI).
 */
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('access')
  @SerializeOptions({ schema: ContactAccessSchema })
  access(@CurrentUser() user: SessionUser): ContactAccess {
    return this.contacts.access(user);
  }

  @Get()
  @SerializeOptions({ schema: ContactListResponseSchema })
  list(
    @Query({ schema: ContactListQuerySchema }) q: ContactListQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<ContactListResponse> {
    return this.contacts.list(q, user);
  }

  /** Most active callers from the PBX CDR, with saved contact data. */
  @Get('top-active')
  @SerializeOptions({ schema: TopActiveResponseSchema })
  topActive(
    @Query({ schema: TopActiveQuerySchema }) q: TopActiveQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<TopActiveResponse> {
    return this.contacts.topActive(q, user);
  }

  @Get(':phone')
  @SerializeOptions({ schema: ContactSchema })
  get(
    @Param('phone', { schema: UzPhoneInputSchema }) phone: string,
    @CurrentUser() user: SessionUser,
  ): Promise<Contact> {
    return this.contacts.get(phone, user);
  }

  /** Create, or update the contact with this phone (legacy upsert). */
  @Post()
  @HttpCode(200)
  @SerializeOptions({ schema: ContactSchema })
  create(
    @Body({ schema: ContactInputSchema }) body: ContactInputParsed,
    @CurrentUser() user: SessionUser,
  ): Promise<Contact> {
    return this.contacts.create(body, user);
  }

  @Put(':phone')
  @SerializeOptions({ schema: ContactSchema })
  update(
    @Param('phone', { schema: UzPhoneInputSchema }) phone: string,
    @Body({ schema: ContactInputSchema }) body: ContactInputParsed,
    @CurrentUser() user: SessionUser,
  ): Promise<Contact> {
    return this.contacts.update(phone, body, user);
  }

  @Delete(':phone')
  @HttpCode(204)
  async delete(
    @Param('phone', { schema: UzPhoneInputSchema }) phone: string,
    @CurrentUser() user: SessionUser,
  ): Promise<void> {
    await this.contacts.delete(phone, user);
  }
}
