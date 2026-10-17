/**
 * A virtualized, sortable table.
 *
 * Only the rows inside the viewport (plus a small overscan) exist in the
 * DOM, and row elements are recycled between updates, so a list of several
 * thousand processes refreshes every second without layout thrash. Rows
 * have a fixed height (CSS --row-height) which makes the scroll math exact.
 *
 * columns: [{ id, label, width, numeric, render(row) -> string | Node }]
 */
export class VirtualTable {
  constructor(root, { columns, rowHeight = 30, getKey, onSort, onSelect, onActivate, onContextMenu, onToggle }) {
    this.root = root;
    this.columns = columns;
    this.rowHeight = rowHeight;
    this.getKey = getKey;
    this.onSort = onSort;
    this.onSelect = onSelect;
    this.onActivate = onActivate;
    this.onContextMenu = onContextMenu;
    this.onToggle = onToggle;
    this.rows = [];
    this.selectedKey = null;
    this.sort = { column: null, direction: 'desc' };
    this.pool = [];
    this.emptyText = 'No processes';

    root.style.setProperty('--columns', columns.map((c) => c.width).join(' '));
    root.style.setProperty('--row-height', `${rowHeight}px`);

    this.header = document.createElement('div');
    this.header.className = 'vtable-header';
    this.header.setAttribute('role', 'row');
    for (const col of columns) {
      const cell = document.createElement('div');
      cell.textContent = col.label;
      cell.dataset.column = col.id;
      cell.setAttribute('role', 'columnheader');
      if (col.numeric) cell.classList.add('num');
      this.header.appendChild(cell);
    }

    this.viewport = document.createElement('div');
    this.viewport.className = 'vtable-viewport';
    this.spacer = document.createElement('div');
    this.spacer.className = 'vtable-spacer';
    this.rowsEl = document.createElement('div');
    this.rowsEl.className = 'vtable-rows';
    this.empty = document.createElement('div');
    this.empty.className = 'vtable-empty';
    this.viewport.append(this.spacer, this.rowsEl, this.empty);
    root.append(this.header, this.viewport);

    this.header.addEventListener('click', (e) => {
      const id = e.target.closest('[data-column]')?.dataset.column;
      if (id) this.onSort?.(id);
    });
    this.viewport.addEventListener('scroll', () => this.paint());
    new ResizeObserver(() => this.paint()).observe(this.viewport);

    this.rowsEl.addEventListener('click', (e) => {
      const rowEl = e.target.closest('.vtable-row');
      if (!rowEl) return;
      const row = this.rows[Number(rowEl.dataset.index)];
      if (e.target.closest('.tree-toggle')) {
        this.onToggle?.(row);
        return;
      }
      this.select(this.getKey(row));
    });
    this.rowsEl.addEventListener('dblclick', (e) => {
      const rowEl = e.target.closest('.vtable-row');
      if (rowEl && !e.target.closest('.tree-toggle')) this.onActivate?.(this.rows[Number(rowEl.dataset.index)]);
    });
    this.rowsEl.addEventListener('contextmenu', (e) => {
      const rowEl = e.target.closest('.vtable-row');
      if (!rowEl) return;
      e.preventDefault();
      const row = this.rows[Number(rowEl.dataset.index)];
      this.select(this.getKey(row));
      this.onContextMenu?.(row, { x: e.clientX, y: e.clientY });
    });
    root.addEventListener('keydown', (e) => this.handleKey(e));
  }

  setSort(column, direction) {
    this.sort = { column, direction };
    for (const cell of this.header.children) {
      const active = cell.dataset.column === column;
      if (active) cell.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
      else cell.removeAttribute('aria-sort');
    }
  }

  setRows(rows) {
    this.rows = rows;
    // Drop the selection if the selected process disappeared.
    if (this.selectedKey !== null && !rows.some((r) => this.getKey(r) === this.selectedKey)) {
      this.selectedKey = null;
      this.onSelect?.(null);
    }
    this.spacer.style.height = `${rows.length * this.rowHeight}px`;
    this.empty.hidden = rows.length > 0;
    this.empty.textContent = this.emptyText;
    this.paint();
  }

