(function (global) {
  'use strict';

  // One lock for all recording modes. A generation invalidates requests that
  // finish after recording has stopped or the page has entered the background.
  function createRecordingWakeLock({ navigator, document, window, onChange }) {
    let active = false;
    let suspended = false;
    let lock = null;
    let pending = false;
    let generation = 0;
    let status = 'idle';
    const visible = () => !suspended && document.visibilityState === 'visible';
    const publish = value => { status = value; onChange(value); };
    const release = sentinel => {
      if (sentinel && !sentinel.released) {
        try { Promise.resolve(sentinel.release()).catch(() => {}); } catch {}
      }
    };
    function invalidate() {
      generation++;
      const previous = lock;
      lock = null;
      release(previous);
    }
    async function request() {
      if (!active || !visible() || lock || pending) return;
      if (!navigator.wakeLock?.request) { publish('unsupported'); return; }
      const current = generation;
      pending = true;
      publish('requesting');
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (current !== generation || !active || !visible()) {
          release(sentinel);
          return;
        }
        if (sentinel.released) { publish('released'); return; }
        lock = sentinel;
        sentinel.addEventListener('release', () => {
          if (lock !== sentinel) return;
          lock = null;
          publish(active ? (visible() ? 'released' : 'background') : 'idle');
        });
        publish('active');
      } catch {
        if (current === generation && active && visible()) publish('denied');
      } finally {
        pending = false;
        // A new session may have started while an old request was in flight.
        if (current !== generation && active && visible()) void request();
      }
    }
    function refresh() {
      if (!visible()) {
        invalidate();
        publish(active ? 'background' : 'idle');
      } else if (active) void request();
    }
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pagehide', () => { suspended = true; refresh(); });
    window.addEventListener('pageshow', () => { suspended = false; refresh(); });
    return {
      setActive(value) {
        value = Boolean(value);
        if (active === value) return;
        active = value;
        invalidate();
        if (!active) publish('idle');
        else if (!visible()) publish('background');
        else void request();
      },
      retry: request,
      get status() { return status; }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createRecordingWakeLock };
  else global.RecordingWakeLock = { createRecordingWakeLock };
})(typeof window === 'undefined' ? globalThis : window);
