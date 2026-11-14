const { test, expect } = require('./fixtures.cjs');

const records = [
  { id: 'usage-1', user_id: 'user-a', email: 'alice@example.invalid', kind: 'analysis', model: 'test-text', created_at: '2026-11-09T04:00:00Z', input_tokens: 100, output_tokens: 50, estimated_cost: 0.1, audio_seconds: 0, status: 'success' },
  { id: 'usage-2', user_id: 'user-b', email: 'bob@example.invalid', kind: 'transcription', model: 'test-audio', created_at: '2026-11-08T04:00:00Z', input_tokens: 0, output_tokens: 0, estimated_cost: 0.2, audio_seconds: 60, status: 'success' },
  { id: 'usage-3', user_id: 'user-a', email: 'alice@example.invalid', kind: 'questions', model: 'test-text', created_at: '2026-10-01T04:00:00Z', input_tokens: 200, output_tokens: 25, estimated_cost: 0.3, audio_seconds: 0, status: 'success' },
];

test('admin sees totals users details and working period purpose and user filters', async ({ signedInPage: page, sandbox }) => {
  sandbox.mockRpc('admin_list_ai_usage', records);
  sandbox.mockRpc('admin_list_tokens', [
    { user_id: 'user-a', email: 'alice@example.invalid', balance: 1240, streak: 8, last_check_in: '2026-11-10' },
    { user_id: 'user-b', email: 'bob@example.invalid', balance: 0, streak: 0, last_check_in: null },
  ]);
  await page.clock.setFixedTime(new Date('2026-11-10T04:00:00Z'));
  await page.goto('/admin');
  await page.locator('#adminLanguage').selectOption('en-US');
  await expect(page.locator('#adminData')).toBeVisible();
  await expect(page.locator('#adminCalls')).toHaveText('2');
  await expect(page.locator('#adminInputTokens')).toHaveText('100');
  await expect(page.locator('#adminOutputTokens')).toHaveText('50');
  await expect(page.locator('#adminCost')).toHaveText('US$0.300000');
  await expect(page.locator('#adminAudioSeconds')).toHaveText('60');
  await expect(page.locator('#adminUserRows tr')).toHaveCount(2);
  await expect(page.locator('#adminUserRows tr').filter({ hasText: 'alice@example.invalid' })).toContainText('US$0.400000');
  await expect(page.locator('#adminUsageRows tr')).toHaveCount(2);
  await expect(page.locator('#adminTokenRows tr')).toHaveCount(2);
  const tokens = page.locator('#adminTokenRows tr').filter({ hasText: 'alice@example.invalid' });
  await expect(tokens.locator('td').nth(1)).toHaveText('1,240');
  await expect(tokens.locator('td').nth(2)).toHaveText('8');
  await expect(tokens.locator('td').nth(3)).toHaveText('2026-11-10');
  await page.locator('#adminPeriod').selectOption('all');
  await expect(page.locator('#adminCalls')).toHaveText('3');
  await page.locator('#adminKind').selectOption('transcription');
  await expect(page.locator('#adminCalls')).toHaveText('1');
  await expect(page.locator('#adminUsageRows')).toContainText('test-audio');
  await page.locator('#adminUserFilter').selectOption('user-a');
  await expect(page.locator('#adminCalls')).toHaveText('0');
  await expect(page.locator('#adminUsageRows')).toContainText('No usage records');
  await page.locator('#adminKind').selectOption('all');
  await expect(page.locator('#adminCalls')).toHaveText('2');
  await expect(page.locator('#adminUserRows tr')).toHaveCount(1);
  await expect(page.locator('#adminTokenRows tr')).toHaveCount(1);
  await expect(page.locator('#adminTokenRows')).toContainText('alice@example.invalid');
  await page.locator('#adminPeriod').selectOption('7');
  await expect(page.locator('#adminCalls')).toHaveText('1');
  await page.locator('#adminPeriod').selectOption('30');
  await expect(page.locator('#adminCalls')).toHaveText('1');
});

test('non-admin receives access denied with no usage data', async ({ signedInPage: page, sandbox }) => {
  sandbox.mockRpc('admin_list_ai_usage', { code: '42501', message: 'permission denied' }, 403);
  // Expected denied RPC status; application must hide all administrative data.
  sandbox.allowConsoleError(/^Failed to load resource:.*(?:403|Forbidden)/);
  await page.goto('/admin');
  await expect(page.locator('#adminStatus')).toHaveText('沒有權限');
  await expect(page.locator('#adminData')).not.toBeVisible();
  await expect(page.locator('#adminUserRows tr')).toHaveCount(0);
  await expect(page.locator('#adminUsageRows tr')).toHaveCount(0);
  await expect(page.locator('#adminTokenRows tr')).toHaveCount(0);
});

test('denied token permissions hide usage and token data even if usage RPC succeeded', async ({ signedInPage: page, sandbox }) => {
  sandbox.mockRpc('admin_list_ai_usage', records);
  sandbox.mockRpc('admin_list_tokens', { code: '42501', message: 'permission denied' }, 403);
  sandbox.allowConsoleError(/^Failed to load resource:.*(?:403|Forbidden)/);
  await page.goto('/admin');
  await expect(page.locator('#adminStatus')).toHaveText('沒有權限');
  await expect(page.locator('#adminData')).not.toBeVisible();
  await expect(page.locator('#adminTokenRows tr')).toHaveCount(0);
  await expect(page.locator('#adminUsageRows tr')).toHaveCount(0);
});

test('guest admin page asks for sign-in without requesting usage', async ({ guestPage: page, sandbox }) => {
  await page.goto('/admin');
  await expect(page.locator('#adminStatus')).toHaveText('請先登入');
  await expect(page.locator('#adminSignIn')).toBeVisible();
  await expect(page.locator('#adminData')).not.toBeVisible();
  expect(sandbox.calls.filter(call => call.path.endsWith('/admin_list_ai_usage'))).toEqual([]);
  expect(sandbox.calls.filter(call => call.path.endsWith('/admin_list_tokens'))).toEqual([]);
});
