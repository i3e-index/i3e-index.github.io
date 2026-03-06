/* -------------------------------------------------------
   I3E Plotly Chart Renderer (revised + generic TSV renderer)
   Fixes:
   - Range selector buttons (1M/1Y/5Y/10Y/MAX) now always show data
     by using DAY-based windows (30/365/1825/3650) instead of "month".
   - Robust handling of missing/NaN values (keeps gaps instead of aborting).
   - Uses last valid data point for “latest/previous” and for range end.
   - Adds a small right-side padding so the line doesn’t hit the wall.
   - Avoids blank plot issues caused by ranges not aligning with x data.
   - Adds a reusable TSV chart renderer for Forward charts.
-------------------------------------------------------- */

function formatTitle(col) {
  return String(col)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function addDays(dateObj, days) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateOnlyISO(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function generateYearLines(startYear, endYear) {
  const shapes = [];
  for (let y = startYear; y <= endYear; y++) {
    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: `${y}-01-01`,
      x1: `${y}-01-01`,
      y0: 0,
      y1: 1,
      line: {
        color: "rgba(80, 80, 80, 0.3)",
        width: 1,
        dash: "dot",
      },
    });
  }
  return shapes;
}

function getLastValidIndex(values) {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return i;
  }
  return -1;
}

function getPrevValidIndex(values, fromIndex) {
  for (let i = fromIndex - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return i;
  }
  return -1;
}

const i3eData = {
  loaded: false,
  loadingPromise: null,
  dates: [],
  series: {},
  startYear: null,
  endYear: null,
};

const tsvCache = {};

function loadI3EData() {
  if (i3eData.loaded) return Promise.resolve(i3eData);
  if (i3eData.loadingPromise) return i3eData.loadingPromise;

  i3eData.loadingPromise = fetch("i3e_countries.txt")
    .then((res) => res.text())
    .then((text) => {
      const lines = text.trim().split("\n");
      if (lines.length < 2) throw new Error("i3e_countries.txt has no data rows.");

      const rawHeader = lines[0].split("\t");
      rawHeader.unshift("Date");

      const rows = lines.slice(1).map((line) => line.split("\t"));
      const dates = rows.map((r) => r[0]);

      const startYear = new Date(dates[0]).getFullYear();
      const endYear = new Date(dates[dates.length - 1]).getFullYear();

      const series = {};
      for (let i = 1; i < rawHeader.length; i++) {
        const key = rawHeader[i];
        const values = rows.map((r) => {
          const n = Number.parseFloat(r[i]);
          return Number.isFinite(n) ? n : null;
        });
        series[key] = values;
      }

      i3eData.dates = dates;
      i3eData.series = series;
      i3eData.startYear = startYear;
      i3eData.endYear = endYear;
      i3eData.loaded = true;

      return i3eData;
    })
    .catch((err) => {
      console.error("Failed to load I3E data:", err);
      throw err;
    });

  return i3eData.loadingPromise;
}

function loadSingleSeriesTSV(file) {
  if (tsvCache[file]?.loaded) return Promise.resolve(tsvCache[file]);
  if (tsvCache[file]?.loadingPromise) return tsvCache[file].loadingPromise;

  tsvCache[file] = tsvCache[file] || {};

  tsvCache[file].loadingPromise = fetch(file)
    .then((res) => res.text())
    .then((text) => {
      const lines = text.trim().split("\n").filter((l) => l.trim().length > 0);
      if (lines.length < 2) throw new Error(`${file} has no data rows.`);

      const rows = lines.slice(1).map((line) => line.split("\t"));
      const dates = rows.map((r) => (r[0] || "").trim());
      const values = rows.map((r) => {
        const n = Number.parseFloat((r[1] || "").trim());
        return Number.isFinite(n) ? n : null;
      });

      const startYear = new Date(dates[0]).getFullYear();
      const endYear = new Date(dates[dates.length - 1]).getFullYear();

      tsvCache[file] = {
        loaded: true,
        loadingPromise: null,
        dates,
        values,
        startYear,
        endYear,
      };

      return tsvCache[file];
    })
    .catch((err) => {
      console.error(`Failed to load ${file}:`, err);
      throw err;
    });

  return tsvCache[file].loadingPromise;
}

function buildRangeButtons() {
  return [
    { count: 30, label: "1M", step: "day", stepmode: "backward" },
    { count: 365, label: "1Y", step: "day", stepmode: "backward" },
    { count: 1825, label: "5Y", step: "day", stepmode: "backward" },
    { count: 3650, label: "10Y", step: "day", stepmode: "backward" },
    { step: "all", label: "MAX" },
  ];
}

