(() => {
  const MODE_KEY = 'tableTopicsStorageMode';
  const DATA_KEY = 'tableTopicsPractice.v1';
  const config = window.SUPABASE_CONFIG || {};
  const configured = Boolean(config.url && config.anonKey && window.supabase?.createClient);
  const client = configured ? window.supabase.createClient(config.url, config.anonKey) : null;
  let session = null;
  let syncing = false;
  let timer = null;

  const byId = id => document.getElementById(id);
  const setStatus = (message, type = '') => {
    const element = byId('syncStatus');
    element.textContent = message;
    element.className = `sync-status ${type}`.trim();
  };
  const currentMode = () => localStorage.getItem(MODE_KEY) || 'local';
  const cloudEnabled = () => currentMode() === 'cloud' && Boolean(session);

  function updateUi() {
    const user = session?.user;
    const cloud = cloudEnabled();
    byId('accountLabel').textContent = cloud ? (user.user_metadata?.full_name || user.email || '已同步') : '本機資料';
    byId('accountAvatar').textContent = cloud ? '✓' : '☁';
    byId('storageModeFooter').textContent = cloud ? '已透過 Supabase 私密同步' : '資料只保存在你的瀏覽器';
    byId('cloudAccountStatus').textContent = user
      ? `已登入 ${user.email || 'Google 帳號'}，資料會在你的裝置間同步。`
      : '登入後，練習紀錄、講稿與複習卡會同步至你的私人空間。';
    byId('googleSignInButton').classList.toggle('hidden', Boolean(user));
    byId('syncNowButton').classList.toggle('hidden', !user || currentMode() !== 'cloud');
    byId('signOutButton').classList.toggle('hidden', !user);
    byId('localStorageOption').classList.toggle('selected', !cloud);
    byId('cloudStorageOption').classList.toggle('selected', cloud);
    if (!configured) setStatus('尚未設定 Supabase。現在仍安全地使用本機模式。', 'warning');
    else if (cloud) setStatus('雲端同步已開啟。', 'success');
    else setStatus('目前未上傳任何資料。');
  }

  async function push(payload = saved) {
    if (!cloudEnabled() || syncing) return;
    syncing = true;
    setStatus('正在同步…');
    const { error } = await client.from('user_data').upsert({
      user_id: session.user.id,
      payload: JSON.parse(JSON.stringify(payload)),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    syncing = false;
    if (error) setStatus(`同步失敗：${error.message}`, 'error');
    else setStatus(`已同步 · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'success');
  }

  async function enableCloud() {
    localStorage.setItem(MODE_KEY, 'cloud');
    const { data, error } = await client.from('user_data').select('payload').eq('user_id', session.user.id).maybeSingle();
    if (error) {
      setStatus(`無法讀取雲端資料：${error.message}`, 'error');
      updateUi();
      return;
    }
    if (data?.payload && Object.keys(data.payload).length) {
      const remote = JSON.stringify(data.payload);
      const local = localStorage.getItem(DATA_KEY);
      if (remote !== local) {
        localStorage.setItem(DATA_KEY, remote);
        sessionStorage.setItem('tableTopicsCloudNotice', '已載入這個 Google 帳號的雲端資料');
        location.reload();
        return;
      }
    } else {
      await push(saved);
    }
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
    }
  };

  byId('accountButton').onclick = () => { updateUi(); byId('accountDialog').showModal(); };
  byId('closeAccountButton').onclick = () => byId('accountDialog').close();
  byId('googleSignInButton').onclick = signIn;
  byId('useLocalButton').onclick = useLocal;
  byId('syncNowButton').onclick = () => push(saved);
  byId('signOutButton').onclick = signOut;

  async function initialize() {
    if (sessionStorage.getItem('tableTopicsCloudNotice')) {
      setTimeout(() => toast(sessionStorage.getItem('tableTopicsCloudNotice')), 100);
      sessionStorage.removeItem('tableTopicsCloudNotice');
    }
    if (client) {
      const { data } = await client.auth.getSession();
      session = data.session;
      client.auth.onAuthStateChange((_event, nextSession) => { session = nextSession; updateUi(); });
      if (session && currentMode() === 'cloud') await enableCloud();
    }
    updateUi();
  }

  initialize();
})();
