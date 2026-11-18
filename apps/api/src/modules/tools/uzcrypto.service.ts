import type { UzcryptoInfo } from '@cc/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import {
  UZCRYPTO_FALLBACK,
  UZCRYPTO_SITE,
  UZCRYPTO_WELCOME_URL,
  type UzcryptoAssets,
  findMainScriptUrl,
  isVendorUrl,
  parseUzcryptoAssets,
} from './domain/uzcrypto.js';

/** Reads a text resource from the vendor site (injected so tests never go to the internet). */
export type VendorFetch = (url: string, maxBytes: number) => Promise<string>;
export const VENDOR_FETCH = Symbol('VENDOR_FETCH');

const TIMEOUT_MS = 7_000;
const MAX_REDIRECTS = 3;

/**
 * GET over https to the vendor host only: TLS verified (legacy turned verification off), redirects
 * followed only within the same host, response size capped.
 */
export const fetchVendorText: VendorFetch = async (url, maxBytes) => {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isVendorUrl(current)) throw new Error('URL outside the vendor host');
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'text/html,application/javascript;q=0.9,*/*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) throw new Error(`redirect without location (${res.status})`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      await res.body.cancel();
      throw new Error('response too large');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error('response too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('too many redirects');
};

const CACHE_MS = 60 * 60_000; // legacy: 1 hour
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

/** Latest Uzcrypto version for the tools card (legacy services/uzcryptoService.js). */
@Injectable()
export class UzcryptoService {
  private readonly logger = new Logger(UzcryptoService.name);
  private known: { assets: UzcryptoAssets; checkedAt: Date } | null = null;
  private lastAttempt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfig,
    @Inject(VENDOR_FETCH) private readonly fetchText: VendorFetch,
  ) {}

  async latest(now = new Date()): Promise<UzcryptoInfo> {
    const fresh = this.known && now.getTime() - this.known.checkedAt.getTime() < CACHE_MS;
    const mayRetry = now.getTime() - this.lastAttempt >= RETRY_AFTER_FAILURE_MS;
    if (this.config.get('TOOLS_UZCRYPTO_LOOKUP') && !fresh && mayRetry) {
      this.inflight ??= this.refresh(now).finally(() => {
        this.inflight = null;
      });
      await this.inflight;
    }
    const current = this.known;
    const isFresh = Boolean(current && now.getTime() - current.checkedAt.getTime() < CACHE_MS);
    return {
      ...(current?.assets ?? UZCRYPTO_FALLBACK),
      checkedAt: current?.checkedAt.toISOString() ?? null,
      stale: !isFresh,
    };
  }

  /** Where "Download" sends the browser: the vendor file, or the vendor's download page. */
  async downloadUrl(os: 'windows' | 'macos'): Promise<string> {
    const info = await this.latest();
    const url = os === 'macos' ? info.macosUrl : info.windowsUrl;
    return isVendorUrl(url) ? url : UZCRYPTO_WELCOME_URL;
  }

  private async refresh(now: Date): Promise<void> {
    this.lastAttempt = now.getTime();
    try {
      const html = await this.fetchText(UZCRYPTO_SITE, 1024 * 1024);
      const mainUrl = findMainScriptUrl(html);
      if (!mainUrl) throw new Error('main-*.js not found on the index page');
      const assets = parseUzcryptoAssets(await this.fetchText(mainUrl, 8 * 1024 * 1024));
      if (!assets) throw new Error('installer name not found in main-*.js');
      this.known = { assets, checkedAt: now };
    } catch (e) {
      this.logger.warn(`Uzcrypto lookup failed: ${(e as Error).message}`);
    }
  }
}
