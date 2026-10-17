/**
 * Popover menus (header menus and the process context menu).
 *
 * Items: { label, shortcut, onSelect, disabled, danger, checked, radio }
 *        { separator: true } | { heading: 'Text' }
 */

let openMenu = null;

export function closeMenu() {
  if (!openMenu) return;
  openMenu.el.remove();
  document.removeEventListener('pointerdown', openMenu.onOutside, true);
  document.removeEventListener('keydown', openMenu.onKey, true);
  window.removeEventListener('blur', closeMenu);
  const { restoreFocus } = openMenu;
  openMenu = null;
  restoreFocus?.focus?.();
}

/**
 * Show a menu at a point ({x, y}) or anchored below an element.
 */
export function showMenu(items, { x, y, anchor, align = 'start' } = {}) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');

  for (const item of items) {
    if (item.separator) {
      el.appendChild(document.createElement('hr'));
      continue;
    }
    if (item.heading) {
      const h = document.createElement('div');
      h.className = 'menu-heading';
      h.textContent = item.heading;
      el.appendChild(h);
      continue;
    }
    const btn = document.createElement('button');
    const role = item.radio ? 'menuitemradio' : item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem';
    btn.setAttribute('role', role);
    if (item.checked !== undefined) btn.setAttribute('aria-checked', String(Boolean(item.checked)));
    btn.disabled = Boolean(item.disabled);
    if (item.danger) btn.classList.add('danger');

    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = item.checked ? (item.radio ? '●' : '✓') : '';
    const label = document.createElement('span');
    label.textContent = item.label;
    btn.append(check, label);
    if (item.shortcut) {
      const sc = document.createElement('span');
      sc.className = 'shortcut';
      sc.textContent = item.shortcut;
      btn.appendChild(sc);
    }
    btn.addEventListener('click', () => {
      closeMenu();
      item.onSelect?.();
    });
    el.appendChild(btn);
  }

  document.body.appendChild(el);

  // Position, keeping the menu inside the window.
  const rect = el.getBoundingClientRect();
  let left = x ?? 0;
  let top = y ?? 0;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    left = align === 'end' ? a.right - rect.width : a.left;
    top = a.bottom + 4;
  }
  left = Math.max(4, Math.min(left, window.innerWidth - rect.width - 4));
  top = Math.max(4, Math.min(top, window.innerHeight - rect.height - 4));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  const focusables = () => [...el.querySelectorAll('button:not(:disabled)')];
  const onOutside = (e) => {
    if (!el.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    const list = focusables();
    const idx = list.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(idx + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(idx - 1 + list.length) % list.length]?.focus();
    }
    e.stopPropagation();
  };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeMenu);
  openMenu = { el, onOutside, onKey, restoreFocus: document.activeElement };
  focusables()[0]?.focus();
}