function renderSeriesIntoContainer(containerId, opts) {
  const {
    dates,
    values,
    startYear,
    endYear,
    title,
    lineColor,
    fillColor,
    seriesName,
    yMax = 250,
    valueDecimals = 2,
  } = opts;

  const chartDiv = document.getElementById(containerId);
  if (!chartDiv) return;

  const lastIdx = getLastValidIndex(values);
  if (lastIdx < 0) {
    chartDiv.innerHTML = `<div style="color:#b00;text-align:center;">No valid data available</div>`;
    return;
  }

  const prevIdx = getPrevValidIndex(values, lastIdx);
  const latest = values[lastIdx];
  const previous = prevIdx >= 0 ? values[prevIdx] : null;

  const delta = previous !== null ? latest - previous : null;
  const deltaStr =
    delta === null ? "" : (delta > 0 ? "+" : "") + delta.toFixed(valueDecimals);
  const deltaColor = delta === null ? "#666" : delta > 0 ? "red" : "green";

  const latestDate = dates[lastIdx];

  const shapes = generateYearLines(startYear, endYear);
  shapes.push({
    type: "line",
    xref: "paper",
    yref: "y",
    x0: 0,
    x1: 1,
    y0: 100,
    y1: 100,
    line: { color: "#555", width: 1 },
  });

  chartDiv.innerHTML = `
    <div class="plot-title" style="text-align:center; font-size:18px;">
      ${title}
    </div>
    <div class="plot-subtitle" style="text-align:center; font-size:16px;">
      <span class="label">${latestDate}:</span>
      <span class="value">${latest.toFixed(valueDecimals)}</span>
      ${
        delta === null
          ? ""
          : `<span class="change" style="color:${deltaColor};">(${deltaStr})</span>`
      }
    </div>
    <div id="${containerId}-plot" style="width:100%; height:60vw; max-height:600px;"></div>
  `;

  const endAnchor = new Date(latestDate);
  const endPadded = addDays(endAnchor, 7);

  const start10Y = new Date(endAnchor);
  start10Y.setFullYear(start10Y.getFullYear() - 10);

  const initialRange = [toDateOnlyISO(start10Y), toDateOnlyISO(endPadded)];

  const yearTickVals = Array.from(
    { length: endYear - startYear + 1 },
    (_, i) => `${startYear + i}-01-01`
  );

  const plotId = `${containerId}-plot`;

  Plotly.newPlot(
    plotId,
    [
      {
        x: dates,
        y: values,
        type: "scatter",
        mode: "lines",
        fill: "tozeroy",
        fillcolor: fillColor,
        line: { color: lineColor, width: 2 },
        hovertemplate: "%{x|%Y-%m-%d}<br>Value: %{y}<extra></extra>",
        name: seriesName,
        connectgaps: false,
      },
    ],
    {
      margin: { t: 30, b: 50, l: 60, r: 20 },
      yaxis: {
        range: [0, yMax],
        title: "Index Value",
        zeroline: false,
      },
      xaxis: {
        type: "date",
        autorange: false,
        range: initialRange,
        tickangle: -90,
        tickformat: "%Y",
        tickvals: yearTickVals,
        showgrid: false,
        ticks: "outside",
        ticklen: 4,
        tickcolor: "#999",
        rangeselector: {
          active: 3,
          buttons: buildRangeButtons(),
        },
      },
      shapes,
      hovermode: "x unified",
      plot_bgcolor: "white",
      dragmode: false,
    },
    {
      displayModeBar: false,
      scrollZoom: false,
      doubleClick: false,
      staticPlot: false,
      responsive: true,
    }
  );

  Plotly.relayout(plotId, {
    "xaxis.range[1]": toDateOnlyISO(endPadded),
  });
}

async function renderChart(containerId, columnKey) {
  const chartDiv = document.getElementById(containerId);
  if (!chartDiv) return;

  let data;
  try {
    data = await loadI3EData();
  } catch {
    chartDiv.innerHTML = `<div style="color:#b00;text-align:center;">Failed to load i3e_countries.txt</div>`;
    return;
  }

  const { dates, series, startYear, endYear } = data;
  const values = series[columnKey];

  if (!values) {
    chartDiv.innerHTML = `<div style="color:#b00;text-align:center;">Unknown series: ${columnKey}</div>`;
    return;
  }

  renderSeriesIntoContainer(containerId, {
    dates,
    values,
    startYear,
    endYear,
    title: `I3E ECONOMIC UNCERTAINTY INDEX (${formatTitle(columnKey)})`,
    lineColor: "#FF3B30",
    fillColor: "rgba(255, 59, 48, 0.04)",
    seriesName: "Index",
    yMax: 250,
    valueDecimals: 2,
  });
}

async function renderTSVChart(containerId, config) {
  const chartDiv = document.getElementById(containerId);
  if (!chartDiv) return;

  const {
    file,
    title = "Time Series",
    lineColor = "#00BFFF",
    fillColor = "rgba(31,119,180,0.06)",
    seriesName = "Series",
    yMax = 250,
    valueDecimals = 2,
  } = config || {};

  if (!file) {
    chartDiv.innerHTML = `<div style="color:#b00;text-align:center;">Missing TSV file</div>`;
    return;
  }

  let data;
  try {
    data = await loadSingleSeriesTSV(file);
  } catch {
    chartDiv.innerHTML = `<div style="color:#b00;text-align:center;">Failed to load ${file}</div>`;
    return;
  }

  renderSeriesIntoContainer(containerId, {
    dates: data.dates,
    values: data.values,
    startYear: data.startYear,
    endYear: data.endYear,
    title,
    lineColor,
    fillColor,
    seriesName,
    yMax,
    valueDecimals,
  });
}
