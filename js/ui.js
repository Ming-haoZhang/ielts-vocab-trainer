// ui.js — tiny DOM helpers, escape, toast, modal

export function el(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'dataset' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
      } else if (v === true) {
        node.setAttribute(k, '');
      } else {
        node.setAttribute(k, v);
      }
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      node.appendChild(document.createTextNode(String(c)));
    } else if (c instanceof Node) {
      node.appendChild(c);
    }
  }
  return node;
}

export function fragment(...children) {
  const f = document.createDocumentFragment();
  for (const c of children.flat(Infinity)) {
    if (c == null) continue;
    if (c instanceof Node) f.appendChild(c);
  }
  return f;
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ESC_MAP[c]);
}

// ---- toast ----
function ensureToastRoot() {
  let r = document.getElementById('toast-root');
  if (!r) {
    r = el('div', { id: 'toast-root' });
    document.body.appendChild(r);
  }
  return r;
}
export function toast(msg, type = '') {
  const root = ensureToastRoot();
  const t = el('div', { class: `toast ${type}` }, msg);
  root.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 0.3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, 2400);
}

// ---- modal ----
function ensureModalRoot() {
  let r = document.getElementById('modal-root');
  if (!r) {
    r = el('div', { id: 'modal-root' });
    document.body.appendChild(r);
  }
  return r;
}
export function openModal({ title, body, actions = [] }) {
  const root = ensureModalRoot();
  root.innerHTML = '';
  const back = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' });
  if (title) modal.appendChild(el('h2', {}, title));
  if (typeof body === 'string') modal.appendChild(el('div', {}, body));
  else if (body instanceof Node) modal.appendChild(body);
  const acts = el('div', { class: 'modal-actions' });
  for (const a of actions) {
    const b = el('button', { class: `btn ${a.kind || ''}` }, a.label);
    b.addEventListener('click', () => {
      try { a.onClick && a.onClick(); } finally { closeModal(); }
    });
    acts.appendChild(b);
  }
  modal.appendChild(acts);
  back.appendChild(modal);
  back.addEventListener('click', (ev) => {
    if (ev.target === back) closeModal();
  });
  root.appendChild(back);
  return { close: closeModal };
}
export function closeModal() {
  const r = document.getElementById('modal-root');
  if (r) r.innerHTML = '';
}

// simple render function: renderInto(container, tree)
export function renderInto(container, tree) {
  container.innerHTML = '';
  if (tree == null) return;
  if (Array.isArray(tree)) {
    for (const t of tree) if (t) container.appendChild(t);
  } else if (tree instanceof Node) {
    container.appendChild(tree);
  }
}
