import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller.js';
import { ContactsRepository } from './contacts.repository.js';
import { ContactsService } from './contacts.service.js';

/** Citizens' phonebook keyed by normalized phone; top callers from the PBX CDR. */
@Module({
  controllers: [ContactsController],
  providers: [ContactsRepository, ContactsService],
})
export class ContactsModule {}
