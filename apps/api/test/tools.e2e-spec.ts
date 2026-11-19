import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type request from 'supertest';
// Test-only (devDependency): reads the text of the PDF the API produced.
import { extractText, getDocumentProxy } from 'unpdf';
import { ConverterService } from '../src/modules/tools/converter.service.js';
import { Client, createE2eApp, createUser, type E2eApp, loginAs, ROOT } from './support/e2e-app.js';

/**
 * Tools API (session S8): access by permission (tools.view / tools.use, the Zangiota group flag; observers none),
 * config, Uzcrypto (lookup off: no internet in tests), downloads, the managers directory, and the
 * document converter end to end (real worker threads).
 *   E2E_DATABASE_URL=postgres://callcenter:callcenter@127.0.0.1:54320/callcenter_s8_test pnpm --filter @cc/api test:e2e tools
 */
let e2e: E2eApp;
let root: Client;
let op: Client;
let zangiota: Client;
let observer: Client;

const FILES = path.join(import.meta.dirname, '../src/modules/tools/files');

/** Collect a binary response body as a Buffer. */
function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

function convert(c: Client, file: Buffer, filename: string, target: string) {
  return c
    .post('/tools/convert')
    .field('target', target)
    .attach('file', file, { filename, contentType: 'application/octet-stream' })
    .buffer(true)
    .parse(binary);
}

async function sampleDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>Маълумотнома</w:t></w:r></w:p><w:p><w:r><w:t>Ish joyi: Call Center</w:t></w:r></w:p>' +
      '</w:body></w:document>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

beforeAll(async () => {
  process.env.TOOLS_UZCRYPTO_LOOKUP = 'false';
  process.env.TOOLS_TELEGRAM_FORM_URL = 'https://forms.example.uz/dashboard';
  e2e = await createE2eApp();
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  const zangiotaGroup = await e2e.db
    .selectFrom('operatorGroups')
    .select('id')
    .where('name', '=', 'Zangiota')
    .executeTakeFirstOrThrow();
  await createUser(root, { username: 'op101', password: 'Oper-Pass-1234', extension: '101' });
  await createUser(root, {
    username: 'op201',
    password: 'Oper-Pass-1234',
    extension: '201',
    groupId: zangiotaGroup.id,
  });
  await createUser(root, { username: 'watcher', password: 'Watch-Pass-123', role: 'observer' });
  op = await loginAs(e2e, 'op101', 'Oper-Pass-1234');
  zangiota = await loginAs(e2e, 'op201', 'Oper-Pass-1234');
  observer = await loginAs(e2e, 'watcher', 'Watch-Pass-123');
});
afterAll(async () => {
  delete process.env.TOOLS_UZCRYPTO_LOOKUP;
  delete process.env.TOOLS_TELEGRAM_FORM_URL;
  await e2e?.close();
});

describe('access', () => {
  it('needs a session', async () => {
    const anon = new Client(e2e);
    for (const p of ['/tools/config', '/tools/uzcrypto', '/tools/managers', '/tools/files/uzb2026-klaviatura.zip']) {
      expect((await anon.get(p)).status, p).toBe(401);
    }
    expect((await convert(anon, Buffer.from('salom'), 'a.txt', 'pdf')).status).toBe(401);
  });

  it('the tools page is open to operators (both groups); the converter is not', async () => {
    for (const [name, c] of [
      ['operator', op],
      ['zangiota', zangiota],
    ] as const) {
      expect((await c.get('/tools/config')).status, name).toBe(200);
      expect((await c.get('/tools/managers')).status, name).toBe(200);
    }
    // observers see only the overview dashboard (owner, 19.11.2026)
    expect((await observer.get('/tools/config')).status).toBe(403);
    expect((await observer.get('/tools/managers')).status).toBe(403);
    const me = (await zangiota.get('/auth/me')).body.user;
    expect(me.permissions).toContain('tools.view');
    expect(me.permissions).not.toContain('tools.use'); // legacy hid the converter from the 200 group
    expect((await convert(zangiota, Buffer.from('salom'), 'a.txt', 'pdf')).status).toBe(403);
    expect((await convert(observer, Buffer.from('salom'), 'a.txt', 'pdf')).status).toBe(403);
  });
});

