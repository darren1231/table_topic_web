(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BackupImport = factory();
})(globalThis, function () {
  function create({ document, storage, readBackup, getCloud, keys, supportsLanguage, confirm, toast, schedule, t, ui,
    onCommit, refresh = () => {}, preparePractice = value => value, getLanguage = () => 'zh-TW',
    prepareAiSettings = value => value, authEvents, cancel = clearTimeout, timeoutMs = 15000 }) {
    let busy = false, pending = false, initialized = false, messageKey = '', revision = 0;
    let stopWait = null;
    let owner = null;
    const byId = id => document.getElementById(id);
    function render() {
      byId('importCommitStatus').textContent = messageKey ? t(messageKey) : '';
      byId('importCommitNotice').classList.toggle('hidden', !messageKey);
      byId('retryImportSyncButton').textContent = t('backup.import.retry');
      byId('retryImportSyncButton').classList.toggle('hidden', !pending);
      byId('retryImportSyncButton').disabled = busy;
      byId('importBackupButton').disabled = busy;
      byId('languageSelect').value = getLanguage();
    }
    function report(key) { messageKey = key; render(); toast(t(key)); }
    function identityChanged() {
      const next = getCloud()?.getUserId?.() || null;
      if (owner === next) {
        if (!busy && pending && !getCloud()?.hasPendingImport?.()) {
          pending = false; messageKey = 'backup.import.synced'; render();
        }
        return;
      }
      owner = next; revision++; stopWait?.(); stopWait = null; busy = false;
      pending = Boolean(getCloud()?.hasPendingImport?.());
      messageKey = pending ? 'backup.import.pending' : '';
      render();
    }
    function commitLocal(data, complete) {
      const writes = [[keys.practice, JSON.stringify(data.practice)], [keys.ai, JSON.stringify(data.aiSettings)]];
      if (supportsLanguage(data.language)) writes.push([keys.language, data.language]);
      const before = writes.map(([key]) => [key, storage.getItem(key)]), written = [];
      try {
        for (const [key, raw] of writes) { storage.setItem(key, raw); written.push(key); }
        complete();
      } catch {
        let restored = true;
        for (const [key, raw] of before.reverse()) {
          if (!written.includes(key)) continue;
          try { if (raw === null) storage.removeItem(key); else storage.setItem(key, raw); } catch { restored = false; }
        }
        throw Object.assign(new Error('Local import failed'), {
          messageKey: restored ? 'backup.import.localFailed' : 'backup.import.rollbackFailed',
        });
      }
    }
    async function synchronize(cloud) {
      if (!cloud?.isEnabled?.()) return false;
      let timer;
      const ticket = revision;
      const timeout = new Promise(resolve => {
        timer = schedule(() => resolve(false), timeoutMs);
        stopWait = () => { cancel(timer); resolve(false); };
      });
      try {
        const current = JSON.parse(storage.getItem(keys.practice));
        const operation = Promise.resolve().then(() => cloud.replaceData(current)).catch(() => false);
        const result = await Promise.race([operation, timeout]);
        if (ticket !== revision) return false;
        return result === true;
      } finally { cancel(timer); if (ticket === revision) stopWait = null; }
    }
    async function retry() {
      if (busy || !pending) return;
      const ticket = revision;
      busy = true; render();
      try {
        const succeeded = await synchronize(getCloud());
        if (ticket !== revision) return;
        pending = !succeeded;
        report(succeeded ? 'backup.import.synced' : 'backup.import.pending');
      } finally { if (ticket === revision) { busy = false; render(); } }
    }
    async function importFile(file) {
      if (busy) return;
      const ticket = revision;
      busy = true; render();
      let lease;
      try {
        const text = await file.text();
        if (ticket !== revision) return;
        const { payload, count, hasKeys } = readBackup(text);
        const question = ui(`確定匯入 ${count} 筆練習資料並取代目前所有資料嗎？${hasKeys ? ' 此檔案包含 API Key。' : ''}`,
          `Import ${count} practices and replace all current data?${hasKeys ? ' This file contains API keys.' : ''}`);
        if (!confirm(question)) return;
        const data = { practice: preparePractice(payload.data.practice), aiSettings: prepareAiSettings(payload.data.aiSettings),
          language: supportsLanguage(payload.data.language) ? payload.data.language : getLanguage() };
        const cloud = getCloud();
        lease = cloud?.beginImport?.();
        commitLocal(data, () => lease?.commit());
        onCommit(data); // Synchronous bindings only: storage has committed before memory can change.
        lease = null;
        pending = Boolean(cloud?.isEnabled?.());
        refresh();
        byId('backupDialog').close();
        const succeeded = pending ? await synchronize(cloud) : false;
        if (ticket !== revision) return;
        if (pending) pending = !succeeded;
        report(pending ? 'backup.import.pending' : cloud?.isEnabled?.() ? 'backup.import.synced' : 'backup.import.local');
      } catch (error) {
        if (ticket !== revision) return;
        let message = error.message;
        if (error.messageKey) {
          const variables = { ...error.variables, category: t(`backup.category.${error.category}`) };
          message = t(error.messageKey, variables);
        } else if (error.name === 'SyntaxError') message = t('backup.invalid.json');
        toast(`${ui('匯入失敗', 'Import failed')}: ${message}`);
      } finally {
        lease?.cancel();
        if (ticket === revision) { busy = false; byId('importBackupInput').value = ''; render(); }
      }
    }
    return { importFile, retry, render,
      initialize() {
        if (initialized) return;
        initialized = true;
        owner = getCloud()?.getUserId?.() || null;
        pending = Boolean(getCloud()?.hasPendingImport?.());
        if (pending) messageKey = 'backup.import.pending';
        byId('retryImportSyncButton').addEventListener('click', retry);
        authEvents?.addEventListener('tabletopics:auth', identityChanged);
        render();
        const ticket = revision;
        getCloud()?.ready?.then(() => {
          if (ticket !== revision || busy || !pending) return;
          pending = Boolean(getCloud()?.hasPendingImport?.());
          messageKey = pending ? 'backup.import.pending' : 'backup.import.synced';
          render();
        }, () => {});
      },
      dispose() {
        byId('retryImportSyncButton').removeEventListener('click', retry);
        authEvents?.removeEventListener('tabletopics:auth', identityChanged);
        initialized = false; busy = false; revision++; stopWait?.(); stopWait = null;
      }
    };
  }
  return { create };
});
