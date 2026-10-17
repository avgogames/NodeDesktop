/**
 * Minimal HiDPI-aware canvas line chart for scrolling time series.
 *
 * Values are drawn right-aligned: the newest sample sits at the right edge
 * and the x-axis spans `capacity` samples, like GNOME's resource graphs.
 */
export class LineChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ max?: number, formatAxis?: (v: number) => string, seconds?: number }} options
   *   max: fixed y-axis maximum (e.g. 100 for percentages); omit to auto-scale.
   */
  constructor(canvas, { max, formatAxis = (v) => `${Math.round(v)}%`, seconds = 60 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fixedMax = max;
    this.formatAxis = formatAxis;
    this.seconds = seconds;
    this.series = [];
    this.capacity = 60;
    this.frame = 0;
    new ResizeObserver(() => this.requestDraw()).observe(canvas);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.requestDraw());
  }

  /** @param {{color: string, values: number[]}[]} series */
  setData(series, capacity, seconds) {
    this.series = series;
    this.capacity = Math.max(2, capacity);
    if (seconds) this.seconds = seconds;
    this.requestDraw();
  }

  requestDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw() {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (!cssWidth || !cssHeight) return; // hidden view
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const style = getComputedStyle(document.documentElement);
    const gridColor = style.getPropertyValue('--chart-grid').trim();
    const textColor = style.getPropertyValue('--chart-text').trim();
    ctx.font = '11px Cantarell, "Noto Sans", system-ui, sans-serif';

    const max = this.fixedMax ?? niceMax(Math.max(0, ...this.series.flatMap((s) => s.values)));
    const axisWidth = Math.max(36, ...[0, 1, 2, 3, 4].map((i) => ctx.measureText(this.formatAxis((max * i) / 4)).width + 8));
    const left = 0;
    const right = cssWidth - axisWidth;
    const top = 6;
    const bottom = cssHeight - 18;
    const plotH = bottom - top;
    const plotW = right - left;

    // Grid + y-axis labels.
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = textColor;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i += 1) {
      const y = Math.round(bottom - (plotH * i) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillText(this.formatAxis((max * i) / 4), right + 6, y);
    }
    // Vertical grid every quarter of the time span.
    for (let i = 0; i <= 4; i += 1) {
      const x = Math.round(left + (plotW * i) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${this.seconds} seconds`, left + 2, cssHeight - 4);
    ctx.textAlign = 'right';
    ctx.fillText('0', right - 2, cssHeight - 4);
    ctx.textAlign = 'left';

    const step = plotW / (this.capacity - 1);
    const fill = this.series.length <= 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top - 1, plotW, plotH + 2);
    ctx.clip();
    for (const s of this.series) {
      const n = s.values.length;
      if (n < 2) continue;
      const x0 = right - (n - 1) * step;
      const yOf = (v) => bottom - (Math.min(v, max) / max) * plotH;
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const x = x0 + i * step;
        if (i === 0) ctx.moveTo(x, yOf(v));
        else ctx.lineTo(x, yOf(v));
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = 'round';
      ctx.stroke();
      if (fill) {
        ctx.lineTo(right, bottom);
        ctx.lineTo(x0, bottom);
        ctx.closePath();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }
}

/**
 * Round an auto-scaled byte-rate maximum up to 1, 2 or 5 × 10^n of the
 * largest binary unit below it (e.g. 13 KiB/s -> 20 KiB/s), so the four
 * grid lines land on readable values. The floor is 1 KiB/s.
 */
export function niceMax(value) {
  const v = Math.max(value, 1024);
  const unit = Math.pow(1024, Math.floor(Math.log(v) / Math.log(1024)));
  const scaled = v / unit;
  const exp = Math.pow(10, Math.floor(Math.log10(scaled)));
  const m = scaled / exp;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * exp * unit;
}
