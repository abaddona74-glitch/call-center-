import { Global, Module } from '@nestjs/common';
import { AMI_COMMANDS } from '../../common/ports/ami-commands.port.js';
import { AmiController } from './ami.controller.js';
import { AmiService } from './ami.service.js';

/**
 * Asterisk Manager Interface. Global so any module can inject `AMI_COMMANDS`
 * (`@InjectAmiCommands()`, e.g. blacklist → AstDB) without importing this module.
 * Telephony modules (live, actions) inject `AmiService` directly.
 */
@Global()
@Module({
  controllers: [AmiController],
  providers: [
    AmiService,
    { provide: AMI_COMMANDS, inject: [AmiService], useFactory: (ami: AmiService) => ami.commands },
  ],
  exports: [AmiService, AMI_COMMANDS],
})
export class AmiModule {}
