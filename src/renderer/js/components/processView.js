import { VirtualTable } from './virtualTable.js';
import { showMenu } from './menu.js';
import { confirmDialog, niceDialog, tabbedDialog, cleanError } from './dialogs.js';
import { buildRows } from '../processModel.js';
import {
  formatBytes, formatRate, formatPercent, formatCpuTime, formatDate, priorityLabel, stateLabel,
  escapeHtml, PRIORITY_PRESETS,
} from '../format.js';

const DEFAULT_DIRECTION = { name: 'asc', user: 'asc', pid: 'asc' };

/**
 * The Processes view: a virtualized table plus every process action
 * (signals, priority, properties, open files, memory maps).
 */
export class ProcessView {
  constructor({ api, settings, toast }) {
    this.api = api;
    this.settings = settings;
    this.toast = toast;
    this.processes = [];
    this.myUid = -1;
    this.query = '';
    this.collapsed = new Set();
    this.summary = document.getElementById('process-summary');
    this.endButton = document.getElementById('end-process-button');

    this.table = new VirtualTable(document.getElementById('process-table'), {
      columns: this.columns(),
      getKey: (row) => row.proc.key,
      onSort: (column) => this.toggleSort(column),
      onSelect: (row) => { this.endButton.disabled = !row; },
      onActivate: (row) => this.showProperties(row.proc),
      onContextMenu: (row, point) => this.showContextMenu(row.proc, point),
      onToggle: (row) => this.toggleCollapsed(row.proc),
    });
    this.table.setSort(settings.sortColumn, settings.sortDirection);
    this.endButton.addEventListener('click', () => this.withSelection((p) => this.sendSignal(p, 'end')));
  }

  columns() {
    return [
      {
        id: 'name', label: 'Process Name', width: 'minmax(180px, 3fr)', className: 'cell-name',
        render: (row) => this.renderName(row),
        tooltip: (row) => row.proc.cmdline || row.proc.name,
      },
      { id: 'user', label: 'User', width: 'minmax(80px, 1fr)', render: (r) => r.proc.user },
      { id: 'cpuPercent', label: '% CPU', width: '80px', numeric: true, render: (r) => formatPercent(r.proc.cpuPercent) },
      { id: 'pid', label: 'ID', width: '80px', numeric: true, render: (r) => String(r.proc.pid) },
      { id: 'memory', label: 'Memory', width: '100px', numeric: true, render: (r) => formatBytes(r.proc.memory) },
      {
        id: 'diskRead', label: 'Disk Read', width: '100px', numeric: true,
        render: (r) => (r.proc.diskReadTotal === null ? 'N/A' : formatRate(r.proc.diskRead)),
      },
      {
        id: 'diskWrite', label: 'Disk Write', width: '100px', numeric: true,
        render: (r) => (r.proc.diskWriteTotal === null ? 'N/A' : formatRate(r.proc.diskWrite)),
      },
      { id: 'nice', label: 'Priority', width: '90px', render: (r) => priorityLabel(r.proc.nice) },
    ];
  }

  renderName({ proc, depth, hasChildren, expanded }) {
    const frag = document.createDocumentFragment();
    if (this.settings.showDependencies) {
      const indent = document.createElement('span');
      indent.style.width = `${depth * 16}px`;
      indent.style.flex = 'none';
      const toggle = document.createElement('span');
      toggle.className = `tree-toggle${hasChildren ? '' : ' leaf'}`;
      toggle.textContent = expanded ? '▾' : '▸';
      frag.append(indent, toggle);
    }
    const name = document.createElement('span');
    name.textContent = proc.name;
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    frag.appendChild(name);
    if (proc.state === 'T' || proc.state === 'Z') {
      const badge = document.createElement('span');
      badge.className = 'state-badge';
      badge.textContent = stateLabel(proc.state);
      frag.appendChild(badge);
    }
    return frag;
  }

  update({ processes, myUid }) {
    this.processes = processes;
    this.myUid = myUid;
    this.render();
  }

  render() {
    const s = this.settings;
    const rows = buildRows(this.processes, {
      filter: s.processFilter,
      myUid: this.myUid,
      query: this.query,
      sortColumn: s.sortColumn,
      sortDirection: s.sortDirection,
      tree: s.showDependencies,
      collapsed: this.collapsed,
    });
    this.table.emptyText = this.query ? `No processes match “${this.query}”` : 'No processes';
    this.table.setRows(rows);
    const shown = rows.length;
    const total = this.processes.length;
    this.summary.textContent = shown === total ? `${total} processes` : `${shown} of ${total} processes`;
  }

