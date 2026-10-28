const MONTHS_ES = {
  ene: 0,
  feb: 1,
  mar: 2,
  abr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  ago: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dic: 11,
};

export function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function parseSpanishMonthPeriod(periodName) {
  if (!periodName || typeof periodName !== 'string') return null;
  const clean = periodName.trim().toLowerCase().replace(/\s+/g, '');
  const match = clean.match(/^([a-záéíóúñ]{3})\.?[-/]?(\d{4})$/i);
  if (!match) return null;
  const month = MONTHS_ES[match[1].normalize('NFD').replace(/[^a-z]/g, '')];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[2]), month, 1));
}

export function parseBcrpJson(payload) {
  if (!payload) return [];
  let rows = [];

  if (Array.isArray(payload)) {
    rows = payload;
  } else if (Array.isArray(payload.periods)) {
    rows = payload.periods.map((p) => ({
      period: p.name,
      value: Array.isArray(p.values) ? p.values[0] : p.value,
    }));
  } else if (Array.isArray(payload.data)) {
    rows = payload.data;
  }

  const parsed = rows
    .map((row) => {
      const date = row.date
        ? new Date(`${row.date}-01T00:00:00Z`)
        : parseSpanishMonthPeriod(row.period || row.name);
      const value = Number(String(row.value).replace(',', '.'));
      if (!date || Number.isNaN(date.getTime()) || Number.isNaN(value)) return null;
      return { date, value };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  return uniqueByMonth(parsed);
}

export function parseBcrpCsv(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];
  const parsed = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(',').map((p) => p.trim());
    if (parts.length < 2) continue;
    const date = parseSpanishMonthPeriod(parts[0]);
    const value = Number(parts[1].replace(',', '.'));
    if (!date || Number.isNaN(value)) continue;
    parsed.push({ date, value });
  }
  return uniqueByMonth(parsed.sort((a, b) => a.date - b.date));
}

export function parseLocalFallback(payload) {
  if (!payload || !Array.isArray(payload.series)) return [];
  return payload.series
    .map((row) => {
      const date = new Date(`${row.date}-01T00:00:00Z`);
      const value = Number(row.value);
      if (Number.isNaN(date.getTime()) || Number.isNaN(value)) return null;
      return { date, value };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);
}

export function filterSeries(data, period, customStart, customEnd) {
  if (!Array.isArray(data) || data.length === 0) return [];
  let startDate = null;

  if (period === '20y' || period === '10y' || period === '5y') {
    const years = Number(period.replace('y', ''));
    const last = data[data.length - 1].date;
    startDate = new Date(Date.UTC(last.getUTCFullYear() - years, last.getUTCMonth(), 1));
  }

  if (period === 'custom') {
    if (customStart) {
      startDate = new Date(`${customStart}-01T00:00:00Z`);
    }
    if (customEnd) {
      const endDate = new Date(`${customEnd}-01T00:00:00Z`);
      return data.filter((row) => (!startDate || row.date >= startDate) && row.date <= endDate);
    }
  }

  return data.filter((row) => !startDate || row.date >= startDate);
}

export function calculateSummary(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const values = data.map((row) => row.value);
  const latest = data[data.length - 1].value;
  const previous = data.length > 1 ? data[data.length - 2].value : null;
  const average = values.reduce((acc, v) => acc + v, 0) / values.length;

  return {
    latest,
    min: Math.min(...values),
    max: Math.max(...values),
    average,
    delta: previous === null ? null : latest - previous,
    deltaPct: previous === null ? null : ((latest - previous) / previous) * 100,
  };
}

export function movingAverage(data, windowSize) {
  if (!Array.isArray(data) || windowSize <= 1) return [];
  const out = [];
  for (let i = windowSize - 1; i < data.length; i += 1) {
    const segment = data.slice(i - windowSize + 1, i + 1);
    const avg = segment.reduce((acc, row) => acc + row.value, 0) / windowSize;
    out.push({ date: data[i].date, value: avg });
  }
  return out;
}

function stdDev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = values[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

export function projectNextMonths(data, months = 6, historyWindow = 12) {
  if (!Array.isArray(data) || data.length < 4) return [];
  const baseWindow = Math.min(historyWindow, data.length);
  const recentValues = data.slice(-baseWindow).map((row) => row.value);
  const slope = linearSlope(recentValues);
  const recentAvg = recentValues.reduce((acc, v) => acc + v, 0) / recentValues.length;
  const deviation = stdDev(recentValues);
  const lastValue = data[data.length - 1].value;
  const lastDate = data[data.length - 1].date;

  const projections = [];
  for (let step = 1; step <= months; step += 1) {
    const trendPoint = lastValue + slope * step;
    const center = (trendPoint + recentAvg) / 2;
    const band = deviation * (0.85 + step * 0.22);
    const nextDate = new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth() + step, 1));
    projections.push({
      date: nextDate,
      center,
      lower: center - band,
      upper: center + band,
    });
  }

  return projections;
}

export function runBacktest(data, horizons = [1, 3, 6], historyWindow = 12) {
  if (!Array.isArray(data) || data.length < historyWindow + 6) return [];

  return horizons.map((horizon) => {
    const errors = [];
    const pctErrors = [];

    for (let i = historyWindow; i < data.length - horizon; i += 1) {
      const train = data.slice(0, i + 1);
      const forecast = projectNextMonths(train, horizon, historyWindow);
      if (!forecast.length) continue;
      const predicted = forecast[horizon - 1].center;
      const actual = data[i + horizon].value;
      const absError = Math.abs(predicted - actual);
      errors.push(absError);
      if (actual !== 0) {
        pctErrors.push((absError / actual) * 100);
      }
    }

    const mae = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
    const mape = pctErrors.length ? pctErrors.reduce((a, b) => a + b, 0) / pctErrors.length : null;

    return {
      horizon,
      samples: errors.length,
      mae,
      mape,
    };
  });
}

export function buildVisibleCsv(actual, movingAvg, projection) {
  const maMap = new Map(movingAvg.map((row) => [monthKey(row.date), row.value]));
  const projMap = new Map(projection.map((row) => [monthKey(row.date), row]));

  const headers = ['periodo', 'valor_usd_pen', 'media_movil', 'proyeccion_central', 'rango_inferior', 'rango_superior'];
  const rows = actual.map((row) => {
    const key = monthKey(row.date);
    const proj = projMap.get(key);
    return [
      key,
      fixedOrEmpty(row.value),
      fixedOrEmpty(maMap.get(key)),
      fixedOrEmpty(proj?.center),
      fixedOrEmpty(proj?.lower),
      fixedOrEmpty(proj?.upper),
    ];
  });

  projection.forEach((row) => {
    const key = monthKey(row.date);
    if (rows.find((line) => line[0] === key)) return;
    rows.push([
      key,
      '',
      '',
      fixedOrEmpty(row.center),
      fixedOrEmpty(row.lower),
      fixedOrEmpty(row.upper),
    ]);
  });

  return [headers, ...rows].map((line) => line.join(',')).join('\n');
}

function fixedOrEmpty(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return '';
  return Number(value).toFixed(4);
}

function uniqueByMonth(data) {
  const map = new Map();
  data.forEach((row) => map.set(monthKey(row.date), row));
  return [...map.values()].sort((a, b) => a.date - b.date);
}
