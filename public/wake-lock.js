(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WakeLock=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  function createWakeLock({ navigator = {}, document = {} } = {}) {
    let wanted = false, sentinel = null, pending = null, generation = 0;
    const releaseSentinel = async lock => { try { await lock?.release(); } catch {} };
    function acquire() {
      wanted = true;
      if (!navigator.wakeLock?.request || document.visibilityState === 'hidden') return Promise.resolve();
      if (sentinel && !sentinel.released) return Promise.resolve();
      if (pending) return pending;
      const ticket = generation;
      const task = (async () => {
        try {
          const lock = await navigator.wakeLock.request('screen');
          if (!wanted || ticket !== generation || document.visibilityState === 'hidden') return releaseSentinel(lock);
          sentinel = lock;
          lock.addEventListener?.('release', () => { if (sentinel === lock) sentinel = null; });
        } catch {}
      })();
      pending = task;
      task.finally(() => { if (pending === task) pending = null; });
      return task;
    }
    async function release() {
      wanted = false; generation++; pending = null;
      const lock = sentinel; sentinel = null;
      await releaseSentinel(lock);
    }
    document.addEventListener?.('visibilitychange', () => {
      if (wanted && document.visibilityState === 'visible') acquire();
    });
    return { acquire, release };
  }
  return { ...createWakeLock({ navigator: root.navigator, document: root.document }), createWakeLock };
});
