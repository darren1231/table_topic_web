(() => {
  const MODE_KEY = 'tableTopicsStorageMode';
  const DATA_KEY = 'tableTopicsPractice.v1';
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

  function updateUi() {
    const user = session?.user;
    const cloud = cloudEnabled();
    const accountName = user?.user_metadata?.full_name || user?.email || 'Google 帳號';
    const accountButton = byId('accountButton');
    accountButton.dataset.mode = cloud ? 'cloud' : 'local';
    accountButton.title = cloud ? `Google 雲端模式：${accountName}` : '目前為本機模式；按一下管理資料模式';
    accountButton.setAttribute('aria-label', accountButton.title);
    byId('accountModeLabel').textContent = cloud ? 'Google 雲端' : '本機模式';
    byId('accountLabel').textContent = cloud ? accountName : '資料只在這台裝置';
    const modeBanner = byId('currentModeBanner');
    modeBanner.dataset.mode = cloud ? 'cloud' : 'local';
    modeBanner.querySelector('.mode-banner-logo').textContent = cloud ? '☁' : '⌂';
    byId('currentModeTitle').textContent = cloud ? 'Google 雲端同步' : '本機模式';
    byId('currentModeDescription').textContent = cloud
      ? `已連結 ${accountName}，資料會安全同步到其他裝置。`
      : '資料只儲存在這台裝置，不會上傳雲端。';
    byId('storageModeFooter').textContent = cloud ? '已透過 Supabase 私密同步' : '資料只保存在你的瀏覽器';
    byId('cloudAccountStatus').textContent = cloud
      ? `已登入 ${user.email || 'Google 帳號'}，資料會在你的裝置間同步。`
      : user
        ? `已登入 ${user.email || 'Google 帳號'}，但目前仍是本機模式；請按下方按鈕啟用同步。`
        : '登入後，練習紀錄、講稿與複習卡會同步至你的私人空間。';
    byId('googleSignInButton').classList.toggle('hidden', Boolean(user));
    byId('enableCloudButton').classList.toggle('hidden', !user || cloud);
    byId('syncNowButton').classList.toggle('hidden', !user || currentMode() !== 'cloud');
    byId('signOutButton').classList.toggle('hidden', !user);
    byId('localStorageOption').classList.toggle('selected', !cloud);
    byId('cloudStorageOption').classList.toggle('selected', cloud);
    if (!configured) setStatus('尚未設定 Supabase。現在仍安全地使用本機模式。', 'warning');
    else if (cloud) setStatus('雲端同步已開啟。', 'success');
    else setStatus('目前未上傳任何資料。');
  }

  async function push(payload = readLocalPayload()) {
    if (!cloudEnabled()) return false;
    if (syncing) {
      syncAgain = JSON.parse(JSON.stringify(payload));
      return false;
    }
    syncing = true;
    setStatus('正在同步…');
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
    if (error) setStatus(`同步失敗：${error.message}`, 'error');
    else {
      lastRemoteUpdatedAt = updatedAt;
      setStatus(`已同步 · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'success');
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
    setStatus('正在將匯入資料寫入雲端…');
    const succeeded = await push(payload);
    if (!succeeded) setStatus('匯入資料已保存在本機，但無法更新雲端；請檢查連線後再試一次。', 'error');
    return succeeded;
  }

  async function pullRemote({ reload = true } = {}) {
    if (!cloudEnabled()) return false;
    const { data, error } = await client.from('user_data').select('payload, updated_at').eq('user_id', session.user.id).maybeSingle();
    if (error) {
      setStatus(`無法讀取雲端資料：${error.message}`, 'error');
      return null;
    }
    if (!data?.payload || !Object.keys(data.payload).length) return false;
    if (data.updated_at && lastRemoteUpdatedAt && data.updated_at <= lastRemoteUpdatedAt) return true;
    lastRemoteUpdatedAt = data.updated_at || lastRemoteUpdatedAt;
    const remote = JSON.stringify(data.payload);
    const local = localStorage.getItem(DATA_KEY);
    if (remote !== local) {
      localStorage.setItem(DATA_KEY, remote);
      if (reload) {
        sessionStorage.setItem('tableTopicsCloudNotice', '已載入這個 Google 帳號的最新雲端資料');
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
    if (!configured) return setStatus('請先在 supabase-config.js 填入 Project URL 與 anon key。', 'error');
    localStorage.setItem(MODE_KEY, 'cloud');
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}${location.pathname}` }
    });
    if (error) setStatus(`Google 登入失敗：${error.message}`, 'error');
  }

  async function useLocal() {
    clearTimeout(timer);
    localStorage.setItem(MODE_KEY, 'local');
    updateUi();
    setStatus('已切換為本機模式；之後的變更不會上傳。', 'success');
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
    isEnabled: cloudEnabled
  };

  byId('accountButton').onclick = () => { updateUi(); byId('accountDialog').showModal(); };
  byId('closeAccountButton').onclick = () => byId('accountDialog').close();
  byId('googleSignInButton').onclick = signIn;
  byId('enableCloudButton').onclick = enableCloud;
  byId('useLocalButton').onclick = useLocal;
  byId('syncNowButton').onclick = () => push();
  byId('signOutButton').onclick = signOut;

  async function initialize() {
    let authErrorMessage = '';
    if (sessionStorage.getItem('tableTopicsCloudNotice')) {
      setTimeout(() => toast(sessionStorage.getItem('tableTopicsCloudNotice')), 100);
      sessionStorage.removeItem('tableTopicsCloudNotice');
    }
    if (client) {
      const callbackParams = new URLSearchParams(location.hash.replace(/^#/,''));
      const callbackError = callbackParams.get('error_description') || callbackParams.get('error');
      const { data, error } = await client.auth.getSession();
      if (callbackError) authErrorMessage = `Google 登入失敗：${decodeURIComponent(callbackError.replace(/\+/g,' '))}`;
      else if (error) authErrorMessage = `無法建立登入狀態：${error.message}`;
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
