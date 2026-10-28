import {
  parseBcrpJson,
  parseBcrpCsv,
  parseLocalFallback,
  filterSeries,
  calculateSummary,
  movingAverage,
  projectNextMonths,
  runBacktest,
  buildVisibleCsv,
} from './analytics.js';

const SOURCE_ENDPOINTS = [
  'https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PN01234PM/json',
  'https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PN01234PM/csv',
  'https://r.jina.ai/http://estadisticas.bcrp.gob.pe/estadisticas/series/api/PN01234PM/json',
];
const FALLBACK_URL = './data/fallback-pn01234pm.json';

const currencyFormatter = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const monthFormatter = new Intl.DateTimeFormat('es-PE', {
  year: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const ui = {
  status: document.getElementById('status'),
  source: document.getElementById('source-label'),
  updatedAt: document.getElementById('updated-at'),
  period: document.getElementById('period-filter'),
  customRange: document.getElementById('custom-range'),
  customStart: document.getElementById('start-month'),
  customEnd: document.getElementById('end-month'),
  maWindow: document.getElementById('ma-window'),
  downloadBtn: document.getElementById('download-csv'),
  cards: {
    latest: document.getElementById('metric-latest'),
    min: document.getElementById('metric-min'),
    max: document.getElementById('metric-max'),
    avg: document.getElementById('metric-avg'),
    change: document.getElementById('metric-change'),
  },
  backtestBody: document.getElementById('backtest-body'),
};

let chart;
let rawData = [];
let activeData = [];
let activeMA = [];
let activeProjection = [];

init();

async function init() {
  bindEvents();
  setStatus('Cargando datos del BCRP…', 'loading');
  const loaded = await loadSeries();
  rawData = loaded.data;

  if (!rawData.length) {
    setStatus('No se encontraron datos disponibles para mostrar.', 'error');
    return;
  }

  ui.source.textContent = loaded.sourceLabel;
  render();
}

function bindEvents() {
  ui.period.addEventListener('change', () => {
    ui.customRange.hidden = ui.period.value !== 'custom';
    render();
  });
  ui.customStart.addEventListener('change', render);
  ui.customEnd.addEventListener('change', render);
  ui.maWindow.addEventListener('change', render);
  ui.downloadBtn.addEventListener('click', downloadCsv);
}

async function loadSeries() {
  for (const endpoint of SOURCE_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, 12000);
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      const parsed = contentType.includes('json')
        ? parseBcrpJson(JSON.parse(text))
        : parseTextData(text);

      if (parsed.length) {
        setStatus('Datos reales cargados correctamente.', 'ok');
        return {
          data: parsed,
          sourceLabel: `BCRP PN01234PM (${endpoint})`,
        };
      }
    } catch (_error) {
      // Continúa con siguiente endpoint
    }
  }

  try {
    const fallbackResponse = await fetch(FALLBACK_URL);
    const fallbackPayload = await fallbackResponse.json();
    const parsed = parseLocalFallback(fallbackPayload);
    if (parsed.length) {
      setStatus('Usando datos locales de ejemplo por contingencia de red/CORS.', 'warning');
      return {
        data: parsed,
        sourceLabel: 'Fallback local de ejemplo (no reemplaza fuente oficial BCRP)',
      };
    }
  } catch (_error) {
    // handled below
  }

  setStatus('Error de red: no fue posible cargar datos del BCRP ni fallback local.', 'error');
  return { data: [], sourceLabel: 'Sin fuente disponible' };
}

function parseTextData(text) {
  if (!text) return [];
  try {
    return parseBcrpJson(JSON.parse(text));
  } catch {
    return parseBcrpCsv(text);
  }
}

function render() {
  const period = ui.period.value;
  const maWindow = Number(ui.maWindow.value);
  activeData = filterSeries(rawData, period, ui.customStart.value, ui.customEnd.value);

  if (!activeData.length) {
    setStatus('El rango seleccionado no tiene datos.', 'warning');
    return;
  }

  activeMA = movingAverage(activeData, maWindow);
  activeProjection = projectNextMonths(activeData, 6, Math.max(maWindow, 12));

  renderCards(calculateSummary(activeData));
  renderChart(activeData, activeMA, activeProjection);
  renderBacktest(runBacktest(activeData, [1, 3, 6], Math.max(maWindow, 12)));

  const latestDate = activeData[activeData.length - 1].date;
  ui.updatedAt.textContent = monthFormatter.format(latestDate);
}

