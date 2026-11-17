import { type AmiStatus, AmiStatusSchema } from '@cc/shared';
import { Controller, Get, SerializeOptions } from '@nestjs/common';
import { AmiService } from './ami.service.js';

@Controller('ami')
export class AmiController {
  constructor(private readonly ami: AmiService) {}

  /** Connection state for the "AMI" pill (any logged-in user). */
  @Get('status')
  @SerializeOptions({ schema: AmiStatusSchema })
  status(): AmiStatus {
    return this.ami.status();
  }
}
