const { Element } = require('./frontend.cjs');

// Only the generated controls/selectors used by practice flows are modeled here.
// This is not a browser HTML parser and must not be used to assert XSS safety.
function practiceDom() {
  const ids = new Map();
  class PracticeElement extends Element {
    set innerHTML(value) {
      super.innerHTML = value;
      this.generated = [];
      for (const match of String(value).matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
        const node = new PracticeElement(match[1]);
        for (const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
          const [, name, content = ''] = attribute;
          node.setAttribute(name, content);
          if (name.startsWith('data-')) node.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = content;
          if (name === 'class') for (const item of content.split(/\s+/)) node.classList.add(item);
          if (name === 'id') ids.set(`#${content}`, node);
          if (name === 'type' || name === 'value') node[name] = content;
          if (name === 'checked') node.checked = true;
        }
        this.generated.push(node);
      }
    }
    get innerHTML() { return super.innerHTML; }
    querySelectorAll(selector) {
      return (this.generated || []).filter(node => {
        if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
        if (selector.startsWith('#')) return node.getAttribute('id') === selector.slice(1);
        const attribute = selector.match(/^\[([\w-]+)\]$/);
        if (attribute) return node.getAttribute(attribute[1]) !== undefined;
        return node.tagName.toLowerCase() === selector;
      });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || super.querySelector(selector); }
    click() {
      if (this.type === 'checkbox') { this.checked = !this.checked; this.onchange?.({ target: this }); }
      else super.click();
    }
  }
  return { ids, createElement: tag => new PracticeElement(tag) };
}

module.exports = { practiceDom };
