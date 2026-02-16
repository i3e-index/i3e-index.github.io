
function formatTitle(col) {
  return col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function generateYearLines(startYear, endYear) {
  const shapes = [];
  for (let y = startYear; y <= endYear; y++) {
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: `${y}-01-01`,
      x1: `${y}-01-01`,
      y0: 0,
      y1: 1,
      line: {
        color: 'rgba(80, 80, 80, 0.3)',
        width: 1,
        dash: 'dot'
      }
    });
  }
  return shapes;
}

let i3eData = { dates: [], series: {}, loaded: false };

function loadI3EData(callback) {
  if (i3eData.loaded) {
    callback(i3eData);
    return;
  }

  fetch('i3e_countries.txt')
    .then(res => res.text())
    .then(text => {
      const lines = text.trim().split('\n');
      const rawHeader = lines[0].split('\t');
      const headers = ["Date", ...rawHeader];
      rawHeader.unshift("Date");

      const rows = lines.slice(1).map(line => line.split('\t'));
      const dates = rows.map(r => r[0]);

      const startYear = new Date(dates[0]).getFullYear();
      const endYear = new Date(dates[dates.length - 1]).getFullYear();

      const series = {};
      for (let i = 1; i < rawHeader.length; i++) {
        const key = rawHeader[i];
        const values = rows.map(r => parseFloat(r[i]));
        series[key] = values;
      }

      i3eData = { dates, series, startYear, endYear, loaded: true };
      callback(i3eData);
    })
    .catch(err => console.error("Failed to load I3E data", err));
}

function renderChart(containerId, columnKey) {
  loadI3EData(({ dates, series, startYear, endYear }) => {
    const values = series[columnKey];
    if (!values || values.some(v => isNaN(v))) return;

    const latest = values[values.length - 1];
    const previous = values[values.length - 2];
    const delta = latest - previous;
    const deltaStr = (delta > 0 ? "+" : "") + delta.toFixed(2);
    const deltaColor = delta > 0 ? "red" : "green";
    const latestDate = dates[dates.length - 1];
    const shapes = generateYearLines(startYear, endYear);
    // 🆕 Add thick horizontal line at y = 100
    shapes.push({
      type: 'line',
      xref: 'paper',
      yref: 'y',
      x0: 0,
      x1: 1,
      y0: 100,
      y1: 100,
      line: {
        color: '#555',
        width: 1
      }
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

    Plotly.newPlot(`${containerId}-plot`, [{
      x: dates,
      y: values,
      type: 'scatter',
      mode: 'lines',
      fill: 'tozeroy',
      fillcolor: 'rgba(255, 59, 48, 0.04)',
      line: { color: '#FF3B30', width: 2 },
      hovertemplate: '%{x|%Y-%m-%d}<br>Value: %{y}<extra></extra>',
      name: "Index"
    }], {
      margin: { t: 30, b: 40 },
      yaxis: { range: [0, 250], title: "Index Value" },
      xaxis: {
        type: "date",
        tickangle: -90,
        tickformat: "%Y",
        tickvals: Array.from({length: endYear - startYear + 1}, (_, i) => `${startYear + i}-01-01`),
        showgrid: false,
        ticks: 'outside',
        ticklen: 4,
        tickcolor: '#999',
        rangeselector: {
          buttons: [
            { count: 1, label: '1M', step: 'month', stepmode: 'backward' },
            { count: 12, label: '1Y', step: 'month', stepmode: 'backward' },
            { count: 60, label: '5Y', step: 'month', stepmode: 'backward' },
            { count: 120, label: '10Y', step: 'month', stepmode: 'backward' },
            { step: 'all', label: 'MAX' }
          ]
        }
      },
      shapes: shapes,
      hovermode: "x unified",
      plot_bgcolor: "white",
      dragmode: false
    }, {
      displayModeBar: false,
      scrollZoom: false,
      doubleClick: false,
      staticPlot: false,
      responsive: true
    });
  });
}
