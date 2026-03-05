// ----------------------------
// charts.js (clean + robust)
// - Loads i3e_countries.txt once and caches it
// - Renders any series by columnKey
// - Adds RIGHT padding for ALL windows (1M/1Y/5Y/10Y/MAX) and keeps it after clicks
// - FIXES the “1M blank / 1Y missing months” bug by NOT forcing tickvals
// ----------------------------

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

/**
 * Compute a padded right edge for an x-axis window.
 * Padding = max(padFrac * windowWidth, minDays).
 * Returned as a Date snapped to midnight to avoid “edge clipping” feel.
 */
function paddedEndByWindow(startDateObj, endDateObj, padFrac, minDays) {
  const startMs = startDateObj.getTime();
  const endMs = endDateObj.getTime();
  if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return new Date(endMs);

  const windowMs = endMs - startMs;
  const padMsFrac = windowMs * padFrac;
  const padMsMin = minDays * 24 * 60 * 60 * 1000;
  const padMs = Math.max(padMsFrac, padMsMin);

  const padded = new Date(endMs + padMs);
  padded.setHours(0, 0, 0, 0);
  return padded;
}

let i3eData = { dates: [], series: {}, startYear: null, endYear: null, loaded: false };

function loadI3EData(callback) {
  if (i3eData.loaded) return callback(i3eData);

  fetch("i3e_countries.txt")
    .then((res) => res.text())
    .then((text) => {
      const lines = text.trim().split("\n");
      if (lines.length < 2) throw new Error("i3e_countries.txt has no data rows.");

      const header = lines[0].split("\t"); // first column is date, then series keys
      const rows = lines.slice(1).map((line) => line.split("\t"));

      const dates = rows.map((r) => (r[0] || "").trim());
      const startYear = new Date(dates[0]).getFullYear();
      const endYear = new Date(dates[dates.length - 1]).getFullYear();

      const series = {};
      for (let i = 1; i < header.length; i++) {
        const key = (header[i] || "").trim();
        series[key] = rows.map((r) => parseFloat(r[i]));
      }

      i3eData = { dates, series, startYear, endYear, loaded: true };
      callback(i3eData);
    })
    .catch((err) => console.error("Failed to load I3E data", err));
}

function renderChart(containerId, columnKey) {
  loadI3EData(({ dates, series, startYear, endYear }) => {
    const values = series[columnKey];
    if (!values || !values.length || values.some((v) => Number.isNaN(v))) return;

    const latest = values[values.length - 1];
    const previous = values.length >= 2 ? values[values.length - 2] : latest;
    const delta = latest - previous;
    const deltaStr = (delta > 0 ? "+" : "") + delta.toFixed(2);
    const deltaColor = delta > 0 ? "red" : "green";
    const latestDate = dates[dates.length - 1];

    // Shapes (year lines + baseline at 100)
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

    // Data bounds
    const dataStart = new Date(dates[0]);
    dataStart.setHours(0, 0, 0, 0);

    const dataEnd = new Date(dates[dates.length - 1]);
    dataEnd.setHours(0, 0, 0, 0);

    // Tuning: right padding for ALL windows
    // - padFrac makes padding scale with window width
    // - minDays guarantees some space in short windows like 1M
    const PAD_FRAC = 0.04; // 4% of the visible window width (adjust 0.02–0.06)
    const MIN_DAYS = 5;    // minimum days of padding for short windows (adjust 3–10)

    // Default window: last 10 years, padded right
    const defaultLeft = new Date(dataEnd);
    defaultLeft.setFullYear(defaultLeft.getFullYear() - 10);
    defaultLeft.setHours(0, 0, 0, 0);

    const defaultRight = paddedEndByWindow(defaultLeft, dataEnd, PAD_FRAC, MIN_DAYS);

    // Compute a padded range given a left edge (Date)
    function computePaddedRange(leftDateObj) {
      const leftMs = leftDateObj.getTime();
      const clampedLeft = new Date(Math.max(leftMs, dataStart.getTime()));
      clampedLeft.setHours(0, 0, 0, 0);

      const paddedRight = paddedEndByWindow(clampedLeft, dataEnd, PAD_FRAC, MIN_DAYS);

      return [clampedLeft.toISOString(), paddedRight.toISOString()];
    }

    // Initial plot
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
          range: [defaultLeft.toISOString(), defaultRight.toISOString()],

          // ✅ IMPORTANT: DO NOT force tickvals (this broke 1M/1Y views)
          tickangle: -90,
          tickformat: "%Y",

          showgrid: false,
          ticks: "outside",
          ticklen: 4,
          tickcolor: "#999",
          rangeselector: {
            active: 3,
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
      // Keep right padding after clicking range buttons or any relayout
      let guard = false;

      plotEl.on("plotly_relayout", (ev) => {
        if (guard) return;

        // If Plotly is updating the x-axis range, re-apply padded right.
        // We only do this when we can detect a left edge.
        const leftISO =
          ev["xaxis.range[0]"] ||
          (Array.isArray(ev["xaxis.range"]) ? ev["xaxis.range"][0] : null);

        // If Plotly switched back to autorange, set it to our padded full-data range
        if (ev["xaxis.autorange"] === true) {
          const fullRange = computePaddedRange(dataStart);
          guard = true;
          Plotly.relayout(plotEl, {
            "xaxis.autorange": false,
            "xaxis.range": fullRange,
          }).finally(() => {
            guard = false;
          });
          return;
        }

        if (!leftISO) return;

        const leftDate = new Date(leftISO);
        if (!isFinite(leftDate.getTime())) return;

        const paddedRange = computePaddedRange(leftDate);

        // If user manually zoomed/panned beyond our padded end, don't fight them.
        const rightISO =
          ev["xaxis.range[1]"] ||
          (Array.isArray(ev["xaxis.range"]) ? ev["xaxis.range"][1] : null);

        if (rightISO) {
          const rightDate = new Date(rightISO);
          if (isFinite(rightDate.getTime()) && rightDate.getTime() > dataEnd.getTime()) {
            return; // respect user intent
          }
        }

        guard = true;
        Plotly.relayout(plotEl, {
          "xaxis.autorange": false,
          "xaxis.range": paddedRange,
        }).finally(() => {
          guard = false;
        });
      });
    });
  });
}
