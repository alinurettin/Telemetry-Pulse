// Telemetry-Pulse v2.0.0 - Enterprise OpenTelemetry & Prometheus Aggregator
// Cumulative & Exponential Histograms, Vector Label Indexing, and PromQL Evaluation Engine

/**
 * Deterministically formats label dictionaries into standard Prometheus syntax:
 * {k1="v1",k2="v2"} with alphabetically sorted keys
 */
function formatLabels(labels = {}) {
  const keys = Object.keys(labels).filter(k => labels[k] !== undefined && labels[k] !== null).sort();
  if (keys.length === 0) return '';
  const pairs = keys.map(k => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`);
  return `{${pairs.join(',')}}`;
}

function parseSeriesKey(metricName, labels = {}) {
  return `${metricName}${formatLabels(labels)}`;
}

/**
 * 1. Monotonic Counter Metric
 */
class Counter {
  constructor(name, help = '') {
    this.name = name;
    this.help = help;
    this.series = new Map(); // seriesKey -> { value, labels, history: [{t, v}] }
  }

  inc(delta = 1, labels = {}) {
    if (delta < 0) throw new Error('Counter can only increment monotonically');
    const key = parseSeriesKey(this.name, labels);
    const entry = this.series.get(key) || { value: 0, labels: { ...labels }, history: [] };
    entry.value += delta;
    entry.history.push({ t: Date.now(), v: entry.value });
    if (entry.history.length > 50) entry.history.shift();
    this.series.set(key, entry);
    return entry.value;
  }

  get(labels = {}) {
    const key = parseSeriesKey(this.name, labels);
    const entry = this.series.get(key);
    return entry ? entry.value : 0;
  }
}

/**
 * 2. Gauge Metric (Instantaneous Snapshot)
 */
class Gauge {
  constructor(name, help = '') {
    this.name = name;
    this.help = help;
    this.series = new Map();
  }

  set(value, labels = {}) {
    const key = parseSeriesKey(this.name, labels);
    const entry = this.series.get(key) || { value: 0, labels: { ...labels }, history: [] };
    entry.value = Number(value);
    entry.history.push({ t: Date.now(), v: entry.value });
    if (entry.history.length > 50) entry.history.shift();
    this.series.set(key, entry);
    return entry.value;
  }

  inc(delta = 1, labels = {}) {
    const key = parseSeriesKey(this.name, labels);
    const cur = this.get(labels);
    return this.set(cur + delta, labels);
  }

  dec(delta = 1, labels = {}) {
    const key = parseSeriesKey(this.name, labels);
    const cur = this.get(labels);
    return this.set(cur - delta, labels);
  }

  get(labels = {}) {
    const key = parseSeriesKey(this.name, labels);
    const entry = this.series.get(key);
    return entry ? entry.value : 0;
  }
}

/**
 * 3. Cumulative Bucket Histogram
 */
class Histogram {
  constructor(name, help = '', buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]) {
    this.name = name;
    this.help = help;
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.series = new Map(); // seriesKey -> { bucketCounts: Map(bound -> count), sum, count, labels }
  }

  observe(value, labels = {}) {
    const key = parseSeriesKey(this.name, labels);
    let entry = this.series.get(key);
    if (!entry) {
      const bMap = new Map();
      this.buckets.forEach(b => bMap.set(b, 0));
      entry = { bucketCounts: bMap, sum: 0, count: 0, labels: { ...labels }, raw: [] };
      this.series.set(key, entry);
    }

    const val = Number(value);
    entry.sum += val;
    entry.count++;
    entry.raw.push(val);
    if (entry.raw.length > 100) entry.raw.shift();

    for (const b of this.buckets) {
      if (val <= b) {
        entry.bucketCounts.set(b, entry.bucketCounts.get(b) + 1);
      }
    }
  }

  get(labels = {}) {
    const key = parseSeriesKey(this.name, labels);
    return this.series.get(key) || null;
  }
}

/**
 * 4. OpenTelemetry Exponential Histogram
 * High-resolution log-linear bucket scale: index = floor(log2(val) * 2^scale)
 */
class ExponentialHistogram {
  constructor(scale = 3) {
    this.scale = scale;
    this.factor = Math.pow(2, scale);
    this.positiveBuckets = new Map(); // bucketIndex -> count
    this.zeroCount = 0;
    this.sum = 0;
    this.count = 0;
  }

  computeBucketIndex(val) {
    if (val <= 0) return null;
    return Math.floor(Math.log2(val) * this.factor);
  }

  observe(value) {
    const val = Number(value);
    this.sum += val;
    this.count++;

    if (val === 0) {
      this.zeroCount++;
      return;
    }

    const idx = this.computeBucketIndex(val);
    this.positiveBuckets.set(idx, (this.positiveBuckets.get(idx) || 0) + 1);
  }

  getDistribution() {
    const buckets = [];
    for (const [idx, count] of this.positiveBuckets.entries()) {
      const lowerBound = Math.pow(2, idx / this.factor);
      const upperBound = Math.pow(2, (idx + 1) / this.factor);
      buckets.push({
        index: idx,
        lowerBound: parseFloat(lowerBound.toFixed(4)),
        upperBound: parseFloat(upperBound.toFixed(4)),
        count
      });
    }
    return {
      scale: this.scale,
      zeroCount: this.zeroCount,
      totalCount: this.count,
      sum: parseFloat(this.sum.toFixed(4)),
      buckets: buckets.sort((a, b) => a.index - b.index)
    };
  }
}

/**
 * 5. PromQL Subset Evaluator
 * Supports:
 * - Direct vector selector: http_requests_total{status="200"}
 * - Aggregators: sum(metric), avg(metric), min(metric), max(metric), count(metric)
 * - Rate function: rate(http_requests_total[1m])
 */
class PromQLEvaluator {
  constructor(engine) {
    this.engine = engine;
  }

  evaluate(query) {
    const q = query ? query.trim() : '';
    if (!q) return { type: 'vector', result: [] };

    // 1. Check aggregator function: sum(q), avg(q), min(q), max(q), count(q)
    const aggMatch = q.match(/^(sum|avg|min|max|count)\((.*)\)$/i);
    if (aggMatch) {
      const aggType = aggMatch[1].toLowerCase();
      const innerQuery = aggMatch[2].trim();
      const innerRes = this.evaluate(innerQuery);
      return this.aggregateVector(aggType, innerRes.result);
    }

    // 2. Check rate function: rate(metric{...}[window])
    const rateMatch = q.match(/^rate\(([^\[]+)\[([0-9]+[smhd])\]\)$/i);
    if (rateMatch) {
      const innerTarget = rateMatch[1].trim();
      const innerRes = this.evaluateVector(innerTarget);
      return this.computeRate(innerRes);
    }

    // 3. Direct vector query
    return {
      type: 'vector',
      result: this.evaluateVector(q)
    };
  }

  parseSelector(selectorStr) {
    const match = selectorStr.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?$/);
    if (!match) return { metricName: selectorStr, matchers: {} };

    const metricName = match[1];
    const matchersStr = match[2] || '';
    const matchers = {};

    if (matchersStr) {
      const pairs = matchersStr.split(',');
      for (const pair of pairs) {
        const pMatch = pair.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(=|!=)\s*"(.*)"/);
        if (pMatch) {
          matchers[pMatch[1]] = { op: pMatch[2], val: pMatch[3] };
        }
      }
    }

    return { metricName, matchers };
  }

  evaluateVector(selectorStr) {
    const { metricName, matchers } = this.parseSelector(selectorStr);
    const results = [];

    // Search across counters, gauges, histograms
    const metricObj = this.engine.metrics.get(metricName);
    if (!metricObj) return [];

    if (metricObj instanceof Counter || metricObj instanceof Gauge) {
      for (const [key, entry] of metricObj.series.entries()) {
        if (this.labelsMatch(entry.labels, matchers)) {
          results.push({
            metric: { __name__: metricName, ...entry.labels },
            value: [Date.now() / 1000, String(entry.value)]
          });
        }
      }
    } else if (metricObj instanceof Histogram) {
      for (const [key, entry] of metricObj.series.entries()) {
        if (this.labelsMatch(entry.labels, matchers)) {
          results.push({
            metric: { __name__: `${metricName}_count`, ...entry.labels },
            value: [Date.now() / 1000, String(entry.count)]
          });
          results.push({
            metric: { __name__: `${metricName}_sum`, ...entry.labels },
            value: [Date.now() / 1000, String(entry.sum)]
          });
        }
      }
    }

    return results;
  }

  labelsMatch(labels = {}, matchers = {}) {
    for (const [k, matcher] of Object.entries(matchers)) {
      const val = labels[k];
      if (matcher.op === '=' && val !== matcher.val) return false;
      if (matcher.op === '!=' && val === matcher.val) return false;
    }
    return true;
  }

  aggregateVector(aggType, vector) {
    if (!vector || vector.length === 0) {
      return { type: 'scalar', result: [{ value: [Date.now() / 1000, '0'] }] };
    }

    const values = vector.map(v => parseFloat(v.value[1]));
    let finalVal = 0;

    switch (aggType) {
      case 'sum':
        finalVal = values.reduce((a, b) => a + b, 0);
        break;
      case 'avg':
        finalVal = values.reduce((a, b) => a + b, 0) / values.length;
        break;
      case 'min':
        finalVal = Math.min(...values);
        break;
      case 'max':
        finalVal = Math.max(...values);
        break;
      case 'count':
        finalVal = values.length;
        break;
    }

    return {
      type: 'scalar',
      result: [{
        metric: {},
        value: [Date.now() / 1000, String(parseFloat(finalVal.toFixed(4)))]
      }]
    };
  }

  computeRate(vector) {
    // Rate approximation over series history
    const results = vector.map(item => {
      const val = parseFloat(item.value[1]);
      // Approximate per-second rate
      const rateVal = parseFloat((val / 60).toFixed(4));
      return {
        metric: { ...item.metric },
        value: [item.value[0], String(rateVal)]
      };
    });
    return { type: 'vector', result: results };
  }
}

/**
 * 6. TelemetryEngine Registry
 */
class TelemetryEngine {
  constructor() {
    this.metrics = new Map(); // name -> Counter | Gauge | Histogram
    this.exponentialHistograms = new Map();
    this.evaluator = new PromQLEvaluator(this);
    this.totalDatapointsIngested = 0;
    this.startTime = Date.now();

    this.initDefaultMetrics();
  }

  initDefaultMetrics() {
    const httpReqs = this.registerCounter(
      'http_requests_total',
      'Total count of HTTP requests processed by edge gateway'
    );
    httpReqs.inc(1240, { method: 'GET', status: '200', env: 'production' });
    httpReqs.inc(84, { method: 'POST', status: '201', env: 'production' });
    httpReqs.inc(12, { method: 'GET', status: '500', env: 'production' });

    const memUsage = this.registerGauge(
      'node_memory_utilization_ratio',
      'Process memory utilization percentage'
    );
    memUsage.set(0.42, { instance: 'srv-01', region: 'us-east' });
    memUsage.set(0.68, { instance: 'srv-02', region: 'eu-west' });

    const reqDuration = this.registerHistogram(
      'http_request_duration_seconds',
      'HTTP latency distribution in seconds'
    );
    [0.004, 0.012, 0.045, 0.089, 0.210, 0.450, 1.200].forEach(d => {
      reqDuration.observe(d, { handler: '/api/v1/auth' });
    });

    const expHist = this.registerExponentialHistogram('packet_transfer_bytes', 3);
    [12, 45, 128, 512, 1024, 4096, 65535].forEach(v => expHist.observe(v));

    this.totalDatapointsIngested = 20;
  }

  registerCounter(name, help = '') {
    const c = new Counter(name, help);
    this.metrics.set(name, c);
    return c;
  }

  registerGauge(name, help = '') {
    const g = new Gauge(name, help);
    this.metrics.set(name, g);
    return g;
  }

  registerHistogram(name, help = '', buckets) {
    const h = new Histogram(name, help, buckets);
    this.metrics.set(name, h);
    return h;
  }

  registerExponentialHistogram(name, scale = 3) {
    const eh = new ExponentialHistogram(scale);
    this.exponentialHistograms.set(name, eh);
    return eh;
  }

  ingest(type, name, value, labels = {}) {
    this.totalDatapointsIngested++;
    const t = type.toLowerCase();

    if (t === 'counter') {
      let metric = this.metrics.get(name);
      if (!metric || !(metric instanceof Counter)) metric = this.registerCounter(name);
      return metric.inc(Number(value) || 1, labels);
    }

    if (t === 'gauge') {
      let metric = this.metrics.get(name);
      if (!metric || !(metric instanceof Gauge)) metric = this.registerGauge(name);
      return metric.set(Number(value), labels);
    }

    if (t === 'histogram') {
      let metric = this.metrics.get(name);
      if (!metric || !(metric instanceof Histogram)) metric = this.registerHistogram(name);
      metric.observe(Number(value), labels);
      return metric.get(labels);
    }

    throw new Error(`Unsupported metric type: ${type}`);
  }

  query(promqlString) {
    return this.evaluator.evaluate(promqlString);
  }

  /**
   * Serializes all registered metrics into official Prometheus / OpenMetrics text format
   */
  toPrometheusText() {
    let out = '';

    for (const [name, metric] of this.metrics.entries()) {
      if (metric.help) out += `# HELP ${name} ${metric.help}\n`;

      if (metric instanceof Counter) {
        out += `# TYPE ${name} counter\n`;
        for (const [key, entry] of metric.series.entries()) {
          out += `${key} ${entry.value}\n`;
        }
      } else if (metric instanceof Gauge) {
        out += `# TYPE ${name} gauge\n`;
        for (const [key, entry] of metric.series.entries()) {
          out += `${key} ${entry.value}\n`;
        }
      } else if (metric instanceof Histogram) {
        out += `# TYPE ${name} histogram\n`;
        for (const [key, entry] of metric.series.entries()) {
          let runningCount = 0;
          for (const b of metric.buckets) {
            runningCount = entry.bucketCounts.get(b) || 0;
            const bLabels = { ...entry.labels, le: String(b) };
            out += `${name}_bucket${formatLabels(bLabels)} ${runningCount}\n`;
          }
          // +Inf bucket
          const infLabels = { ...entry.labels, le: '+Inf' };
          out += `${name}_bucket${formatLabels(infLabels)} ${entry.count}\n`;
          out += `${name}_sum${formatLabels(entry.labels)} ${parseFloat(entry.sum.toFixed(6))}\n`;
          out += `${name}_count${formatLabels(entry.labels)} ${entry.count}\n`;
        }
      }
      out += '\n';
    }

    return out;
  }

  getMetricsSummary() {
    let seriesCount = 0;
    const catalog = [];

    for (const [name, m] of this.metrics.entries()) {
      const sc = m.series ? m.series.size : 0;
      seriesCount += sc;
      let type = 'unknown';
      if (m instanceof Counter) type = 'counter';
      if (m instanceof Gauge) type = 'gauge';
      if (m instanceof Histogram) type = 'histogram';

      catalog.push({
        name,
        type,
        help: m.help,
        seriesCount: sc
      });
    }

    return {
      totalMetrics: this.metrics.size,
      totalSeries: seriesCount,
      totalDatapointsIngested: this.totalDatapointsIngested,
      exponentialHistograms: this.exponentialHistograms.size,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      catalog
    };
  }
}

module.exports = {
  formatLabels,
  Counter,
  Gauge,
  Histogram,
  ExponentialHistogram,
  PromQLEvaluator,
  TelemetryEngine
};