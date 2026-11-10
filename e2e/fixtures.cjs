const { test: base, expect } = require('@playwright/test');

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'speaker@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'Test Speaker' } };
const session = {
  access_token: `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, aud: 'authenticated' })).toString('base64url')}.fake-signature`,
  refresh_token: 'fake-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user,
};

const test = base.extend({
  sandbox: [async ({ context }, use) => {
    // KNOWN ISSUE: I18n's MutationObserver translates detached text nodes after
    // a rerender; parentElement is null. Keep other browser errors fatal.
    const unexpected = [], errors = [], allowedErrors = [
      /^Failed to execute 'createTreeWalker' on 'Document': parameter 1 is not of type 'Node'\.$/,
      /^Argument 1 \('root'\) to Document.createTreeWalker must be an instance of Node$/,
    ];
    const api = new Map(), rpc = new Map(), calls = [];
    const watch = page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    };
    context.on('page', watch);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const json = (body, status = 200) => route.fulfill({ status, json: body });
      if (url.hostname === 'cdn.jsdelivr.net' && url.pathname === '/npm/@supabase/supabase-js@2') return route.continue();
      if (url.hostname.endsWith('.supabase.co')) {
        calls.push({ path: url.pathname, body: route.request().postData() });
        if (url.pathname === '/auth/v1/user') return json(user);
        if (url.pathname === '/auth/v1/token') return json(session);
        if (url.pathname === '/auth/v1/logout') return json({});
        if (url.pathname.startsWith('/rest/v1/rpc/')) {
          const entry = rpc.get(url.pathname.split('/').pop());
          if (entry) return json(entry.body, entry.status);
        }
        unexpected.push(`Unmocked Supabase route: ${url.pathname}`);
        return json({ message: 'Unmocked test route' }, 500);
      }
      if (url.hostname === '127.0.0.1') {
        if (!url.pathname.startsWith('/api/')) {
          if (route.request().resourceType() === 'document') {
            const response = await route.fetch();
            // Cosmetic fonts are unnecessary for functional tests. Remove the links
            // before parsing, so no Google request is issued or silently allowed.
            const body = (await response.text()).replace(/<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '');
            return route.fulfill({ response, body });
          }
          return route.continue();
        }
        calls.push({ path: url.pathname, body: route.request().postData() });
        const entry = api.get(url.pathname);
        if (entry) {
          const result = typeof entry === 'function' ? await entry(route.request()) : entry;
          return json(result.body, result.status);
        }
      }
      unexpected.push(`Unmocked request: ${url.origin}${url.pathname}`);
      return json({ message: 'External network disabled' }, 500);
    });
    const sandbox = {
      calls,
      mockApi(name, body, status = 200) { api.set(`/api/ai/${name}`, { body, status }); },
      handleApi(name, handler) { api.set(`/api/ai/${name}`, handler); },
      mockRpc(name, body, status = 200) { rpc.set(name, { body, status }); },
      allowConsoleError(pattern) { allowedErrors.push(pattern); },
    };
    sandbox.mockApi('balance', { spent: 0, credit: 1, balance: 1, exhausted: false });
    await context.addInitScript(() => {
      window.SUPABASE_CONFIG = { url: 'https://e2e.supabase.co', anonKey: 'fake-publishable-key' };
    });
    await use(sandbox);
    for (const page of context.pages()) {
      if (!page.isClosed() && page.url().startsWith('http://127.0.0.1')) {
        const text = await page.locator('body').innerText();
        expect(text, 'Visible text must not contain undecoded HTML entities').not.toMatch(/&(?:amp|lt|gt|quot|#39|#x27);/i);
      }
    }
    expect(unexpected, 'All external and API requests must be explicitly mocked').toEqual([]);
    expect(errors.filter(error => !allowedErrors.some(pattern => pattern.test(error))), 'No unexpected console or page errors').toEqual([]);
  }, { auto: true }],
  guestPage: async ({ page, sandbox }, use) => {
    await page.goto('/');
    await expect(page.locator('#suggestions button')).toHaveCount(5);
    await expect.poll(() => page.evaluate(() => Boolean(window.tableTopicsCloud?.isSignedIn()))).toBe(false);
    await use(page);
  },
  signedInPage: async ({ page, context, sandbox }, use) => {
    await context.addInitScript(value => {
      localStorage.setItem('sb-e2e-auth-token', JSON.stringify(value));
    }, session);
    await page.goto('/');
    await expect(page.locator('#suggestions button')).toHaveCount(5);
    await expect.poll(() => page.evaluate(() => window.tableTopicsCloud?.isSignedIn())).toBe(true);
    await use(page);
  },
});

module.exports = { test, expect };
