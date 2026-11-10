const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DATA_KEY = 'tableTopicsPractice.v1';
const MODE_KEY = 'tableTopicsStorageMode';
const APPLIED_KEY = 'tableTopicsAppliedRemote';
const userSession = { user: { id: 'fixture-user', user_metadata: { full_name: 'Fixture User' } } };
const copy = value => JSON.parse(JSON.stringify(value));

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

async function loadCloud({ local = {}, remote = null, session = userSession, configured = true, sessionValues = {} } = {}) {
  const localStorage = storage(local);
  const sessionStorage = storage(sessionValues);
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      dataset: {}, textContent: '', className: '', attributes: {},
      classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelector: () => node(`${id}/logo`),
      showModal() {}, close() {},
    });
    return nodes.get(id);
  };
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const intervals = [];
  const listeners = new Map();
  const state = { remote, session, reads: [], uploads: [], reloads: 0, signOuts: 0, readError: null, upsert: async () => ({ error: null }) };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.session }, error: null }),
      onAuthStateChange(callback) { state.authChanged = callback; },
      signOut: async () => { state.signOuts++; },
      signInWithOAuth: async () => ({ error: null }),
    },
    from(table) {
      if (table !== 'user_data') throw new Error(`Unexpected table: ${table}`);
      return {
        select(columns) {
          return { eq(column, value) {
            state.reads.push({ columns, column, value });
            return { maybeSingle: async () => ({ data: copy(state.remote), error: state.readError }) };
          } };
        },
        upsert(row, options) {
          state.uploads.push({ row: copy(row), options: copy(options) });
          return state.upsert(row);
        },
      };
    },
  };
  const document = { visibilityState: 'visible', getElementById: node, addEventListener: (name, callback) => listeners.set(name, callback) };
  const window = {
    SUPABASE_CONFIG: configured ? { url: 'https://fixture.invalid', anonKey: 'fixture-anon-key' } : {},
    supabase: { createClient: () => client },
    I18n: { ready: Promise.resolve(), translate: key => key }, dispatchEvent() {},
  };
  const context = vm.createContext({
    window, document, localStorage, sessionStorage, URLSearchParams,
    CustomEvent: class { constructor(type) { this.type = type; } },
    location: { origin: 'https://fixture.invalid', pathname: '/', hash: '', reload: () => { state.reloads++; } },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/cloud.js'), 'utf8'), context);
  const api = window.tableTopicsCloud;
  await api.ready;
  return {
    api, state, node, document, localStorage, sessionStorage,
    click: id => node(id).onclick(),
    async advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        await timer.callback();
      }
      now = end;
    },
    poll() {
      if (intervals.length !== 1 || intervals[0].delay !== 15000) throw new Error('Expected one 15-second poll');
      intervals[0].callback();
    },
    visibility: () => listeners.get('visibilitychange')(),
  };
}

module.exports = { loadCloud, DATA_KEY, MODE_KEY, APPLIED_KEY, userSession };