  selectedRow() {
    return this.rows.find((r) => this.getKey(r) === this.selectedKey) ?? null;
  }

  select(key, { scroll = false } = {}) {
    this.selectedKey = key;
    if (scroll) this.scrollToKey(key);
    this.paint();
    this.onSelect?.(this.selectedRow());
  }

  scrollToKey(key) {
    const index = this.rows.findIndex((r) => this.getKey(r) === key);
    if (index < 0) return;
    const top = index * this.rowHeight;
    const viewTop = this.viewport.scrollTop;
    const viewBottom = viewTop + this.viewport.clientHeight - this.rowHeight;
    if (top < viewTop) this.viewport.scrollTop = top;
    else if (top > viewBottom) this.viewport.scrollTop = top - this.viewport.clientHeight + this.rowHeight;
  }

  handleKey(e) {
    if (!this.rows.length) return;
    const index = this.rows.findIndex((r) => this.getKey(r) === this.selectedKey);
    const pageSize = Math.max(1, Math.floor(this.viewport.clientHeight / this.rowHeight) - 1);
    let next = null;
    switch (e.key) {
      case 'ArrowDown': next = Math.min(this.rows.length - 1, index + 1); break;
      case 'ArrowUp': next = Math.max(0, index < 0 ? 0 : index - 1); break;
      case 'PageDown': next = Math.min(this.rows.length - 1, index + pageSize); break;
      case 'PageUp': next = Math.max(0, index - pageSize); break;
      case 'Home': next = 0; break;
      case 'End': next = this.rows.length - 1; break;
      case 'Enter':
        if (index >= 0) this.onActivate?.(this.rows[index]);
        return;
      case 'ArrowRight':
      case 'ArrowLeft': {
        const row = this.rows[index];
        if (row?.hasChildren && row.expanded === (e.key === 'ArrowLeft')) {
          e.preventDefault();
          this.onToggle?.(row);
        }
        return;
      }
      default: return;
    }
    e.preventDefault();
    this.select(this.getKey(this.rows[next]), { scroll: true });
  }

  /** Render the rows currently inside the viewport. */
  paint() {
    const height = this.viewport.clientHeight || 600;
    const overscan = 6;
    const first = Math.max(0, Math.floor(this.viewport.scrollTop / this.rowHeight) - overscan);
    const last = Math.min(this.rows.length, Math.ceil((this.viewport.scrollTop + height) / this.rowHeight) + overscan);
    const count = Math.max(0, last - first);

    while (this.pool.length < count) this.pool.push(this.createRowElement());
    while (this.rowsEl.children.length > count) this.rowsEl.lastChild.remove();
    while (this.rowsEl.children.length < count) this.rowsEl.appendChild(this.pool[this.rowsEl.children.length]);

    this.rowsEl.style.transform = `translateY(${first * this.rowHeight}px)`;
    for (let i = 0; i < count; i += 1) {
      const index = first + i;
      const row = this.rows[index];
      const el = this.rowsEl.children[i];
      el.dataset.index = String(index);
      el.classList.toggle('selected', this.getKey(row) === this.selectedKey);
      el.setAttribute('aria-selected', String(this.getKey(row) === this.selectedKey));
      this.columns.forEach((col, c) => {
        const cell = el.children[c];
        const value = col.render(row);
        if (typeof value === 'string') {
          // Avoid touching the DOM when nothing changed.
          if (cell.dataset.text !== value || cell.firstElementChild) {
            cell.textContent = value;
            cell.dataset.text = value;
            cell.title = col.tooltip ? col.tooltip(row) : value;
          }
        } else {
          cell.replaceChildren(value);
          delete cell.dataset.text;
          if (col.tooltip) cell.title = col.tooltip(row);
        }
      });
    }
  }

  createRowElement() {
    const el = document.createElement('div');
    el.className = 'vtable-row';
    el.setAttribute('role', 'row');
    for (const col of this.columns) {
      const cell = document.createElement('div');
      cell.setAttribute('role', 'gridcell');
      if (col.numeric) cell.classList.add('num');
      if (col.className) cell.classList.add(col.className);
      el.appendChild(cell);
    }
    return el;
  }
}
