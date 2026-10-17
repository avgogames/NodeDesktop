import { ProcessView } from './components/processView.js';
import { ResourcesView } from './components/resourcesView.js';
import { FileSystemsView } from './components/filesystemsView.js';
import { showMenu } from './components/menu.js';
import { infoDialog } from './components/dialogs.js';
import { escapeHtml, formatBytes } from './format.js';

/**
 * Renderer entry point: wires the header bar, view switching, menus and
 * keyboard shortcuts to the three views and the preload API.
 */

const api = window.monitor;
const VIEWS = ['processes', 'resources', 'filesystems'];
const INTERVALS = [1000, 2000, 3000, 5000];

const state = {
  view: 'processes',
  settings: null,
  system: null,
};

let toastTimer = 0;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function main() {
  const initial = await api.getInitialState();
  state.settings = initial.settings;
  state.system = initial.system;

  const processView = new ProcessView({ api, settings: state.settings, toast });
  const resourcesView = new ResourcesView();
  const filesystemsView = new FileSystemsView();
  resourcesView.setHistory(initial.resourceHistory, state.settings.updateInterval);

  api.onProcesses((data) => processView.update(data));
  api.onResources((point) => resourcesView.push(point));
  api.onFileSystems((rows) => filesystemsView.update(rows));
  api.onError(({ message }) => toast(`Sampling failed: ${message}`));

  async function updateSettings(patch) {
    state.settings = await api.updateSettings(patch);
    processView.applySettings(state.settings);
    if ('updateInterval' in patch) {
      resourcesView.setInterval(state.settings.updateInterval,
        Math.max(30, Math.round(120000 / state.settings.updateInterval)));
    }
  }

  // ---- View switching ----
  const tabs = [...document.querySelectorAll('.view-switcher [data-view]')];
  function showView(view) {
    state.view = view;
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.view === view));
    for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
    for (const el of document.querySelectorAll('[data-view-only]')) el.hidden = el.dataset.viewOnly !== view;
    api.setActiveView(view);
    if (view === 'resources') resourcesView.render();
    if (view === 'processes') processView.focus();
  }
  for (const tab of tabs) tab.addEventListener('click', () => showView(tab.dataset.view));

  // ---- Search ----
  const search = document.getElementById('search');
  search.addEventListener('input', () => processView.setQuery(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = '';
      processView.setQuery('');
      processView.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      processView.focus();
    }
  });

  // ---- Menus ----
  const filterButton = document.getElementById('filter-button');
  filterButton.addEventListener('click', () => {
    const f = state.settings.processFilter;
    showMenu([
      { label: 'All Processes', radio: true, checked: f === 'all', onSelect: () => updateSettings({ processFilter: 'all' }) },
      { label: 'My Processes', radio: true, checked: f === 'mine', onSelect: () => updateSettings({ processFilter: 'mine' }) },
      { label: 'Active Processes', radio: true, checked: f === 'active', onSelect: () => updateSettings({ processFilter: 'active' }) },
      { separator: true },
      {
        label: 'Show Dependencies',
        checked: state.settings.showDependencies,
        onSelect: () => updateSettings({ showDependencies: !state.settings.showDependencies }),
      },
    ], { anchor: filterButton, align: 'end' });
  });

  const menuButton = document.getElementById('menu-button');
  menuButton.addEventListener('click', () => {
    const s = state.settings;
    showMenu([
      { heading: 'Update Interval' },
      ...INTERVALS.map((ms) => ({
        label: `${ms / 1000} second${ms === 1000 ? '' : 's'}`,
        radio: true,
        checked: s.updateInterval === ms,
        onSelect: () => updateSettings({ updateInterval: ms }),
      })),
      { separator: true },
      {
        label: 'Show All File Systems',
        checked: s.showAllFileSystems,
        onSelect: () => updateSettings({ showAllFileSystems: !s.showAllFileSystems }),
      },
      { label: 'Refresh', shortcut: 'F5', onSelect: () => api.refresh() },
      { separator: true },
      { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+?', onSelect: showShortcuts },
      { label: 'About System Monitor', onSelect: showAbout },
    ], { anchor: menuButton, align: 'end' });
  });

  // ---- Global keyboard shortcuts ----
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.ctrlKey && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      showView(VIEWS[Number(e.key) - 1]);
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      showView('processes');
      search.focus();
      search.select();
      return;
    }
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
      e.preventDefault();
      api.refresh();
      return;
    }
    if (e.ctrlKey && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
      e.preventDefault();
      showShortcuts();
      return;
    }
    if (state.view !== 'processes') return;
    // Process shortcuts must not fire while typing in the search field.
    const inInput = document.activeElement?.tagName === 'INPUT';
    if (!inInput && processView.handleShortcut(e)) return;
    // Type-ahead: printable keys in the table start a search.
    if (!inInput && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && /\S/.test(e.key)) {
      search.focus();
    }
  });

  showView(state.view);
}

function showShortcuts() {
  const rows = [
    ['Switch to Processes / Resources / File Systems', 'Ctrl+1 / 2 / 3'],
    ['Search processes', 'Ctrl+F'],
    ['Refresh', 'F5'],
    ['Process properties', 'Alt+Enter'],
    ['Memory maps', 'Ctrl+M'],
    ['Open files', 'Ctrl+O'],
    ['Stop process', 'Ctrl+S'],
    ['Continue process', 'Ctrl+C'],
    ['End process', 'Ctrl+E or Delete'],
    ['Kill process', 'Ctrl+K'],
    ['Developer tools', 'Ctrl+Shift+I'],
  ];
  infoDialog({
    title: 'Keyboard Shortcuts',
    html: `<div class="shortcuts">${rows.map(([label, keys]) =>
      `<span>${escapeHtml(label)}</span><span>${keys.split(' ').map((k) =>
        (/^(or|\/)$/.test(k) ? ` ${k} ` : `<kbd>${escapeHtml(k)}</kbd>`)).join('')}</span>`).join('')}</div>`,
  });
}

function showAbout() {
  const s = state.system;
  const rows = [
    ['Hostname', s.hostname],
    ['Operating System', s.distro],
    ['Kernel', `${s.kernel} (${s.arch})`],
    ['Processor', `${s.cpuModel} × ${s.cpuCount}`],
    ['Memory', formatBytes(s.memoryTotal)],
  ];
  infoDialog({
    title: 'System Monitor',
    html: `<p>View current processes and monitor system state. A GNOME System Monitor–style app built with Electron.</p>
      <dl class="props">${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`,
  });
}

main().catch((err) => {
  console.error(err);
  toast(`Failed to start: ${err.message}`);
});
