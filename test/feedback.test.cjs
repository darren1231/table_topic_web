const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { before, after, beforeEach, describe, test } = require('node:test');
const { createDatabase, initializeUsageDatabase } = require('./helpers/database.cjs');
const users = { member: '00000000-0000-0000-0000-000000000001', other: '00000000-0000-0000-0000-000000000002',
  admin: '00000000-0000-0000-0000-000000000003', unconfirmed: '00000000-0000-0000-0000-000000000004' };
const context = { view: 'practice', userAgent: 'FAKE-test-browser', language: 'zh-TW', appVersion: '2.0.0', submittedAt: '2026-11-13T04:00:00Z' };
let database;
async function owner() { await database.exec('reset role'); }
async function caller(id = users.member, role = 'authenticated', email = 'member@example.invalid') {
  await owner();
  await database.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(id ? { sub: id, email } : {})]);
  assert.ok(['authenticated', 'anon', 'public_only'].includes(role));
  await database.exec(`set role ${role}`);
}
async function clock(value) {
  const iso = new Date(value).toISOString();
  await owner();
  // Only the owner of this isolated test DB replaces the fixed production clock.
  await database.exec(`create or replace function private.feedback_now() returns timestamptz
    language sql stable security definer set search_path = '' as $$ select '${iso}'::timestamptz $$`);
}
async function submit(type = 'bug', message = 'A test description', info = context, id = users.member) {
  await caller(id);
  return (await database.query('select public.submit_feedback($1, $2, $3) as id', [type, message, info === null ? null : JSON.stringify(info)])).rows[0].id;
}
async function listMine(id = users.member) {
  await caller(id);
  return database.query('select * from public.get_my_feedback()');
}
async function snapshot() {
  await owner();
  return (await database.query('select * from public.feedback order by id')).rows;
}
async function adminUpdate(ids, priority = null, status = null, note = null) {
  await caller(users.admin);
  return database.query('select public.admin_update_feedback($1::bigint[], $2, $3, $4) as count', [ids, priority, status, note]);
}
async function begin(id) {
  await caller(users.admin);
  return (await database.query('select public.admin_begin_issue($1) as result', [id])).rows[0].result;
}
async function finish(id, token, number = 42, url = 'https://github.com/example/repo/issues/42') {
  await caller(users.admin);
  return database.query('select public.admin_finish_issue($1, $2::uuid, $3, $4)', [id, token, number, url]);
}
async function cancel(id, token) {
  await caller(users.admin);
  return database.query('select public.admin_cancel_issue($1, $2::uuid)', [id, token]);
}

