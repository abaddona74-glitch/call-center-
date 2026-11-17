import { Module } from '@nestjs/common';
import { RecordingsController } from './recordings.controller.js';
import { RecordingsRepository } from './recordings.repository.js';
import { RecordingsService } from './recordings.service.js';
import { RECORDING_STORAGE } from './storage/recording-storage.port.js';
import { SftpRecordingStorage } from './storage/sftp-recording-storage.js';
import { ZipJobsService } from './zip-jobs.service.js';

/** Call recordings: monitor folder browser, streaming, call → recording, ZIP export. */
@Module({
  controllers: [RecordingsController],
  providers: [
    RecordingsService,
    RecordingsRepository,
    ZipJobsService,
    SftpRecordingStorage,
    { provide: RECORDING_STORAGE, useExisting: SftpRecordingStorage },
  ],
})
export class RecordingsModule {}
