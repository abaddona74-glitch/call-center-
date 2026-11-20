import { Global, Module } from '@nestjs/common';
import { OperatorPhotosController } from './operator-photos.controller.js';
import { OperatorPhotosRepository } from './operator-photos.repository.js';
import { OperatorPhotosService } from './operator-photos.service.js';
import { OperatorPhotosStore } from './operator-photos.store.js';

/** Operator photos for the operator cards. Global: the live board injects the service for the photo URLs. */
@Global()
@Module({
  controllers: [OperatorPhotosController],
  providers: [OperatorPhotosService, OperatorPhotosRepository, OperatorPhotosStore],
  exports: [OperatorPhotosService],
})
export class OperatorPhotosModule {}
