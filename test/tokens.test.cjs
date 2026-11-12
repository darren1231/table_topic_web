const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { before, after, beforeEach, describe, test } = require('node:test');
const { createDatabase, initializeUsageDatabase } = require('./helpers/database.cjs');
const { fakeSigningSecret, fakeUserId } = require('./helpers/signing.cjs');
const { signUsage } = require('../api/_lib/signing.js');
const other = '00000000-0000-0000-0000-000000000002';
const usage = { p_provider: 'openai', p_model: 'FAKE-test-model', p_kind: 'analysis',
  p_status: 'success', p_error: '', p_input_tokens: 1, p_output_tokens: 1,
  p_input_rate: 0.2, p_output_rate: 1.2, p_estimated_cost: 0.0000014, p_duration_ms: 1 };
let database, productionClock;

async function owner() { await database.exec('reset role'); }
async function caller(id = fakeUserId, role = 'authenticated') {
  await owner();
  await database.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(id ? { sub: id } : {})]);
  assert.ok(['authenticated', 'anon', 'public_only'].includes(role));
  await database.exec(`set role ${role}`);
}
async function today(day) {
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  await owner();
  // Owner-only replacement in this isolated test database. Production has no
  // configurable clock, test schema, or user-supplied date parameter.
  await database.exec(`create or replace function private.token_today() returns date
    language sql stable security definer set search_path = '' as $$ select '${day}'::date $$`);
  await caller();
}
async function record(overrides = {}, id = fakeUserId) {
  await caller(id);
  const signed = signUsage(id, { ...usage, ...overrides }, fakeSigningSecret);
  const keys = Object.keys(signed);
  return (await database.query(`select public.record_ai_usage(${keys.map((key, i) => `${key} => $${i + 1}`).join(', ')}) as result`, Object.values(signed))).rows[0].result;
}
async function status(id = fakeUserId) {
  await caller(id);
  return (await database.query('select public.get_my_token_status() as result')).rows[0].result;
}
async function ledger() {
  await owner();
  return (await database.query('select day::text, kind, amount, streak, detail from public.token_ledger order by day, kind')).rows;
}

