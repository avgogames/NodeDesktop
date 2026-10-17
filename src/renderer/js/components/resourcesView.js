import { LineChart } from './lineChart.js';
import { formatBytes, formatRate, formatPercent } from '../format.js';

/** GNOME System Monitor's default CPU palette, extended for many-core machines. */
const CPU_COLORS = [
  '#e01b24', '#ff7800', '#f6d32d', '#33d17a', '#3584e4', '#9141ac', '#986a44', '#c64600',
  '#26a269', '#1a5fb4', '#c061cb', '#63452c', '#ed333b', '#ffa348', '#57e389', '#62a0ea',
];
const MEMORY_COLOR = '#9141ac';
const SWAP_COLOR = '#26a269';
const RX_COLOR = '#3584e4';
const TX_COLOR = '#e01b24';
const READ_COLOR = '#33d17a';
const WRITE_COLOR = '#ff7800';

/**
 * The Resources view: CPU, memory/swap, network and disk graphs.
 * History lives in the main process, so a reload resumes with full graphs.
 */
export class ResourcesView {
  constructor() {
    this.points = [];
    this.capacity = 60;
    this.intervalMs = 2000;
    const card = (id) => document.getElementById(id);
    this.cards = {
      cpu: card('card-cpu'),
      memory: card('card-memory'),
      network: card('card-network'),
      disk: card('card-disk'),
    };
    const rate = (v) => formatRate(v);
    this.charts = {
      cpu: new LineChart(this.cards.cpu.querySelector('canvas'), { max: 100 }),
      memory: new LineChart(this.cards.memory.querySelector('canvas'), { max: 100 }),
      network: new LineChart(this.cards.network.querySelector('canvas'), { formatAxis: rate }),
      disk: new LineChart(this.cards.disk.querySelector('canvas'), { formatAxis: rate }),
    };
    this.cpuLegendBuilt = 0;
  }

  setHistory({ historyLength, points }, intervalMs) {
    this.capacity = historyLength;
    this.intervalMs = intervalMs;
    this.points = points.slice(-historyLength);
    this.render();
  }

  setInterval(intervalMs, historyLength) {
    this.intervalMs = intervalMs;
    this.capacity = historyLength;
    this.points = this.points.slice(-historyLength);
  }

  push(point) {
    this.points.push(point);
    if (this.points.length > this.capacity) this.points.splice(0, this.points.length - this.capacity);
    this.render();
  }

  render() {
    const pts = this.points;
    const last = pts[pts.length - 1];
    if (!last) return;
    const seconds = Math.round((this.capacity * this.intervalMs) / 1000);

    // CPU
    const coreCount = last.cores.length;
    this.charts.cpu.setData(
      Array.from({ length: coreCount }, (_, i) => ({
        color: CPU_COLORS[i % CPU_COLORS.length],
        values: pts.map((p) => p.cores[i] ?? 0),
      })),
      this.capacity, seconds,
    );
    this.renderCpuLegend(last);

    // Memory & swap as a percentage of their totals.
    const mem = last.memory;
    if (mem) {
      this.charts.memory.setData([
        { color: MEMORY_COLOR, values: pts.map((p) => pct(p.memory?.used, p.memory?.total)) },
        { color: SWAP_COLOR, values: pts.map((p) => pct(p.memory?.swapUsed, p.memory?.swapTotal)) },
      ], this.capacity, seconds);
      this.renderLegend(this.cards.memory, [
        {
          color: MEMORY_COLOR,
          label: 'Memory',
          value: `${formatBytes(mem.used)} (${formatPercent(pct(mem.used, mem.total))}) of ${formatBytes(mem.total)}`,
          sub: `Cache ${formatBytes(mem.cached)}`,
        },
        {
          color: SWAP_COLOR,
          label: 'Swap',
          value: mem.swapTotal > 0
            ? `${formatBytes(mem.swapUsed)} (${formatPercent(pct(mem.swapUsed, mem.swapTotal))}) of ${formatBytes(mem.swapTotal)}`
            : 'Not available',
        },
      ]);
    }

    // Network
    this.charts.network.setData([
      { color: RX_COLOR, values: pts.map((p) => p.network.rx) },
      { color: TX_COLOR, values: pts.map((p) => p.network.tx) },
    ], this.capacity, seconds);
    this.renderLegend(this.cards.network, [
      { color: RX_COLOR, label: 'Receiving', value: formatRate(last.network.rx), sub: `Total Received ${formatBytes(last.network.rxTotal)}` },
      { color: TX_COLOR, label: 'Sending', value: formatRate(last.network.tx), sub: `Total Sent ${formatBytes(last.network.txTotal)}` },
    ]);

    // Disk
    this.charts.disk.setData([
      { color: READ_COLOR, values: pts.map((p) => p.disk.read) },
      { color: WRITE_COLOR, values: pts.map((p) => p.disk.write) },
    ], this.capacity, seconds);
    this.renderLegend(this.cards.disk, [
      { color: READ_COLOR, label: 'Reading', value: formatRate(last.disk.read), sub: `Total Read ${formatBytes(last.disk.readTotal)}` },
      { color: WRITE_COLOR, label: 'Writing', value: formatRate(last.disk.write), sub: `Total Written ${formatBytes(last.disk.writeTotal)}` },
    ]);
  }

  renderCpuLegend(last) {
    const legend = this.cards.cpu.querySelector('.legend');
    if (this.cpuLegendBuilt !== last.cores.length) {
      legend.replaceChildren(...last.cores.map((_, i) =>
        legendItem({ color: CPU_COLORS[i % CPU_COLORS.length], label: `CPU${i + 1}`, value: '' })));
      this.cpuLegendBuilt = last.cores.length;
    }
    last.cores.forEach((v, i) => {
      legend.children[i].querySelector('.value').textContent = formatPercent(v);
    });
  }

  renderLegend(card, items) {
    const legend = card.querySelector('.legend');
    if (legend.children.length !== items.length) legend.replaceChildren(...items.map(legendItem));
    items.forEach((item, i) => {
      const el = legend.children[i];
      el.querySelector('.value').textContent = item.value;
      const sub = el.querySelector('.sub');
      if (sub) sub.textContent = item.sub ?? '';
    });
  }
}

function legendItem({ color, label, sub }) {
  const el = document.createElement('div');
  el.className = 'legend-item';
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = color;
  const text = document.createElement('span');
  text.className = 'label';
  const name = document.createElement('span');
  name.textContent = `${label} `;
  const value = document.createElement('span');
  value.className = 'value';
  text.append(name, value);
  if (sub !== undefined) {
    const subEl = document.createElement('span');
    subEl.className = 'sub';
    text.appendChild(subEl);
  }
  el.append(swatch, text);
  return el;
}

function pct(part, total) {
  return total > 0 ? (part / total) * 100 : 0;
}
