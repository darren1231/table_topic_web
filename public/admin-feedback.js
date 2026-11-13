(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./feedback-issue-draft.js'));
  else root.AdminFeedbackUI = factory(root.FeedbackIssueDraft);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (IssueDraft) {
  function createFeedbackAdmin({ client, document, t, getLocale, onDenied, fetch = globalThis.fetch }) {
    const byId = id => document.getElementById(id);
    const priorities = { urgent: 'adminFeedback.urgent', normal: 'adminFeedback.normal', later: 'adminFeedback.later' };
    const types = { bug: 'feedback.bug', suggestion: 'feedback.suggestion', other: 'feedback.other' };
    const statuses = { new: 'adminFeedback.new', triaged: 'adminFeedback.triaged', issue_created: 'adminFeedback.issueCreated', done: 'adminFeedback.done', wont_fix: 'adminFeedback.declined' };
    let records = [], currentId = null, noteId = null, authorized = false, busy = false, revision = 0, messageKey = '';
    const selectedIds = new Set();
    let draftId = null, issueBusy = false, issueMessage = '', labelNodes = [];
    const actions = { Urgent: ['urgent', null], Normal: ['normal', null], Later: ['later', null], Decline: [null, 'wont_fix'], Done: [null, 'done'] };
    const cell = text => { const node = document.createElement('td'); node.textContent = text; return node; };
    function buttons() {
      for (const action of Object.keys(actions)) byId(`adminFeedback${action}`).disabled = !authorized || busy || !selectedIds.size;
      byId('adminFeedbackSaveNote').disabled = !authorized || busy || currentId === null;
      byId('adminFeedbackNote').disabled = busy;
      byId('adminFeedbackMessage').textContent = messageKey ? t(messageKey) : '';
    }
    function filters() {
      for (const [id, values] of [['Status', statuses], ['Type', types], ['Priority', { none: 'adminFeedback.unclassified', ...priorities }]]) {
        const select = byId(`adminFeedback${id}`), current = select.value || 'all';
        const options = Object.entries({ all: 'adminFeedback.all', ...values }).map(([value, key]) => {
          const node = document.createElement('option'); node.value = value; node.textContent = t(key); return node;
        });
        select.replaceChildren(...options); select.value = current;
      }
    }
    function detail() {
      const item = records.find(record => String(record.id) === currentId);
      byId('adminFeedbackDetail').classList.toggle('hidden', !item);
      byId('adminFeedbackBody').textContent = item ? String(item.message ?? '') : '';
      if (noteId !== currentId || !item) byId('adminFeedbackNote').value = item?.admin_note || '';
      noteId = currentId;
      byId('adminFeedbackDetailTitle').textContent = item ? `#${item.id} · ${String(item.email ?? '')}` : '';
      byId('adminFeedbackDetailStatus').textContent = item ? t(statuses[item.status] || 'adminFeedback.new') : '';
      byId('adminFeedbackIssue').disabled = !authorized || busy || !item || Boolean(item.issue_number);
      byId('adminFeedbackIssueHint').textContent = t(item?.issue_number ? 'feedbackIssue.alreadyCreated' : 'feedbackIssue.openHint');
      byId('adminFeedbackContext').replaceChildren();
      if (item?.context) for (const key of ['view', 'userAgent', 'language', 'appVersion', 'submittedAt']) {
        if (typeof item.context[key] !== 'string') continue;
        const label = document.createElement('dt'), value = document.createElement('dd');
        label.textContent = t(`adminFeedback.${key}`); value.textContent = item.context[key];
        byId('adminFeedbackContext').append(label, value);
      }
      buttons();
    }
    function render() {
      filters();
      const status = byId('adminFeedbackStatus').value, type = byId('adminFeedbackType').value, priority = byId('adminFeedbackPriority').value;
      const filtered = records.filter(item => (status === 'all' || item.status === status) && (type === 'all' || item.type === type)
        && (priority === 'all' || (priority === 'none' ? item.priority === null : item.priority === priority)));
      const rows = filtered.map(item => {
        const row = document.createElement('tr'), selected = cell(''), checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label', `${t('adminFeedback.select')} #${item.id}`); selected.append(checkbox);
        checkbox.checked = selectedIds.has(String(item.id)); checkbox.disabled = busy;
        checkbox.onchange = () => { if (checkbox.checked) selectedIds.add(String(item.id)); else selectedIds.delete(String(item.id)); buttons(); };
        const summary = cell(''), button = document.createElement('button'); button.type = 'button'; button.className = 'text-button';
        button.textContent = Array.from(String(item.message ?? '')).slice(0, 40).join('');
        button.onclick = () => { currentId = String(item.id); detail(); }; summary.append(button);
        const date = new Date(item.created_at), dateText = Number.isFinite(date.getTime()) ? date.toLocaleString(getLocale()) : '—';
        row.append(selected, cell(`#${item.id}`), cell(t(priorities[item.priority] || 'adminFeedback.unclassified')), cell(t(types[item.type] || 'feedback.other')),
          summary, cell(dateText), cell(String(item.email ?? '')), issueLink(item));
        return row;
      });
      if (authorized && !rows.length) { const row = document.createElement('tr'), empty = cell(t('adminFeedback.empty')); empty.colSpan = 8; row.append(empty); rows.push(row); }
      byId('adminFeedbackRows').replaceChildren(...rows); detail(); renderIssue();
    }
    function issueLink(item) {
      const node = cell('—'), value = item.issue_url;
      if (typeof value !== 'string' || !value.startsWith('https://github.com/') || /[\\\s]/.test(value)) return node;
      try { if (new URL(value).origin !== 'https://github.com') return node; } catch { return node; }
      const link = document.createElement('a'); link.setAttribute('href', value); link.setAttribute('rel', 'noopener noreferrer');
      link.setAttribute('target', '_blank'); link.textContent = item.issue_number ? `#${item.issue_number}` : t('adminFeedback.issue');
      node.textContent = ''; node.append(link); return node;
    }
    function setRecords(next) { records = next; authorized = true; selectedIds.clear(); noteId = null; render(); }
    function clear() {
      draftId = null; issueMessage = ''; issueBusy = false; labelNodes = []; byId('feedbackIssueDialog').close();
      byId('feedbackIssueTitleInput').value = ''; byId('feedbackIssueBodyInput').value = ''; byId('feedbackIssueLabels').replaceChildren();
      revision++; authorized = false; busy = false; records = []; selectedIds.clear(); currentId = null; noteId = null; messageKey = ''; render();
    }
    function labelText(value) {
      const typeKeys = { feedback: 'feedback.title', bug: 'feedback.bug', enhancement: 'feedback.suggestion', question: 'feedback.other' };
      return typeKeys[value] ? t(typeKeys[value]) : `${t('adminFeedback.priority')}：${t(priorities[value.split(': ')[1]])}`;
    }
    function renderIssue() {
      byId('feedbackIssueClose').textContent = '×'; byId('feedbackIssueClose').setAttribute('aria-label', t('feedbackIssue.close'));
      byId('feedbackIssueSubmit').textContent = t(issueBusy ? 'feedbackIssue.creating' : 'feedbackIssue.confirm');
      byId('feedbackIssueSubmit').disabled = !authorized || busy || draftId === null;
      byId('feedbackIssueClose').disabled = issueBusy;
      byId('feedbackIssueTitleInput').disabled = issueBusy; byId('feedbackIssueBodyInput').disabled = issueBusy;
      byId('feedbackIssueMessage').textContent = issueMessage ? t(issueMessage) : '';
      for (const { checkbox, span } of labelNodes) { checkbox.disabled = issueBusy; span.textContent = labelText(checkbox.value); }
    }
    function openIssue() {
      const item = records.find(record => String(record.id) === currentId);
      if (!authorized || busy || !item || item.issue_number) return;
      const draft = IssueDraft.buildIssueDraft(item, { t });
      draftId = currentId; issueMessage = '';
      byId('feedbackIssueTitleInput').value = draft.title; byId('feedbackIssueBodyInput').value = draft.body;
      labelNodes = IssueDraft.LABELS.map(value => {
        const label = document.createElement('label'), checkbox = document.createElement('input'), span = document.createElement('span');
        checkbox.type = 'checkbox'; checkbox.value = value; checkbox.checked = draft.labels.includes(value); label.append(checkbox, span);
        return { label, checkbox, span };
      });
      byId('feedbackIssueLabels').replaceChildren(...labelNodes.map(item => item.label)); renderIssue(); byId('feedbackIssueDialog').showModal();
    }
    async function createIssue() {
      if (!authorized || busy || draftId === null) return;
      const item = records.find(record => String(record.id) === draftId);
      if (!item) return;
      const draft = { id: item.id, title: byId('feedbackIssueTitleInput').value, body: byId('feedbackIssueBodyInput').value,
        labels: labelNodes.filter(item => item.checkbox.checked).map(item => item.checkbox.value) };
      const errorKeys = { invalid_title: 'invalidTitle', invalid_body: 'invalidBody', invalid_labels: 'invalidLabels', missing_disclaimer: 'missingDisclaimer',
        feedback_contains_email: 'containsEmail', reserved_issue_marker: 'reservedMarker', github_not_configured: 'notConfigured',
        configuration_error: 'notConfigured', feedback_issue_pending: 'pending', feedback_issue_exists: 'alreadyCreated',
        feedback_issue_token_mismatch: 'retry', issue_record_failed: 'retry', unauthorized: 'signInRequired' };
      const invalid = IssueDraft.validateIssueDraft(draft, item.email || '');
      if (invalid) { issueMessage = `feedbackIssue.${errorKeys[invalid]}`; renderIssue(); return; }
      const ticket = revision;
      busy = true; issueBusy = true; issueMessage = ''; render();
      let linked = false;
      try {
        const session = await client.auth.getSession();
        if (ticket !== revision) return;
        if (session.error || !session.data?.session?.user || !session.data.session.access_token) { issueMessage = 'feedbackIssue.signInRequired'; return; }
        const response = await fetch('/api/feedback/issue', { method: 'POST', headers: {
          Authorization: `Bearer ${session.data.session.access_token}`, 'Content-Type': 'application/json',
        }, body: JSON.stringify(draft) });
        if (ticket !== revision) return;
        const result = await response.json();
        if (ticket !== revision) return;
        if (response.status === 403) { clear(); onDenied({ code: '42501' }); return; }
        if (!response.ok) { issueMessage = `feedbackIssue.${errorKeys[result?.error] || 'failed'}`; return; }
        if (!Number.isInteger(result?.number) || result.number <= 0 || typeof result.reused !== 'boolean') throw new Error('Invalid issue result');
        byId('feedbackIssueDialog').close(); draftId = null;
        linked = true;
        messageKey = result.reused ? 'feedbackIssue.reused' : 'feedbackIssue.created';
        const refreshed = await client.rpc('admin_list_feedback');
        if (ticket !== revision) return;
        if (refreshed.error?.code === '42501') { clear(); onDenied(refreshed.error); return; }
        if (refreshed.error || !Array.isArray(refreshed.data)) { messageKey = 'adminFeedback.reloadFailed'; return; }
        setRecords(refreshed.data);
      } catch { if (ticket === revision) { if (linked) messageKey = 'adminFeedback.reloadFailed'; else issueMessage = 'feedbackIssue.failed'; } }
      finally { if (ticket === revision) { busy = false; issueBusy = false; render(); } }
    }
    async function update(ids, priority, status, note) {
      if (!authorized || busy || !ids.length) return;
      if (note !== null && Array.from(note).length > 2000) { messageKey = 'adminFeedback.invalidBatch'; buttons(); return; }
      const ticket = revision;
      busy = true; messageKey = ''; buttons();
      let saved = false;
      try {
        const result = await client.rpc('admin_update_feedback', { p_ids: ids, p_priority: priority, p_status: status, p_note: note });
        if (ticket !== revision) return;
        if (result.error) throw result.error;
        saved = true;
        const refreshed = await client.rpc('admin_list_feedback');
        if (ticket !== revision) return;
        if (refreshed.error || !Array.isArray(refreshed.data)) throw refreshed.error || new Error('Invalid feedback list');
        messageKey = 'adminFeedback.saved'; setRecords(refreshed.data);
      } catch (error) {
        if (ticket !== revision) return;
        if (error?.code === '42501') { clear(); onDenied(error); return; }
        messageKey = error?.message === 'feedback_not_found' ? 'adminFeedback.notFound'
          : error?.message === 'invalid_feedback_batch' ? 'adminFeedback.invalidBatch'
          : saved ? 'adminFeedback.reloadFailed' : 'adminFeedback.updateFailed';
      } finally { if (ticket === revision) { busy = false; render(); } }
    }
    function initialize() {
      byId('adminFeedbackIssue').onclick = openIssue;
      byId('feedbackIssueForm').onsubmit = event => { event.preventDefault(); return createIssue(); };
      byId('feedbackIssueClose').onclick = () => { if (!issueBusy) byId('feedbackIssueDialog').close(); };
      byId('feedbackIssueDialog').oncancel = event => { if (issueBusy) event.preventDefault(); };
      for (const id of ['Status', 'Type', 'Priority']) byId(`adminFeedback${id}`).onchange = () => { selectedIds.clear(); currentId = null; render(); };
      for (const [action, [priority, status]] of Object.entries(actions)) byId(`adminFeedback${action}`).onclick = () =>
        update(records.filter(item => selectedIds.has(String(item.id))).map(item => item.id), priority, status, null);
      byId('adminFeedbackSaveNote').onclick = () => {
        const item = records.find(record => String(record.id) === currentId);
        return item ? update([item.id], null, null, byId('adminFeedbackNote').value) : undefined;
      };
      render();
    }
    return { initialize, setRecords, render, clear };
  }
  return { createFeedbackAdmin };
});
