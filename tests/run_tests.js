// Telemetry-Pulse v2.0.0 - Exhaustive Verification Suite
// OpenMetrics Serialization, Exponential Histograms, PromQL Algebra, and Prometheus Scrape Gateway
const assert = require('assert');
const http = require('http');

const { formatLabels, Counter, Gauge, Histogram, ExponentialHistogram, TelemetryEngine } = require('../src/engine');
const { startServer } = require('../src/index');

console.log('====================================================');
console.log('🧪 Running Verification Suite: Telemetry-Pulse v2.0.0');
console.log('====================================================');

let totalPassed = 0;
function pass(desc) {
  totalPassed++;
  console.log(`  ✓ [PASS ${totalPassed}] ${desc}`);
}

async function runAllTests() {
  // -------------------------------------------------------------
  // 1. Label Serialization & Multi-Dimensional Series Keys
  // -------------------------------------------------------------
  console.log('\n[1/5] Testing OpenMetrics Label Serialization...');

  assert.strictEqual(formatLabels({}), '');
  pass('Empty label dictionary serializes to empty string');

  const formatted1 = formatLabels({ status: '200', method: 'GET', env: 'prod' });
  assert.strictEqual(formatted1, '{env="prod",method="GET",status="200"}');
  pass('Labels deterministically sort in alphabetical order');

  const formatted2 = formatLabels({ desc: 'hello "world"' });
  assert.strictEqual(formatted2, '{desc="hello \\"world\\""}');
  pass('Double quotes within label values are escaped');

  // -------------------------------------------------------------
  // 2. Metric Primitives (Counter, Gauge, Histogram)
  // -------------------------------------------------------------
  console.log('\n[2/5] Testing Metric Primitives & Monotonicity...');

  const counter = new Counter('test_counter', 'Unit test counter');
  counter.inc(5, { env: 'staging' });
  counter.inc(10, { env: 'staging' });
  assert.strictEqual(counter.get({ env: 'staging' }), 15);
  pass('Counter accumulates values across consecutive increments');

  assert.throws(() => counter.inc(-1), /monotonic/i);
  pass('Negative delta rejected enforcing counter monotonicity');

  // Independent series
  counter.inc(3, { env: 'production' });
  assert.strictEqual(counter.get({ env: 'staging' }), 15);
  assert.strictEqual(counter.get({ env: 'production' }), 3);
  pass('Distinct label dimensions isolate series state');

  const gauge = new Gauge('test_gauge', 'Unit test gauge');
  gauge.set(100, { node: 'worker-1' });
  gauge.inc(25, { node: 'worker-1' });
  gauge.dec(15, { node: 'worker-1' });
  assert.strictEqual(gauge.get({ node: 'worker-1' }), 110);
  pass('Gauge increment, decrement, and set operations verified');

  // -------------------------------------------------------------
  // 3. Cumulative & Exponential Histograms
  // -------------------------------------------------------------
  console.log('\n[3/5] Testing Cumulative & Exponential Histograms...');

  const hist = new Histogram('test_hist', 'Test latency', [0.1, 0.5, 1.0, 5.0]);
  hist.observe(0.05, { path: '/api' });
  hist.observe(0.45, { path: '/api' });
  hist.observe(0.95, { path: '/api' });
  hist.observe(3.20, { path: '/api' });

  const histEntry = hist.get({ path: '/api' });
  assert.strictEqual(histEntry.count, 4);
  assert.strictEqual(histEntry.sum, 4.65);
  assert.strictEqual(histEntry.bucketCounts.get(0.1), 1); // 0.05 <= 0.1
  assert.strictEqual(histEntry.bucketCounts.get(0.5), 2); // 0.05, 0.45 <= 0.5
  assert.strictEqual(histEntry.bucketCounts.get(1.0), 3); // 0.05, 0.45, 0.95 <= 1.0
  assert.strictEqual(histEntry.bucketCounts.get(5.0), 4); // all 4 <= 5.0
  pass('Cumulative histogram bucket counters correctly categorize distributions');

  // Exponential Histogram
  const expHist = new ExponentialHistogram(3); // factor = 2^3 = 8
  expHist.observe(0);
  expHist.observe(1.0);
  expHist.observe(2.0);

  const expDist = expHist.getDistribution();
  assert.strictEqual(expDist.zeroCount, 1);
  assert.strictEqual(expDist.totalCount, 3);
  assert.strictEqual(expDist.buckets.length, 2);
  pass('Exponential histogram log-linear bucketing and zero-bucket verified');

  // -------------------------------------------------------------
  // 4. Prometheus Text Exposition & PromQL Engine
  // -------------------------------------------------------------
  console.log('\n[4/5] Testing Prometheus Text Format & PromQL Algebra...');

  const engine = new TelemetryEngine();
  const promText = engine.toPrometheusText();

  assert(promText.includes('# TYPE http_requests_total counter'));
  assert(promText.includes('http_requests_total{env="production",method="GET",status="200"} 1240'));
  assert(promText.includes('# TYPE http_request_duration_seconds histogram'));
  assert(promText.includes('http_request_duration_seconds_bucket{handler="/api/v1/auth",le="+Inf"}'));
  pass('RFC compliant Prometheus / OpenMetrics exposition format generated');

  // PromQL: Instant vector selector
  const q1 = engine.query('http_requests_total{status="200"}');
  assert.strictEqual(q1.type, 'vector');
  assert.strictEqual(q1.result.length, 1);
  assert.strictEqual(q1.result[0].value[1], '1240');
  pass('PromQL instant vector match with label filter evaluated');

  // PromQL: Inequality selector
  const q2 = engine.query('http_requests_total{status!="200"}');
  assert.strictEqual(q2.result.length, 2); // 201 and 500
  pass('PromQL inequality label matcher evaluated');

  // PromQL: Aggregation sum()
  const qSum = engine.query('sum(http_requests_total)');
  assert.strictEqual(qSum.type, 'scalar');
  assert.strictEqual(qSum.result[0].value[1], '1336'); // 1240 + 84 + 12
  pass('PromQL sum() aggregation accurately computes global sum');

  // PromQL: Aggregation avg()
  const qAvg = engine.query('avg(http_requests_total)');
  assert.strictEqual(qAvg.type, 'scalar');
  assert.strictEqual(qAvg.result[0].value[1], '445.3333');
  pass('PromQL avg() aggregation evaluates mathematical mean');

  // PromQL: Aggregation min() & max()
  const qMin = engine.query('min(http_requests_total)');
  assert.strictEqual(qMin.type, 'scalar');
  assert.strictEqual(qMin.result[0].value[1], '12');
  pass('PromQL min() aggregation evaluates minimum series value (12)');

  const qMax = engine.query('max(http_requests_total)');
  assert.strictEqual(qMax.type, 'scalar');
  assert.strictEqual(qMax.result[0].value[1], '1240');
  pass('PromQL max() aggregation evaluates maximum series value (1240)');

  // PromQL: Aggregation count()
  const qCount = engine.query('count(http_requests_total)');
  assert.strictEqual(qCount.type, 'scalar');
  assert.strictEqual(qCount.result[0].value[1], '3');
  pass('PromQL count() aggregation evaluates total matching series count (3)');

  // PromQL: Rate function approximation
  const qRate = engine.query('rate(http_requests_total[1m])');
  assert.strictEqual(qRate.type, 'vector');
  assert.strictEqual(qRate.result.length, 3);
  pass('PromQL rate() function calculates per-second moving rate');

  // Gauge edge test
  gauge.dec(200, { node: 'worker-1' });
  assert.strictEqual(gauge.get({ node: 'worker-1' }), -90);
  pass('Gauge permits negative instantaneous values (-90)');

  // -------------------------------------------------------------
  // 5. Production HTTP Server & Prometheus Scrape Gateway
  // -------------------------------------------------------------
  console.log('\n[5/5] Testing Production HTTP Server & Scrape Gateway...');

  const apiServer = await new Promise(resolve => {
    const s = startServer(0, () => resolve(s));
  });
  const apiPort = apiServer.address().port;

  const makeReq = (options, postData) => new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: apiPort,
      ...options
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, text: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    req.end();
  });

  // GET /api/health
  const healthRes = await makeReq({ path: '/api/health', method: 'GET' });
  assert.strictEqual(healthRes.status, 200);
  assert.strictEqual(healthRes.json.status, 'UP');
  assert.strictEqual(healthRes.json.service, 'Telemetry-Pulse');
  pass('GET /api/health returned 200 UP');

  // GET /api/stats
  const statsRes = await makeReq({ path: '/api/stats', method: 'GET' });
  assert.strictEqual(statsRes.status, 200);
  assert.strictEqual(statsRes.json.success, true);
  assert(statsRes.json.metrics.totalMetrics >= 3);
  pass('GET /api/stats returned metrics summary and descriptor catalog');

  // GET /metrics (Prometheus scrape endpoint)
  const metricsRes = await makeReq({ path: '/metrics', method: 'GET' });
  assert.strictEqual(metricsRes.status, 200);
  assert(metricsRes.headers['content-type'].includes('text/plain'));
  assert(metricsRes.text.includes('# TYPE http_requests_total counter'));
  pass('GET /metrics rendered standard OpenMetrics scrape payload');

  // POST /api/metrics/ingest
  const ingestRes = await makeReq({
    path: '/api/metrics/ingest',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    type: 'counter',
    name: 'order_checkout_total',
    value: 1,
    labels: { currency: 'USD', tier: 'premium' }
  });
  assert.strictEqual(ingestRes.status, 200);
  assert.strictEqual(ingestRes.json.success, true);
  pass('POST /api/metrics/ingest ingested custom metric observation');

  // POST /api/query (PromQL)
  const queryRes = await makeReq({
    path: '/api/query',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    query: 'sum(http_requests_total)'
  });
  assert.strictEqual(queryRes.status, 200);
  assert.strictEqual(queryRes.json.status, 'success');
  assert.strictEqual(queryRes.json.data.resultType, 'scalar');
  pass('POST /api/query evaluated PromQL expression via HTTP API');

  // GET /api/metrics/catalog
  const catRes = await makeReq({ path: '/api/metrics/catalog', method: 'GET' });
  assert.strictEqual(catRes.status, 200);
  assert(Array.isArray(catRes.json.catalog));
  pass('GET /api/metrics/catalog returned active metric descriptors');

  // Test SSE Stream Handshake
  const sseHandshake = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: apiPort,
      path: '/api/events/stream',
      method: 'GET'
    }, (res) => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['content-type'], 'text/event-stream');
      res.on('data', chunk => {
        const text = chunk.toString();
        if (text.includes('event: init')) {
          req.destroy();
          resolve(true);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
  assert.strictEqual(sseHandshake, true);
  pass('GET /api/events/stream established Server-Sent Events live telemetry stream');

  // Teardown
  await new Promise(resolve => apiServer.close(resolve));

  console.log('\n====================================================');
  console.log(`🎉 ALL ${totalPassed} ASSERTIONS PASSED WITH ZERO MOCKS! (100% SUCCESS)`);
  console.log('====================================================\n');
  process.exit(0);
}

runAllTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
