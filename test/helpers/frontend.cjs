const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '../../public');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.value = ''; this.textContent = '';
    this.dataset = {}; this.style = {}; this.attributes = {}; this.htmlWrites = 0;
    const classes = new Set();
    this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
      toggle(value, force = !classes.has(value)) { if (force) classes.add(value); else classes.delete(value); return force; } };
  }
  set innerHTML(value) { this.htmlWrites++; this._html = value; }
  get innerHTML() { return this._html ?? this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  closest() { return this.label ||= new Element('label'); }
  querySelector() { return this.nested ||= new Element(); }
  querySelectorAll() { return []; }
  addEventListener() {}
  click() { this.onclick?.(); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  scrollIntoView(options) { this.lastScroll = options; }
  focus() { this.focused = true; }
}

function browser({ storageEntries = [], now, createElement = tag => new Element(tag) } = {}) {
  const nodes = new Map();
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(`#${match[1]}`, createElement('div'));
  const get = selector => nodes.get(selector) || (selector.startsWith('#') ? null : createElement('div'));
  const events = new Map();
  const storage = new Map(storageEntries);
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const messages = JSON.parse(fs.readFileSync(path.join(publicDir, 'locales/en-US.json'), 'utf8')).messages;
  const window = {
    addEventListener(name, listener) { events.set(name, [...(events.get(name) || []), listener]); },
    dispatchEvent(event) { for (const listener of events.get(event.type) || []) listener(event); },
  };
  const context = vm.createContext({
    window, document: { visibilityState: 'visible', querySelector: get, querySelectorAll: () => [], getElementById: id => get(`#${id}`), createElement,
      addEventListener(name, listener) { const key = `document:${name}`; events.set(key, [...(events.get(key) || []), listener]); },
      dispatchEvent(event) { for (const listener of events.get(`document:${event.type}`) || []) listener(event); } },
    localStorage, sessionStorage: localStorage, console, Blob, FormData, Response, Request, URL, Intl,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    location: { hash: '', origin: 'https://app.example.invalid', pathname: '/' },
    I18n: { ready: new Promise(() => {}), fromSource: (source, english) => english || source,
      setLocale() {}, apply() {},
      questionTemplates: () => [topic => `Question about ${topic}`],
      translate(key, variables = {}) { return Object.entries(variables).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), messages[key] || key); } },
    SpeechUtils: require('../../public/speech-utils.js'), CoachResultUtils: require('../../public/coach-result-utils.js'),
    WakeLock: require('../../public/wake-lock.js'),
    RecordingSession: require('../../public/recording-session.js'),
  });
  if (now !== undefined) {
    const timestamp = new Date(now).getTime();
    context.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : [timestamp])); }
      static now() { return timestamp; }
    };
  }
  window.I18n = context.I18n;
  return { context, nodes, storage, get, run: source => vm.runInContext(source, context) };
}

function app({ signedIn = true, fetch = async () => { throw new Error('Unexpected test fetch'); }, balanceFetch, ...browserOptions } = {}) {
  const b = browser(browserOptions);
  b.storage.set('tableTopicsAIProjects.v1', JSON.stringify({ activeId: 'legacy', projects: [
    { id: 'legacy', name: 'Legacy project', provider: 'openai', apiKey: 'legacy-placeholder', endpoint: 'https://legacy.example.invalid' },
  ] }));
  let user = signedIn ? 'member-one' : null;
  b.window = b.context.window;
  b.window.tableTopicsCloud = {
    ready: Promise.resolve(), isSignedIn: () => Boolean(user), getUserId: () => user,
    getAccessToken: async () => user ? 'user-placeholder' : null, isEnabled: () => false,
    scheduleSync() {},
  };
  b.context.SystemAI = require('../../public/system-ai.js');
  b.context.UsageStats = require('../../public/usage-stats.js');
  b.balanceCalls = [];
  b.context.fetch = (url, init) => {
    if (url === '/api/ai/balance') {
      b.balanceCalls.push(init);
      return balanceFetch ? balanceFetch(url, init) : Promise.resolve(Response.json({ spent: 0, credit: 1, balance: 1, exhausted: false }));
    }
    return fetch(url, init);
  };
  b.run(fs.readFileSync(path.join(publicDir, 'practice-stats.js'), 'utf8'));
  b.run(fs.readFileSync(path.join(publicDir, 'practice-data.js'), 'utf8'));
  b.run(fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8'));
  b.run('ensureDataSchema(); initSystemAi();');
  b.setUser = value => { user = value; b.window.dispatchEvent({ type: 'tabletopics:auth' }); };
  return b;
}

module.exports = { browser, app, publicDir, Element };
