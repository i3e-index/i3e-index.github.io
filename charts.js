function formatTitle(col) {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

/**
 * Add right padding to an x-axis window using a percentage of the visible range.
 * - Keeps padding proportional for 1M / 1Y / 10Y / MAX windows.
 * - Snaps padded end to midnight to avoid edge clipping.
 *
 * padFrac: e.g. 0.05 = 5% of the current window width
 * minDays: ensures some room even for short windows
 */
function paddedEndByWindow(startDateObj, endDateObj, padFrac = 0.03, minDays = 5) {
  const startMs = startDateObj.getTime();
  const endMs = endDateObj.getTime();
  if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return endDateObj;

  const windowMs = endMs - startMs;
  const padMsFrac = windowMs * padFrac;
  const padMsMin = minDays * 24 * 60 * 60 * 1000;

  const padMs = Math.max(padMsFrac, padMsMin);
  const padded = new Date(endMs + padMs);

  // Snap to midnight to avoid the right-edge "clip" effect
  padded.setHours(0, 0, 0, 0);
  return padded;
}

let i3eData = { dates: [], series: {}, loaded: false };

function loadI3EData(callback) {
  if (i3eData.loaded) {
    callback(i3eData);
    return;
  }

  fetch("i3e_countries.txt")
    .then((res) => res.text())
    .then((text) => {
      const lines = text.trim().split("\n");
      const rawHeader = lines[0].split("\t");

      // Keep your original logic (even though 'headers' is unused)
      const headers = ["Date", ...rawHeader];
      rawHeader.unshift("Date");

      const rows = lines.slice(1).map((line) => line.split("\t"));
      const dates = rows.map((r) => r[0]);

      const startYear = new Date(dates[0]).getFullYear();
      const endYear = new Date(dates[dates.length - 1]).getFullYear();

      const series = {};
      for (let i = 1; i < rawHeader.length; i++) {
        const key = rawHeader[i];
        const values = rows.map((r) => parseFloat(r[i]));
        series[key] = values;
      }

      i3eData = { dates, series, startYear, endYear, loaded: true };
      callback(i3eData);
    })
    .catch((err) => console.error("Failed to load I3E data", err));
}

function renderChart(containerId, columnKey) {
  loadI3EData(({ dates, series, startYear, endYear }) => {
    const values = series[columnKey];
    if (!values || values.some((v) => isNaN(v))) return;

    const latest = values[values.length - 1];
    const previous = values[values.length - 2];
    const delta = latest - previous;
    const deltaStr = (delta > 0 ? "+" : "") + delta.toFixed(2);
    const deltaColor = delta > 0 ? "red" : "green";
    const latestDate = dates[dates.length - 1];

    const shapes = generateYearLines(startYear, endYear);

    // Thick horizontal line at y = 100
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

    // Default window: last 10 years (using last data date)
    const start10Y = new Date(dataEnd);
    start10Y.setFullYear(start10Y.getFullYear() - 10);
    start10Y.setHours(0, 0, 0, 0);

    // ✅ Tune these two numbers to your taste
    const PAD_FRAC = 0.03; // 3% of the visible window width
    const MIN_DAYS = 7;    // at least 7 days of padding

    const paddedEnd = paddedEndByWindow(start10Y, dataEnd, PAD_FRAC, MIN_DAYS);

    // Helper: apply padding using a given left edge
    function applyRightPadding(leftISO) {
      const left = new Date(leftISO);
      if (!isFinite(left.getTime())) return;

      left.setHours(0, 0, 0, 0);

      // Clamp left to dataStart (avoid weirdness)
      const clampedLeft = new Date(Math.max(left.getTime(), dataStart.getTime()));

      const paddedRight = paddedEndByWindow(clampedLeft, dataEnd, PAD_FRAC, MIN_DAYS);

      return {
        "xaxis.autorange": false,
        "xaxis.range": [clampedLeft.toISOString(), paddedRight.toISOString()],
      };
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
          range: [start10Y.toISOString(), paddedEnd.toISOString()],
          tickangle: -90,
          tickformat: "%Y",
          tickvals: Array.from(
            { length: endYear - startYear + 1 },
            (_, i) => `${startYear + i}-01-01`
          ),
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
        shapes: shapes,
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
      // ✅ Ensure padding persists after clicking 1M / 1Y / 5Y / 10Y / MAX
      // Plotly will relayout the x-axis; we re-apply padded right edge after each relayout.
      let guard = false;

      plotEl.on("plotly_relayout", (ev) => {
        if (guard) return;

        // Try to read the new left edge chosen by Plotly
        const leftISO =
          ev["xaxis.range[0]"] ||
          (Array.isArray(ev["xaxis.range"]) ? ev["xaxis.range"][0] : null);

        // If we don't have a left edge (some autorange cases), use full data start
        const effectiveLeftISO = leftISO || dataStart.toISOString();

        // Compute desired padded range for this window
        const relayoutPatch = applyRightPadding(effectiveLeftISO);
        if (!relayoutPatch) return;

        // If Plotly already has a right edge beyond the data end, don't fight it.
        const rightISO =
          ev["xaxis.range[1]"] ||
          (Array.isArray(ev["xaxis.range"]) ? ev["xaxis.range"][1] : null);

        if (rightISO) {
          const right = new Date(rightISO);
          if (isFinite(right.getTime()) && right.getTime() > dataEnd.getTime()) {
            // Still ensure at least our padding if user zoomed *past* the padded end:
            // we leave it alone (user intent).
            return;
          }
        }

        // Apply patch
        guard = true;
        Plotly.relayout(plotEl, relayoutPatch).finally(() => {
          guard = false;
        });
      });
    });
  });
}
