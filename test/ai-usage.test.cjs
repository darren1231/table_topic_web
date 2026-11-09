const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { before, after, beforeEach, describe, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const users = {
  member: '00000000-0000-0000-0000-000000000001',
  other: '00000000-0000-0000-0000-000000000002',
  admin: '00000000-0000-0000-0000-000000000003',
  unconfirmed: '00000000-0000-0000-0000-000000000004',
};
const recordSql = `SELECT public.record_ai_usage(
  p_provider => $1, p_model => $2, p_kind => $3, p_status => $4,
  p_error => $5, p_input_tokens => $6, p_output_tokens => $7,
  p_input_rate => $8, p_output_rate => $9, p_estimated_cost => $10,
  p_duration_ms => $11, p_audio_seconds => $12
) AS id`;
const validUsage = ['openai', 'test-model', 'analysis', 'success', '', 100, 50, '0.2', '1.2', '0.25', 10, 0];
let database;

async function asRole(role, id = null, email = 'member@example.invalid') {
  await database.exec('RESET ROLE');
  await database.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(id ? { sub: id, email, role } : {}),
  ]);
  // Role names are fixed test fixtures, never application input.
  assert.ok(['authenticated', 'anon', 'public_only'].includes(role));
  await database.exec(`SET ROLE ${role}`);
}

async function record(id, overrides = {}) {
  await asRole('authenticated', id);
  const values = [...validUsage];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return database.query(recordSql, values);
}

