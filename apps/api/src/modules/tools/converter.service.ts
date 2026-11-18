import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  SERVER_CONVERT_SOURCES,
  type ServerConvertSource,
  type ServerConvertTarget,
  TOOLS_CONVERT_MAX_BYTES,
  fileExtension,
  isServerConversion,
} from '@cc/shared';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  type OnModuleDestroy,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import type { ConvertJob, ConvertReply } from './converter.worker.js';
import { decodeText, matchesSignature } from './domain/document-input.js';
import { convertedFileName } from './domain/output-name.js';

/** What multer hands over (memory storage — the upload never touches the disk). */
export interface IncomingFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export interface ConvertedFile {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

const MIME: Record<ServerConvertTarget, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
};

// converter.worker.js next to the compiled service; converter.worker.ts when running from sources.
const WORKER_URL = new URL(`./converter.worker${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url);

/**
 * Universal converter, server half (Word and text documents; images and PDFs are converted in the
 * browser). Every conversion runs in its own worker thread with
 * a heap limit and a timeout and is terminated afterwards; the bytes stay in memory ("zero storage":
 * nothing is written to disk, nothing is kept after the response). Legacy spawned converter.py.
 */
@Injectable()
export class ConverterService implements OnModuleDestroy {
  private readonly logger = new Logger(ConverterService.name);
  private readonly running = new Set<Worker>();

  constructor(private readonly config: AppConfig) {}

  async convert(file: IncomingFile | undefined, target: ServerConvertTarget): Promise<ConvertedFile> {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file to convert (field "file")');
    if (file.size > TOOLS_CONVERT_MAX_BYTES) throw new PayloadTooLargeException('The file is larger than 35 MB');

    const source = fileExtension(file.originalname);
    if (!(SERVER_CONVERT_SOURCES as readonly string[]).includes(source)) {
      throw new UnsupportedMediaTypeException('Only DOCX, DOC and TXT documents are converted on the server');
    }
    const kind = source as ServerConvertSource;
    if (!isServerConversion(kind, target)) {
      throw new BadRequestException(`${kind.toUpperCase()} → ${target.toUpperCase()} is not supported`);
    }
    const bytes = new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength);
    if (!matchesSignature(kind, bytes)) {
      throw new UnsupportedMediaTypeException(`The file is not a real ${kind.toUpperCase()} document`);
    }

    const job: ConvertJob =
      kind === 'txt' ? { source: kind, target, text: decodeText(bytes) } : { source: kind, target, bytes };
    const started = Date.now();
    const output = await this.runWorker(job);
    if (!output.length) throw new UnprocessableEntityException('The conversion produced an empty file');
    // No file names in logs: they often carry citizens' names.
    this.logger.log(`${kind} → ${target}: ${file.size} B → ${output.length} B in ${Date.now() - started} ms`);
    return {
      fileName: convertedFileName(file.originalname, target),
      mimeType: MIME[target],
      buffer: Buffer.from(output.buffer, output.byteOffset, output.byteLength),
    };
  }

  onModuleDestroy(): void {
    for (const w of this.running) void w.terminate();
    this.running.clear();
  }

  private runWorker(job: ConvertJob): Promise<Uint8Array> {
    if (this.running.size >= this.config.get('TOOLS_CONVERT_CONCURRENCY')) {
      throw new ServiceUnavailableException('The converter is busy, try again in a minute');
    }
    const timeoutMs = this.config.get('TOOLS_CONVERT_TIMEOUT_SEC') * 1000;
    const worker = new Worker(WORKER_URL, {
      workerData: { ccConverter: true },
      resourceLimits: {
        maxOldGenerationSizeMb: this.config.get('TOOLS_CONVERT_MEMORY_MB'),
        maxYoungGenerationSizeMb: 48,
        stackSizeMb: 4,
      },
      // The worker needs no environment (secrets stay in the main thread).
      env: {},
      // Library chatter (console.*) is dropped; failures come back as messages and are logged here.
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    this.running.add(worker);

    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const finish = (err: Error | null, value?: Uint8Array) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.running.delete(worker);
        void worker.terminate();
        if (err) reject(err);
        else resolve(value as Uint8Array);
      };
      const timer = setTimeout(() => {
        this.logger.warn(`${job.source} → ${job.target}: killed after ${timeoutMs} ms`);
        finish(new UnprocessableEntityException('The document is too large or too complex to convert'));
      }, timeoutMs);

      worker.once('message', (reply: ConvertReply) => {
        if (reply.ok) return finish(null, reply.bytes);
        this.logger.warn(`${job.source} → ${job.target} failed (${reply.reason}): ${reply.detail.slice(0, 300)}`);
        if (reply.reason === 'unreadable') {
          return finish(new UnprocessableEntityException('The file is damaged or cannot be read'));
        }
        if (reply.reason === 'unsupported') return finish(new BadRequestException('This conversion is not supported'));
        finish(new InternalServerErrorException('Conversion failed'));
      });
      worker.once('error', (err: Error & { code?: string }) => {
        this.logger.warn(`${job.source} → ${job.target}: worker error ${err.code ?? ''} ${err.message.slice(0, 300)}`);
        finish(
          err.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new UnprocessableEntityException('The document is too large or too complex to convert')
            : new InternalServerErrorException('Conversion failed'),
        );
      });
      worker.once('exit', (code) => finish(new InternalServerErrorException(`Converter stopped (code ${code})`)));

      if (job.bytes) {
        // The upload buffer may be a slice of a larger (pooled) buffer: hand over a private copy.
        const copy = new Uint8Array(job.bytes);
        worker.postMessage({ ...job, bytes: copy }, [copy.buffer]);
      } else {
        worker.postMessage(job);
      }
    });
  }
}
