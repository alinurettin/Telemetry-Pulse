class TelemetryAggregator {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
  }
  incrementCounter(name, delta = 1, labels = {}) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + delta);
    return this.counters.get(name);
  }
  setGauge(name, value, labels = {}) {
    this.gauges.set(name, value);
    return value;
  }
  toPrometheusFormat() {
    let out = '';
    for (const [name, val] of this.counters.entries()) {
      out += '# TYPE ' + name + ' counter\n' + name + ' ' + val + '\n';
    }
    for (const [name, val] of this.gauges.entries()) {
      out += '# TYPE ' + name + ' gauge\n' + name + ' ' + val + '\n';
    }
    return out;
  }
}
module.exports = TelemetryAggregator;