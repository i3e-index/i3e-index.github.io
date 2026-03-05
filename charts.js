// charts.js (robust UTC date handling + persistent right padding)

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
      x0: `${y}-01-01T00:00:00.000Z`,
      x1: `${y}-01-01T00:00:00.000Z`,
      y0: 0,
      y1: 1,
      line: { color: "rgba(80, 80, 80, 0.3)", width: 1, dash: "dot" },
    });
  }
  return shapes;
}

// ----------------- CONFIG (single source of truth) -----------------
const RIGHT_PAD = {
  frac: 0.03,   // 3% of visible window
  minDays: 3,   // for 1M, 7 days can feel large; 2–4 is usually nicer
};

// ----------------- UTC DATE HELPERS -----------------
function parseYMDToUTCDate(ymd) {
  // ymd: "YYYY-MM-DD"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  return new Date(Date.UTC(y, mo, d, 0, 0, 0, 0));
}

function toDateSafeUTC(x) {
  if (x instanceof Date) return new Date(x.getTime());
  if (typeof x === "number") return new Date(x);
  if (typeof x === "string") {
    // If Plotly gives "YYYY-MM-DD", parse as UTC midnight
    const s = x.trim();
    const d1 = parseYMDToUTCDate(s);
    if (d1) return d1;

    // Otherwise try Date(...) then normalize to UTC date boundary by keeping the instant
    const d2 = new Date(s);
    if (isFinite(d2.getTime())) return d2;
  }
  return null;
}

function addDaysUTC(d, days) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function clampDate(d, minD, maxD) {
  const t = d.getTime();
  return new Date(Math.min(Math.max(t, minD.getTime()), maxD.getTime()));
}

function addRightPadding(startUTC, endUTC, cfg = RIGHT_PAD) {
  const startMs = startUTC.getTime();
  const endMs = endUTC.getTime();
  if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return endUTC;

  const windowMs = endMs - startMs;
  const padMsFrac = windowMs * (cfg.frac || 0);
  const padMsMin = (cfg.minDays || 0) * 24 * 60 * 60 * 1000;
  const padMs = Math.max(padMsFrac, padMsMin);

  return new Date(endMs + padMs);
}

// ----------------- DATA LOADING (cached) -----------------
let i3eData = { datesISO: [], series: {}, startYear: null, endYear: null, loaded: false };

function loadI3EData(callback) {
  if (i3eData.loaded) return callback(i3eData);

  fetch("i3e_countries.txt")
    .then((res) => res.text())
    .then((text) => {
      const lines = text.trim().split("\n");
      const rawHeader = lines[0].split("\t");
      rawHeader.unshift("Date");

      const rows = lines.slice(1).map((line) => line.split("\t"));
      const datesYMD = rows.map((r) => r[0]);

      // Convert all x values to ISO UTC midnight strings
      const datesISO = datesYMD.map((d) => {
        const utc = parseYMDToUTCDate(d);
        return utc ? utc.toISOString() : d; // fallback (shouldn't happen)
      });

      const startYear = new Date(datesISO[0]).getUTCFullYear();
      const endYear = new Date(datesISO[datesISO.length - 1]).getUTCFullYear();

      const series = {};
      for (let i = 1; i < rawHeader.length; i++) {
        const key = rawHeader[i];
        series[key] = rows.map((r) => parseFloat(r[i]));
      }

      i3eData = { datesISO, series, startYear, endYear, loaded: true };
      callback(i3eData);
    })
    .catch((err) => console.error("Failed to load I3E data", err));
}

// ----------------- MAIN RENDER -----------------
function renderChart(containerId, columnKey) {
  loadI3EData(({ datesISO, series, startYear, endYear }) => {
    const values = series[columnKey];
    if (!values || values.length < 2 || values.some((v) => isNaN(v))) return;

    const latest = values[values.length - 1];
    const previous = values[values.length - 2];
    const delta = latest - previous;
    const deltaStr = (delta > 0 ? "+" : "") + delta.toFixed(2);
    const deltaColor = delta > 0 ? "red" : "green";

    // Latest label as YYYY-MM-DD (from ISO)
    const latestISO = datesISO[datesISO.length - 1];
    const latestDateLabel = String(latestISO).slice(0, 10);

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
        <span class="label">${latestDateLabel}:</span>
        <span class="value">${latest.toFixed(2)}</span>
        <span class="change" style="color:${deltaColor};">(${deltaStr})</span>
      </div>
      <div id="${containerId}-plot" style="width: 100%; height: 60vw; max-height: 600px;"></div>
    `;

    const plotEl = document.getElementById(`${containerId}-plot`);
    if (!plotEl) return;

    // Data bounds
    const dataStart = new Date(datesISO[0]);
    const dataEnd = new Date(datesISO[datesISO.length - 1]);

    // Default: 10Y
    const start10Y = new Date(Date.UTC(dataEnd.getUTCFullYear() - 10, dataEnd.getUTCMonth(), dataEnd.getUTCDate()));
    const defaultLeft = clampDate(start10Y, dataStart, dataEnd);
    const defaultRight = addRightPadding(defaultLeft, dataEnd);

    function paddedRangeFromLeft(leftDate) {
      const left = clampDate(leftDate, dataStart, dataEnd);
      const right = addRightPadding(left, dataEnd);
      if (right.getTime() <= left.getTime()) return null;
      return [left.toISOString(), right.toISOString()];
    }

    Plotly.newPlot(
      plotEl,
      [
        {
          x: datesISO,
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
          tickangle: -90,
          tickformat: "%Y",
          tickvals: Array.from({ length: endYear - startYear + 1 }, (_, i) => `${startYear + i}-01-01T00:00:00.000Z`),
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
      // Keep padding after rangeselector changes.
      // We only rewrite the right edge to our padded end.
      let guard = false;

      plotEl.on("plotly_relayout", (ev) => {
        if (guard) return;

        const leftRaw =
          ev["xaxis.range[0]"] ||
          (Array.isArray(ev["xaxis.range"]) ? ev["xaxis.range"][0] : null);

        if (!leftRaw) return;

        const leftDate = toDateSafeUTC(leftRaw);
        if (!leftDate || !isFinite(leftDate.getTime())) return;

        const range = paddedRangeFromLeft(leftDate);
        if (!range) return;

        // Avoid endless loops
        const cur = plotEl.layout?.xaxis?.range;
        if (Array.isArray(cur) && String(cur[0]) === range[0] && String(cur[1]) === range[1]) return;

        guard = true;
        Plotly.relayout(plotEl, { "xaxis.autorange": false, "xaxis.range": range })
          .finally(() => { guard = false; });
      });
    });
  });
}
