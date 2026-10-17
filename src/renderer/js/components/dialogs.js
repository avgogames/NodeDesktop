import { escapeHtml } from '../format.js';

/**
 * Promise-based modal dialogs built on <dialog>. Content that comes from
 * processes (names, paths) is always escaped before it reaches innerHTML.
 */

function createDialog(className = '') {
  const dialog = document.createElement('dialog');
  if (className) dialog.className = className;
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  return dialog;
}

/**
 * Confirmation dialog. Resolves true when the confirm button is pressed.
 * @param {{title: string, message: string, confirmLabel: string, destructive?: boolean}} opts
 */
export function confirmDialog({ title, message, confirmLabel = 'OK', destructive = false }) {
  return new Promise((resolve) => {
    const dialog = createDialog();
    dialog.innerHTML = `
      <div class="dialog-body">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="dialog-actions">
        <button data-action="cancel">Cancel</button>
        <button data-action="confirm" class="${destructive ? 'destructive' : 'suggested'}">${escapeHtml(confirmLabel)}</button>
      </div>`;
    let result = false;
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      result = true;
      dialog.close();
    });
    dialog.addEventListener('close', () => resolve(result));
    dialog.showModal();
    dialog.querySelector('[data-action="cancel"]').focus();
  });
}

/** Custom nice value picker. Resolves the chosen nice value or null. */
export function niceDialog({ name, pid, nice }) {
  return new Promise((resolve) => {
    const dialog = createDialog();
    dialog.innerHTML = `
      <div class="dialog-body">
        <h3>Change Priority of “${escapeHtml(name)}” (PID: ${pid})</h3>
        <p>The priority of a process is given by its nice value. A lower nice value corresponds to a higher priority.
           Raising priority usually requires administrator privileges.</p>
        <div class="nice-control">
          <span class="dim">Nice value</span>
          <input type="range" min="-20" max="19" step="1" value="${Number(nice)}" aria-label="Nice value">
          <output>${Number(nice)}</output>
        </div>
      </div>
      <div class="dialog-actions">
        <button data-action="cancel">Cancel</button>
        <button data-action="confirm" class="suggested">Change Priority</button>
      </div>`;
    const range = dialog.querySelector('input');
    const out = dialog.querySelector('output');
    range.addEventListener('input', () => { out.textContent = range.value; });
    let result = null;
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      result = Number(range.value);
      dialog.close();
    });
    dialog.addEventListener('close', () => resolve(result));
    dialog.showModal();
    range.focus();
  });
}

/**
 * Tabbed dialog with lazily loaded panels.
 * @param {{title: string, tabs: {id: string, label: string, render: () => Promise<string>}[], initialTab?: string}} opts
 */
export function tabbedDialog({ title, tabs, initialTab }) {
  const dialog = createDialog('dialog-wide');
  dialog.innerHTML = `
    <div class="dialog-body">
      <h3>${escapeHtml(title)}</h3>
      <div class="tabs" role="tablist">
        ${tabs.map((t) => `<button role="tab" data-tab="${t.id}">${escapeHtml(t.label)}</button>`).join('')}
      </div>
      <div class="tab-panel" role="tabpanel"></div>
    </div>
    <div class="dialog-actions"><button data-action="close" class="suggested">Close</button></div>`;
  const panel = dialog.querySelector('.tab-panel');
  const cache = new Map();

  async function select(id) {
    for (const b of dialog.querySelectorAll('[role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
    const tab = tabs.find((t) => t.id === id);
    if (!cache.has(id)) {
      panel.innerHTML = '<p class="dim">Loading…</p>';
      try {
        cache.set(id, await tab.render());
      } catch (err) {
        cache.set(id, `<p class="dim">${escapeHtml(cleanError(err))}</p>`);
      }
    }
    // Only paint if the user hasn't switched tabs while we were loading.
    if (dialog.querySelector('[aria-selected="true"]')?.dataset.tab === id) {
      panel.innerHTML = cache.get(id);
      panel.scrollTop = 0;
    }
  }

  dialog.querySelector('.tabs').addEventListener('click', (e) => {
    const id = e.target.closest('[data-tab]')?.dataset.tab;
    if (id) select(id);
  });
  dialog.querySelector('[data-action="close"]').addEventListener('click', () => dialog.close());
  dialog.showModal();
  select(initialTab ?? tabs[0].id);
}

/** Simple informational dialog with raw (already escaped) HTML content. */
export function infoDialog({ title, html }) {
  const dialog = createDialog();
  dialog.innerHTML = `
    <div class="dialog-body"><h3>${escapeHtml(title)}</h3>${html}</div>
    <div class="dialog-actions"><button data-action="close" class="suggested">Close</button></div>`;
  dialog.querySelector('[data-action="close"]').addEventListener('click', () => dialog.close());
  dialog.showModal();
}

/** Strip Electron's "Error invoking remote method 'x': Error:" prefix. */
export function cleanError(err) {
  return String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
