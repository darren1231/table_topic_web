(function createI18n(global) {
  'use strict';

  const supportedLocales = ['zh-TW', 'en-US', 'ja-JP'];
  const fallbackLocale = 'zh-TW';
  const catalogs = new Map();
  const textBindings = new WeakMap();
  const placeholderBindings = new WeakMap();
  let observer;
  let activeLocale = fallbackLocale;

  const loadCatalog = async locale => {
    const response = await fetch(`locales/${locale}.json`);
    if (!response.ok) throw new Error(`Unable to load locale ${locale}: HTTP ${response.status}`);
    const catalog = await response.json();
    if (catalog.meta?.code !== locale || !catalog.messages || !catalog.placeholders) {
      throw new Error(`Invalid locale catalog: ${locale}`);
    }
    catalogs.set(locale, catalog);
  };

  const ready = Promise.all(supportedLocales.map(loadCatalog));
  const catalog = locale => catalogs.get(locale) || catalogs.get(fallbackLocale);
  const sourceIndex = section => new Map(
    Object.entries(catalog(fallbackLocale)?.[section] || {}).map(([key, value]) => [value, key])
  );

  function setLocale(locale) {
    activeLocale = supportedLocales.includes(locale) ? locale : fallbackLocale;
    document.documentElement.lang = catalog(activeLocale)?.meta?.htmlLang || 'zh-Hant';
  }

  function translate(key, variables = {}) {
    const value = catalog(activeLocale)?.messages[key]
      ?? catalog(fallbackLocale)?.messages[key]
      ?? key;
    return Object.entries(variables).reduce(
      (text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)),
      value
    );
  }

  function keyForSource(source, section = 'messages') {
    return sourceIndex(section).get(source);
  }

  function fromSource(source, fallback) {
    const key = keyForSource(source);
    if (key) return translate(key);
    // `ui(source, englishFallback)` is retained for legacy dynamic messages.
    // Never leak the Chinese source into another locale while those call sites
    // are being migrated to catalog keys.
    return activeLocale !== fallbackLocale && fallback ? fallback : source;
  }

  function apply(root = document.body) {
    const messageKeys = sourceIndex('messages');
    const placeholderKeys = sourceIndex('placeholders');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) continue;
      const raw = node.nodeValue;
      const binding = textBindings.get(node);
      const source = binding?.source || raw.trim();
      // A renderer may reuse the same text node for a different label. Prefer a
      // newly rendered fallback string over the node's previous binding.
      const key = messageKeys.get(raw.trim()) || binding?.key || messageKeys.get(source);
      if (!key) continue;
      textBindings.set(node, { key, source });
      const translated = raw.replace(raw.trim(), translate(key));
      if (translated !== raw) node.nodeValue = translated;
    }
    root.querySelectorAll('[placeholder]').forEach(element => {
      const binding = placeholderBindings.get(element);
      const source = binding?.source || element.placeholder;
      const key = binding?.key || placeholderKeys.get(source);
      if (!key) return;
      placeholderBindings.set(element, { key, source });
      element.placeholder = catalog(activeLocale)?.placeholders[key]
        ?? catalog(fallbackLocale)?.placeholders[key]
        ?? source;
    });
    root.querySelectorAll('[title], [aria-label]').forEach(element => {
      ['title', 'aria-label'].forEach(attribute => {
        if (!element.hasAttribute(attribute)) return;
        const sourceAttribute = `data-i18n-${attribute}-source`;
        const source = element.getAttribute(sourceAttribute) || element.getAttribute(attribute);
        const key = messageKeys.get(source);
        if (!key) return;
        element.setAttribute(sourceAttribute, source);
        element.setAttribute(attribute, translate(key));
      });
    });
  }

  function observe() {
    observer?.disconnect();
    observer = new MutationObserver(mutations => {
      observer.disconnect();
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') apply(mutation.target.parentElement);
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) apply(node.parentElement);
          else if (node.nodeType === Node.ELEMENT_NODE) apply(node);
        });
      }
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  function topics(locale = activeLocale) {
    return catalog(locale)?.topics || catalog(fallbackLocale)?.topics || [];
  }

  function questionTemplates(locale = activeLocale) {
    return (catalog(locale)?.questionTemplates || catalog(fallbackLocale)?.questionTemplates || [])
      .map(template => topic => template.replaceAll('{topic}', topic));
  }

  global.I18n = { apply, fromSource, keyForSource, observe, questionTemplates, ready, setLocale, supportedLocales, topics, translate };
})(window);
