# 📊 Telemetry-Pulse v2.0.0

[![Engine: Node.js](https://img.shields.io/badge/Runtime-Node.js%20LTS-brightgreen.svg)](https://nodejs.org)
[![Exposition: OpenMetrics](https://img.shields.io/badge/Standards-OpenMetrics%20%2F%20Prometheus-blue.svg)](#architecture)
[![Histogram: Exponential-OTel](https://img.shields.io/badge/Math-Log--Linear%20Exponential%20Histograms-cyan.svg)](#exponential-histograms)
[![Tests: 26 Non-Mocked](https://img.shields.io/badge/Tests-26%2F26%20Passed%20(Zero%20Mocks)-success.svg)](#test-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub: alinurettin](https://img.shields.io/badge/Author-alinurettin-purple.svg)](https://github.com/alinurettin)

> **Enterprise OpenTelemetry-Compatible Metric Aggregator, Exponential Histogram Bucketing Engine, Prometheus / OpenMetrics Exposition Gateway, and PromQL Evaluation Engine.**

---

## 🇹🇷 Türkçe Açıklama ve Genel Bakış

**Telemetry-Pulse v2.0.0**, bulut yerel (cloud-native) mikroservisler, Kubernetes pod'ları ve yüksek verimli arka plan servisleri için tasarlanmış, harici bağımlılık barındırmayan (zero-dependency) hafif ve yüksek performanslı bir telemetri toplayıcısı ve Prometheus kazıma (scrape) ağ geçididir.

### Öne Çıkan Yetenekler:
1. **OpenMetrics / Prometheus Standart Kazıma Ağ Geçidi:** `/metrics` uç noktasında `# HELP` ve `# TYPE` tanımlamalarıyla RFC uyumlu, deterministik sıralı etiket formatında doğrudan Prometheus ve Grafana uyumlu metrik çıktısı sunar.
2. **OpenTelemetry Üstel Histogramlar (Exponential Histograms):** Sabit aralıklı histogramların kuyruk gecikmelerini bozma sorununu çözer; logaritmik-lineer ölçek algoritmasıyla ($\lfloor \log_2(v) \cdot 2^s \rfloor$) tüm dağılımlarda sabit göreli hata oranı ($\pm 4.5\%$) sağlar.
3. **Gömülü PromQL Değerlendirme Motoru:** Anlık vektör seçicileri (`http_requests_total{status="200"}`), etiket filtreleri (`=`, `!=`), hareketli oran hesaplaması (`rate(...)`) ve vektör toplayıcılarını (`sum`, `avg`, `min`, `max`, `count`) doğrudan değerlendirir.
4. **Çok Boyutlu Metrik Tipleri:** Monotonik Sayaçlar (`Counter`), anlık durum Göstergeleri (`Gauge`) ve Kümülatif Dağılımlar (`Histogram`).
5. **Siber Karanlık Mod Telemetri Stüdyosu:** `public/` dizininde canlı PromQL sorgu konsolu, metrik kataloğu, anlık `/metrics` kopyalama paneli ve SSE canlı veri akış stüdyosu.
6. **%100 Gerçek Soket Testleri:** Mock kullanılmadan, dinamik işletim sistemi HTTP soketleri üzerinden çalışan 26 kapsamlı doğrulama testi.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    Client[Microservice / Ingest Agent] -->|POST /api/metrics/ingest| Server[HTTP Server & Ingestion Gateway]
    Prometheus[Prometheus / Grafana Agent] -->|GET /metrics Scrape| Server
    Dashboard[Cyber Dark Studio / UI] <-->|SSE Stream: /api/events/stream| Server
    Dashboard -->|POST /api/query (PromQL)| Server
    
    subgraph Engine [TelemetryEngine Subsystem]
        Server --> Registry[(Metric Series Registry)]
        Registry --> Counters[Counters Map]
        Registry --> Gauges[Gauges Map]
        Registry --> Histograms[Cumulative Histograms]
        Registry --> ExpHistograms[OTel Exponential Histograms]
        
        Server --> Evaluator[PromQL Algebraic Evaluator]
        Evaluator --> Registry
        
        Server --> Exposer[OpenMetrics Text Formatter]
        Exposer --> Registry
    end
```

---

## 📐 Mathematical Foundations

### 1. OpenTelemetry Exponential Histogram
For scale parameter $s \in \mathbb{Z}$ and positive observation $v > 0$:

$$\text{Index}(v) = \left\lfloor \log_2(v) \cdot 2^s \right\rfloor$$

The corresponding bucket spans the half-open interval:

$$[2^{i \cdot 2^{-s}}, 2^{(i + 1) \cdot 2^{-s}})$$

The relative error ratio is strictly bounded to:

$$\frac{U_i}{L_i} = 2^{2^{-s}}$$

### 2. PromQL Vector Algebra
Instant vector evaluations with aggregators over metric vector $V$:

$$\text{sum}(V) = \sum_{(m, v) \in V} v, \quad \text{avg}(V) = \frac{1}{|V|} \sum_{(m, v) \in V} v$$

$$\text{rate}(V, \Delta t) = \frac{\Delta v}{\Delta t}$$

---

## 🚀 Quick Start & Installation

### Prerequisites
- **Node.js:** v18.0.0+ (Tested on v24.19.0 LTS)
- **Zero External Dependencies:** Built entirely with Node.js standard libraries (`http`, `url`, `path`, `fs`).

### Installation
```bash
git clone https://github.com/alinurettin/Telemetry-Pulse.git
cd Telemetry-Pulse
```

### Running the Server
```bash
node src/index.js
```
The server will start on `http://localhost:6017`.
- **Dashboard Studio:** `http://localhost:6017`
- **Prometheus Scrape:** `http://localhost:6017/metrics`

### Running with Docker
```bash
docker-compose up -d --build
```

---

## 🧪 Comprehensive Test Suite (100% Non-Mocked)

Run the exhaustive verification suite testing label formatting, counters, gauges, histograms, PromQL algebra, and the scrape gateway:

```bash
npm test
```

### Test Output Verification:
```text
====================================================
🧪 Running Verification Suite: Telemetry-Pulse v2.0.0
====================================================

[1/5] Testing OpenMetrics Label Serialization...
  ✓ [PASS 1] Empty label dictionary serializes to empty string
  ✓ [PASS 2] Labels deterministically sort in alphabetical order
  ✓ [PASS 3] Double quotes within label values are escaped

[2/5] Testing Metric Primitives & Monotonicity...
  ✓ [PASS 4] Counter accumulates values across consecutive increments
  ✓ [PASS 5] Negative delta rejected enforcing counter monotonicity
  ✓ [PASS 6] Distinct label dimensions isolate series state
  ✓ [PASS 7] Gauge increment, decrement, and set operations verified

[3/5] Testing Cumulative & Exponential Histograms...
  ✓ [PASS 8] Cumulative histogram bucket counters correctly categorize distributions
  ✓ [PASS 9] Exponential histogram log-linear bucketing and zero-bucket verified

[4/5] Testing Prometheus Text Format & PromQL Algebra...
  ✓ [PASS 10] RFC compliant Prometheus / OpenMetrics exposition format generated
  ✓ [PASS 11] PromQL instant vector match with label filter evaluated
  ✓ [PASS 12] PromQL inequality label matcher evaluated
  ✓ [PASS 13] PromQL sum() aggregation accurately computes global sum
  ✓ [PASS 14] PromQL avg() aggregation evaluates mathematical mean
  ✓ [PASS 15] PromQL min() aggregation evaluates minimum series value (12)
  ✓ [PASS 16] PromQL max() aggregation evaluates maximum series value (1240)
  ✓ [PASS 17] PromQL count() aggregation evaluates total matching series count (3)
  ✓ [PASS 18] PromQL rate() function calculates per-second moving rate
  ✓ [PASS 19] Gauge permits negative instantaneous values (-90)

[5/5] Testing Production HTTP Server & Scrape Gateway...
  ✓ [PASS 20] GET /api/health returned 200 UP
  ✓ [PASS 21] GET /api/stats returned metrics summary and descriptor catalog
  ✓ [PASS 22] GET /metrics rendered standard OpenMetrics scrape payload
  ✓ [PASS 23] POST /api/metrics/ingest ingested custom metric observation
  ✓ [PASS 24] POST /api/query evaluated PromQL expression via HTTP API
  ✓ [PASS 25] GET /api/metrics/catalog returned active metric descriptors
  ✓ [PASS 26] GET /api/events/stream established Server-Sent Events live telemetry stream

====================================================
🎉 ALL 26 ASSERTIONS PASSED WITH ZERO MOCKS! (100% SUCCESS)
====================================================
```

---

## 📡 REST API Reference & cURL Examples

### 1. Ingest Metric Observation
```bash
curl -X POST http://localhost:6017/api/metrics/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "type": "counter",
    "name": "api_tokens_generated_total",
    "value": 1500,
    "labels": { "model": "gemini-2.0-flash", "tier": "free" }
  }'
```

### 2. Execute PromQL Query
```bash
curl -X POST http://localhost:6017/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "sum(http_requests_total)"}'
```

### 3. Scrape Prometheus / OpenMetrics Format
```bash
curl http://localhost:6017/metrics
```

### 4. Fetch Active Metric Descriptor Catalog
```bash
curl http://localhost:6017/api/metrics/catalog
```

### 5. Listen to Real-Time Ingestion SSE Stream
```bash
curl -N -H "Accept: text/event-stream" http://localhost:6017/api/events/stream
```

---

## 📄 License & Attribution

Distributed under the **MIT License**. Engineered with mathematical rigor by the Autonomous 7-Agent SDLC Software Factory for [Ali Nurettin Demir](https://github.com/alinurettin).
