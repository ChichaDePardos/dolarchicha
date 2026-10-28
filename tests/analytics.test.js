import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSummary,
  movingAverage,
  projectNextMonths,
  runBacktest,
  buildVisibleCsv,
  parseBcrpJson,
} from '../src/analytics.js';

function makeSeries(size) {
  const rows = [];
  for (let i = 0; i < size; i += 1) {
    rows.push({
      date: new Date(Date.UTC(2020, i, 1)),
      value: 3 + i * 0.01,
    });
  }
  return rows;
}

test('parseBcrpJson parsea periods del formato BCRP', () => {
  const parsed = parseBcrpJson({
    periods: [
      { name: 'Ene.2024', values: ['3.8123'] },
      { name: 'Feb.2024', values: ['3.8450'] },
    ],
  });

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].value, 3.8123);
  assert.equal(parsed[1].date.getUTCMonth(), 1);
});

test('calculateSummary retorna métricas principales', () => {
  const summary = calculateSummary([
    { date: new Date(Date.UTC(2024, 0, 1)), value: 3.5 },
    { date: new Date(Date.UTC(2024, 1, 1)), value: 3.7 },
    { date: new Date(Date.UTC(2024, 2, 1)), value: 3.6 },
  ]);

  assert.equal(summary.latest, 3.6);
  assert.equal(summary.min, 3.5);
  assert.equal(summary.max, 3.7);
  assert.equal(Number(summary.average.toFixed(4)), 3.6);
  assert.equal(Number(summary.delta.toFixed(4)), -0.1);
});

test('movingAverage calcula ventana de 3 meses', () => {
  const ma = movingAverage(makeSeries(6), 3);
  assert.equal(ma.length, 4);
  assert.equal(Number(ma[0].value.toFixed(4)), 3.01);
  assert.equal(Number(ma[3].value.toFixed(4)), 3.04);
});

test('projectNextMonths crea 6 meses con rango', () => {
  const projection = projectNextMonths(makeSeries(18), 6, 12);
  assert.equal(projection.length, 6);
  assert.ok(projection.every((row) => row.upper > row.center && row.center > row.lower));
});

test('runBacktest devuelve métricas para 1/3/6', () => {
  const metrics = runBacktest(makeSeries(40), [1, 3, 6], 12);
  assert.equal(metrics.length, 3);
  assert.ok(metrics.every((m) => m.samples > 0));
  assert.ok(metrics.every((m) => m.mae >= 0));
});

test('buildVisibleCsv exporta encabezados y filas', () => {
  const actual = makeSeries(3);
  const ma = movingAverage(actual, 3);
  const projection = projectNextMonths(actual, 2, 3);
  const csv = buildVisibleCsv(actual, ma, projection);

  assert.ok(csv.startsWith('periodo,valor_usd_pen,media_movil,proyeccion_central,rango_inferior,rango_superior'));
  assert.ok(csv.includes('2020-01,3.0000'));
});
