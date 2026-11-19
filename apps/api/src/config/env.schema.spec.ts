import { validateEnv } from './env.schema.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('validateEnv', () => {
  it('treats empty values as unset so defaults and optionals apply', () => {
    const env = validateEnv({
      ...base,
      BOOTSTRAP_SUPERUSER_PASSWORD: '',
      PBX_DB_HOST: '',
      COOKIE_SECURE: '',
      PORT: ' ',
    });
    expect(env.BOOTSTRAP_SUPERUSER_PASSWORD).toBeUndefined();
    expect(env.PBX_DB_HOST).toBeUndefined();
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.PORT).toBe(3000);
  });

  it('keeps a blank optional value as an explicit undefined key', () => {
    const env = validateEnv({ ...base, TOOLS_TELEGRAM_FORM_URL: '', UNRELATED_BLANK: '' });
    expect(Object.hasOwn(env, 'TOOLS_TELEGRAM_FORM_URL')).toBe(true);
    expect(env.TOOLS_TELEGRAM_FORM_URL).toBeUndefined();
    expect(Object.hasOwn(env, 'UNRELATED_BLANK')).toBe(false);
  });

  it('still rejects a too short bootstrap password', () => {
    expect(() => validateEnv({ ...base, BOOTSTRAP_SUPERUSER_PASSWORD: 'short' })).toThrow(/BOOTSTRAP_SUPERUSER_PASSWORD/);
  });

  it('parses lists and booleans', () => {
    const env = validateEnv({ ...base, TRUSTED_PROXIES: '10.0.0.1, 172.16.0.0/12', DB_MIGRATE_ON_START: 'false' });
    expect(env.TRUSTED_PROXIES).toEqual(['10.0.0.1', '172.16.0.0/12']);
    expect(env.DB_MIGRATE_ON_START).toBe(false);
  });

  it('requires DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});
