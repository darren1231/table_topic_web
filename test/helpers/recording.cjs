const { app } = require('./frontend.cjs');

function recordingBrowser(mode = 'api', fetch) {
  const b = app({ fetch });
  const recorders = [], streams = [], timers = new Map();
  let nextTimer = 0;
  b.context.clearInterval = id => timers.delete(id);
  b.context.setInterval = fn => { const id = ++nextTimer; timers.set(id, fn); return id; };
  b.context.requestAnimationFrame = fn => fn();
  b.window.scrollTo = () => {};
  b.context.navigator = { mediaDevices: { getUserMedia: async () => {
    const listeners = new Map();
    const track = { stopped: false, stop() { this.stopped = true; },
      addEventListener: (name, fn) => listeners.set(name, fn),
      emit: name => listeners.get(name)?.() };
    const stream = { track, getTracks: () => [track], getAudioTracks: () => [track] };
    streams.push(stream); return stream;
  } } };
  class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor(stream, options) {
      this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; this.stops = 0;
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() {
      this.stops++; this.state = 'inactive';
      this.finishStop = () => { this.ondataavailable?.({ data: this.finalBlob || new Blob([`segment-${recorders.indexOf(this) + 1}`]) }); this.onstop?.(); };
      if (!this.deferStop) queueMicrotask(this.finishStop);
    }
  }
  b.context.MediaRecorder = b.window.MediaRecorder = MediaRecorder;
  b.window.SpeechRecognition = class { start() {} stop() {} abort() {} };
  const wake = { acquires: 0, releases: 0, acquire() { this.acquires++; }, release() { this.releases++; } };
  b.context.WakeLock = wake;
  b.run(`getActiveProject().transcriptionMode = '${mode}'; getActiveProject().smartCorrection = false;`);
  return { ...b, recorders, streams, timers, wake,
    tick(seconds) { for (let i = 0; i < seconds; i++) for (const fn of [...timers.values()]) fn(); },
    visible(value) { b.context.document.visibilityState = value ? 'visible' : 'hidden'; b.context.document.dispatchEvent({ type: 'visibilitychange' }); },
    async settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(setImmediate); },
  };
}

module.exports = { recordingBrowser };