describe('config, Uzcrypto, downloads, managers', () => {
  it('returns the Telegram Form link from the configuration', async () => {
    expect((await op.get('/tools/config')).body).toEqual({ telegramFormUrl: 'https://forms.example.uz/dashboard' });
  });

  it('Uzcrypto: the built-in version when the lookup is off; download redirects to the vendor', async () => {
    const info = (await op.get('/tools/uzcrypto')).body;
    expect(info).toMatchObject({ version: '2.2.4.24', checkedAt: null, stale: true });
    const win = await op.get('/tools/uzcrypto/download');
    expect(win.status).toBe(302);
    expect(win.headers.location).toBe('https://edo.ijro.uz/assets/uzcrypto-2.2.4.24-x32-setup.windows.zip');
    expect((await op.get('/tools/uzcrypto/download?os=macos')).headers.location).toBe(
      'https://edo.ijro.uz/assets/uzcrypto-macos.rar',
    );
    expect((await op.get('/tools/uzcrypto/download?os=linux')).status).toBe(400);
  });

  it('serves only the listed files, as attachments, byte for byte', async () => {
    const zip = await op.get('/tools/files/uzb2026-klaviatura.zip').buffer(true).parse(binary);
    expect(zip.status).toBe(200);
    expect(zip.headers['content-disposition']).toContain('attachment; filename="uzb2026-klaviatura.zip"');
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(Buffer.compare(zip.body as Buffer, readFileSync(path.join(FILES, 'uzb2026-klaviatura.zip')))).toBe(0);
    expect((zip.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    expect((await op.get('/tools/files/RustDesk_Ornatish.bat')).status).toBe(400);
    expect((await op.get('/tools/files/clean-anydesk.bat')).status).toBe(400); // AnyDesk is no longer used
    expect((await op.get('/tools/files/..%2F..%2Fapp.module.js')).status).toBe(400);
  });

  it('managers directory: four tabs of data, not cached', async () => {
    const res = await op.get('/tools/managers');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.tashkent).toHaveLength(14);
    expect(res.body.ministries).toHaveLength(7);
    expect(res.body.regions).toHaveLength(13);
    expect(res.body.exat).toHaveLength(2);
    expect(res.body.regions[0]).toEqual(
      expect.objectContaining({ region: expect.any(String), offices: expect.any(Array), extraPhone: null }),
    );
  });
});

describe('converter', () => {
  it('TXT → PDF and → DOCX (UTF-8 file name kept)', async () => {
    const pdf = await convert(op, Buffer.from('Salom dunyo\nПривет мир', 'utf8'), 'Ариза №1.txt', 'pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('Ариза №1.pdf')}`);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const docx = await convert(op, Buffer.from('Bir\tikki'), 'a.txt', 'docx');
    expect(docx.status).toBe(200);
    expect(docx.headers['content-type']).toContain('wordprocessingml');
    const xml = await (await JSZip.loadAsync(docx.body as Buffer)).file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:tab/>');
  });

  it('DOCX → PDF keeps the text; DOCX → TXT', async () => {
    const pdf = await convert(root, await sampleDocx(), 'obyektivka.docx', 'pdf');
    expect(pdf.status).toBe(200);
    const doc = await getDocumentProxy(new Uint8Array(pdf.body as Buffer));
    const text = (await extractText(doc, { mergePages: true })).text;
    expect(text).toContain('Маълумотнома');
    expect(text).toContain('Call Center');

    const txt = await convert(root, await sampleDocx(), 'obyektivka.docx', 'txt');
    expect(txt.status).toBe(200);
    expect(txt.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect((txt.body as Buffer).toString('utf8')).toContain('Ish joyi: Call Center');
  });

  it('checks the file: signature, type, pair, size, damage', async () => {
    // a fresh client: each fake IP has its own converter rate limit
    const op = await loginAs(e2e, 'op101', 'Oper-Pass-1234');
    // a text file renamed to .docx; a PDF renamed to .txt
    expect((await convert(op, Buffer.from('not a word file'), 'fake.docx', 'pdf')).status).toBe(415);
    expect((await convert(op, Buffer.from('%PDF-1.7 ...'), 'fake.txt', 'pdf')).status).toBe(415);
    // images and PDFs are converted in the browser, not here
    expect((await convert(op, Buffer.from([0xff, 0xd8, 0xff]), 'photo.jpg', 'pdf')).status).toBe(415);
    expect((await convert(op, Buffer.from('%PDF-1.7'), 'scan.pdf', 'docx')).status).toBe(415);
    // DOCX → DOCX is not a conversion; PNG is not a server target
    expect((await convert(op, await sampleDocx(), 'a.docx', 'docx')).status).toBe(400);
    expect((await convert(op, Buffer.from('x'), 'a.txt', 'png')).status).toBe(400);
    // no file
    expect((await op.post('/tools/convert').field('target', 'pdf')).status).toBe(400);
    // over 35 MB
    const big = Buffer.alloc(35 * 1024 * 1024 + 1, 0x61);
    expect((await convert(op, big, 'big.txt', 'pdf')).status).toBe(413);
    // a ZIP that is not a Word document
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    const notWord = await zip.generateAsync({ type: 'nodebuffer' });
    const damaged = await convert(op, notWord, 'broken.docx', 'pdf');
    expect(damaged.status).toBe(422);
  });

  it('rate-limits the converter per client (10 a minute)', async () => {
    const c = await loginAs(e2e, 'op101', 'Oper-Pass-1234');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await convert(c, Buffer.from('x'), 'scan.pdf', 'docx')).status);
    expect(statuses.slice(0, 10).every((s) => s === 415)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('keeps nothing running after the responses', async () => {
    const svc = e2e.app.get(ConverterService) as unknown as { running: Set<unknown> };
    expect(svc.running.size).toBe(0);
  });
});
