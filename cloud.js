(() => {
  const MODE_KEY = 'tableTopicsStorageMode';
  const DATA_KEY = 'tableTopicsPractice.v1';
  const APPLIED_REMOTE_KEY = 'tableTopicsAppliedRemote';
  const config = window.SUPABASE_CONFIG || {};
  const configured = Boolean(config.url && config.anonKey && window.supabase?.createClient);
  const client = configured ? window.supabase.createClient(config.url, config.anonKey) : null;
  let session = null;
  let syncing = false;
  let timer = null;
  let syncAgain = null;
  let enablingCloud = false;
  let lastRemoteUpdatedAt = '';
  let pollTimer = null;

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
    if (!configured) setStatus(t('cloud.notConfigured'), 'warning');
    else if (cloud) setStatus(t('cloud.syncEnabled'), 'success');
    else setStatus(t('cloud.nothingUploaded'));
  }

  async function push(payload = readLocalPayload()) {
    if (!cloudEnabled()) return false;
    if (syncing) {
      syncAgain = JSON.parse(JSON.stringify(payload));
      return false;
    }
    syncing = true;
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
    if (error) setStatus(t('cloud.syncFailed', { error: error.message }), 'error');
    else {
      lastRemoteUpdatedAt = updatedAt;
      setStatus(t('cloud.synced', { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }), 'success');
    }
    if (syncAgain) {
      const nextPayload = syncAgain;
      syncAgain = null;
      await push(nextPayload);
    }
    return !error;
  }

  async function replaceCloudData(payload) {
    localStorage.setItem(DATA_KEY, JSON.stringify(payload));
    if (!cloudEnabled()) return true;
    clearTimeout(timer);
    syncAgain = null;
    while (syncing) await new Promise(resolve => setTimeout(resolve, 50));
    setStatus(t('cloud.importSyncing'));
    const succeeded = await push(payload);
    if (!succeeded) setStatus(t('cloud.importFailed'), 'error');
    return succeeded;
  }

  async function pullRemote({ reload = true } = {}) {
    if (!cloudEnabled()) return false;
    const { data, error } = await client.from('user_data').select('payload, updated_at').eq('user_id', session.user.id).maybeSingle();
    if (error) {
      setStatus(t('cloud.readFailed', { error: error.message }), 'error');
      return null;
    }
    if (!data?.payload || !Object.keys(data.payload).length) return false;
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
      if (alreadyApplied) {
        sessionStorage.removeItem(APPLIED_REMOTE_KEY);
        await push(readLocalPayload());
        return true;
      }
      localStorage.setItem(DATA_KEY, remote);
      if (reload) {
        sessionStorage.setItem(APPLIED_REMOTE_KEY, signature);
        sessionStorage.setItem('tableTopicsCloudNotice', t('cloud.loadedLatest'));
        location.reload();
      }
    }
    return true;
  }

  async function enableCloud() {
    if (!session || enablingCloud) return;
    enablingCloud = true;
    localStorage.setItem(MODE_KEY, 'cloud');
    updateUi();
    const foundRemote = await pullRemote();
    if (foundRemote === false) await push();
    enablingCloud = false;
    updateUi();
  }

  async function signIn() {
    if (!configured) return setStatus(t('cloud.configureSupabase'), 'error');
    localStorage.setItem(MODE_KEY, 'cloud');
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}${location.pathname}` }
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
    session = null;
    updateUi();
  }

  window.tableTopicsCloud = {
    scheduleSync(payload) {
      if (!cloudEnabled()) return;
      clearTimeout(timer);
      timer = setTimeout(() => push(payload), 900);
    },
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
    byId('syncNowButton').onclick = () => push();
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
      session = data.session;
      client.auth.onAuthStateChange((event, nextSession) => {
        session = nextSession;
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

  initialize();
})();