describe('AI usage migration', { concurrency: false }, () => {
  before(async () => {
    database = new PGlite();
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
    const migration = await readFile(path.join(__dirname, '../supabase/migrations/0001_ai_usage.sql'), 'utf8');
    await database.exec(migration);
    for (const [name, id] of Object.entries(users)) {
      await database.query('INSERT INTO auth.users VALUES ($1, $2, $3)', [
        id, `${name}@example.invalid`, name === 'unconfirmed' ? null : '2026-01-01T00:00:00Z',
      ]);
    }
  });

  after(async () => { await database?.close(); });

  beforeEach(async () => {
    await database.exec('RESET ROLE; TRUNCATE public.ai_usage, public.app_admins');
    await database.query('INSERT INTO public.app_admins VALUES ($1), ($2)', [
      'ADMIN@EXAMPLE.INVALID', 'unconfirmed@example.invalid',
    ]);
  });

  test('records usage with generated identity, time, and the caller as owner', async () => {
    const { rows: [{ id }] } = await record(users.member);
    assert.match(id, /^[0-9a-f-]{36}$/);
    const { rows } = await database.query('SELECT * FROM public.ai_usage');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, users.member);
    assert.ok(rows[0].created_at instanceof Date);
    assert.equal(rows[0].estimated_cost, '0.25');
    assert.equal(rows[0].input_tokens, 100);
    assert.equal(rows[0].output_tokens, 50);
    assert.equal(rows[0].model, 'test-model');
  });

  test('cannot directly insert usage or supply another user to the recording function', async () => {
    await record(users.member);
    for (const owner of [users.member, users.other]) {
      await assert.rejects(database.query(
        'INSERT INTO public.ai_usage (user_id) VALUES ($1)', [owner],
      ), { code: '42501' });
    }
    await assert.rejects(database.query(
      'SELECT public.record_ai_usage(p_user_id => $1::uuid)', [users.other],
    ), { code: '42883' });
    assert.deepEqual((await database.query('SELECT user_id FROM public.ai_usage')).rows, [
      { user_id: users.member },
    ]);
  });

  test('audio seconds default to zero for legacy calls and are returned to owners and admins', async () => {
    await asRole('authenticated', users.member);
    await database.query(recordSql.replace(', p_audio_seconds => $12', ''), validUsage.slice(0, 11));
    await record(users.member, { 2: 'transcription', 5: 0, 6: 0, 7: 0, 8: 0, 9: '0.0045', 11: '60.5' });
    assert.deepEqual((await database.query('SELECT audio_seconds FROM public.ai_usage ORDER BY audio_seconds')).rows,
      [{ audio_seconds: '0' }, { audio_seconds: '60.5' }]);
    assert.deepEqual((await database.query('SELECT * FROM public.get_my_ai_balance()')).rows, [{ spent: '0.2545' }]);
    await asRole('authenticated', users.admin);
    assert.deepEqual((await database.query('SELECT audio_seconds FROM public.admin_list_ai_usage() ORDER BY audio_seconds')).rows,
      [{ audio_seconds: '0' }, { audio_seconds: '60.5' }]);
  });

  test('audio seconds reject null, negatives, NaN and infinities in both function and table', async () => {
    for (const seconds of [null, -1, 'NaN', 'Infinity', '-Infinity']) {
      await assert.rejects(record(users.member, { 11: seconds }), { code: '22023' });
    }
    await record(users.member);
    await database.exec('RESET ROLE');
    for (const seconds of [null, -1, 'NaN', 'Infinity', '-Infinity']) {
      await assert.rejects(database.query('UPDATE public.ai_usage SET audio_seconds = $1', [seconds]), {
        code: seconds === null ? '23502' : '23514',
      });
    }
  });

  test('rejects negative or non-finite money, tokens, rates, and duration', async () => {
    for (const index of [5, 6, 7, 8, 9, 10]) {
      await assert.rejects(record(users.member, { [index]: -1 }));
      await assert.rejects(record(users.member, { [index]: null }));
    }
    for (const index of [7, 8, 9]) {
      for (const value of ['NaN', 'Infinity', '-Infinity']) {
        await assert.rejects(record(users.member, { [index]: value }));
      }
    }
    assert.deepEqual((await database.query('SELECT * FROM public.ai_usage')).rows, []);
    await record(users.member, { 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 });
  });

  test('validates bounded text, supported kinds and statuses without truncation', async () => {
    for (const [index, limit] of [[0, 50], [1, 200], [2, 32], [3, 20], [4, 500]]) {
      await assert.rejects(record(users.member, { [index]: 'x'.repeat(limit + 1) }));
      await assert.rejects(record(users.member, { [index]: null }));
    }
    for (const index of [0, 1, 2, 3]) {
      await assert.rejects(record(users.member, { [index]: ' ' }));
    }
    await assert.rejects(record(users.member, { 2: 'unsupported' }));
    await assert.rejects(record(users.member, { 3: 'unsupported' }));
    for (const kind of ['agent', 'analysis', 'questions', 'transcription', 'polish']) {
      await record(users.member, { 2: kind, 3: 'error', 4: 'x'.repeat(500) });
    }
    assert.equal((await database.query('SELECT * FROM public.ai_usage')).rows.length, 5);
  });

  test('RLS exposes only the caller usage even without a client-side filter', async () => {
    await record(users.member);
    await record(users.other);
    await asRole('authenticated', users.member);
    assert.deepEqual((await database.query('SELECT user_id FROM public.ai_usage')).rows, [
      { user_id: users.member },
    ]);
    await asRole('authenticated', users.other);
    assert.deepEqual((await database.query('SELECT user_id FROM public.ai_usage')).rows, [
      { user_id: users.other },
    ]);
  });

  test('authenticated and anonymous roles have no direct write privileges on either table', async () => {
    await record(users.member);
    for (const role of ['authenticated', 'anon']) {
      await asRole(role, role === 'authenticated' ? users.member : null);
      for (const table of ['ai_usage', 'app_admins']) {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const { rows } = await database.query('SELECT has_table_privilege(current_user, $1, $2) AS allowed', [
            `public.${table}`, privilege,
          ]);
          assert.equal(rows[0].allowed, false, `${role} ${privilege} ${table}`);
        }
      }
      await assert.rejects(database.exec('UPDATE public.ai_usage SET estimated_cost = 0'), { code: '42501' });
      await assert.rejects(database.exec('DELETE FROM public.ai_usage'), { code: '42501' });
      await assert.rejects(database.exec("INSERT INTO public.app_admins VALUES ('intruder@example.invalid')"), { code: '42501' });
      await assert.rejects(database.exec('UPDATE public.app_admins SET email = email'), { code: '42501' });
      await assert.rejects(database.exec('DELETE FROM public.app_admins'), { code: '42501' });
      await assert.rejects(database.query('SELECT * FROM public.app_admins'), { code: '42501' });
    }
  });

  test('balance returns only spent, starts at zero, and sums only the caller including errors', async () => {
    await asRole('authenticated', users.member);
    assert.deepEqual((await database.query('SELECT * FROM public.get_my_ai_balance()')).rows, [{ spent: '0' }]);
    await record(users.member, { 9: '0.25' });
    await record(users.member, { 3: 'error', 4: 'Simulated failure', 9: '0.10' });
    await record(users.other, { 9: '0.90' });
    await asRole('authenticated', users.member);
    assert.deepEqual((await database.query('SELECT * FROM public.get_my_ai_balance()')).rows, [{ spent: '0.35' }]);
  });

  test('admin is verified from auth.users, ignoring a forged JWT email', async () => {
    await asRole('authenticated', users.member, 'admin@example.invalid');
    await assert.rejects(database.query('SELECT * FROM public.admin_list_ai_usage()'), { code: '42501' });
    await asRole('authenticated', users.unconfirmed, 'admin@example.invalid');
    await assert.rejects(database.query('SELECT * FROM public.admin_list_ai_usage()'), { code: '42501' });
  });

  test('confirmed admin matches email case-insensitively and can list all usage with database emails', async () => {
    const { rows: [{ id: firstId }] } = await record(users.member);
    const { rows: [{ id: secondId }] } = await record(users.other);
    await asRole('authenticated', users.admin, 'not-an-admin@example.invalid');
    const { rows } = await database.query('SELECT * FROM public.admin_list_ai_usage()');
    assert.deepEqual(new Set(rows.map(row => row.id)), new Set([firstId, secondId]));
    assert.deepEqual(new Set(rows.map(row => row.email)), new Set([
      'member@example.invalid', 'other@example.invalid',
    ]));
    // Being an admin does not broaden the direct table SELECT policy.
    assert.deepEqual((await database.query('SELECT * FROM public.ai_usage')).rows, []);
    await assert.rejects(database.query('SELECT * FROM public.app_admins'), { code: '42501' });
  });

  test('admin since filter includes the boundary and excludes older records', async () => {
    const { rows: [{ id: older }] } = await record(users.member);
    const { rows: [{ id: newer }] } = await record(users.other);
    await database.exec('RESET ROLE');
    await database.query('UPDATE public.ai_usage SET created_at = $1 WHERE id = $2', ['2026-01-01T00:00:00Z', older]);
    await database.query('UPDATE public.ai_usage SET created_at = $1 WHERE id = $2', ['2026-02-01T00:00:00Z', newer]);
    await asRole('authenticated', users.admin);
    const { rows } = await database.query('SELECT id FROM public.admin_list_ai_usage($1)', ['2026-02-01T00:00:00Z']);
    assert.deepEqual(rows, [{ id: newer }]);
  });

  test('anon and PUBLIC-only roles cannot execute any usage function', async () => {
    for (const role of ['anon', 'public_only']) {
      await asRole(role, users.admin);
      await assert.rejects(database.query(recordSql, validUsage), { code: '42501' });
      await assert.rejects(database.query('SELECT * FROM public.get_my_ai_balance()'), { code: '42501' });
      await assert.rejects(database.query('SELECT * FROM public.admin_list_ai_usage()'), { code: '42501' });
    }
  });

  test('authenticated calls without auth.uid are rejected by every function', async () => {
    await asRole('authenticated');
    await assert.rejects(database.query(recordSql, validUsage), { code: '42501' });
    await assert.rejects(database.query('SELECT * FROM public.get_my_ai_balance()'), { code: '42501' });
    await assert.rejects(database.query('SELECT * FROM public.admin_list_ai_usage()'), { code: '42501' });
  });

  test('tables have RLS with only the own-usage SELECT policy and functions have hardened execution context', async () => {
    const { rows: tables } = await database.query(`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE oid IN ('public.ai_usage'::regclass, 'public.app_admins'::regclass)
      ORDER BY relname
    `);
    assert.deepEqual(tables, [
      { relname: 'ai_usage', relrowsecurity: true },
      { relname: 'app_admins', relrowsecurity: true },
    ]);
    const { rows: policies } = await database.query(`
      SELECT tablename, cmd, roles FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('ai_usage', 'app_admins')
    `);
    assert.deepEqual(policies, [{ tablename: 'ai_usage', cmd: 'SELECT', roles: ['authenticated'] }]);
    const { rows: functions } = await database.query(`
      SELECT proname, prosecdef, proconfig FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('record_ai_usage', 'get_my_ai_balance', 'admin_list_ai_usage')
    `);
    assert.equal(functions.length, 3);
    for (const fn of functions) {
      assert.equal(fn.prosecdef, true, fn.proname);
      assert.deepEqual(fn.proconfig, ['search_path=""'], fn.proname);
    }
  });

  test('0002 repairs the legacy varchar email query and is safe to rerun with restricted privileges', async () => {
    await record(users.member);
    await database.exec('RESET ROLE');
    const initial = await readFile(path.join(__dirname, '../supabase/migrations/0001_ai_usage.sql'), 'utf8');
    const definition = initial.slice(initial.indexOf('create function public.admin_list_ai_usage'),
      initial.indexOf('revoke all on function public.record_ai_usage'));
    // Reproduce the deployed 0001 body, before its explicit email cast was added.
    assert.ok(definition.includes('return query'));
    await database.exec(definition.replace('create function', 'create or replace function').replace('account.email::text', 'account.email'));
    await asRole('authenticated', users.admin);
    await assert.rejects(database.query('SELECT * FROM public.admin_list_ai_usage()'), { code: '42804' });
    const repair = await readFile(path.join(__dirname, '../supabase/migrations/0002_fix_admin_email_type.sql'), 'utf8');
    for (let run = 0; run < 2; run++) {
      await database.exec('RESET ROLE');
      await database.exec(repair);
      await asRole('authenticated', users.admin);
      assert.deepEqual((await database.query('SELECT email FROM public.admin_list_ai_usage()')).rows,
        [{ email: 'member@example.invalid' }]);
      assert.deepEqual((await database.query("SELECT email FROM public.admin_list_ai_usage('2100-01-01')")).rows, []);
      await asRole('authenticated', users.member, 'admin@example.invalid');
      await assert.rejects(database.query('SELECT * FROM public.admin_list_ai_usage()'), { code: '42501' });
      await asRole('authenticated', users.unconfirmed);
      await assert.rejects(database.query('SELECT * FROM public.admin_list_ai_usage()'), { code: '42501' });
      for (const role of ['anon', 'public_only']) {
        await asRole(role, users.admin);
        await assert.rejects(database.query('SELECT * FROM public.admin_list_ai_usage()'), { code: '42501' });
      }
      await database.exec('RESET ROLE');
      const { rows: [fn] } = await database.query("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'public.admin_list_ai_usage(timestamptz)'::regprocedure");
      assert.equal(fn.prosecdef, true);
      assert.deepEqual(fn.proconfig, ['search_path=""']);
    }
  });

  test('deleting an auth user cascades to their usage without affecting others', async () => {
    await record(users.member);
    await record(users.other);
    await database.exec('RESET ROLE');
    await database.query('DELETE FROM auth.users WHERE id = $1', [users.other]);
    assert.deepEqual((await database.query('SELECT user_id FROM public.ai_usage')).rows, [{ user_id: users.member }]);
  });
});