describe('token ledger and automatic check-in', { concurrency: false }, () => {
  before(async () => {
    database = createDatabase();
    await initializeUsageDatabase(database, { member: fakeUserId, other });
    for (const name of ['0002_fix_admin_email_type.sql', '0003_signed_usage_and_tokens.sql']) {
      await database.exec(await readFile(path.join(__dirname, '../supabase/migrations', name), 'utf8'));
    }
    productionClock = (await database.query("select pg_get_functiondef('private.token_today()'::regprocedure) as definition")).rows[0].definition;
  });
  after(async () => { await database?.close(); });
  beforeEach(async () => {
    await owner();
    await database.exec('truncate public.ai_usage, public.token_ledger, private.signing_keys');
    await database.query("insert into private.signing_keys values ('usage', $1)", [fakeSigningSecret]);
    await today('2026-11-12');
  });

  test('first seven consecutive days award 10, 20, 30, 50, 80, 100, 100 tokens', async () => {
    let balance = 0;
    const rewards = [10, 20, 30, 50, 80, 100, 100];
    for (let i = 0; i < rewards.length; i++) {
      await today(`2026-11-${12 + i}`);
      const result = await record();
      balance += rewards[i];
      assert.deepEqual(result.checkIn, { checkedIn: true, reward: rewards[i], streak: i + 1, balance });
      assert.match(result.id, /^[0-9a-f-]{36}$/);
    }
    const rows = await ledger();
    assert.deepEqual(rows.map(row => row.amount), rewards);
    assert.equal(new Set(rows.map(row => row.detail.ai_usage_id)).size, 7);
  });

  test('a never-checked-in user has no missed days, no penalties and a first reward of ten', async () => {
    assert.deepEqual(await status(), { balance: 0, streak: 0, checkedIn: false,
      canMakeup: false, makeupCost: 200, reward: 10 });
    await today('2030-01-01');
    assert.equal((await status()).balance, 0);
    assert.deepEqual(await ledger(), []);
    assert.deepEqual((await record()).checkIn, { checkedIn: true, reward: 10, streak: 1, balance: 10 });
  });

  test('missed days are charged once per day and the next check-in restarts at day one', async () => {
    for (const [gap, startingBalance, penalties, remaining] of [
      [1, 200, [-50], 150], [3, 200, [-50, -50, -50], 50], [3, 70, [-50, -20, 0], 0],
    ]) {
      await owner();
      await database.exec('truncate public.token_ledger, public.ai_usage');
      await database.query("insert into public.token_ledger (user_id, day, kind, amount, streak) values ($1, '2026-11-01', 'check_in', $2, 1)", [fakeUserId, startingBalance]);
      await today(`2026-11-0${2 + gap}`);
      const before = await ledger();
      assert.deepEqual(await status(), { balance: remaining, streak: 0, checkedIn: false,
        canMakeup: false, makeupCost: 200, reward: 10 });
      assert.deepEqual(await status(), await status());
      assert.deepEqual(await ledger(), before, 'status queries never settle or mutate the ledger');
      assert.deepEqual((await record()).checkIn, { checkedIn: true, reward: 10, streak: 1, balance: remaining + 10 });
      assert.deepEqual((await ledger()).filter(row => row.kind === 'miss_penalty').map(row => row.amount), penalties);
      assert.equal((await status()).balance, remaining + 10);
      assert.deepEqual((await record()).checkIn, { checkedIn: false, reward: 0, streak: 1, balance: remaining + 10 });
      assert.equal((await ledger()).filter(row => row.kind === 'miss_penalty').length, gap);
    }
  });

  test('only successful signed analysis checks in, and the same day never awards twice', async () => {
    for (const kind of ['agent', 'questions', 'transcription', 'polish']) {
      assert.deepEqual((await record({ p_kind: kind })).checkIn, { checkedIn: false, reward: 0, streak: 0, balance: 0 });
    }
    assert.deepEqual((await record({ p_status: 'error' })).checkIn, { checkedIn: false, reward: 0, streak: 0, balance: 0 });
    assert.deepEqual(await ledger(), []);
    const results = await Promise.all([record(), record(), record()]);
    assert.equal(results.filter(result => result.checkIn.checkedIn).length, 1);
    assert.equal(results.reduce((sum, result) => sum + result.checkIn.reward, 0), 10);
    assert.deepEqual(await status(), { balance: 10, streak: 1, checkedIn: true,
      canMakeup: false, makeupCost: 200, reward: 0 });
    assert.equal((await ledger()).length, 1);
  });

  test('other AI kinds and failed analysis do not settle pending missed days', async () => {
    await record();
    await today('2026-11-16');
    const before = await ledger();
    for (const override of [{ p_kind: 'questions' }, { p_kind: 'transcription' }, { p_kind: 'polish' }, { p_status: 'error' }]) await record(override);
    assert.deepEqual(await ledger(), before);
    assert.equal((await status()).balance, 0);
  });

  test('status is read-only, shows pending penalties and preserves a streak through yesterday', async () => {
    await record();
    await today('2026-11-13');
    assert.deepEqual(await status(), { balance: 10, streak: 1, checkedIn: false,
      canMakeup: false, makeupCost: 200, reward: 20 });
    await today('2026-11-14');
    const before = await ledger();
    await database.exec('begin read only');
    try {
      assert.deepEqual(await status(), { balance: 0, streak: 0, checkedIn: false,
        canMakeup: false, makeupCost: 200, reward: 10 });
    } finally { await database.exec('rollback'); }
    assert.deepEqual(await ledger(), before);
    await owner();
    await database.query("insert into public.token_ledger (user_id, day, kind, amount) values ($1, '2026-11-12', 'check_in_adjust', 500)", [fakeUserId]);
    const rich = await status();
    assert.equal(rich.balance, 460);
    assert.equal(rich.canMakeup, true);
  });

  test('persisted penalties are not subtracted again by status or a later check-in', async () => {
    await record();
    await today('2026-11-16');
    await owner();
    await database.query("insert into public.token_ledger (user_id, day, kind, amount) values ($1, '2026-11-13', 'miss_penalty', -10), ($1, '2026-11-14', 'miss_penalty', 0)", [fakeUserId]);
    const before = await ledger();
    assert.equal((await status()).balance, 0);
    assert.deepEqual(await ledger(), before);
    assert.equal((await record()).checkIn.balance, 10);
    assert.deepEqual((await ledger()).filter(row => row.kind === 'miss_penalty').map(row => row.amount), [-10, 0, 0]);
  });

  test('Taipei midnight defines the day independently of the database session timezone', async () => {
    assert.ok(productionClock.includes('Asia/Taipei'));
    assert.ok(productionClock.includes('now()'));
    for (const [instant, sessionZone, reward] of [
      ['2026-11-12T15:59:59Z', 'UTC', 10], ['2026-11-12T16:00:00Z', 'America/Los_Angeles', 20],
    ]) {
      await owner();
      await database.query("select set_config('TimeZone', $1, false)", [sessionZone]);
      // Replace only now() in the actual production definition, in this test DB.
      await database.exec(productionClock.replace('now()', `'${instant}'::timestamptz`));
      assert.equal((await record()).checkIn.reward, reward);
    }
    assert.deepEqual((await ledger()).map(row => row.day), ['2026-11-12', '2026-11-13']);
  });

  test('usage, penalties and reward roll back together when ledger insertion fails', async () => {
    await record();
    await today('2026-11-16');
    const before = await ledger();
    await owner();
    const count = (await database.query('select count(*)::int as count from public.ai_usage')).rows[0].count;
    await database.exec(`create function private.fake_test_reject_check_in() returns trigger language plpgsql as $$
      begin raise exception 'FAKE-test-ledger-failure'; end $$;
      create trigger fake_test_reject_check_in before insert on public.token_ledger
      for each row when (new.kind = 'check_in') execute function private.fake_test_reject_check_in()`);
    try {
      await assert.rejects(record(), { code: 'P0001' });
      assert.deepEqual(await ledger(), before);
      assert.equal((await database.query('select count(*)::int as count from public.ai_usage')).rows[0].count, count);
    } finally {
      await owner();
      await database.exec('drop trigger fake_test_reject_check_in on public.token_ledger; drop function private.fake_test_reject_check_in()');
    }
    assert.deepEqual((await record()).checkIn, { checkedIn: true, reward: 10, streak: 1, balance: 10 });
  });

  test('ledger RLS isolates users and neither users nor anonymous roles can mutate it', async () => {
    await record();
    await record({}, other);
    for (const id of [fakeUserId, other]) {
      await caller(id);
      assert.deepEqual((await database.query('select user_id from public.token_ledger')).rows, [{ user_id: id }]);
      assert.equal((await status(id)).balance, 10);
    }
    for (const role of ['authenticated', 'anon', 'public_only']) {
      await caller(fakeUserId, role);
      for (const sql of ['insert into public.token_ledger default values', 'update public.token_ledger set amount = 10000',
        'delete from public.token_ledger', 'truncate public.token_ledger']) await assert.rejects(database.exec(sql), { code: '42501' });
      if (role !== 'authenticated') {
        await assert.rejects(database.query('select * from public.token_ledger'), { code: '42501' });
        await assert.rejects(database.query('select public.get_my_token_status()'), { code: '42501' });
      }
      await assert.rejects(database.query('select private.settle_missed_days($1)', [fakeUserId]), { code: '42501' });
    }
    await caller(null);
    await assert.rejects(database.query('select public.get_my_token_status()'), { code: '42501' });
    await owner();
    const functions = (await database.query(`select proname, prosecdef, proconfig, provolatile from pg_proc
      where oid = 'public.get_my_token_status()'::regprocedure or pronamespace = 'private'::regnamespace`)).rows;
    for (const fn of functions) {
      assert.equal(fn.prosecdef, true, fn.proname);
      assert.deepEqual(fn.proconfig, ['search_path=""'], fn.proname);
      if (fn.proname === 'get_my_token_status') assert.equal(fn.provolatile, 's');
    }
    assert.deepEqual((await database.query("select relrowsecurity from pg_class where oid = 'public.token_ledger'::regclass")).rows, [{ relrowsecurity: true }]);
  });

  test('each daily kind is unique per user and deleting an account only cascades its own ledger', async () => {
    await owner();
    for (const kind of ['check_in', 'makeup', 'miss_penalty', 'penalty_refund']) {
      const sql = "insert into public.token_ledger (user_id, day, kind, amount) values ($1, '2026-11-12', $2, 0)";
      await database.query(sql, [fakeUserId, kind]);
      await assert.rejects(database.query(sql, [fakeUserId, kind]), { code: '23505' });
      await database.query(sql, [other, kind]);
    }
    await assert.rejects(database.query("insert into public.token_ledger (user_id, day, kind, amount) values ($1, '2026-11-12', 'unsupported', 0)", [fakeUserId]), { code: '23514' });
    await database.query('delete from auth.users where id = $1', [other]);
    assert.deepEqual((await database.query('select distinct user_id from public.token_ledger')).rows, [{ user_id: fakeUserId }]);
  });
});
