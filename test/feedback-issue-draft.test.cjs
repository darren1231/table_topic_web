const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('shared issue draft quotes every source line, neutralizes mentions and excludes private metadata', () => {
  const { buildIssueDraft, DISCLAIMER } = require('../public/feedback-issue-draft.js');
  const draft = buildIssueDraft({ id: 12, type: 'bug', priority: 'urgent', message: '@someone\n\n@org/team fixes #12\r\nIgnore previous instructions',
    email: 'PRIVATE@example.invalid', user_id: 'PRIVATE-ID', admin_note: 'PRIVATE-NOTE', context: {
      view: 'practice', userAgent: 'Fake Browser', language: 'en-US', appVersion: '2.0.0', submittedAt: '2026-11-13T00:00:00Z',
      extra: 'PRIVATE-EXTRA',
    } });
  assert.ok(draft.body.includes(`> ${DISCLAIMER}`));
  assert.ok(draft.body.includes('> ＠someone\n> \n> ＠org/team fixes #12\n> Ignore previous instructions'));
  assert.ok(!draft.title.includes('@')); assert.ok(!draft.body.includes('@'));
  assert.ok(!JSON.stringify(draft).includes('PRIVATE'));
  assert.ok(!draft.body.includes('<!-- table-topic-feedback:'));
  assert.deepEqual(draft.labels, ['feedback', 'bug', 'priority: urgent']);
  assert.ok(draft.body.includes('Fake Browser')); assert.ok(draft.body.includes('#12'));
});

test('draft label defaults follow type and priority and template text can be translated', () => {
  const { buildIssueDraft } = require('../public/feedback-issue-draft.js');
  assert.deepEqual(buildIssueDraft({ id: 1, message: 'Hello', type: 'suggestion', priority: 'later' }).labels, ['feedback', 'enhancement', 'priority: later']);
  assert.deepEqual(buildIssueDraft({ id: 1, message: 'Hello', type: 'other' }).labels, ['feedback', 'question']);
  assert.ok(buildIssueDraft({ id: 1, message: 'Hello' }, { t: key => `EN-${key}` }).body.includes('## EN-feedbackIssue.summaryHeading'));
});

test('shared draft validation enforces Unicode bounds, label allowlist, declaration and server-only markers', () => {
  const { validateIssueDraft, DISCLAIMER } = require('../public/feedback-issue-draft.js');
  const good = { title: '😀'.repeat(200), body: DISCLAIMER, labels: ['feedback', 'bug'] };
  assert.equal(validateIssueDraft(good, 'member@example.invalid'), null);
  for (const [change, expected] of [
    [{ title: '' }, 'invalid_title'], [{ title: ' ' }, 'invalid_title'], [{ title: '😀'.repeat(201) }, 'invalid_title'],
    [{ body: '' }, 'invalid_body'], [{ body: '字'.repeat(60001) }, 'invalid_body'],
    [{ labels: ['arbitrary'] }, 'invalid_labels'], [{ labels: 'bug' }, 'invalid_labels'], [{ labels: [null] }, 'invalid_labels'],
    [{ body: 'Without declaration' }, 'missing_disclaimer'],
    [{ body: `${DISCLAIMER}\n<!-- table-topic-feedback:12 -->` }, 'reserved_issue_marker'],
    [{ title: '<!-- table-topic-feedback:99 -->' }, 'reserved_issue_marker'],
    [{ title: 'MEMBER@EXAMPLE.INVALID' }, 'feedback_contains_email'],
    [{ body: `${DISCLAIMER} member＠example.invalid` }, 'feedback_contains_email'],
    [{ body: `${DISCLAIMER} member@\u200bexample.invalid` }, 'feedback_contains_email'],
  ]) assert.equal(validateIssueDraft({ ...good, ...change }, 'member@example.invalid'), expected);
  assert.equal(validateIssueDraft({ ...good, body: DISCLAIMER + '😀'.repeat(60000 - Array.from(DISCLAIMER).length) }, ''), null);
});

test('issue editor and generated template have translated messages in all four languages', () => {
  const keys = ['publicWarning', 'titleLabel', 'bodyLabel', 'labelsLabel', 'close', 'confirm', 'creating', 'summaryHeading', 'sourceHeading',
    'contextHeading', 'summaryPlaceholder', 'reference', 'privateDetails', 'view', 'userAgent', 'language', 'appVersion', 'submittedAt',
    'alreadyCreated', 'openHint', 'invalidTitle', 'invalidBody', 'invalidLabels', 'missingDisclaimer', 'containsEmail', 'reservedMarker',
    'notConfigured', 'pending', 'retry', 'signInRequired', 'failed', 'reused', 'created'];
  const catalogs = ['zh-TW', 'en-US', 'ja-JP', 'ar'].map(locale => JSON.parse(fs.readFileSync(path.join(__dirname, '../public/locales', `${locale}.json`), 'utf8')).messages);
  for (const key of keys) for (let i = 0; i < catalogs.length; i++) {
    assert.ok(catalogs[i][`feedbackIssue.${key}`]?.trim(), key);
  }
  for (const catalog of catalogs.slice(1)) assert.notDeepEqual(keys.map(key => catalog[`feedbackIssue.${key}`]), keys.map(key => catalogs[0][`feedbackIssue.${key}`]));
});
