(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./usage-stats.js'), require('./admin-feedback.js'));
  else {
    const api = factory(root.UsageStats, root.AdminFeedbackUI);
    root.AdminUI = api;
    root.I18n.ready.then(async () => {
      const select = document.getElementById('adminLanguage');
      const stored = root.localStorage.getItem('tableTopicsLanguage.v1');
      select.value = root.I18n.supportedLocales.includes(stored) ? stored : 'zh-TW';
      const setLocale = locale => {
        root.I18n.setLocale(locale);
        document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
        root.localStorage.setItem('tableTopicsLanguage.v1', locale);
      };
      setLocale(select.value);
      let client = null;
      const config = root.SUPABASE_CONFIG || {};
      try { if (config.url && config.anonKey && root.supabase?.createClient) client = root.supabase.createClient(config.url, config.anonKey); } catch {}
      const controller = api.createAdminController({ client, document, t: (key, values) => root.I18n.translate(key, values),
        getLocale: () => select.value, onLocaleChange: setLocale, redirectTo: `${root.location.origin}${root.location.pathname}` });
      await controller.initialize();
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (UsageStats, AdminFeedbackUI) {
  function createAdminController({ client, document, t, getLocale = () => 'zh-TW', onLocaleChange = () => {},
    now = () => new Date(), schedule = fn => setTimeout(fn, 0), redirectTo }) {
    const byId = id => document.getElementById(id);
    let records = [], tokenRecords = [], session = null, authorized = false, version = 0, statusKey = 'admin.signInRequired';
    const feedback = AdminFeedbackUI.createFeedbackAdmin({ client, document, t, getLocale, onDenied: loadError });
    const money = value => `US$${Number(value).toFixed(6)}`;
    const number = value => new Intl.NumberFormat(getLocale()).format(value);
    const dateText = value => {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toLocaleString(getLocale()) : '—';
    };
    const kindKeys = { agent: 'admin.agent', analysis: 'admin.analysis', questions: 'admin.questions', polish: 'admin.polish', transcription: 'admin.transcription' };
    const option = (value, text) => { const node = document.createElement('option'); node.value = value; node.textContent = text; return node; };
    function row(values) {
      const node = document.createElement('tr');
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = String(value); node.append(cell); }
      return node;
    }
    function labels() {
      document.title = t('admin.title');
      byId('adminLanguage').setAttribute('aria-label', t('admin.language'));
      document.querySelectorAll('[data-admin-i18n]').forEach(node => { node.textContent = t(node.dataset.adminI18n); });
    }
    function buttons() {
      byId('adminSignIn').classList.toggle('hidden', Boolean(session?.user));
      byId('adminSignOut').classList.toggle('hidden', !session?.user);
    }
    function deny(key = statusKey) {
      statusKey = key;
      authorized = false; records = []; tokenRecords = [];
      feedback.clear();
      byId('adminData').classList.add('hidden');
      byId('adminStatus').textContent = t(statusKey);
      byId('adminUserRows').replaceChildren();
      byId('adminUsageRows').replaceChildren();
      byId('adminTokenRows').replaceChildren();
      byId('adminUserFilter').replaceChildren(option('all', t('admin.allUsers')));
      byId('adminUserFilter').value = 'all';
      for (const id of ['adminCalls', 'adminInputTokens', 'adminOutputTokens', 'adminCost', 'adminAudioSeconds']) byId(id).textContent = '0';
    }
    function loadError(error) {
      if (error?.code === '42501') return deny('admin.denied');
      const clean = value => {
        let text = typeof value === 'string' ? value : '';
        for (const token of [session?.access_token, session?.refresh_token]) {
          if (token) text = text.split(token).join('[redacted]');
        }
        return text.replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, '[redacted]');
      };
      console.error('Admin usage load failed', { code: clean(error?.code), message: clean(error?.message) });
      deny('admin.loadFailed');
    }
    function userOptions() {
      const select = byId('adminUserFilter'), selected = select.value;
      const groups = UsageStats.groupByUser(records);
      for (const item of tokenRecords) if (!groups.some(group => group.userId === item.user_id)) groups.push({ userId: item.user_id, email: item.email || '' });
      select.replaceChildren(option('all', t('admin.allUsers')), ...groups.map(group => option(group.userId, group.email)));
      select.value = groups.some(group => group.userId === selected) ? selected : 'all';
    }
    function render() {
      labels();
      if (!authorized) return deny();
      byId('adminStatus').textContent = '';
      byId('adminData').classList.remove('hidden');
      const user = byId('adminUserFilter').value || 'all';
      const filtered = UsageStats.filterRecords(records, { period: byId('adminPeriod').value || 'month',
        kind: byId('adminKind').value || 'all', userId: user, now: now() });
      const totals = UsageStats.summarize(filtered);
      byId('adminCalls').textContent = number(totals.calls);
      byId('adminInputTokens').textContent = number(totals.inputTokens);
      byId('adminOutputTokens').textContent = number(totals.outputTokens);
      byId('adminCost').textContent = money(totals.totalCost);
      byId('adminAudioSeconds').textContent = number(totals.audioSeconds);
      const groups = UsageStats.groupByUser(records).filter(group => user === 'all' || group.userId === user);
      byId('adminUserRows').replaceChildren(...groups.map(group => row([group.email, number(group.calls), money(group.spent), dateText(group.lastUsedAt)])));
      const details = filtered.map(item => {
        const total = UsageStats.summarize([item]);
        return row([dateText(item.created_at), item.email || '', t(kindKeys[item.kind] || 'admin.agent'), item.model || '',
          number(total.inputTokens), number(total.outputTokens), number(total.audioSeconds), money(total.totalCost),
          t(item.status === 'success' ? 'admin.success' : 'admin.failed')]);
      });
      if (!details.length) { const node = row([t('admin.noRecords')]); node.children[0].colSpan = 9; details.push(node); }
      byId('adminUsageRows').replaceChildren(...details);
      const tokenNumber = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? number(Number(value)) : '—';
      const tokenRows = tokenRecords.filter(item => user === 'all' || item.user_id === user).map(item => row([
        item.email || '', tokenNumber(item.balance), tokenNumber(item.streak),
        typeof item.last_check_in === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.last_check_in) ? item.last_check_in : '—',
      ]));
      if (!tokenRows.length) { const node = row([t('admin.noTokenRecords')]); node.children[0].colSpan = 4; tokenRows.push(node); }
      byId('adminTokenRows').replaceChildren(...tokenRows);
      feedback.render();
    }
    async function loadSession(nextSession) {
      const ticket = ++version;
      session = nextSession; deny(session?.user ? 'admin.loadFailed' : 'admin.signInRequired'); buttons();
      if (!client || !session?.user) return;
      try {
        const { data, error } = await client.rpc('admin_list_ai_usage');
        if (ticket !== version) return;
        if (error || !Array.isArray(data)) return loadError(error || { code: 'INVALID_RESPONSE', message: 'Expected usage records' });
        const tokens = await client.rpc('admin_list_tokens');
        if (ticket !== version) return;
        if (tokens.error || !Array.isArray(tokens.data)) return loadError(tokens.error || { code: 'INVALID_RESPONSE', message: 'Expected token records' });
        const feedbackRows = await client.rpc('admin_list_feedback');
        if (ticket !== version) return;
        if (feedbackRows.error || !Array.isArray(feedbackRows.data)) return loadError(feedbackRows.error || { code: 'INVALID_RESPONSE', message: 'Expected feedback records' });
        records = data; tokenRecords = tokens.data; authorized = true; feedback.setRecords(feedbackRows.data); userOptions(); render();
      } catch (error) { if (ticket === version) loadError(error); }
    }
    async function refresh() {
      const ticket = ++version;
      deny();
      try {
        const { data, error } = await client.auth.getSession();
        if (ticket !== version) return;
        if (error) return loadError(error);
        return loadSession(data?.session || null);
      } catch (error) { if (ticket === version) { loadError(error); session = null; buttons(); } }
    }
    async function signIn() {
      try {
        const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
        if (error) loadError(error);
      } catch (error) { loadError(error); }
    }
    async function signOut() {
      version++; session = null; deny('admin.signInRequired'); buttons();
      try { await client.auth.signOut(); } catch {}
    }
    async function initialize() {
      feedback.initialize();
      labels(); deny(); buttons();
      byId('adminPeriod').value ||= 'month'; byId('adminKind').value ||= 'all';
      for (const id of ['adminPeriod', 'adminKind', 'adminUserFilter']) byId(id).onchange = render;
      byId('adminSignIn').onclick = signIn; byId('adminSignOut').onclick = signOut; byId('adminRefresh').onclick = refresh;
      byId('adminLanguage').onchange = () => { onLocaleChange(byId('adminLanguage').value); if (authorized) userOptions(); render(); };
      if (client) client.auth.onAuthStateChange((event, nextSession) => {
        const ticket = ++version; session = nextSession; deny(session?.user ? 'admin.loadFailed' : 'admin.signInRequired'); buttons();
        // Keep RPC calls outside Supabase's auth callback lock.
        return schedule(() => { if (ticket === version) return loadSession(nextSession); });
      });
      await refresh();
    }
    return { initialize, refresh, render, signIn, signOut };
  }
  return { createAdminController };
});
