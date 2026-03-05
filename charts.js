// charts.js (revised from scratch)
// - Adds consistent right padding for ALL views (1M/1Y/5Y/10Y/MAX)
// - Avoids relayout loops and “graph disappears” issues
// - Removes duplicated default params (single source of truth for padding)

function formatTitle(col) {
  return (col || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
      line: { color: "rgba(80, 80, 80, 0.3)", width: 1, dash: "dot" },
    });
  }
  return shapes;
}

// ----------------- CONFIG (single source of truth) -----------------
const RIGHT_PAD = {
  frac: 0.02,     // 3% of current visible window
  minDays: 3,     // minimum padding even for short windows (1M etc.)
  snapMidnight: true,
};

function toDateSafe(x) {
  // Plotly can hand back strings, Date objects, or numbers in relayout events
  if (x instanceof Date) return new Date(x.getTime());
  if (typeof x === "number") return new Date(x);
  if (typeof x === "string") return new Date(x);
  return null;
}

function normalizeMidnight(d) {
  const out = new Date(d.getTime());
  out.setHours(0, 0, 0, 0);
  return out;
}

function addRightPadding(startDate, endDate, cfg = RIGHT_PAD) {
  // startDate/endDate are Date objects (assumed valid)
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) {
    return cfg.snapMidnight ? normalizeMidnight(endDate) : new Date(endMs);
  }

  const windowMs = endMs - startMs;
  const padMsFrac = windowMs * (cfg.frac || 0);
  const padMsMin = (cfg.minDays || 0) * 24 * 60 * 60 * 1000;
  const padMs = Math.max(padMsFrac, padMsMin);

  const padded = new Date(endMs + padMs);
  return cfg.snapMidnight ? normalizeMidnight(padded) : padded;
}

function clampDate(d, minD, maxD) {
  const t = d.getTime();
  const minT = minD.getTime();
  const maxT = maxD.getTime();
  return new Date(Math.min(Math.max(t, minT), maxT));
}

// ----------------- DATA LOADING (cached) -----------------
let i3eData = { dates: [], series: {}, startYear: null, endYear: null, loaded: false };

function loadI3EData(callback) {
  if (i3eData.loaded) return callback(i3eData);

  fetch("i3e_countries.txt")
    .then((res) => res.text())
    .then((text) => {
      const lines = text.trim().split("\n");
      const rawHeader = lines[0].split("\t");

      // Keep your original “Date” logic
      rawHeader.unshift("Date");

      const rows = lines.slice(1).map((line) => line.split("\t"));
      const dates = rows.map((r) => r[0]);

      const startYear = new Date(dates[0]).getFullYear();
      const endYear = new Date(dates[dates.length - 1]).getFullYear();

      const series = {};
      for (let i = 1; i < rawHeader.length; i++) {
        const key = rawHeader[i];
        series[key] = rows.map((r) => parseFloat(r[i]));
      }

      i3eData = { dates, series, startYear, endYear, loaded: true };
      callback(i3eData);
    })
    .catch((err) => console.error("Failed to load I3E data", err));
}

