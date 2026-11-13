const { createServerTiming } = require('./server-timing.js');
const { createRpc } = require('./supabase-rpc.js');
const defaults = require('./supabase-defaults.js');
const { validateIssueDraft } = require('../../public/feedback-issue-draft.js');
class FeedbackIssueError extends Error {
  constructor(code, status) { super(code); this.status = status; }
}

async function handleFeedbackIssue({ request, env, fetch, logger = console }) {
  const timing = createServerTiming(['reserve', 'github', 'record', 'cancel']);
  if (request.method !== 'POST') return timing.json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [^\s]+$/i.test(authorization)) return timing.json({ error: 'unauthorized' }, 401);
  const baseUrl = env.SUPABASE_URL ?? defaults.url, key = env.SUPABASE_PUBLISHABLE_KEY ?? defaults.anonKey;
  if (typeof baseUrl !== 'string' || !baseUrl.trim() || typeof key !== 'string' || !key.trim()) return timing.json({ error: 'configuration_error' }, 503);
  const rpc = createRpc({ fetch, baseUrl: baseUrl.replace(/\/+$/, ''), headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json' },
    reasons: ['feedback_not_found', 'feedback_issue_pending', 'feedback_issue_exists', 'feedback_issue_token_mismatch'] });
  let body;
  try { body = await request.json(); } catch { return timing.json({ error: 'invalid_input' }, 400); }
  if (!body || Array.isArray(body) || !(typeof body.id === 'number' && Number.isSafeInteger(body.id) && body.id > 0
    || typeof body.id === 'string' && /^[1-9]\d{0,18}$/.test(body.id) && BigInt(body.id) <= 9223372036854775807n)) return timing.json({ error: 'invalid_input' }, 400);
  let pending;
  try { pending = await timing.measure('reserve', async () => (await rpc('admin_begin_issue', { p_id: body.id })).json()); }
  catch (error) {
    if (error?.rpcCode === '42501') return timing.json({ error: 'forbidden' }, 403);
    if (error?.unauthorized) return timing.json({ error: 'unauthorized' }, 401);
    if (error?.reason) return timing.json({ error: error.reason }, error.reason === 'feedback_not_found' ? 400 : 409);
    return timing.json({ error: 'feedback_unavailable' }, 503);
  }
  const repo = env.GITHUB_ISSUES_REPO ?? 'darren1231/table_topic_web';
  const api = `https://api.github.com/repos/${repo}`;
  const github = (url, method = 'GET', data) => fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${env.GITHUB_ISSUES_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'table-topic-feedback', 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  try {
    const fail = (code, status) => { throw new FeedbackIssueError(code, status); };
    if (!pending || String(pending.id) !== String(body.id) || typeof pending.email !== 'string'
      || typeof pending.issue_pending_token !== 'string' || !/^[0-9a-f-]{36}$/i.test(pending.issue_pending_token)
      || typeof pending.created_at !== 'string' || !Number.isFinite(Date.parse(pending.created_at))) fail('feedback_unavailable', 503);
    if (typeof env.GITHUB_ISSUES_TOKEN !== 'string' || !env.GITHUB_ISSUES_TOKEN.trim()) fail('github_not_configured', 503);
    if (typeof repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || ['.', '..'].includes(repo.split('/')[1])) fail('configuration_error', 503);
    const invalid = validateIssueDraft(body, pending.email);
    if (invalid) fail(invalid, 400);
    const marker = `<!-- table-topic-feedback:${body.id} -->`;
    let found, reused = false;
    await timing.measure('github', async () => {
      for (let page = 1; page <= 5; page++) {
        const search = await github(`${api}/issues?state=all&since=${encodeURIComponent(pending.created_at)}&per_page=100&page=${page}`);
        if (!search.ok) throw new Error('github_error');
        const items = await search.json();
        if (!Array.isArray(items)) throw new Error('github_error');
        found = items.find(item => item && !item.pull_request && typeof item.body === 'string' && item.body.includes(marker));
        if (found || items.length < 100) break;
      }
      reused = Boolean(found);
      if (!found) {
        for (const label of body.labels) {
          const existing = await github(`${api}/labels/${encodeURIComponent(label)}`);
          if (existing.status === 404) {
            const created = await github(`${api}/labels`, 'POST', { name: label, color: 'd4c5f9' });
            if (!created.ok && !(created.status === 422 && (await github(`${api}/labels/${encodeURIComponent(label)}`)).ok)) throw new Error('github_error');
          } else if (!existing.ok) throw new Error('github_error');
        }
        const created = await github(`${api}/issues`, 'POST', { title: body.title, body: `${body.body}\n\n${marker}`, labels: body.labels });
        if (!created.ok) throw new Error('github_error');
        found = await created.json();
      }
    });
    if (!Number.isInteger(found?.number) || found.number <= 0 || found.number > 2147483647 || typeof found.html_url !== 'string'
      || found.html_url.toLowerCase() !== `https://github.com/${repo}/issues/${found.number}`.toLowerCase()) throw new Error('github_error');
    try { await timing.measure('record', () => rpc('admin_finish_issue', { p_id: body.id, p_token: pending.issue_pending_token, p_number: found.number, p_url: found.html_url })); }
    catch (error) { fail(error?.reason === 'feedback_issue_token_mismatch' ? 'feedback_issue_token_mismatch' : 'issue_record_failed', error?.reason === 'feedback_issue_token_mismatch' ? 409 : 503); }
    return timing.json({ number: found.number, url: found.html_url, reused });
  } catch (error) {
    try { await timing.measure('cancel', () => rpc('admin_cancel_issue', { p_id: body.id, p_token: pending?.issue_pending_token })); }
    catch { logger.error('Feedback issue reservation release failed'); }
    return error instanceof FeedbackIssueError ? timing.json({ error: error.message }, error.status) : timing.json({ error: 'github_error' }, 502);
  }
}
module.exports = { handleFeedbackIssue };
