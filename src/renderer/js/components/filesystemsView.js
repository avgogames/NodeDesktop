import { formatBytes, formatPercent } from '../format.js';

const TEXT_COLUMNS = new Set(['device', 'mountpoint', 'type']);

/** The File Systems view: one sortable row per mounted storage filesystem. */
export class FileSystemsView {
  constructor() {
    this.table = document.getElementById('fs-table');
    this.tbody = this.table.querySelector('tbody');
    this.rows = [];
    this.sort = { column: 'mountpoint', direction: 'asc' };
    this.table.querySelector('thead').addEventListener('click', (e) => {
      const column = e.target.closest('[data-sort]')?.dataset.sort;
      if (!column) return;
      this.sort = this.sort.column === column
        ? { column, direction: this.sort.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: TEXT_COLUMNS.has(column) ? 'asc' : 'desc' };
      this.render();
    });
  }

  update(rows) {
    this.rows = rows;
    this.render();
  }

  render() {
    const { column, direction } = this.sort;
    const sign = direction === 'asc' ? 1 : -1;
    const sorted = [...this.rows].sort((a, b) => (TEXT_COLUMNS.has(column)
      ? sign * String(a[column]).localeCompare(String(b[column]))
      : sign * ((a[column] ?? -1) - (b[column] ?? -1))));

    for (const th of this.table.querySelectorAll('th[data-sort]')) {
      if (th.dataset.sort === column) th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    }

    this.tbody.replaceChildren(...sorted.map((fs) => {
      const tr = document.createElement('tr');
      const cell = (text, className) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (className) td.className = className;
        tr.appendChild(td);
        return td;
      };
      cell(fs.device);
      cell(fs.mountpoint).title = fs.readOnly ? 'Mounted read-only' : '';
      cell(fs.type);
      if (fs.error) {
        const td = cell(`Unavailable: ${fs.error}`, 'dim');
        td.colSpan = 4;
        return tr;
      }
      cell(formatBytes(fs.total), 'num');
      cell(formatBytes(fs.available), 'num');
      cell(formatBytes(fs.used), 'num');

      const usage = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'usage';
      const bar = document.createElement('div');
      bar.className = `usage-bar${fs.percent >= 95 ? ' critical' : fs.percent >= 85 ? ' warn' : ''}`;
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuenow', String(Math.round(fs.percent)));
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      const fill = document.createElement('span');
      fill.style.width = `${Math.min(100, fs.percent)}%`;
      bar.appendChild(fill);
      const text = document.createElement('span');
      text.className = 'usage-text';
      text.textContent = formatPercent(fs.percent, 0);
      wrap.append(bar, text);
      usage.appendChild(wrap);
      tr.appendChild(usage);
      return tr;
    }));
  }
}
