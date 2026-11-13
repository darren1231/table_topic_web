(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdminFeedbackUI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createFeedbackAdmin({ client, document, t, getLocale, onDenied }) {
    const byId = id => document.getElementById(id);
    const priorities = { urgent: 'adminFeedback.urgent', normal: 'adminFeedback.normal', later: 'adminFeedback.later' };
    const types = { bug: 'feedback.bug', suggestion: 'feedback.suggestion', other: 'feedback.other' };
    const statuses = { new: 'adminFeedback.new', triaged: 'adminFeedback.triaged', issue_created: 'adminFeedback.issueCreated', done: 'adminFeedback.done', wont_fix: 'adminFeedback.declined' };
    let records = [], currentId = null, noteId = null, authorized = false, busy = false, revision = 0, messageKey = '';
    const selectedIds = new Set();
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
      byId('adminFeedbackIssue').disabled = true;
      byId('adminFeedbackIssueHint').textContent = t('adminFeedback.nextStep');
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
      byId('adminFeedbackRows').replaceChildren(...rows); detail();
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
      revision++; authorized = false; busy = false; records = []; selectedIds.clear(); currentId = null; noteId = null; messageKey = ''; render();
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
