(function createI18n(global) {
  'use strict';

  const supportedLocales = ['zh-TW', 'en-US', 'ja-JP'];
  const fallbackLocale = 'zh-TW';
  const catalogs = new Map();
  const textBindings = new WeakMap();
  const placeholderBindings = new WeakMap();
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
    return activeLocale === 'en-US' && fallback ? fallback : source;
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
      const key = binding?.key || messageKeys.get(source);
      if (!key) continue;
      textBindings.set(node, { key, source });
      node.nodeValue = raw.replace(raw.trim(), translate(key));
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
  }

  function topics(locale = activeLocale) {
    return catalog(locale)?.topics || catalog(fallbackLocale)?.topics || [];
  }

  function questionTemplates(locale = activeLocale) {
    return (catalog(locale)?.questionTemplates || catalog(fallbackLocale)?.questionTemplates || [])
      .map(template => topic => template.replaceAll('{topic}', topic));
  }

  global.I18n = { apply, fromSource, keyForSource, questionTemplates, ready, setLocale, supportedLocales, topics, translate };
})(window);
