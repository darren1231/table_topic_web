(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StorageRecovery = factory();
})(globalThis, function () {
  function create({ storage, now = Date.now }) {
    const known = new Set(), blocked = new Set();
    let recovered = false;
    function read(key, { validate, fallback }) {
      const raw = storage.getItem(key);
      if (raw === null) return fallback();
      try {
        const value = JSON.parse(raw);
        if (validate(value)) return value;
      } catch {}
      recovered = true;
      let backup = `${key}.corrupt.${now()}`, suffix = 0;
      const base = backup;
      while (storage.getItem(backup) !== null) backup = `${base}.${++suffix}`;
      try { storage.setItem(backup, raw); known.add(backup); }
      catch { blocked.add(key); }
      const value = fallback();
      if (!blocked.has(key)) {
        try { storage.setItem(key, JSON.stringify(value)); } catch { blocked.add(key); }
      }
      return value;
    }
    function list() {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (/^tableTopics(?:Practice|AIProjects|SpeechSettings)\.v1\.corrupt\./.test(key)) known.add(key);
      }
      return [...new Set([...known, ...blocked])].map(key => ({ key, raw: storage.getItem(key) }));
    }
    return { read, list, hadRecovery: () => recovered, isBlocked: () => blocked.size > 0, isWriteBlocked: key => blocked.has(key),
      write(key, raw) {
        if (blocked.has(key)) throw new Error('Original data could not be backed up; writes are blocked');
        storage.setItem(key, raw);
      } };
  }
  function createNotice({ document, recovery, t, download }) {
    let initialized = false;
    const byId = id => document.getElementById(id);
    function exportOriginals() { download(JSON.stringify({ format: 'table-topics-recovery', entries: recovery.list() }, null, 2)); }
    function close() { byId('dataRecoveryNotice').classList.add('hidden'); }
    function render() {
      byId('dataRecoveryMessage').textContent = t(recovery.isBlocked() ? 'recovery.blocked' : 'recovery.preserved');
      byId('exportRecoveryButton').textContent = t('recovery.export');
      byId('dismissRecoveryButton').textContent = t('recovery.dismiss');
      byId('backupRecoveryButton').textContent = t('recovery.export');
      byId('backupRecoveryButton').classList.toggle('hidden', recovery.list().length === 0);
    }
    return { render,
      initialize() {
        if (initialized) return;
        initialized = true;
        render();
        byId('dataRecoveryNotice').classList.toggle('hidden', !recovery.hadRecovery());
        byId('exportRecoveryButton').addEventListener('click', exportOriginals);
        byId('backupRecoveryButton').addEventListener('click', exportOriginals);
        byId('dismissRecoveryButton').addEventListener('click', close);
      },
      dispose() {
        byId('exportRecoveryButton').removeEventListener('click', exportOriginals);
        byId('backupRecoveryButton').removeEventListener('click', exportOriginals);
        byId('dismissRecoveryButton').removeEventListener('click', close);
        initialized = false;
      }
    };
  }
  return { create, createNotice };
});