  setQuery(query) {
    this.query = query.trim();
    this.render();
  }

  applySettings(settings) {
    this.settings = settings;
    this.table.setSort(settings.sortColumn, settings.sortDirection);
    this.render();
  }

  toggleSort(column) {
    const s = this.settings;
    const direction = s.sortColumn === column
      ? (s.sortDirection === 'asc' ? 'desc' : 'asc')
      : (DEFAULT_DIRECTION[column] ?? 'desc');
    this.settings = { ...s, sortColumn: column, sortDirection: direction };
    this.table.setSort(column, direction);
    this.render();
    this.api.updateSettings({ sortColumn: column, sortDirection: direction });
  }

  toggleCollapsed(proc) {
    if (this.collapsed.has(proc.key)) this.collapsed.delete(proc.key);
    else this.collapsed.add(proc.key);
    this.render();
  }

  focus() {
    this.table.root.focus();
  }

  withSelection(fn) {
    const row = this.table.selectedRow();
    if (row) fn(row.proc);
  }

  /** Keyboard shortcuts matching GNOME System Monitor. Returns true if handled. */
  handleShortcut(e) {
    const key = e.key.toLowerCase();
    const map = {
      'ctrl+s': (p) => this.sendSignal(p, 'stop'),
      'ctrl+c': (p) => this.sendSignal(p, 'continue'),
      'ctrl+e': (p) => this.sendSignal(p, 'end'),
      'ctrl+k': (p) => this.sendSignal(p, 'kill'),
      delete: (p) => this.sendSignal(p, 'end'),
      'ctrl+m': (p) => this.showProperties(p, 'maps'),
      'ctrl+o': (p) => this.showProperties(p, 'files'),
      'alt+enter': (p) => this.showProperties(p),
    };
    const combo = `${e.ctrlKey ? 'ctrl+' : ''}${e.altKey ? 'alt+' : ''}${key}`;
    const action = map[combo];
    if (!action) return false;
    const row = this.table.selectedRow();
    if (!row) return false;
    e.preventDefault();
    action(row.proc);
    return true;
  }

  showContextMenu(proc, point) {
    const stopped = proc.state === 'T';
    showMenu([
      { label: 'Properties', shortcut: 'Alt+Enter', onSelect: () => this.showProperties(proc) },
      { label: 'Memory Maps', shortcut: 'Ctrl+M', onSelect: () => this.showProperties(proc, 'maps') },
      { label: 'Open Files', shortcut: 'Ctrl+O', onSelect: () => this.showProperties(proc, 'files') },
      { separator: true },
      { heading: 'Change Priority' },
      ...PRIORITY_PRESETS.map((p) => ({
        label: p.label,
        radio: true,
        checked: proc.nice === p.nice,
        onSelect: () => this.renice(proc, p.nice),
      })),
      {
        label: 'Custom…',
        radio: true,
        checked: !PRIORITY_PRESETS.some((p) => p.nice === proc.nice),
        onSelect: async () => {
          const nice = await niceDialog(proc);
          if (nice !== null) this.renice(proc, nice);
        },
      },
      { separator: true },
      { label: 'Stop', shortcut: 'Ctrl+S', disabled: stopped, onSelect: () => this.sendSignal(proc, 'stop') },
      { label: 'Continue', shortcut: 'Ctrl+C', disabled: !stopped, onSelect: () => this.sendSignal(proc, 'continue') },
      { label: 'End', shortcut: 'Ctrl+E', danger: true, onSelect: () => this.sendSignal(proc, 'end') },
      { label: 'Kill', shortcut: 'Ctrl+K', danger: true, onSelect: () => this.sendSignal(proc, 'kill') },
    ], point);
  }

