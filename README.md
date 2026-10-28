# DolarChicha

Aplicación web estática para visualizar y analizar el histórico mensual del tipo de cambio **USD/PEN** usando la serie **BCRP PN01234PM**.

## Características del MVP

- Gráfico histórico mensual interactivo (Chart.js).
- Filtros de período: todo, 20 años, 10 años, 5 años y rango personalizado.
- Tarjetas de resumen: último valor, mínimo, máximo, promedio y variación mensual.
- Media móvil seleccionable (3, 6 o 12 meses).
- Proyección referencial a 6 meses con banda de incertidumbre.
- Backtesting simple con horizontes de 1, 3 y 6 meses (MAE y MAPE).
- Descarga CSV de los datos visibles.
- Estado de carga/error y fecha de última actualización visible.

## Avisos importantes

- **Proyección estadística referencial**.
- **No es asesoría financiera**.
- El tipo de cambio está sujeto a factores económicos externos y alta incertidumbre.

## Fuente de datos

1. Fuente principal: endpoint público BCRP para serie `PN01234PM`.
2. Fallback: `data/fallback-pn01234pm.json` (datos locales de ejemplo) si hay problemas de red/CORS/inestabilidad.

> El fallback local está marcado como ejemplo y no reemplaza la fuente oficial del BCRP.

## Ejecutar localmente

No requiere backend.

```bash
# desde la raíz del repositorio
python -m http.server 8000
```

Abrir: `http://localhost:8000`

## Pruebas

```bash
npm test
```

Las pruebas validan cálculos de resumen, media móvil, proyección, backtesting y exportación CSV.

## Deploy en GitHub Pages

Se incluye el workflow: `.github/workflows/deploy-pages.yml`.

Pasos para activarlo en GitHub:

1. Ir a **Settings → Pages**.
2. En **Build and deployment**, seleccionar **GitHub Actions** como Source.
3. Hacer merge de cambios a `main`.
4. El workflow `Deploy static app to GitHub Pages` publicará automáticamente.

## Limitaciones del modelo de proyección

- El método es deliberadamente simple (combinación de tendencia lineal reciente y promedio histórico corto).
- La banda de incertidumbre es heurística, no un intervalo de confianza econométrico formal.
- El backtesting es referencial y no garantiza desempeño futuro.
