(() => {
  const MODE_KEY = 'tableTopicsStorageMode';
  const DATA_KEY = 'tableTopicsPractice.v1';
  const APPLIED_REMOTE_KEY = 'tableTopicsAppliedRemote';
  const IMPORT_PENDING_KEY = 'tableTopicsImportPending.v1';
  const config = window.SUPABASE_CONFIG || {};
  const configured = Boolean(config.url && config.anonKey && window.supabase?.createClient);
  const client = configured ? window.supabase.createClient(config.url, config.anonKey) : null;
  // Capture this before app.js can replace damaged local data with startup defaults.
  const hadInvalidLocal = (() => {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw === null) return false;
    try { return !PracticeData.validateStartupPractice(JSON.parse(raw)); } catch { return true; }
  })();
  let session = null;
  let syncing = false;
  let timer = null;
  let syncAgain = null;
  let enablingCloud = false;
  let lastRemoteUpdatedAt = '';
  let pollTimer = null;
  let invalidRemote = false;
  let remoteChecked = false;
  let reloadPending = false;
  let dataRevision = 0, importing = false, restoredOwner = null;
  let pendingOwner = null, importPending = false;
  try {
    const marker = JSON.parse(localStorage.getItem(IMPORT_PENDING_KEY) || 'null');
    if (marker) { importPending = true; pendingOwner = marker.owner; }
  } catch {}

  function markImportPending() {
    const owner = session?.user?.id || null;
    if (!importPending || pendingOwner !== owner) localStorage.setItem(IMPORT_PENDING_KEY, JSON.stringify({ owner }));
    importPending = true; pendingOwner = owner;
  }
  function beginImport() {
    const previous = { raw: localStorage.getItem(IMPORT_PENDING_KEY), pending: importPending, owner: pendingOwner };
    dataRevision++; importing = true;
    clearTimeout(timer); syncAgain = null;
    if (restoredOwner === session?.user?.id) remoteChecked = true;
    return {
      commit() {
        if (cloudEnabled()) markImportPending();
        importing = false;
      },
      cancel() {
        dataRevision++; importing = false;
        importPending = previous.pending; pendingOwner = previous.owner;
        if (previous.raw === null) localStorage.removeItem(IMPORT_PENDING_KEY);
        else localStorage.setItem(IMPORT_PENDING_KEY, previous.raw);
      }
    };
  }

  function setSession(next) {
    if (session?.user?.id !== next?.user?.id) {
      dataRevision++; restoredOwner = null;
      remoteChecked = false;
      reloadPending = false;
      lastRemoteUpdatedAt = '';
      clearTimeout(timer);
      syncAgain = null;
    }
    // Pending(A) survives sign-out and restoring A. Signing in as B ends that
    // retry state: the shared local payload can now change through B's normal sync.
    if (importPending && next?.user?.id && pendingOwner !== next.user.id) {
      localStorage.removeItem(IMPORT_PENDING_KEY);
      importPending = false; pendingOwner = null;
    }
    session = next;
  }

  const byId = id => document.getElementById(id);
  const t = (key, variables) => window.I18n?.translate(key, variables) || key;
  const setStatus = (message, type = '') => {
    const element = byId('syncStatus');
    element.textContent = message;
    element.className = `sync-status ${type}`.trim();
  };
  const currentMode = () => localStorage.getItem(MODE_KEY) || 'local';
  const cloudEnabled = () => currentMode() === 'cloud' && Boolean(session);
  const readLocalPayload = () => {
    try { return JSON.parse(localStorage.getItem(DATA_KEY) || '{"history":[]}'); }
    catch { return { history: [] }; }
  };
  const remoteSignature = (updatedAt, payload) => {
    if (updatedAt) return updatedAt;
    let hash = 0;
    for (let index = 0; index < payload.length; index += 1) hash = (hash * 31 + payload.charCodeAt(index)) | 0;
    return `${payload.length}:${hash}`;
  };

  function updateUi() {
    const user = session?.user;
    const cloud = cloudEnabled();
    const accountName = user?.user_metadata?.full_name || user?.email || t('cloud.googleAccount');
    const accountButton = byId('accountButton');
    accountButton.dataset.mode = cloud ? 'cloud' : 'local';
    accountButton.title = cloud ? t('cloud.modeTitle', { account: accountName }) : t('cloud.localModeTitle');
    accountButton.setAttribute('aria-label', accountButton.title);
    byId('accountModeLabel').textContent = cloud ? t('cloud.googleCloud') : t('cloud.localMode');
    byId('accountLabel').textContent = cloud ? accountName : t('cloud.deviceOnly');
    const modeBanner = byId('currentModeBanner');
    modeBanner.dataset.mode = cloud ? 'cloud' : 'local';
    modeBanner.querySelector('.mode-banner-logo').textContent = cloud ? '☁' : '⌂';
    byId('currentModeTitle').textContent = cloud ? t('cloud.sync') : t('cloud.localMode');
    byId('currentModeDescription').textContent = cloud
      ? t('cloud.connected', { account: accountName })
      : t('cloud.localDescription');
    byId('storageModeFooter').textContent = cloud ? t('cloud.privateSync') : t('ui.031');
    byId('cloudAccountStatus').textContent = cloud
      ? t('cloud.signedInSync', { account: user.email || t('cloud.googleAccount') })
      : user
        ? t('cloud.signedInLocal', { account: user.email || t('cloud.googleAccount') })
        : t('cloud.signInDescription');
    byId('googleSignInButton').classList.toggle('hidden', Boolean(user));
    byId('enableCloudButton').classList.toggle('hidden', !user || cloud);
    byId('syncNowButton').classList.toggle('hidden', !user || currentMode() !== 'cloud');
    byId('signOutButton').classList.toggle('hidden', !user);
    byId('localStorageOption').classList.toggle('selected', !cloud);
    byId('cloudStorageOption').classList.toggle('selected', cloud);
    if (importPending) setStatus(t('backup.import.pending'), 'warning');
    else if (invalidRemote) setStatus(t('cloud.invalidPayload'), 'error');
    else if (!configured) setStatus(t('cloud.notConfigured'), 'warning');
    else if (cloud) setStatus(t('cloud.syncEnabled'), 'success');
    else setStatus(t('cloud.nothingUploaded'));
    window.dispatchEvent(new CustomEvent('tabletopics:auth'));
  }

  async function push(payload = readLocalPayload(), imported = false) {
    if (!cloudEnabled() || !remoteChecked || reloadPending || importing) return false;
    if (importPending && (!imported || pendingOwner !== session?.user?.id)) return false;
    if (syncing) {
      syncAgain = JSON.parse(JSON.stringify(payload));
      return false;
    }
    syncing = true;
    const revision = dataRevision, owner = session?.user?.id;
    setStatus(t('cloud.syncing'));
    const updatedAt = new Date().toISOString();
    let error = null;
    try {
      ({ error } = await client.from('user_data').upsert({
        user_id: session.user.id,
        payload: JSON.parse(JSON.stringify(payload)),
        updated_at: updatedAt
      }, { onConflict: 'user_id' }));
    } catch (caughtError) {
      error = caughtError;
    } finally {
      syncing = false;
    }
    if (revision !== dataRevision || owner !== session?.user?.id) return false;
    if (error) setStatus(t('cloud.syncFailed', { error: error.message }), 'error');
    else {
      lastRemoteUpdatedAt = updatedAt;
      setStatus(t('cloud.synced', { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }), 'success');
      if (imported && JSON.stringify(payload) === JSON.stringify(readLocalPayload())) {
        localStorage.removeItem(IMPORT_PENDING_KEY);
        importPending = false; pendingOwner = null;
      }
    }
    if (syncAgain) {
      const nextPayload = syncAgain;
      syncAgain = null;
      await push(nextPayload);
    }
    return !error && (!imported || !importPending);
  }

  async function replaceCloudData(payload) {
    // Local keys and memory have already committed; this adapter only synchronizes.
    if (!cloudEnabled()) return true;
    if (importPending && pendingOwner !== session?.user?.id) return false;
    markImportPending();
    clearTimeout(timer);
    syncAgain = null;
    const revision = dataRevision;
    while (syncing) await new Promise(resolve => setTimeout(resolve, 50));
    if (revision !== dataRevision) return false;
    if (!remoteChecked) {
      const found = await pullRemote({ apply: false });
      if (found === null || revision !== dataRevision) return false;
    }
    setStatus(t('cloud.importSyncing'));
    const succeeded = await push(readLocalPayload(), true);
    if (!succeeded) setStatus(t('cloud.importFailed'), 'error');
    return succeeded;
  }

  async function pullRemote({ reload = true, apply = true } = {}) {
    if (!cloudEnabled()) return false;
    if (importing || importPending && apply) return null;
    remoteChecked = false;
    const owner = session?.user?.id;
    const revision = dataRevision;
    const { data, error } = await client.from('user_data').select('payload, updated_at').eq('user_id', session.user.id).maybeSingle();
    if (owner !== session?.user?.id || !cloudEnabled() || revision !== dataRevision || importing) return null;
    if (error) {
      setStatus(t('cloud.readFailed', { error: error.message }), 'error');
      return null;
    }
    if (!data || data.payload && !Array.isArray(data.payload) && typeof data.payload === 'object' && !Object.keys(data.payload).length) {
      remoteChecked = true;
      restoredOwner = owner;
      return false;
    }
    if (!apply) { remoteChecked = true; restoredOwner = owner; return true; }
    if (!PracticeData.validatePractice(data.payload)) {
      invalidRemote = true;
      setStatus(t('cloud.invalidPayload'), 'error');
      return null;
    }
    invalidRemote = false;
    remoteChecked = true;
    restoredOwner = owner;
    if (data.updated_at && lastRemoteUpdatedAt && data.updated_at <= lastRemoteUpdatedAt) return true;
    lastRemoteUpdatedAt = data.updated_at || lastRemoteUpdatedAt;
    const remote = JSON.stringify(data.payload);
    const local = localStorage.getItem(DATA_KEY);
    if (remote !== local) {
      // app.js migrates older payloads during startup. Previously that made the
      // freshly loaded local value differ from the still-unmigrated cloud value,
      // so every auth/visibility refresh caused another location.reload(). This
      // is especially disruptive on mobile, where visibility changes are common.
      const signature = remoteSignature(data.updated_at, remote);
      const alreadyApplied = sessionStorage.getItem(APPLIED_REMOTE_KEY) === signature;
      if (alreadyApplied && !hadInvalidLocal) {
        sessionStorage.removeItem(APPLIED_REMOTE_KEY);
        await push(readLocalPayload());
        return true;
      }
      localStorage.setItem(DATA_KEY, remote);
      if (reload) {
        reloadPending = true;
        sessionStorage.setItem(APPLIED_REMOTE_KEY, signature);
        sessionStorage.setItem('tableTopicsCloudNotice', t('cloud.loadedLatest'));
        location.reload();
      }
    }
    return true;
  }

  async function enableCloud() {
    if (!session || enablingCloud) return false;
    enablingCloud = true;
    remoteChecked = false;
    clearTimeout(timer);
    syncAgain = null;
    localStorage.setItem(MODE_KEY, 'cloud');
    updateUi();
    if (importPending) {
      enablingCloud = false;
      const succeeded = await replaceCloudData(readLocalPayload());
      updateUi();
      return succeeded;
    }
    const foundRemote = await pullRemote();
    const succeeded = foundRemote === false ? await push() : foundRemote === true && !reloadPending;
    enablingCloud = false;
    updateUi();
    return succeeded;
  }

  async function signIn() {
    if (!configured) return setStatus(t('cloud.configureSupabase'), 'error');
    localStorage.setItem(MODE_KEY, 'cloud');
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}${location.pathname}`, queryParams: { prompt: 'select_account' } }
    });
    if (error) setStatus(t('cloud.signInFailed', { error: error.message }), 'error');
  }

  async function useLocal() {
    clearTimeout(timer);
    localStorage.setItem(MODE_KEY, 'local');
    updateUi();
    setStatus(t('cloud.switchedLocal'), 'success');
  }

  async function signOut() {
    localStorage.setItem(MODE_KEY, 'local');
    await client?.auth.signOut();
    setSession(null);
    updateUi();
  }

  window.tableTopicsCloud = {
    isSignedIn: () => Boolean(session?.user),
    getUserId: () => session?.user?.id || null,
    async getAccessToken() {
      if (!client) return null;
      try {
        const { data, error } = await client.auth.getSession();
        setSession(error ? null : data?.session || null);
      } catch {
        setSession(null);
      }
      updateUi();
      return session?.user ? session.access_token || null : null;
    },
    scheduleSync(payload) {
      if (!cloudEnabled() || !remoteChecked || reloadPending || importing || importPending) return;
      clearTimeout(timer);
      const revision = dataRevision;
      const snapshot = JSON.parse(JSON.stringify(payload));
      timer = setTimeout(() => { if (revision === dataRevision) return push(snapshot); }, 900);
    },
    beginImport,
    hasPendingImport: () => importPending,
    replaceData: replaceCloudData,
    isEnabled: cloudEnabled,
    refreshUi: updateUi
  };

  async function initialize() {
    await window.I18n.ready;
    byId('accountButton').onclick = () => { window.closeSettingsMenu?.(); updateUi(); byId('accountDialog').showModal(); };
    byId('closeAccountButton').onclick = () => byId('accountDialog').close();
    byId('googleSignInButton').onclick = signIn;
    byId('enableCloudButton').onclick = enableCloud;
    byId('useLocalButton').onclick = useLocal;
    byId('syncNowButton').onclick = () => importPending ? replaceCloudData(readLocalPayload()) : remoteChecked ? push() : enableCloud();
    byId('signOutButton').onclick = signOut;
    let authErrorMessage = '';
    if (sessionStorage.getItem('tableTopicsCloudNotice')) {
      setTimeout(() => toast(sessionStorage.getItem('tableTopicsCloudNotice')), 100);
      sessionStorage.removeItem('tableTopicsCloudNotice');
    }
    if (client) {
      const callbackParams = new URLSearchParams(location.hash.replace(/^#/,''));
      const callbackError = callbackParams.get('error_description') || callbackParams.get('error');
      const { data, error } = await client.auth.getSession();
      if (callbackError) authErrorMessage = t('cloud.signInFailed', { error: decodeURIComponent(callbackError.replace(/\+/g,' ')) });
      else if (error) authErrorMessage = t('cloud.sessionFailed', { error: error.message });
      setSession(data.session);
      client.auth.onAuthStateChange((event, nextSession) => {
        setSession(nextSession);
        updateUi();
        if (nextSession && currentMode() === 'cloud' && ['SIGNED_IN', 'INITIAL_SESSION'].includes(event)) {
          setTimeout(enableCloud, 0);
        }
      });
      if (session && currentMode() === 'cloud') await enableCloud();
      pollTimer = setInterval(() => {
        if (cloudEnabled() && document.visibilityState === 'visible' && !syncing) pullRemote();
      }, 15000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && cloudEnabled() && !syncing) pullRemote();
      });
    }
    updateUi();
    if (authErrorMessage) setStatus(authErrorMessage, 'error');
  }

  window.tableTopicsCloud.ready = initialize();
})();
