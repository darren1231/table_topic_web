const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function text(value) {
  return { nodeType: 3, nodeValue: value, parentElement: null };
}

function element(tag = 'div', attributes = {}, ...children) {
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), attributes: { ...attributes }, children,
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    get placeholder() { return this.getAttribute('placeholder'); },
    set placeholder(value) { this.setAttribute('placeholder', value); },
    querySelectorAll(selector) {
      const names = [...selector.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
      return descendants(this).filter(child => child.nodeType === 1 && names.some(name => child.hasAttribute(name)));
    },
  };
  children.forEach(child => { child.parentElement = node; });
  return node;
}

function descendants(root) {
  return (root.children || []).flatMap(child => [child, ...descendants(child)]);
}

function loadI18n({ catalogs, storedLocale, fetchCatalog, body = element('body') } = {}) {
  const requests = [];
  const document = {
    body, documentElement: {},
    createTreeWalker(root) {
      const nodes = descendants(root).filter(node => node.nodeType === 3);
      let index = 0;
      return { nextNode: () => nodes[index++] || null };
    },
  };
  const window = { localStorage: { getItem: () => storedLocale ?? null } };
  const context = vm.createContext({
    window, document, NodeFilter: { SHOW_TEXT: 4 },
    fetch: async url => {
      requests.push(url);
      const locale = url.match(/locales\/(.+)\.json$/)[1];
      if (fetchCatalog) return fetchCatalog(locale);
      return { ok: true, json: async () => catalogs[locale] };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/i18n.js'), 'utf8'), context);
  return { i18n: window.I18n, document, requests };
}

module.exports = { loadI18n, element, text };
