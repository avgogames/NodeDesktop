/**
 * Pure process-list logic: filtering, sorting and tree flattening.
 * Kept free of DOM access so it can be unit-tested in Node
 * (test/renderer.test.js).
 */

/** Columns that sort as text rather than numbers. */
const TEXT_COLUMNS = new Set(['name', 'user']);

export function compareBy(column, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  const primary = TEXT_COLUMNS.has(column)
    ? (a, b) => String(a[column]).localeCompare(String(b[column]), undefined, { sensitivity: 'base' })
    : (a, b) => (a[column] ?? -1) - (b[column] ?? -1);
  // Ties always fall back to ascending pid so rows don't jump between refreshes.
  return (a, b) => sign * primary(a, b) || a.pid - b.pid;
}

export function matchesFilter(proc, { filter, myUid, query }) {
  if (filter === 'mine' && proc.uid !== myUid) return false;
  if (filter === 'active' && !(proc.cpuPercent > 0 || proc.state === 'R')) return false;
  if (query) {
    const q = query.toLowerCase();
    return proc.name.toLowerCase().includes(q)
      || proc.user.toLowerCase().includes(q)
      || String(proc.pid) === q
      || proc.cmdline.toLowerCase().includes(q);
  }
  return true;
}

/**
 * Produce the visible row list.
 *
 * Flat mode: filter + sort. Tree mode ("Show dependencies"): processes are
 * nested under their parent; a process whose parent is filtered out becomes
 * a root. Siblings are sorted by the active column, and collapsed subtrees
 * are skipped. Each row is `{ proc, depth, hasChildren, expanded }`.
 */
export function buildRows(processes, { filter = 'all', myUid, query = '', sortColumn = 'cpuPercent',
  sortDirection = 'desc', tree = false, collapsed = new Set() } = {}) {
  const visible = processes.filter((p) => matchesFilter(p, { filter, myUid, query }));
  const cmp = compareBy(sortColumn, sortDirection);

  if (!tree) {
    return visible.sort(cmp).map((proc) => ({ proc, depth: 0, hasChildren: false, expanded: false }));
  }

  const byPid = new Map(visible.map((p) => [p.pid, p]));
  const children = new Map();
  const roots = [];
  for (const p of visible) {
    if (p.ppid !== p.pid && byPid.has(p.ppid)) {
      if (!children.has(p.ppid)) children.set(p.ppid, []);
      children.get(p.ppid).push(p);
    } else {
      roots.push(p);
    }
  }

  const rows = [];
  // Iterative DFS so very deep trees can't overflow the stack.
  const stack = roots.sort(cmp).reverse().map((proc) => ({ proc, depth: 0 }));
  while (stack.length) {
    const { proc, depth } = stack.pop();
    const kids = children.get(proc.pid) ?? [];
    const expanded = !collapsed.has(proc.key);
    rows.push({ proc, depth, hasChildren: kids.length > 0, expanded });
    if (expanded && kids.length) {
      const sorted = kids.sort(cmp);
      for (let i = sorted.length - 1; i >= 0; i -= 1) stack.push({ proc: sorted[i], depth: depth + 1 });
    }
  }
  return rows;
}
