import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppConfig } from './app-config.js';
import { validateEnv } from './env.schema.js';

/** AppConfig through the real ConfigModule, which falls back to process.env for keys it does not know. */
describe('AppConfig', () => {
  const keys = ['DATABASE_URL', 'TOOLS_TELEGRAM_FORM_URL', 'PORT'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function load(): Promise<AppConfig> {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, validate: validateEnv })],
      providers: [AppConfig],
    }).compile();
    return moduleRef.get(AppConfig);
  }

  it('reads a blank optional variable as unset, not as the raw ""', async () => {
    process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db';
    process.env.TOOLS_TELEGRAM_FORM_URL = '';
    process.env.PORT = '';
    const config = await load();
    expect(config.get('TOOLS_TELEGRAM_FORM_URL')).toBeUndefined();
    expect(config.get('PORT')).toBe(3000);
  });

  it('reads a set optional variable', async () => {
    process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db';
    process.env.TOOLS_TELEGRAM_FORM_URL = 'https://forms.example.uz/dashboard';
    const config = await load();
    expect(config.get('TOOLS_TELEGRAM_FORM_URL')).toBe('https://forms.example.uz/dashboard');
  });
});
