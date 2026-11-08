(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./usage-stats.js'));
  else {
    const api = factory(root.UsageStats);
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
})(typeof globalThis !== 'undefined' ? globalThis : this, function (UsageStats) {
  function createAdminController({ client, document, t, getLocale = () => 'zh-TW', onLocaleChange = () => {},
    now = () => new Date(), schedule = fn => setTimeout(fn, 0), redirectTo }) {
    const byId = id => document.getElementById(id);
    let records = [], session = null, authorized = false, version = 0;
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
    function deny() {
      authorized = false; records = [];
      byId('adminData').classList.add('hidden');
      byId('adminStatus').textContent = t('admin.denied');
      byId('adminUserRows').replaceChildren();
      byId('adminUsageRows').replaceChildren();
      byId('adminUserFilter').replaceChildren(option('all', t('admin.allUsers')));
      byId('adminUserFilter').value = 'all';
      for (const id of ['adminCalls', 'adminInputTokens', 'adminOutputTokens', 'adminCost', 'adminAudioSeconds']) byId(id).textContent = '0';
    }
    function userOptions() {
      const select = byId('adminUserFilter'), selected = select.value;
      const groups = UsageStats.groupByUser(records);
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
    }
    async function loadSession(nextSession) {
      const ticket = ++version;
      session = nextSession; deny(); buttons();
      if (!client || !session?.user) return;
      try {
        const { data, error } = await client.rpc('admin_list_ai_usage');
        if (ticket !== version) return;
        if (error || !Array.isArray(data)) return deny();
        records = data; authorized = true; userOptions(); render();
      } catch { if (ticket === version) deny(); }
    }
    async function refresh() {
      const ticket = ++version;
      deny();
      try {
        const { data, error } = await client.auth.getSession();
        if (ticket !== version) return;
        return loadSession(error ? null : data?.session || null);
      } catch { if (ticket === version) { session = null; deny(); buttons(); } }
    }
    async function signIn() {
      try {
        const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
        if (error) deny();
      } catch { deny(); }
    }
    async function signOut() {
      version++; session = null; deny(); buttons();
      try { await client.auth.signOut(); } catch {}
    }
    async function initialize() {
      labels(); deny(); buttons();
      byId('adminPeriod').value ||= 'month'; byId('adminKind').value ||= 'all';
      for (const id of ['adminPeriod', 'adminKind', 'adminUserFilter']) byId(id).onchange = render;
      byId('adminSignIn').onclick = signIn; byId('adminSignOut').onclick = signOut; byId('adminRefresh').onclick = refresh;
      byId('adminLanguage').onchange = () => { onLocaleChange(byId('adminLanguage').value); if (authorized) userOptions(); render(); };
      if (client) client.auth.onAuthStateChange((event, nextSession) => {
        const ticket = ++version; session = nextSession; deny(); buttons();
        // Keep RPC calls outside Supabase's auth callback lock.
        return schedule(() => { if (ticket === version) return loadSession(nextSession); });
      });
      await refresh();
    }
    return { initialize, refresh, render, signIn, signOut };
  }
  return { createAdminController };
});
