// Telemetry-Pulse v2.0.0 - Interactive PromQL & OpenMetrics Controller
document.addEventListener('DOMContentLoaded', () => {
  const kpiTotalMetrics = document.getElementById('kpiTotalMetrics');
  const kpiTotalSeries = document.getElementById('kpiTotalSeries');
  const kpiDatapoints = document.getElementById('kpiDatapoints');

  const sseLabel = document.getElementById('sseLabel');
  const promqlForm = document.getElementById('promqlForm');
  const promqlInput = document.getElementById('promqlInput');
  const queryResultsBox = document.getElementById('queryResultsBox');
  const catalogTableBody = document.getElementById('catalogTableBody');
  const metricsPreview = document.getElementById('metricsPreview');
  const feedContainer = document.getElementById('feedContainer');

  const btnCopyMetrics = document.getElementById('btnCopyMetrics');
  const btnOpenIngestModal = document.getElementById('btnOpenIngestModal');
  const ingestModal = document.getElementById('ingestModal');
  const btnCloseIngestModal = document.getElementById('btnCloseIngestModal');
  const ingestForm = document.getElementById('ingestForm');

  // Query Sample Chips
  document.querySelectorAll('.sample-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      promqlInput.value = chip.dataset.q;
      executePromQL(chip.dataset.q);
    });
  });

  // Execute PromQL Query
  promqlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    executePromQL(promqlInput.value.trim());
  });

  async function executePromQL(query) {
    if (!query) return;
    queryResultsBox.innerHTML = '<div class="result-placeholder">Evaluating PromQL query...</div>';

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();

      if (data.status === 'success') {
        renderQueryResults(data.data);
      } else {
        queryResultsBox.innerHTML = `<div style="color: var(--accent-rose); padding: 12px;">Query Error: ${escapeHtml(data.error || 'Evaluation failed')}</div>`;
      }
    } catch (err) {
      queryResultsBox.innerHTML = `<div style="color: var(--accent-rose); padding: 12px;">Network Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderQueryResults(data) {
    const resultType = data.resultType;
    const results = data.result || [];

    if (results.length === 0) {
      queryResultsBox.innerHTML = '<div class="result-placeholder">Empty vector: 0 series matched query.</div>';
      return;
    }

    queryResultsBox.innerHTML = results.map(r => {
      const metricLabels = Object.entries(r.metric || {}).map(([k, v]) => `${k}="${v}"`).join(', ');
      const labelStr = metricLabels ? `{${metricLabels}}` : (resultType === 'scalar' ? 'scalar' : '{}');
      const val = r.value ? r.value[1] : '--';

      return `
        <div class="vector-result-row">
          <span class="vector-metric-labels">${escapeHtml(labelStr)}</span>
          <span class="vector-val">${escapeHtml(val)}</span>
        </div>
      `;
    }).join('');
  }

  // Ingest Modal Handlers
  btnOpenIngestModal.addEventListener('click', () => {
    ingestModal.style.display = 'flex';
  });

  btnCloseIngestModal.addEventListener('click', () => {
    ingestModal.style.display = 'none';
  });

  ingestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('ingestType').value;
    const name = document.getElementById('ingestName').value.trim();
    const value = parseFloat(document.getElementById('ingestValue').value);
    let labels = {};

    const rawLabels = document.getElementById('ingestLabels').value.trim();
    if (rawLabels) {
      try {
        labels = JSON.parse(rawLabels);
      } catch (err) {
        return alert('Labels must be valid JSON: ' + err.message);
      }
    }

    try {
      const res = await fetch('/api/metrics/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, value, labels })
      });
      const data = await res.json();
      if (data.success) {
        ingestModal.style.display = 'none';
        ingestForm.reset();
        await refreshAll();
      } else {
        alert('Failed to ingest: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Ingest error: ' + err.message);
    }
  });

  // Copy Metrics
  btnCopyMetrics.addEventListener('click', () => {
    navigator.clipboard.writeText(metricsPreview.textContent)
      .then(() => alert('Copied /metrics exposition payload to clipboard!'))
      .catch(e => console.error(e));
  });

  // Refresh Telemetry & Raw /metrics
  async function refreshAll() {
    try {
      const [statsRes, promRes] = await Promise.all([
        fetch('/api/stats').then(r => r.json()),
        fetch('/metrics').then(r => r.text())
      ]);

      if (statsRes.success && statsRes.metrics) {
        updateKPIs(statsRes.metrics);
        renderCatalog(statsRes.metrics.catalog || []);
      }

      metricsPreview.textContent = promRes;
    } catch (e) {
      console.error('Refresh error:', e);
    }
  }

  function updateKPIs(metrics) {
    kpiTotalMetrics.textContent = metrics.totalMetrics;
    kpiTotalSeries.textContent = metrics.totalSeries;
    kpiDatapoints.textContent = metrics.totalDatapointsIngested.toLocaleString();
  }

  function renderCatalog(catalog) {
    catalogTableBody.innerHTML = catalog.map(m => `
      <tr>
        <td style="font-family: var(--font-mono); font-weight: 600; color: var(--accent-cyan);">${escapeHtml(m.name)}</td>
        <td><span class="type-pill ${m.type}">${m.type}</span></td>
        <td style="font-family: var(--font-mono);">${m.seriesCount}</td>
        <td style="color: var(--text-secondary); font-size: 10px;">${escapeHtml(m.help || '-')}</td>
      </tr>
    `).join('');
  }

  function appendFeed(item) {
    const empty = feedContainer.querySelector('.feed-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'feed-item';
    const labelStr = Object.entries(item.labels || {}).map(([k, v]) => `${k}="${v}"`).join(' ');

    div.innerHTML = `
      <div class="feed-item-top">
        <span class="feed-item-title">${escapeHtml(item.name)}</span>
        <span>${new Date().toLocaleTimeString()}</span>
      </div>
      <div style="display:flex; justify-content:space-between; color:var(--text-secondary);">
        <span>${escapeHtml(item.type.toUpperCase())} ${escapeHtml(labelStr)}</span>
        <span style="color:var(--accent-emerald); font-weight:bold;">${item.value}</span>
      </div>
    `;

    feedContainer.prepend(div);
    while (feedContainer.children.length > 30) {
      feedContainer.removeChild(feedContainer.lastChild);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // SSE Stream
  function initSSE() {
    const evt = new EventSource('/api/events/stream');

    evt.addEventListener('init', (e) => {
      sseLabel.textContent = 'SSE Live Connected';
      refreshAll();
    });

    evt.addEventListener('metric_ingested', (e) => {
      const data = JSON.parse(e.data);
      appendFeed(data);
      refreshAll();
    });

    evt.onopen = () => { sseLabel.textContent = 'SSE Live Connected'; };
    evt.onerror = () => { sseLabel.textContent = 'SSE Reconnecting...'; };
  }

  // Initial Boot
  refreshAll();
  executePromQL('sum(http_requests_total)');
  initSSE();
});
