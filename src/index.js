// Telemetry-Pulse v2.0.0 - Production HTTP Server & Prometheus Scrape Gateway
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { TelemetryEngine } = require('./engine');

const engine = new TelemetryEngine();
const PORT = parseInt(process.env.PORT, 10) || 6017;
const publicDir = path.join(__dirname, '..', 'public');
const startTime = Date.now();
const subscribers = new Set();

function broadcastEvent(eventType, payload) {
  const data = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) {
    try { res.write(data); } catch (e) { subscribers.delete(res); }
  }
}

function requestHandler(req, res) {
  const reqUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = reqUrl.pathname;

  // CORS Headers
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    return res.end();
  }

  // 1. Prometheus Standard Scrape Endpoint: /metrics
  if (req.method === 'GET' && pathname === '/metrics') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(engine.toPrometheusText());
  }

  // 2. SSE Live Stream Endpoint: /api/events/stream
  if (req.method === 'GET' && pathname === '/api/events/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 3000\n\n');

    const initData = JSON.stringify({
      type: 'INIT',
      summary: engine.getMetricsSummary(),
      timestamp: Date.now()
    });
    res.write(`event: init\ndata: ${initData}\n\n`);

    subscribers.add(res);
    res.on('close', () => subscribers.delete(res));
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    const jsonRes = (statusCode, data) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(data));
    };

    let parsedBody = {};
    if (body) {
      try { parsedBody = JSON.parse(body); } catch (e) { /* empty */ }
    }

    // 3. Health API
    if (pathname === '/api/health') {
      return jsonRes(200, {
        status: 'UP',
        service: 'Telemetry-Pulse',
        version: '2.0.0',
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString()
      });
    }

    // 4. Stats & Telemetry API
    if (pathname === '/api/stats') {
      return jsonRes(200, {
        success: true,
        service: 'Telemetry-Pulse',
        version: '2.0.0',
        metrics: engine.getMetricsSummary()
      });
    }

    // 5. Catalog API
    if (req.method === 'GET' && pathname === '/api/metrics/catalog') {
      return jsonRes(200, {
        success: true,
        catalog: engine.getMetricsSummary().catalog
      });
    }

    // 6. Metric Ingestion API
    if (req.method === 'POST' && pathname === '/api/metrics/ingest') {
      const { type, name, value, labels } = parsedBody;
      if (!type || !name) {
        return jsonRes(400, { success: false, error: 'type and name are required' });
      }

      try {
        const result = engine.ingest(type, name, value, labels || {});
        broadcastEvent('metric_ingested', { type, name, value, labels, timestamp: Date.now() });
        return jsonRes(200, { success: true, result });
      } catch (err) {
        return jsonRes(400, { success: false, error: err.message });
      }
    }

    // 7. PromQL Query API
    if (req.method === 'POST' && pathname === '/api/query') {
      const query = parsedBody.query || reqUrl.searchParams.get('query') || '';
      if (!query) return jsonRes(400, { success: false, error: 'Query parameter required' });

      try {
        const result = engine.query(query);
        return jsonRes(200, {
          status: 'success',
          data: {
            resultType: result.type,
            result: result.result
          }
        });
      } catch (err) {
        return jsonRes(400, { status: 'error', error: err.message });
      }
    }

    // 8. Static Assets
    let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      return fs.createReadStream(filePath).pipe(res);
    }

    jsonRes(404, { error: 'Endpoint Not Found', path: pathname });
  });
}

function startServer(port = PORT, callback) {
  const server = http.createServer(requestHandler);
  server.listen(port, () => {
    if (callback) callback(server);
  });
  return server;
}

if (require.main === module) {
  startServer(PORT, () => {
    console.log(`📊 Telemetry-Pulse v2.0.0 running on http://localhost:${PORT}`);
    console.log(`📡 Prometheus scrape endpoint active at http://localhost:${PORT}/metrics`);
  });
}

module.exports = { startServer, requestHandler, engine };
