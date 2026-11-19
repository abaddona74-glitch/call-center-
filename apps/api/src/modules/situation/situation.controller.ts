import { type SituationSnapshot, SituationSnapshotSchema } from '@cc/shared';
import { Controller, Get, SerializeOptions } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { SituationService } from './situation.service.js';

/**
 * The live situation board «Hozirgi holat» (owner, 19.11.2026): the observers' landing page, the superuser sees it
 * too. Read-only — this module has no actions. Afterwards the client applies the `situation.*` WS events.
 */
@Controller('situation')
@RequirePermission('situation.view')
export class SituationController {
  constructor(private readonly situation: SituationService) {}

  /** Telephony now (citizen numbers in full) and tickets now. Definitions: docs/rewrite/METRICS.md §10. */
  @Get()
  @SkipThrottle()
  @SerializeOptions({ schema: SituationSnapshotSchema })
  snapshot(): Promise<SituationSnapshot> {
    return this.situation.snapshot();
  }
}
