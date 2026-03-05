/* -------------------------------------------------------
   I3E Plotly Chart Renderer (revised)
   Fixes:
   - Range selector buttons (1M/1Y/5Y/10Y/MAX) now always show data
     by using DAY-based windows (30/365/1825/3650) instead of "month".
   - Robust handling of missing/NaN values (keeps gaps instead of aborting).
   - Uses last *valid* data point for “latest/previous” and for range end.
   - Adds a small right-side padding so the line doesn’t hit the wall.
   - Avoids “blank plot” issues caused by ranges not aligning with your x data.
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
  // Plotly date axis is happiest with "YYYY-MM-DD"
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

/* ----------------- Data cache + loader ----------------- */

const i3eData = {
  loaded: false,
  loadingPromise: null,
  dates: [],
  series: {},
  startYear: null,
  endYear: null,
};

function loadI3EData() {
  if (i3eData.loaded) return Promise.resolve(i3eData);
  if (i3eData.loadingPromise) return i3eData.loadingPromise;

  i3eData.loadingPromise = fetch("i3e_countries.txt")
    .then((res) => res.text())
    .then((text) => {
      const lines = text.trim().split("\n");
      if (lines.length < 2) throw new Error("i3e_countries.txt has no data rows.");

      const rawHeader = lines[0].split("\t");
      rawHeader.unshift("Date"); // column 0 is Date

      const rows = lines.slice(1).map((line) => line.split("\t"));
      const dates = rows.map((r) => r[0]);

      const startYear = new Date(dates[0]).getFullYear();
      const endYear = new Date(dates[dates.length - 1]).getFullYear();

      const series = {};
      for (let i = 1; i < rawHeader.length; i++) {
        const key = rawHeader[i];

        // Keep nulls for missing values; Plotly will draw gaps gracefully
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

/* ----------------- Main chart render ----------------- */

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

  // Find last valid datapoint (handles trailing nulls)
  const lastIdx = getLastValidIndex(values);
  if (lastIdx < 0) {
    chartDiv.innerHTML = `<div style="color:#b00;text-align:center;">No valid data for: ${columnKey}</div>`;
    return;
  }

  const prevIdx = getPrevValidIndex(values, lastIdx);
  const latest = values[lastIdx];
  const previous = prevIdx >= 0 ? values[prevIdx] : null;

  const delta = previous !== null ? latest - previous : null;
  const deltaStr =
    delta === null ? "" : (delta > 0 ? "+" : "") + delta.toFixed(2);
  const deltaColor = delta === null ? "#666" : delta > 0 ? "red" : "green";

  const latestDate = dates[lastIdx];

  // Shapes (year lines + y=100)
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

  // Build header HTML
  const plotTitle = formatTitle(columnKey);

  chartDiv.innerHTML = `
    <div class="plot-title" style="text-align:center; font-size:18px;">
      I3E ECONOMIC UNCERTAINTY INDEX (${plotTitle})
    </div>
    <div class="plot-subtitle" style="text-align:center; font-size:16px;">
      <span class="label">${latestDate}:</span>
      <span class="value">${latest.toFixed(2)}</span>
      ${
        delta === null
          ? ""
          : `<span class="change" style="color:${deltaColor};">(${deltaStr})</span>`
      }
    </div>
    <div id="${containerId}-plot" style="width:100%; height:60vw; max-height:600px;"></div>
  `;

  // ---- X range defaults and right-padding ----
  // Use last valid date as end anchor.
  const endAnchor = new Date(latestDate);

  // Add small right padding so the line doesn't hit the wall.
  // 7 days works well for daily-ish series; adjust if you want.
  const endPadded = addDays(endAnchor, 7);

  // Default view: last 10 years from endAnchor (not from "today")
  const start10Y = new Date(endAnchor);
  start10Y.setFullYear(start10Y.getFullYear() - 10);

  // Use date-only strings to match your x values ("YYYY-MM-DD")
  const initialRange = [toDateOnlyISO(start10Y), toDateOnlyISO(endPadded)];

  // ---- Range selector buttons (robust) ----
  // Using step:"day" avoids Plotly "month" quirks and ensures data shows.
  const rangeButtons = [
    { count: 30, label: "1M", step: "day", stepmode: "backward" },
    { count: 365, label: "1Y", step: "day", stepmode: "backward" },
    { count: 1825, label: "5Y", step: "day", stepmode: "backward" },
    { count: 3650, label: "10Y", step: "day", stepmode: "backward" },
    { step: "all", label: "MAX" },
  ];

  // ---- Tick values: yearly ticks ----
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
        fillcolor: "rgba(255, 59, 48, 0.04)",
        line: { color: "#FF3B30", width: 2 },
        hovertemplate: "%{x|%Y-%m-%d}<br>Value: %{y}<extra></extra>",
        name: "Index",
        connectgaps: false, // keep gaps if nulls exist
      },
    ],
    {
      margin: { t: 30, b: 50, l: 60, r: 20 },
      yaxis: {
        range: [0, 250],
        title: "Index Value",
        zeroline: false,
      },
      xaxis: {
        type: "date",

        // Force initial view (and make it stable)
        autorange: false,
        range: initialRange,

        tickangle: -90,
        tickformat: "%Y",
        tickvals: yearTickVals,
        showgrid: false,
        ticks: "outside",
        ticklen: 4,
        tickcolor: "#999",

        // Range selector that actually works with your data reliably
        rangeselector: {
          active: 3, // 10Y
          buttons: rangeButtons,
        },
      },
      shapes,
      hovermode: "x unified",
      plot_bgcolor: "white",

      // Keep interaction simple; buttons still work
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

  // Extra safety: after render, ensure we’re not ending *before* last data point.
  // (Can happen if Plotly normalizes ranges oddly in some edge cases.)
  Plotly.relayout(plotId, {
    "xaxis.range[1]": toDateOnlyISO(endPadded),
  });
}

/* ----------------- Usage example -----------------
   renderChart("chart-us", "united_states");
   renderChart("chart-de", "germany");
--------------------------------------------------- */