describe('user feedback migration', { concurrency: false }, () => {
  before(async () => {
    database = createDatabase();
    await initializeUsageDatabase(database, users);
    for (const name of ['0002_fix_admin_email_type.sql', '0003_signed_usage_and_tokens.sql', '0004_user_feedback.sql']) {
      await database.exec(await readFile(path.join(__dirname, '../supabase/migrations', name), 'utf8'));
    }
  });
  after(async () => { await database?.close(); });
  beforeEach(async () => {
    await owner();
    await database.exec('truncate public.feedback, public.app_admins restart identity');
    await database.exec("insert into public.app_admins values ('ADMIN@EXAMPLE.INVALID'), ('unconfirmed@example.invalid')");
    await clock('2026-11-13T04:00:00Z');
  });

  test('submission generates an identity and own-feedback exposes only the five public fields', async () => {
    const id = await submit('bug', '保留原文 <img src=x onerror=alert(1)>');
    assert.equal(id, 1);
    const result = await listMine();
    assert.deepEqual(result.fields.map(field => field.name), ['id', 'created_at', 'type', 'message', 'public_status']);
    assert.equal(result.rows[0].message, '保留原文 <img src=x onerror=alert(1)>');
    assert.equal(result.rows[0].public_status, 'received');
    const stored = (await snapshot())[0];
    assert.equal(stored.user_id, users.member);
    assert.equal(stored.created_at.toISOString(), '2026-11-13T04:00:00.000Z');
    assert.deepEqual(stored.context, context);
    assert.equal(stored.status, 'new'); assert.equal(stored.priority, null);
  });

  test('daily quota allows ten per user and resets at Taipei midnight independently of session timezone', async () => {
    await clock('2026-11-13T15:59:59.999Z');
    await database.exec("set timezone = 'America/Los_Angeles'");
    for (let i = 0; i < 10; i++) await submit('other', `Message ${i}`, null);
    await assert.rejects(submit(), { code: 'P0001', message: 'feedback_daily_limit' });
    assert.equal((await listMine()).rows.length, 10);
    await submit('suggestion', 'Another user', null, users.other);
    await clock('2026-11-13T16:00:00.000Z');
    await submit();
    assert.equal((await listMine()).rows.length, 11);
  });

  test('admin listing casts varchar email to text and classification preserves null fields', async () => {
    const id = await submit();
    await clock('2026-11-13T04:01:00Z');
    await adminUpdate([id], 'urgent', null, 'Private note');
    const result = await database.query('select * from public.admin_list_feedback()');
    assert.equal(result.rows[0].email, 'member@example.invalid');
    assert.equal(result.fields.find(field => field.name === 'email').dataTypeID, 25);
    assert.equal(result.rows[0].status, 'triaged');
    assert.equal(result.rows[0].priority, 'urgent');
    assert.equal(result.rows[0].admin_note, 'Private note');
    assert.equal(result.rows[0].updated_at.toISOString(), '2026-11-13T04:01:00.000Z');
    await adminUpdate([id], null, 'done', null);
    assert.equal((await snapshot())[0].admin_note, 'Private note');
    await adminUpdate([id], null, null, '');
    assert.equal((await snapshot())[0].admin_note, '');
    assert.equal((await listMine()).rows[0].public_status, 'done');
  });

  test('A times out, B takes over, and stale A finish/cancel cannot affect B', async () => {
    const id = await submit();
    const a = await begin(id);
    assert.equal(new Date(a.created_at).toISOString(), '2026-11-13T04:00:00.000Z');
    assert.match(a.issue_pending_token, /^[0-9a-f-]{36}$/);
    assert.equal(a.email, 'member@example.invalid');
    assert.equal(a.type, 'bug'); assert.deepEqual(a.context, context);
    await assert.rejects(begin(id), { code: '55000', message: 'feedback_issue_pending' });
    await clock('2026-11-13T04:10:00Z');
    const b = await begin(id);
    assert.notEqual(a.issue_pending_token, b.issue_pending_token);
    const before = await snapshot();
    await assert.rejects(finish(id, a.issue_pending_token), { code: '55000', message: 'feedback_issue_token_mismatch' });
    await assert.rejects(cancel(id, a.issue_pending_token), { code: '55000', message: 'feedback_issue_token_mismatch' });
    assert.deepEqual(await snapshot(), before);
    await finish(id, b.issue_pending_token);
    const saved = (await snapshot())[0];
    assert.equal(saved.issue_number, 42); assert.equal(saved.status, 'issue_created');
    assert.equal(saved.issue_pending_at, null); assert.equal(saved.issue_pending_token, null);
    await assert.rejects(begin(id), { code: '55000', message: 'feedback_issue_exists' });
  });

  test('invalid submissions do not consume quota and Unicode limits count characters', async () => {
    for (const type of [null, '', 'Bug', 'unsupported']) await assert.rejects(submit(type), { code: '22023' });
    for (const message of [null, '', '   ', '\n\t', 'x'.repeat(2001), '😀'.repeat(2001)]) await assert.rejects(submit('bug', message), { code: '22023' });
    for (const type of ['bug', 'suggestion', 'other']) await submit(type, 'x', null);
    await submit('other', '😀'.repeat(2000), null);
    await submit('other', '  original\ntext  ', null);
    assert.equal((await listMine()).rows[0].message, '  original\ntext  ');
    await caller();
    await database.query("select public.submit_feedback('bug', 'JSON null context', 'null'::jsonb)");
    assert.equal((await snapshot()).at(-1).context, null);
    assert.equal((await snapshot()).length, 6);
  });

  test('context accepts only bounded string values from the whitelist and at most 2048 UTF-8 bytes', async () => {
    for (const bad of [[], 'string', true, 5, { view: null }, { view: [] }, { view: {} }, { view: 10 }, { view: false }, { view: 'x'.repeat(301) },
      ...['email', 'token', 'access_token', 'transcript', 'answer', 'message'].map(key => ({ [key]: 'FAKE-private-value' }))]) {
      await assert.rejects(submit('bug', 'Context test', bad), { code: '22023', message: 'invalid_feedback_context' });
    }
    const exact = { view: '界'.repeat(300), userAgent: '界'.repeat(300), language: 'a'.repeat(203) };
    await owner();
    assert.equal((await database.query("select octet_length(convert_to($1::jsonb::text, 'UTF8')) as bytes", [exact])).rows[0].bytes, 2048);
    await submit('other', 'Exactly 2048 bytes', exact);
    await assert.rejects(submit('other', 'Too many bytes', { ...exact, language: 'a'.repeat(204) }), { code: '22023' });
    await submit('suggestion', 'Empty object', {});
    await submit('suggestion', '300 characters', { view: '😀'.repeat(300) });
    assert.equal((await snapshot()).length, 3);
  });

  test('queued same-user submissions cannot exceed ten and quota uses server time', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => submit('bug', `Queued ${i}`, { submittedAt: '1900-01-01' })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 10);
    for (const result of results.filter(result => result.status === 'rejected')) assert.equal(result.reason.message, 'feedback_daily_limit');
    await owner();
    const definition = (await database.query("select pg_get_functiondef('public.submit_feedback(text,text,jsonb)'::regprocedure) as definition")).rows[0].definition;
    assert.match(definition, /pg_advisory_xact_lock/);
    assert.equal((await snapshot()).length, 10);
  });

  test('users cannot directly read or mutate feedback, identity sequence or specify another owner', async () => {
    await submit();
    for (const role of ['authenticated', 'anon', 'public_only']) {
      await caller(users.member, role);
      for (const sql of ['select * from public.feedback', 'insert into public.feedback default values',
        "update public.feedback set status = 'done'", 'delete from public.feedback', 'truncate public.feedback',
        "select nextval('public.feedback_id_seq')"]) await assert.rejects(database.exec(sql), { code: '42501' });
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal((await database.query("select has_table_privilege(current_user, 'public.feedback', $1) as allowed", [privilege])).rows[0].allowed, false);
      }
    }
    await caller();
    await assert.rejects(database.query("select public.submit_feedback(p_user_id => $1::uuid, p_type => 'bug', p_message => 'Forgery', p_context => null)", [users.other]), { code: '42883' });
    await assert.rejects(database.query('select * from public.get_my_feedback(p_user_id => $1::uuid)', [users.other]), { code: '42883' });
    assert.equal((await snapshot())[0].user_id, users.member);
  });

  test('own-feedback is read-only, isolates users and never exposes admin or issue fields', async () => {
    const ids = [];
    for (const state of ['new', 'triaged', 'issue_created', 'done', 'wont_fix']) {
      const id = await submit('other', state, context); ids.push(id);
      await owner();
      await database.query("update public.feedback set status=$2, priority='urgent', admin_note='FAKE-private-note' where id=$1", [id, state]);
    }
    await submit('bug', 'Other user', null, users.other);
    await caller(); await database.exec('begin read only');
    try {
      const { rows, fields } = await database.query('select * from public.get_my_feedback()');
      assert.deepEqual(fields.map(field => field.dataTypeID), [20, 1184, 25, 25, 25]);
      assert.deepEqual(rows.map(row => row.public_status), ['declined', 'done', 'in_progress', 'in_progress', 'received']);
      assert.deepEqual(rows.map(row => row.id), [...ids].reverse());
      assert.ok(!JSON.stringify(rows).includes('FAKE-private-note'));
      for (const row of rows) assert.deepEqual(Object.keys(row), ['id', 'created_at', 'type', 'message', 'public_status']);
    } finally { await database.exec('rollback'); }
    assert.equal((await listMine(users.other)).rows.length, 1);
  });

  test('batch updates are atomic for missing IDs, notes are single-record only, and null means unchanged', async () => {
    const a = await submit(), b = await submit('suggestion', 'Second');
    const before = await snapshot();
    await clock('2026-11-13T04:05:00Z');
    await assert.rejects(adminUpdate([a, 99999], 'urgent', 'done'), { code: '22023', message: 'feedback_not_found' });
    assert.deepEqual(await snapshot(), before);
    for (const ids of [null, [], [null], [-1], [0]]) await assert.rejects(adminUpdate(ids, 'normal'), { code: '22023' });
    await assert.rejects(adminUpdate([a, b], null, null, 'batch note'), { code: '22023' });
    await assert.rejects(adminUpdate([a, b], null, null, ''), { code: '22023' });
    await assert.rejects(adminUpdate([a], 'invalid'), { code: '22023' });
    await assert.rejects(adminUpdate([a], null, 'issue_created'), { code: '22023' });
    await assert.rejects(adminUpdate([a], null, null, 'x'.repeat(2001)), { code: '22023' });
    assert.deepEqual(await snapshot(), before);
    assert.equal((await adminUpdate([a, b])).rows[0].count, 0);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await adminUpdate([b, a, a], 'normal')).rows[0].count, 2);
    assert.deepEqual((await snapshot()).map(row => row.status), ['triaged', 'triaged']);
    await adminUpdate([a], 'later', 'done');
    assert.equal((await snapshot())[0].status, 'done');
    await caller(users.admin);
    await assert.rejects(database.query('select public.admin_update_feedback(p_ids => $1::bigint[], p_issue_number => 42)', [[a]]), { code: '42883' });
  });

  test('all admin functions reject forged JWT email and unconfirmed accounts', async () => {
    const id = await submit();
    const calls = [
      ['select * from public.admin_list_feedback()', []],
      ['select public.admin_update_feedback($1::bigint[], null, null, null)', [[id]]],
      ['select public.admin_begin_issue($1)', [id]],
      ['select public.admin_finish_issue($1, $2::uuid, 42, $3)', [id, users.member, 'https://github.com/example/repo/issues/42']],
      ['select public.admin_cancel_issue($1, $2::uuid)', [id, users.member]],
    ];
    for (const user of [users.member, users.unconfirmed]) {
      await caller(user, 'authenticated', 'admin@example.invalid');
      for (const [sql, args] of calls) await assert.rejects(database.query(sql, args), { code: '42501' });
    }
    await caller(users.admin, 'authenticated', 'not-admin@example.invalid');
    assert.equal((await database.query('select * from public.admin_list_feedback()')).rows.length, 1);
    await database.exec('begin read only');
    try { assert.equal((await database.query('select * from public.admin_list_feedback()')).rows.length, 1); }
    finally { await database.exec('rollback'); }
  });

  test('finish validates GitHub URL and number, with no unsigned finish or cancel overloads', async () => {
    const id = await submit(), pending = await begin(id);
    const before = await snapshot();
    for (const url of ['http://github.com/example/repo/issues/42', 'https://github.com.evil.invalid/example/repo/issues/42',
      'javascript:alert(1)', 'https://github.com/example/repo/issues/43', 'https://github.com/example/repo/issues/042',
      'https://github.com/example/../issues/42', 'https://github.com/example/repo/pull/42',
      'https://github.com/example/repo/issues/42?x=1', 'https://github.com/example/repo/issues/42#anchor',
      'https://github.com/example/repo/issues/42\n', null]) await assert.rejects(finish(id, pending.issue_pending_token, 42, url), { code: '22023', message: 'invalid_feedback_issue_url' });
    for (const number of [0, -1, null]) await assert.rejects(finish(id, pending.issue_pending_token, number), { code: '22023' });
    assert.deepEqual(await snapshot(), before);
    await caller(users.admin);
    await assert.rejects(database.query("select public.admin_finish_issue($1, 42, 'https://github.com/example/repo/issues/42')", [id]), { code: '42883' });
    await assert.rejects(database.query('select public.admin_cancel_issue($1)', [id]), { code: '42883' });
    await finish(id, pending.issue_pending_token);
    await assert.rejects(finish(id, pending.issue_pending_token), { code: '55000' });
    await assert.rejects(cancel(id, pending.issue_pending_token), { code: '55000' });
    assert.equal((await listMine()).rows[0].public_status, 'in_progress');
  });

  test('cancel releases only its matching reservation and retry always receives a fresh token', async () => {
    const id = await submit(); await adminUpdate([id], 'urgent');
    const a = await begin(id), before = await snapshot();
    await assert.rejects(cancel(id, null), { code: '55000' });
    await assert.rejects(cancel(id, users.other), { code: '55000' });
    assert.deepEqual(await snapshot(), before);
    await cancel(id, a.issue_pending_token);
    const cancelled = (await snapshot())[0];
    assert.equal(cancelled.issue_pending_token, null); assert.equal(cancelled.issue_pending_at, null);
    assert.equal(cancelled.status, 'triaged'); assert.equal(cancelled.priority, 'urgent');
    const b = await begin(id);
    assert.notEqual(b.issue_pending_token, a.issue_pending_token);
    await clock('2026-11-13T04:09:59.999Z');
    await assert.rejects(begin(id), { code: '55000', message: 'feedback_issue_pending' });
    await clock('2026-11-13T05:00:00Z');
    // An expired reservation can still finish if nobody took it over.
    await finish(id, b.issue_pending_token);
    assert.equal((await snapshot())[0].issue_number, 42);
  });

  test('missing IDs and absent reservations fail without changing any feedback', async () => {
    const id = await submit(), before = await snapshot();
    for (const missing of [null, 0, -1, 99999]) await assert.rejects(begin(missing), { code: '22023' });
    await assert.rejects(finish(99999, users.admin), { code: '22023', message: 'feedback_not_found' });
    await assert.rejects(cancel(99999, users.admin), { code: '22023', message: 'feedback_not_found' });
    await assert.rejects(finish(id, users.admin), { code: '55000', message: 'feedback_issue_token_mismatch' });
    await assert.rejects(cancel(id, users.admin), { code: '55000', message: 'feedback_issue_token_mismatch' });
    assert.deepEqual(await snapshot(), before);
  });

  test('functions reject absent identity and anonymous execution, with RLS and hardened contexts', async () => {
    await caller();
    const id = await submit();
    const calls = [
      ['select public.submit_feedback($1,$2,$3)', ['bug', 'text', null]], ['select * from public.get_my_feedback()', []],
      ['select * from public.admin_list_feedback()', []], ['select public.admin_update_feedback($1::bigint[],null,null,null)', [[id]]],
      ['select public.admin_begin_issue($1)', [id]], ['select public.admin_finish_issue($1,$2::uuid,42,$3)', [id, users.admin, 'https://github.com/example/repo/issues/42']],
      ['select public.admin_cancel_issue($1,$2::uuid)', [id, users.admin]],
    ];
    for (const [role, user] of [['anon', users.admin], ['public_only', users.admin], ['authenticated', null]]) {
      await caller(user, role);
      for (const [sql, args] of calls) await assert.rejects(database.query(sql, args), { code: '42501' });
    }
    await owner();
    const functions = (await database.query(`select proname, prosecdef, proconfig from pg_proc where
      (pronamespace = 'public'::regnamespace and proname in ('submit_feedback','get_my_feedback','admin_list_feedback','admin_update_feedback','admin_begin_issue','admin_finish_issue','admin_cancel_issue'))
      or (pronamespace = 'private'::regnamespace and proname like '%feedback%')`)).rows;
    assert.equal(functions.length, 12);
    for (const fn of functions) { assert.equal(fn.prosecdef, true, fn.proname); assert.deepEqual(fn.proconfig, ['search_path=""'], fn.proname); }
    assert.deepEqual((await database.query("select relrowsecurity from pg_class where oid='public.feedback'::regclass")).rows, [{ relrowsecurity: true }]);
    assert.deepEqual((await database.query("select * from pg_policies where schemaname='public' and tablename='feedback'")).rows, []);
  });

  test('deleting a user cascades only their feedback and default rows cannot forge issue metadata', async () => {
    await submit(); await submit('other', 'Other', null, users.other);
    await owner();
    await assert.rejects(database.query("update public.feedback set context = '{\"email\":\"FAKE@example.invalid\"}'"), { code: '23514' });
    await assert.rejects(database.query("update public.feedback set issue_number=42, issue_url='javascript:alert(1)'"), { code: '23514' });
    await database.query('delete from auth.users where id=$1', [users.other]);
    assert.deepEqual((await snapshot()).map(row => row.user_id), [users.member]);
  });
});
