const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { before, after, beforeEach, describe, test } = require('node:test');
const { createDatabase, initializeUsageDatabase } = require('./helpers/database.cjs');
const { signUsage, usagePayload } = require('../api/_lib/signing.js');

// Clearly fake, test-only signing material; no credentials from the environment.
const fakeSecret = 'FAKE-TEST-ONLY-signing-secret-00000000';
const member = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const validRecord = { p_provider: 'openai', p_model: 'fake-model', p_kind: 'analysis',
  p_status: 'success', p_error: '', p_input_tokens: 100, p_output_tokens: 50,
  p_input_rate: 0.2, p_output_rate: 1.2, p_estimated_cost: 1e-7, p_duration_ms: 10,
  p_audio_seconds: 60.5 };
let database;

async function owner() { await database.exec('RESET ROLE'); }
async function caller(id = member, role = 'authenticated') {
  await owner();
  await database.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(id ? { sub: id } : {})]);
  assert.ok(['authenticated', 'anon', 'public_only'].includes(role));
  await database.exec(`set role ${role}`);
}
async function record(signed) {
  const keys = Object.keys(signed);
  return database.query(`select public.record_ai_usage(${keys.map((key, index) => `${key} => $${index + 1}`).join(', ')}) as id`, Object.values(signed));
}

