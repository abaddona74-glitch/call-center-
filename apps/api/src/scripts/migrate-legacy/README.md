# migrate-legacy: legacy data → PostgreSQL

A one-off CLI that copies data from the legacy system (SQLite `callcenter.db` + JSON files) into the new
PostgreSQL schema. It reads the legacy sources read-only and writes through the project's Kysely setup
(`database/kysely.ts`). There is no Nest bootstrap. Mapping reference: `docs/rewrite/legacy/data.md` (§5).

## Run

```bash
pnpm --filter @cc/shared build && pnpm --filter @cc/api build
export DATABASE_URL=postgres://…/callcenter_xxx      # or put it in apps/api/.env.local
pnpm --filter @cc/api db:migrate                     # the target schema must be up to date

# always dry-run first
pnpm --filter @cc/api migrate:legacy --sqlite /path/callcenter.db --data-dir /path/legacy-json --dry-run
pnpm --filter @cc/api migrate:legacy --sqlite /path/callcenter.db --data-dir /path/legacy-json
pnpm --filter @cc/api migrate:legacy --sqlite /path/callcenter.db --only users
```

| Flag               | Meaning                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `--sqlite <file>`  | Legacy `callcenter.db`. It is opened with `readOnly: true`.                                                             |
| `--data-dir <dir>` | One folder that holds the legacy JSON files (see below). A missing file is reported, not fatal.                         |
| `--dry-run`        | Reads and plans only. Each mapper runs in a `READ ONLY` transaction that is rolled back, so Postgres rejects any write. |
| `--only a,b`       | Runs only these mappers, still in the built-in order.                                                                   |

At least one of `--sqlite` and `--data-dir` is required. The target comes only from `DATABASE_URL`, never
from a flag, so credentials stay out of shell history and `ps`.

**Exit codes:** `0` means every mapper either succeeded or is a stub. `1` means a mapper failed (its
transaction was rolled back) or Postgres was unreachable. `2` means bad arguments or a bad `DATABASE_URL`.
Skips, warnings and "not implemented" stubs do not affect the exit code, so read the report.

### Preparing the sources

- **SQLite:** take a consistent copy, `sqlite3 /opt/call-center/data/callcenter.db ".backup callcenter.db"`.
  Legacy runs in WAL mode. Copying the bare file without its `-wal` loses recent writes, and a read-only open
  of a WAL database needs a writable folder for `-shm`.
- **JSON:** copy these files flat into one folder (names must stay the same):

  | File                        | Legacy location            | Mapper                 |
  | --------------------------- | -------------------------- | ---------------------- |
  | `tickets.json`              | `viewer/data/tickets.json` | tickets                |
  | `ticket-uploads/` (folder)  | `viewer/public/uploads/tickets/*` (copy the files flat) | tickets (attachments; images/PDF/DOCX only, copied to `TICKETS_UPLOAD_DIR`) |
  | `stt_custom_rules.json`     | `data/`                    | transcripts            |
  | `queue-sync-settings.json`  | `data/`                    | settings               |
  | `system_settings.json`      | repo root (not `data/`)    | settings               |
  | `telegram_subscribers.json` | `data/`                    | telegram-subscribers   |
  | `rustdesk_devices.json`     | `viewer/data/`             | remote-desktop-devices |

## Report

Each mapper prints `read`, `insert`, `update`, `unchanged`, `skipped`, `warnings` and `errors` (in dry-run:
`would insert` / `would update`), followed by one line per skipped row and per warning, and then its notes.
Rows are identified as `#<legacy id> <username>`. Password hashes and email addresses are never printed.

- **skipped:** the row was deliberately not migrated, and the reason is given. Fix the row in legacy and re-run.
- **warning:** the row was migrated with an adjustment (for example, the email was dropped as a duplicate).
- **error:** something failed. The runner rolls back that mapper's transaction (it is all-or-nothing), the
  other mappers still run, and the exit code is 1.
- **unchanged:** the row already exists in the target. A re-run shows earlier inserts here.

A real run that inserted or updated rows writes one `audit_log` entry, `migration.legacy.<mapper>`, with the
counts, in the same transaction.

## Idempotency rule

