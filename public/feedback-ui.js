(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedbackUI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createFeedbackController({ client, document, t, getLocale, getContext, onSignIn, schedule = fn => setTimeout(fn, 0) }) {
    const byId = id => document.getElementById(id);
    let session = null, rows = [], messageKey = '', listKey = '', busy = false, version = 0;
    const typeKeys = { bug: 'feedback.bug', suggestion: 'feedback.suggestion', other: 'feedback.other' };
    const statusKeys = { received: 'feedback.received', in_progress: 'feedback.inProgress', done: 'feedback.done', declined: 'feedback.declined' };
    function count() { byId('feedbackCount').textContent = `${Array.from(byId('feedbackDescription').value).length}/2000`; }
    function reset() {
      byId('feedbackDescription').value = ''; byId('feedbackType').value = 'bug'; byId('feedbackIncludeContext').checked = true; count();
    }
    function render() {
      const labels = { feedbackMenuLabel: 'title', feedbackTitle: 'title', feedbackTypeLabel: 'type', feedbackBug: 'bug',
        feedbackSuggestion: 'suggestion', feedbackOther: 'other', feedbackDescriptionLabel: 'description',
        feedbackContextLabel: 'includeContext', feedbackContextHint: 'contextHint', feedbackMineTitle: 'mine', feedbackSignIn: 'signIn' };
      for (const [id, key] of Object.entries(labels)) byId(id).textContent = t(`feedback.${key}`);
      byId('feedbackClose').setAttribute('aria-label', t('feedback.close'));
      byId('feedbackSubmit').textContent = t(busy ? 'feedback.sending' : 'feedback.submit');
      byId('feedbackMessage').textContent = session?.user ? (messageKey ? t(messageKey) : '') : t('feedback.signInRequired');
      byId('feedbackSubmit').disabled = !session?.user || busy;
      byId('feedbackSignIn').classList.toggle('hidden', Boolean(session?.user) && messageKey !== 'feedback.signInRequired');
      byId('feedbackListMessage').textContent = session?.user && (listKey || !rows.length) ? t(listKey || 'feedback.empty') : '';
      const nodes = rows.map(item => {
        const node = document.createElement('article'); node.className = 'feedback-item';
        const heading = document.createElement('strong'), status = document.createElement('span'), date = document.createElement('small'), message = document.createElement('p');
        heading.textContent = `#${String(item.id)} · ${t(typeKeys[item.type] || 'feedback.other')}`;
        status.textContent = t(statusKeys[item.public_status] || 'feedback.received');
        const time = new Date(item.created_at); date.textContent = Number.isFinite(time.getTime()) ? time.toLocaleString(getLocale()) : '—';
        message.textContent = String(item.message ?? '');
        node.append(heading, status, date, message); return node;
      });
      byId('feedbackList').replaceChildren(...nodes); count();
    }
    async function readSession() {
      const result = await client?.auth.getSession();
      if (result?.error) throw result.error;
      const nextSession = result?.data?.session || null;
      if (session?.user?.id !== nextSession?.user?.id) { version++; rows = []; messageKey = ''; listKey = ''; busy = false; reset(); }
      session = nextSession;
    }
    async function load() {
      if (!session?.user) return;
      const ticket = version;
      listKey = 'feedback.loading'; render();
      try {
        const result = await client.rpc('get_my_feedback');
        if (ticket !== version) return;
        if (result.error || !Array.isArray(result.data)) throw result.error || new Error('Invalid feedback list');
        rows = result.data; listKey = '';
      } catch { if (ticket === version) { rows = []; listKey = 'feedback.loadFailed'; } }
      if (ticket === version) render();
    }
    async function open() {
      try { await readSession(); } catch { session = null; rows = []; }
      messageKey = '';
      render(); byId('feedbackDialog').showModal();
      await load();
    }
    async function submit() {
      if (busy) return;
      busy = true; render();
      try { await readSession(); } catch { busy = false; messageKey = 'feedback.networkError'; render(); return; }
      if (!session?.user) { busy = false; render(); return; }
      const description = byId('feedbackDescription').value, type = byId('feedbackType').value;
      if (!Object.hasOwn(typeKeys, type) || !description.trim() || Array.from(description).length > 2000) {
        busy = false; messageKey = 'feedback.invalidInput'; render(); return;
      }
      const ticket = version;
      busy = true; messageKey = ''; render();
      try {
        let context = null;
        if (byId('feedbackIncludeContext').checked) {
          const source = getContext(); context = {};
          for (const key of ['view', 'userAgent', 'language', 'appVersion', 'submittedAt']) context[key] = Array.from(String(source[key] ?? '')).slice(0, 300).join('');
        }
        const result = await client.rpc('submit_feedback', { p_type: type, p_message: description, p_context: context });
        if (ticket !== version) return;
        if (result.error) throw result.error;
        messageKey = 'feedback.thanks'; reset(); await load();
      } catch (error) {
        if (ticket === version) messageKey = error?.code === 'P0001' && error?.message === 'feedback_daily_limit' ? 'feedback.dailyLimit'
          : error?.code === '22023' ? 'feedback.invalidInput'
          : ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error?.code) ? 'feedback.signInRequired' : 'feedback.networkError';
      } finally { if (ticket === version) { busy = false; render(); } }
    }
    function initialize() {
      byId('feedbackButton').onclick = open;
      byId('feedbackClose').onclick = () => byId('feedbackDialog').close();
      byId('feedbackSignIn').onclick = () => { byId('feedbackDialog').close(); onSignIn(); };
      byId('feedbackForm').onsubmit = event => { event.preventDefault(); return submit(); };
      byId('feedbackDescription').oninput = count;
      client?.auth.onAuthStateChange((event, nextSession) => {
        if (session?.user?.id !== nextSession?.user?.id) { version++; rows = []; messageKey = ''; listKey = ''; busy = false; reset(); }
        session = nextSession;
        return schedule(() => { render(); if (byId('feedbackDialog').open) return load(); });
      });
      reset();
      render();
    }
    return { initialize, open, submit, render };
  }
  return { createFeedbackController };
});