// ----------------- MAIN RENDER -----------------
function renderChart(containerId, columnKey) {
  loadI3EData(({ dates, series, startYear, endYear }) => {
    const values = series[columnKey];
    if (!values || values.length < 2 || values.some((v) => isNaN(v))) return;

    const latest = values[values.length - 1];
    const previous = values[values.length - 2];
    const delta = latest - previous;
    const deltaStr = (delta > 0 ? "+" : "") + delta.toFixed(2);
    const deltaColor = delta > 0 ? "red" : "green";
    const latestDate = dates[dates.length - 1];

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

    const plotTitle = formatTitle(columnKey);

    const chartDiv = document.getElementById(containerId);
    if (!chartDiv) return;

    chartDiv.innerHTML = `
      <div class="plot-title" style="text-align:center; font-size:18px;">I3E ECONOMIC UNCERTAINTY INDEX (${plotTitle})</div>
      <div class="plot-subtitle" style="text-align:center; font-size:16px;">
        <span class="label">${latestDate}:</span>
        <span class="value">${latest.toFixed(2)}</span>
        <span class="change" style="color:${deltaColor};">(${deltaStr})</span>
      </div>
      <div id="${containerId}-plot" style="width: 100%; height: 60vw; max-height: 600px;"></div>
    `;

    const plotEl = document.getElementById(`${containerId}-plot`);
    if (!plotEl) return;

    // Data bounds (midnight normalized)
    const dataStart = normalizeMidnight(new Date(dates[0]));
    const dataEnd = normalizeMidnight(new Date(dates[dates.length - 1]));

    // Default view: last 10 years, padded on the right
    const start10Y = normalizeMidnight(new Date(dataEnd));
    start10Y.setFullYear(start10Y.getFullYear() - 10);
    const defaultStart = clampDate(start10Y, dataStart, dataEnd);
    const defaultEnd = addRightPadding(defaultStart, dataEnd);

    function applyPaddedRange(leftDateObj) {
      // leftDateObj: Date
      const left = clampDate(normalizeMidnight(leftDateObj), dataStart, dataEnd);
      const right = addRightPadding(left, dataEnd);

      // Guard against weird ranges (Plotly can choke if range is invalid)
      if (right.getTime() <= left.getTime()) return null;

      return { leftISO: left.toISOString(), rightISO: right.toISOString() };
    }

    Plotly.newPlot(
      plotEl,
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
        },
      ],
      {
        margin: { t: 30, b: 40 },
        yaxis: { range: [0, 250], title: "Index Value" },
        xaxis: {
          type: "date",
          autorange: false,
          range: [defaultStart.toISOString(), defaultEnd.toISOString()],
          tickangle: -90,
          tickformat: "%Y",
          tickvals: Array.from({ length: endYear - startYear + 1 }, (_, i) => `${startYear + i}-01-01`),
          showgrid: false,
          ticks: "outside",
          ticklen: 4,
          tickcolor: "#999",
          rangeselector: {
            active: 3, // 10Y
            buttons: [
              { count: 1, label: "1M", step: "month", stepmode: "backward" },
              { count: 12, label: "1Y", step: "month", stepmode: "backward" },
              { count: 60, label: "5Y", step: "month", stepmode: "backward" },
              { count: 120, label: "10Y", step: "month", stepmode: "backward" },
              { step: "all", label: "MAX" },
            ],
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
    ).then(() => {
      // Keep right padding after clicking rangeselector buttons or zooming.
      // Key: ONLY adjust the right end, and do it AFTER Plotly applies its own range.
      let relayoutInProgress = false;

      plotEl.on("plotly_relayout", (ev) => {
        if (relayoutInProgress) return;

        // We only react when x-axis range changes (rangeselector sets these).
        const hasRange0 = Object.prototype.hasOwnProperty.call(ev, "xaxis.range[0]");
        const hasRange1 = Object.prototype.hasOwnProperty.call(ev, "xaxis.range[1]");
        const hasRangeArr = Object.prototype.hasOwnProperty.call(ev, "xaxis.range");

        if (!(hasRange0 || hasRange1 || hasRangeArr)) return;

        // Extract left edge robustly
        let leftRaw = null;
        if (hasRange0) leftRaw = ev["xaxis.range[0]"];
        else if (hasRangeArr && Array.isArray(ev["xaxis.range"])) leftRaw = ev["xaxis.range"][0];

        // If Plotly didn’t provide a left (rare), do nothing
        const leftDate = toDateSafe(leftRaw);
        if (!leftDate || !isFinite(leftDate.getTime())) return;

        const padded = applyPaddedRange(leftDate);
        if (!padded) return;

        // If the right end is already beyond dataEnd, user probably zoomed/panned manually;
        // we still ensure it's at least our padded end when it's <= dataEnd (the “squeezed” case).
        let currentRight = null;
        if (hasRange1) currentRight = toDateSafe(ev["xaxis.range[1]"]);
        else if (hasRangeArr && Array.isArray(ev["xaxis.range"])) currentRight = toDateSafe(ev["xaxis.range"][1]);

        if (currentRight && isFinite(currentRight.getTime())) {
          if (currentRight.getTime() > dataEnd.getTime()) {
            // already has room; don't fight it
            return;
          }
        }

        // Avoid useless relayouts (prevents flicker / rare blanking)
        const currentLayoutRange = plotEl.layout && plotEl.layout.xaxis && plotEl.layout.xaxis.range;
        if (Array.isArray(currentLayoutRange)) {
          const curL = String(currentLayoutRange[0]);
          const curR = String(currentLayoutRange[1]);
          if (curL === padded.leftISO && curR === padded.rightISO) return;
        }

        relayoutInProgress = true;
        Plotly.relayout(plotEl, {
          "xaxis.autorange": false,
          "xaxis.range": [padded.leftISO, padded.rightISO],
        }).finally(() => {
          relayoutInProgress = false;
        });
      });
    });
  });
}