**Users: insert if absent, by username, case-insensitive (`lower(username)`, the same as the
`users_username_lower_uq` index). An existing user is never modified.**

- Nothing that already exists in `users` is touched: password, role, extension, email and `is_active` all
  stay as they are. A password changed in the new system can therefore never be overwritten by a re-run. The
  same goes for the bootstrap `superuser` created by `BOOTSTRAP_SUPERUSER_*`. If legacy also has a
  `superuser`, the new one is kept.
- An existing user whose legacy row differs is still counted as `unchanged`, and a warning names the fields
  that differ (`password`, `role`, `extension`, `email`) so drift is visible.
- Consequence: changes made in legacy _after_ a user was imported are not carried over. For the final
  cutover, run against a freshly migrated database, or accept that the new system wins.
- Inserts use `ON CONFLICT DO NOTHING`. A user created by someone else between planning and inserting is
  reported as `unchanged` with a warning, not as an error.

Stubs should follow the same pattern. Their TODOs name the natural key for each table.

## users mapper (`auth_users` → `users`)

| Legacy                     | New             | Rule                                                                                                                                                                                                                                                            |
| -------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `username`                 | `username`      | trimmed. An empty username is skipped. One that only differs by case from an older legacy row is skipped (new unique index). One outside `UsernameSchema` is kept, with a warning.                                                                              |
| `password_hash` + `salt`   | `password_hash` | `fromLegacy(salt, hash)` produces `scrypt$16384$8$1$<salt>$<hash>`. The hash must be 128 hex chars and the salt 32 hex chars, otherwise the row is skipped. The salt is kept byte-for-byte (it is used as text).                                                |
| `role`                     | `role`          | trimmed and lower-cased; legacy `admin` becomes `superuser` (owner decision 2026-11-17, with a warning). Then it must be `operator`, `observer`, `executive` or `superuser` (`RoleSchema`). Anything else is skipped. |
| `operator_id`              | `extension`     | trimmed, `''` becomes null. A value that is not 2–6 digits (`ExtensionSchema`) becomes null, with a warning. An operator without an extension gets a warning.                                                                                                   |
| `email`                    | `email`         | trimmed and lower-cased, `''` becomes null. Anything legacy's own regex would reject becomes null, with a warning. A duplicate (case-insensitive, either against existing users or against an older legacy row) becomes null, with a warning naming the holder. |
| `created_at`, `updated_at` | same            | `'YYYY-MM-DD HH:MM:SS'` is read as Asia/Tashkent wall-clock time (luxon). An unparsable value falls back to the DB default `now()`.                                                                                                                             |
| `webauthn_user_id`         | `webauthn_user_id` | copied verbatim (lower-cased UUID text): it is the passkey user handle. Missing → a new UUID (no passkeys to keep). Not a UUID, or already held by another user → a new UUID, with a warning (that user's passkeys are then skipped). |
| `operator_id` ≥ 200        | `group_id`      | operators with extension ≥ 200 go to the operator group "Zangiota" (legacy "200 group" restrictions). Others get no group (no restrictions).                                                                                                                   |
| —                          | `is_active`     | DB default `true`.                                                                                                                                                                                                                                              |

Accounts `operator200`…`operator209` (created by legacy `scripts/create_200.js` with one shared password)
are imported with `must_change_password = true` (owner decision): they can only change the password after
signing in, nothing else works until they do.

### Legacy data with no home in the new schema (not migrated)

- **Legacy `id`**: `users.id` is `GENERATED ALWAYS AS IDENTITY`, so ids are not preserved. Later mappers
  resolve users through legacy `auth_users.username` → `users.id`. Only passkeys (and the dropped
  `auth_password_resets`) referenced the legacy id.
- `salt` and `password_hash` are merged into one column, so nothing is lost there.

## passkeys mapper (`auth_passkeys` → `passkeys`)

A passkey keeps working only if the credential id, the COSE public key bytes, the counter and the user handle
stay the same, and the deployment keeps the legacy `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGINS` (env, see
`apps/api/.env.example`). The mapper copies `id`, `public_key` (byte-for-byte), `counter`, `device_type`,
`backed_up`, `transports` (JSON → `text[]`, unknown values dropped), `device_name` → `name` (≤ 60 chars),
`created_at`/`last_used_at` (Tashkent local time). The owner is resolved by legacy username (case-insensitive).

- **Skipped** (with the reason): owner missing in legacy or not migrated; the passkey's `webauthn_user_id`
  differs from its owner's (legacy refused such logins too); the public key is not a COSE key; the credential
  id already belongs to another user.
- **Handle adoption:** if the target user already existed with a different handle (e.g. the bootstrap
  `superuser`) and has **no** passkeys yet, it adopts the legacy handle (counted as `updated`, with a warning).
  A user who already registered passkeys in the new system is never changed; the legacy passkey is skipped.
- Idempotent: insert-if-absent by credential id. Legacy passkey sessions are not migrated (users sign in again).
- Proven end to end in `apps/api/test/passkeys.e2e-spec.ts` (migrate a legacy user + passkey, then sign in with
  the password and with the passkey through the API).

## Mappers

| Mapper                   | Owner              | Legacy source                                                         | Status                                    |
| ------------------------ | ------------------ | --------------------------------------------------------------------- | ----------------------------------------- |
| `users`                  | S1                 | `auth_users`                                                          | implemented (S6)                          |
| `passkeys`               | S1                 | `auth_passkeys`                                                       | implemented (S1)                          |
| `settings`               | S1                 | `system_settings`, `queue-sync-settings.json`, `system_settings.json` | stub                                      |
| `contacts`               | S4                 | `client_contacts`                                                     | stub                                      |
| `callbacks`              | S4                 | `pending_callbacks` (all statuses)                                    | stub                                      |
| `blacklist`              | S4                 | `blacklist` (ext 114 only)                                            | stub                                      |
| `transcripts`            | stage 2 (STT) / S5 | `call_transcriptions`, `stt_learned_rules`, `stt_custom_rules.json`   | stub                                      |
| `tickets`                | S5                 | `tickets.json` (+ upload files)                                       | stub                                      |
| `telegram-subscribers`   | stage 2            | `telegram_subscribers.json`                                           | stub                                      |
| `remote-desktop-devices` | stage 2            | `rustdesk_devices.json`                                               | stub                                      |

A stub migrates nothing. It reports how many legacy rows or records are waiting and which sources are
missing. Its TODO comment summarises the mapping notes from data.md.

**Not migrated on purpose** (data.md §5.2 "Drop"): `calls`, `operator_daily_stats`,
`operator_reject_events`, `operator_missed_events` (check their prod row counts first), `call_topic_analytics`
(synthetic), `auth_sessions` (users log in again), `auth_lockouts`, `auth_password_resets` and
`auth_email_verifications`; `agent_3cx_call_logs` (the 3CX desktop agent is dropped, see
`docs/rewrite/DECISIONS.md`).

### Implementing a stub

1. Replace `notImplementedMapper(...)` in `mappers/<name>.mapper.ts` with a `Mapper` (see `users.mapper.ts`):
   a pure `transform` (legacy row → values, or a skip reason), a pure `plan` (given what the target already
   has: insert / update / unchanged / skip), and a small repository (Kysely, or an in-memory fake in specs).
2. When `ctx.dryRun` is set, only plan and fill in the counts. The transaction is read-only anyway.
3. Never throw for a bad row. Skip it with a reason. Throw (or add to `errors`) only when the whole mapper
   must be rolled back.
4. Write a spec like `users.mapper.spec.ts`. It builds a temporary SQLite from
   `__fixtures__/legacy-schema.sql` and needs no Postgres.

## Tests and fixture

`pnpm --filter @cc/api test` runs `*.spec.ts` here. They need no Postgres. The legacy schema fixture
`__fixtures__/legacy-schema.sql` (schema only, no data) was produced by running the legacy schema code
(`dbService`, `authService.init()`, the `webauthnService` migration, `blacklistService`, `sttCleanerService`,
`sttService` and `topicAnalyticsService`) on an empty database in a scratch copy of `legacy/`. Modules that
open Redis, SSH, SFTP or HTTPS connections on require (`issabelDbService`, `redisService`, `sftpService` and
`geminiService`) were stubbed out, and the `sqlite_master` SQL was dumped. To refresh it, repeat that on a
scratch copy. Never use a production database for the fixture.