  async sendSignal(proc, action) {
    if (action === 'end' || action === 'kill') {
      const kill = action === 'kill';
      const ok = await confirmDialog({
        title: `${kill ? 'Kill' : 'End'} the selected process “${proc.name}” (PID: ${proc.pid})?`,
        message: kill
          ? 'Killing a process may destroy data, break the session or introduce a security risk. Only unresponsive processes should be killed.'
          : 'Ending a process may destroy data, break the session or introduce a security risk. Only unresponsive processes should be ended.',
        confirmLabel: kill ? 'Kill Process' : 'End Process',
        destructive: true,
      });
      if (!ok) return;
    }
    await this.runPrivileged(
      (opts) => this.api.signalProcess(proc.pid, action, opts),
      `You don't have permission to send a signal to “${proc.name}”.`,
    );
  }

  async renice(proc, nice) {
    if (nice === proc.nice) return;
    await this.runPrivileged(
      (opts) => this.api.reniceProcess(proc.pid, nice, opts),
      `Changing the priority of “${proc.name}” to ${nice} requires administrator privileges.`,
    );
  }

  /** Try an action; on a permission error offer to retry through polkit. */
  async runPrivileged(call, permissionMessage) {
    try {
      const result = await call({});
      if (result.ok) return;
      if (result.code === 'EPERM' || result.code === 'EACCES') {
        const retry = await confirmDialog({
          title: 'Administrator privileges required',
          message: `${permissionMessage} Do you want to authenticate and try again?`,
          confirmLabel: 'Authenticate',
        });
        if (retry) await call({ elevated: true });
      } else if (result.code === 'ESRCH') {
        this.toast('The process no longer exists');
      } else {
        this.toast(result.message || 'The action failed');
      }
    } catch (err) {
      this.toast(cleanError(err));
    }
  }

  showProperties(proc, initialTab = 'general') {
    const { api } = this;
    tabbedDialog({
      title: `${proc.name} (PID ${proc.pid})`,
      initialTab,
      tabs: [
        {
          id: 'general',
          label: 'Properties',
          render: async () => {
            const d = await api.getProcessDetails(proc.pid);
            const rows = [
              ['Process Name', d.name],
              ['User', d.user],
              ['Status', d.state],
              ['Process ID', d.pid],
              ['Parent ID', d.ppid],
              ['Threads', d.threads],
              ['Priority', `${priorityLabel(d.nice)} (nice ${d.nice})`],
              ['CPU Time', formatCpuTime(d.cpuTime)],
              ['Started', formatDate(d.startedAt)],
              ['Virtual Memory', formatBytes(d.vmSize)],
              ['Resident Memory', formatBytes(d.vmRss)],
              ['Anonymous Memory', formatBytes(d.rssAnon)],
              ['File-backed Memory', formatBytes(d.rssFile)],
              ['Shared Memory', formatBytes(d.rssShmem)],
              ['Swap', formatBytes(d.vmSwap)],
              ['Executable', d.exe ?? 'N/A (permission denied)'],
              ['Working Directory', d.cwd ?? 'N/A (permission denied)'],
              ['Command Line', d.cmdline || `[${d.name}]`],
            ];
            return `<dl class="props">${rows.map(([k, v]) =>
              `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v ?? 'N/A')}</dd>`).join('')}</dl>`;
          },
        },
        {
          id: 'files',
          label: 'Open Files',
          render: async () => {
            const files = await api.getOpenFiles(proc.pid);
            if (!files.length) return '<p class="dim">No open files</p>';
            return `<table class="mini-table"><thead><tr><th>FD</th><th>Type</th><th>Object</th></tr></thead><tbody>${
              files.map((f) => `<tr><td>${f.fd}</td><td>${escapeHtml(f.type)}</td><td class="path">${escapeHtml(f.target)}</td></tr>`).join('')
            }</tbody></table>`;
          },
        },
        {
          id: 'maps',
          label: 'Memory Maps',
          render: async () => {
            const maps = await api.getMemoryMaps(proc.pid);
            if (!maps.length) return '<p class="dim">No memory mappings (kernel thread)</p>';
            return `<table class="mini-table mono"><thead><tr><th>Start</th><th>End</th><th>Size</th><th>Flags</th><th>Offset</th><th>Filename</th></tr></thead><tbody>${
              maps.map((m) => `<tr><td>${m.start}</td><td>${m.end}</td><td>${formatBytes(m.size)}</td><td>${escapeHtml(m.perms)}</td><td>${m.offset}</td><td class="path">${escapeHtml(m.path)}</td></tr>`).join('')
            }</tbody></table>`;
          },
        },
      ],
    });
  }
}