describe('signed AI usage migration', { concurrency: false }, () => {
  before(async () => {
    database = createDatabase();
    await initializeUsageDatabase(database, { member, other });
    await database.exec(await readFile(path.join(__dirname, '../supabase/migrations/0002_fix_admin_email_type.sql'), 'utf8'));
    await database.exec(await readFile(path.join(__dirname, '../supabase/migrations/0003_signed_usage_and_tokens.sql'), 'utf8'));
  });
  after(async () => { await database?.close(); });
  beforeEach(async () => {
    await owner();
    await database.exec('truncate public.ai_usage, public.token_ledger, private.signing_keys');
    await database.query("insert into private.signing_keys values ('usage', $1)", [fakeSecret]);
  });

  test('real pgcrypto matches the exact JavaScript payload and HMAC and accepts signed usage', async () => {
    const signed = signUsage(member, validRecord, fakeSecret);
    const args = [member, signed.p_kind, signed.p_status, signed.p_model, signed.p_input_tokens,
      signed.p_output_tokens, signed.p_estimated_cost, signed.p_audio_seconds, signed.p_issued_at, signed.p_nonce];
    const { rows: [result] } = await database.query(`select private.usage_signing_payload(
      $1::uuid, $2::text, $3::text, $4::text, $5::bigint, $6::bigint, $7::numeric, $8::numeric, $9::timestamptz, $10::uuid) as payload`, args);
    assert.equal(result.payload, usagePayload(member, signed));
    const { rows: [hmac] } = await database.query("select encode(extensions.hmac($1, $2, 'sha256'), 'hex') as signature", [result.payload, fakeSecret]);
    assert.equal(hmac.signature, signed.p_signature);
    await caller();
    const { rows: [{ id: recordedResult }] } = await record(signed);
    const id = recordedResult.id;
    assert.match(id, /^[0-9a-f-]{36}$/);
    const { rows: [saved] } = await database.query('select * from public.ai_usage');
    assert.equal(saved.nonce, signed.p_nonce);
    assert.equal(saved.user_id, member);
    assert.equal(saved.issued_at.toISOString(), signed.p_issued_at);
  });

  test('SQL and JavaScript canonicalization agree on decimals, Unicode and timezone-independent time', async () => {
    await database.exec("set timezone = 'Asia/Taipei'");
    for (const cost of [0, -0, 1e-30, 1e21, 0.00000010000000000000002, 0.30000000000000004]) {
      const signed = signUsage(member, { ...validRecord, p_model: '假模型-اختبار', p_estimated_cost: cost }, fakeSecret,
        { issuedAt: '2026-11-12T12:05:06.007+08:00', nonce: 'AAAAAAAA-0000-0000-0000-000000000001' });
      const { rows: [result] } = await database.query(`select private.usage_signing_payload(
        $1::uuid, $2::text, $3::text, $4::text, $5::bigint, $6::bigint, $7::numeric, $8::numeric, $9::timestamptz, $10::uuid) as payload`,
      [member, signed.p_kind, signed.p_status, signed.p_model, 100, 50, String(cost), '60.5000', signed.p_issued_at, signed.p_nonce]);
      assert.equal(result.payload, usagePayload(member, signed));
      const { rows: [resultHmac] } = await database.query("select encode(extensions.hmac($1, $2, 'sha256'), 'hex') as signature", [result.payload, fakeSecret]);
      assert.equal(resultHmac.signature, signed.p_signature);
    }
  });

  test('forged, missing and field-tampered signatures cannot record usage, including another user', async () => {
    const signed = signUsage(member, validRecord, fakeSecret);
    await caller();
    for (const patch of [{ p_signature: '0'.repeat(64) }, { p_signature: null }, { p_signature: '' },
      { p_kind: 'questions' }, { p_status: 'error' }, { p_model: 'other-model' },
      { p_input_tokens: 101 }, { p_output_tokens: 51 }, { p_estimated_cost: 1 },
      { p_audio_seconds: 61 }, { p_nonce: other }, { p_issued_at: new Date(Date.now() + 1000).toISOString() }]) {
      await assert.rejects(record({ ...signed, ...patch }), { code: '42501' });
    }
    await caller(other);
    await assert.rejects(record(signed), { code: '42501' });
    await owner();
    assert.deepEqual((await database.query('select * from public.ai_usage')).rows, []);
    assert.deepEqual((await database.query('select * from public.token_ledger')).rows, [], 'forged signatures never mint tokens');
  });

  test('old and future signatures outside five minutes and invalid metadata are rejected', async () => {
    await caller();
    for (const offset of [-301_000, 301_000]) {
      const signed = signUsage(member, validRecord, fakeSecret, { issuedAt: new Date(Date.now() + offset).toISOString() });
      await assert.rejects(record(signed), { code: '22023' });
    }
    const signed = signUsage(member, validRecord, fakeSecret);
    for (const patch of [{ p_nonce: null }, { p_issued_at: null }, { p_issued_at: 'infinity' }, { p_issued_at: '-infinity' }]) {
      await assert.rejects(record({ ...signed, ...patch }), { code: '22023' });
    }
  });

  test('five-minute time boundaries are inclusive with the real database clock', async () => {
    await caller();
    // now() is fixed within a transaction. No production clock override exists.
    await database.exec('begin');
    try {
      const { rows: [times] } = await database.query(`select
        to_char((now() - interval '5 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as oldest,
        to_char((now() + interval '5 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as newest`);
      for (const issuedAt of [times.oldest, times.newest]) {
        const signed = signUsage(member, validRecord, fakeSecret, { issuedAt });
        // SQL retains microseconds; the signed representation has three digits.
        await record({ ...signed, p_issued_at: issuedAt });
      }
    } finally { await database.exec('rollback'); }
  });

  test('signed RPC preserves numeric and text validation and prohibits direct writes', async () => {
    const signed = signUsage(member, validRecord, fakeSecret);
    await caller();
    for (const key of ['p_input_tokens', 'p_output_tokens', 'p_input_rate', 'p_output_rate', 'p_estimated_cost', 'p_duration_ms', 'p_audio_seconds']) {
      for (const value of [null, -1]) await assert.rejects(record({ ...signed, [key]: value }), { code: '22023' });
    }
    for (const key of ['p_input_rate', 'p_output_rate', 'p_estimated_cost', 'p_audio_seconds']) {
      for (const value of ['NaN', 'Infinity', '-Infinity']) await assert.rejects(record({ ...signed, [key]: value }), { code: '22023' });
    }
    for (const patch of [{ p_model: 'fake|ambiguous' }, { p_kind: 'unsupported' }, { p_status: 'unsupported' }, { p_error: 'x'.repeat(501) }]) {
      await assert.rejects(record({ ...signed, ...patch }), { code: '22023' });
    }
    for (const role of ['authenticated', 'anon', 'public_only']) {
      await caller(member, role);
      await assert.rejects(database.exec('insert into public.ai_usage default values'), { code: '42501' });
      await assert.rejects(database.exec('update public.ai_usage set estimated_cost = 0'), { code: '42501' });
      await assert.rejects(database.exec('delete from public.ai_usage'), { code: '42501' });
      await assert.rejects(database.exec("insert into private.signing_keys values ('forged', 'FAKE-TEST-ONLY-forged-secret-00000000')"), { code: '42501' });
    }
  });

  test('a nonce is single-use globally and failures never reserve it', async () => {
    const signed = signUsage(member, validRecord, fakeSecret);
    await caller();
    await assert.rejects(record({ ...signed, p_signature: '0'.repeat(64) }), { code: '42501' });
    await record(signed);
    await assert.rejects(record(signed), { code: '22023' });
    await caller(other);
    await assert.rejects(record(signUsage(other, validRecord, fakeSecret, { nonce: signed.p_nonce })), { code: '22023' });
    await owner();
    assert.equal((await database.query('select count(*)::int as count from public.ai_usage')).rows[0].count, 1);
  });

  test('missing or invalid database secret fails closed', async () => {
    await database.exec('delete from private.signing_keys');
    await caller();
    await assert.rejects(record(signUsage(member, validRecord, fakeSecret)), { code: '42501' });
    await owner();
    await database.query("insert into private.signing_keys values ('usage', 'FAKE-short')");
    await caller();
    await assert.rejects(record(signUsage(member, validRecord, fakeSecret)), { code: '42501' });
  });

  test('real respond and transcribe handlers write signatures accepted by PostgreSQL', async () => {
    const { fakeAuthorization } = require('./helpers/signing.cjs');
    const env = { USAGE_SIGNING_SECRET: fakeSecret, CHATGPT_PREVIEW_KEY: 'FAKE-test-api-key',
      SUPABASE_URL: 'https://database.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'FAKE-public-key' };
    const calls = [], logs = [];
    const fetch = async (url, init) => {
      calls.push(url);
      if (url.endsWith('/rpc/get_my_ai_balance')) return Response.json((await database.query('select * from public.get_my_ai_balance()')).rows);
      if (url.endsWith('/rpc/record_ai_usage')) return Response.json((await record(JSON.parse(init.body))).rows[0].id);
      if (url === 'https://api.openai.com/v1/responses') return Response.json({ output_text: 'Feedback', usage: { input_tokens: 123, output_tokens: 456 } });
      if (url === 'https://api.openai.com/v1/audio/transcriptions') return Response.json({ text: 'Speech', usage: { type: 'duration', seconds: 60.5 } });
      throw new Error('Unexpected network access');
    };
    await caller();
    const { handleRespond } = require('../api/_lib/respond.js');
    const response = await handleRespond({ request: new Request('https://app.example.invalid/api/ai/respond', {
      method: 'POST', headers: { Authorization: fakeAuthorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions: 'Coach', input: 'Answer', kind: 'analysis' }),
    }), env, fetch, logger: { error: (...args) => logs.push(args) } });
    assert.equal(response.status, 200);
    const generated = await response.json();
    assert.notEqual(generated.balance, null);
    assert.deepEqual(generated.checkIn, { checkedIn: true, reward: 10, streak: 1, balance: 10 });
    const form = new FormData();
    form.append('file', new Blob(['FAKE-audio']), 'fake.webm');
    form.append('kind', 'transcription'); form.append('prompt', '');
    const { handleTranscribe } = require('../api/_lib/transcribe.js');
    const transcription = await handleTranscribe({ request: new Request('https://app.example.invalid/api/ai/transcribe', {
      method: 'POST', headers: { Authorization: fakeAuthorization }, body: form,
    }), env, fetch, logger: { error: (...args) => logs.push(args) } });
    assert.equal(transcription.status, 200);
    assert.notEqual((await transcription.json()).balance, null);
    assert.deepEqual(logs, []);
    assert.equal(calls.length, 6);
    assert.deepEqual((await database.query('select kind, audio_seconds from public.ai_usage order by created_at')).rows,
      [{ kind: 'analysis', audio_seconds: '0' }, { kind: 'transcription', audio_seconds: '60.5' }]);
  });

  test('unsigned overloads are removed and the private schema and signing key are inaccessible', async () => {
    const { rows } = await database.query("select oid::regprocedure::text as signature, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = 'record_ai_usage'");
    assert.equal(rows.length, 1);
    assert.ok(rows[0].signature.includes('timestamp with time zone,uuid,text'));
    assert.equal(rows[0].prosecdef, true);
    assert.deepEqual(rows[0].proconfig, ['search_path=""']);
    assert.deepEqual((await database.query("select relrowsecurity from pg_class where oid='private.signing_keys'::regclass")).rows, [{ relrowsecurity: true }]);
    assert.deepEqual((await database.query("select * from pg_policies where schemaname = 'private'")).rows, []);
    for (const role of ['authenticated', 'anon', 'public_only']) {
      await caller(member, role);
      await assert.rejects(database.query('select * from private.signing_keys'), { code: '42501' });
      await assert.rejects(database.query("select public.record_ai_usage('openai', 'fake-model', 'analysis', 'success', '', 100::bigint, 50::bigint, 0.2, 1.2, 0.1, 10::bigint, 0::numeric)"), { code: '42883' });
      if (role !== 'authenticated') await assert.rejects(record(signUsage(member, validRecord, fakeSecret)), { code: '42501' });
    }
    await caller(null);
    await assert.rejects(record(signUsage(member, validRecord, fakeSecret)), { code: '42501' });
  });
});