function renderCards(summary) {
  if (!summary) return;
  ui.cards.latest.textContent = currencyFormatter.format(summary.latest);
  ui.cards.min.textContent = currencyFormatter.format(summary.min);
  ui.cards.max.textContent = currencyFormatter.format(summary.max);
  ui.cards.avg.textContent = currencyFormatter.format(summary.average);

  if (summary.delta === null) {
    ui.cards.change.textContent = 'N/D';
    return;
  }

  const sign = summary.delta >= 0 ? '+' : '';
  ui.cards.change.textContent = `${sign}${currencyFormatter.format(summary.delta)} (${sign}${summary.deltaPct.toFixed(2)}%)`;
}

function renderChart(data, maSeries, projection) {
  const ctx = document.getElementById('exchange-chart');
  const labels = [...data.map((row) => monthFormatter.format(row.date)), ...projection.map((row) => monthFormatter.format(row.date))];

  const actualValues = [...data.map((row) => row.value), ...Array(projection.length).fill(null)];
  const maValues = labels.map((_, idx) => {
    if (idx >= data.length) return null;
    const date = data[idx].date;
    const row = maSeries.find((item) => item.date.getTime() === date.getTime());
    return row ? row.value : null;
  });
  const projCenter = [...Array(data.length).fill(null), ...projection.map((row) => row.center)];
  const projLower = [...Array(data.length).fill(null), ...projection.map((row) => row.lower)];
  const projUpper = [...Array(data.length).fill(null), ...projection.map((row) => row.upper)];

  if (chart) chart.destroy();

  if (typeof Chart === 'undefined') {
    drawBasicChart(ctx, actualValues, projCenter, projLower, projUpper);
    setStatus('Datos cargados. La librería interactiva del gráfico no estuvo disponible en esta sesión.', 'warning');
    return;
  }

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'USD/PEN mensual',
          data: actualValues,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.2)',
          borderWidth: 2,
          tension: 0.24,
          pointRadius: 0,
        },
        {
          label: `Media móvil (${ui.maWindow.value}m)`,
          data: maValues,
          borderColor: '#f97316',
          borderDash: [6, 4],
          borderWidth: 2,
          tension: 0.2,
          pointRadius: 0,
        },
        {
          label: 'Límite inferior proyección',
          data: projLower,
          borderColor: 'rgba(168, 85, 247, 0)',
          pointRadius: 0,
          tension: 0.2,
        },
        {
          label: 'Rango de incertidumbre (6 meses)',
          data: projUpper,
          borderColor: 'rgba(168, 85, 247, 0)',
          backgroundColor: 'rgba(168, 85, 247, 0.2)',
          pointRadius: 0,
          tension: 0.2,
          fill: '-1',
        },
        {
          label: 'Proyección referencial',
          data: projCenter,
          borderColor: '#a855f7',
          borderWidth: 2,
          borderDash: [3, 3],
          pointRadius: 2,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label(context) {
              if (context.raw === null) return null;
              return `${context.dataset.label}: ${currencyFormatter.format(context.raw)}`;
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback(value) {
              return currencyFormatter.format(value);
            },
          },
        },
      },
    },
  });
}

function drawBasicChart(canvas, actual, projectionCenter, projectionLower, projectionUpper) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.clientWidth || 900;
  const height = canvas.clientHeight || 360;
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);

  const allValues = [...actual, ...projectionCenter, ...projectionLower, ...projectionUpper].filter((v) => v !== null);
  if (!allValues.length) return;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const scaleY = (value) => height - 25 - ((value - min) / (max - min || 1)) * (height - 50);
  const scaleX = (index, total) => 30 + (index / (total - 1 || 1)) * (width - 60);

  const drawLine = (series, color, dash = []) => {
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash(dash);
    let started = false;
    series.forEach((value, index) => {
      if (value === null) return;
      const x = scaleX(index, series.length);
      const y = scaleY(value);
      if (!started) {
        context.moveTo(x, y);
        started = true;
      } else {
        context.lineTo(x, y);
      }
    });
    if (started) context.stroke();
    context.setLineDash([]);
  };

  drawLine(actual, '#2563eb');
  drawLine(projectionCenter, '#a855f7', [4, 4]);
}

function renderBacktest(metrics) {
  ui.backtestBody.innerHTML = '';
  metrics.forEach((metric) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${metric.horizon} mes(es)</td>
      <td>${metric.samples}</td>
      <td>${metric.mae === null ? 'N/D' : currencyFormatter.format(metric.mae)}</td>
      <td>${metric.mape === null ? 'N/D' : `${metric.mape.toFixed(2)}%`}</td>
    `;
    ui.backtestBody.appendChild(row);
  });
}

function downloadCsv() {
  const csv = buildVisibleCsv(activeData, activeMA, activeProjection);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `usd-pen-visible-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setStatus(message, tone) {
  ui.status.textContent = message;
  ui.status.dataset.tone = tone;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
}
