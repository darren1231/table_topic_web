const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

function createDatabase() {
  return new PGlite({ extensions: { pgcrypto } });
}

async function initializeUsageDatabase(database, users) {
  // Minimal auth.users fixture; types follow Supabase Auth's upstream migrations:
  // https://github.com/supabase/auth/blob/master/migrations/00_init_auth_schema.up.sql
  // https://github.com/supabase/auth/blob/master/migrations/20210710035447_alter_users.up.sql
  // The latter renames confirmed_at (timestamptz) to email_confirmed_at.
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE public_only NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email varchar(255),
      email_confirmed_at timestamptz
    );
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
      SET search_path = '' AS $$
        SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      SET search_path = '' AS $$ SELECT (auth.jwt() ->> 'sub')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, public_only;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO anon, authenticated, public_only;
    -- Simulate installations that automatically expose new tables/functions.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
  `);
  const migration = await readFile(path.join(__dirname, '../../supabase/migrations/0001_ai_usage.sql'), 'utf8');
  await database.exec(migration);
  for (const [name, id] of Object.entries(users)) {
    await database.query('INSERT INTO auth.users VALUES ($1, $2, $3)', [
      id, `${name}@example.invalid`, name === 'unconfirmed' ? null : '2026-01-01T00:00:00Z',
    ]);
  }
}

module.exports = { createDatabase, initializeUsageDatabase };
