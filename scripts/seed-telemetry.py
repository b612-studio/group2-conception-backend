#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.15"
# dependencies = [
#   "opentelemetry-sdk>=1.39,<2",
#   "opentelemetry-exporter-otlp-proto-http>=1.39,<2",
# ]
# ///
"""Seed an OTLP/HTTP receiver with synthetic telemetry, not application data.

Run: uv run scripts/seed-telemetry.py --requests 100
Only exported environment variables are read; .env is not loaded automatically.
"""

import argparse
import logging
import math
import os
import random
import time
import uuid
from urllib.parse import urlsplit

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import SpanKind, Status, StatusCode


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
        help="OTLP/HTTP base URL, without /v1/traces, /v1/metrics or /v1/logs",
    )
    parser.add_argument(
        "--service-name", default="events-day2-synthetic",
        help="Service shown in the viewer, default: events-day2-synthetic",
    )
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--interval", type=float, default=0.1, help="Seconds between requests")
    parser.add_argument("--error-rate", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42, help="Seed for repeatable scenario choices")
    args = parser.parse_args()
    endpoint = urlsplit(args.endpoint)
    if endpoint.scheme not in ("http", "https") or not endpoint.netloc or endpoint.query or endpoint.fragment:
        parser.error("--endpoint must be an HTTP(S) base URL without a query or fragment")
    if endpoint.path.rstrip("/").endswith(("/v1/traces", "/v1/metrics", "/v1/logs")):
        parser.error("--endpoint must be a base URL, without /v1/<signal>")
    if args.requests < 1:
        parser.error("--requests must be at least 1")
    if not math.isfinite(args.interval) or args.interval < 0:
        parser.error("--interval must be a finite, nonnegative number")
    if not 0 <= args.error_rate <= 1:
        parser.error("--error-rate must be between 0 and 1")
    if not args.service_name.strip():
        parser.error("--service-name cannot be empty")
    return args


def main():
    args = arguments()
    rng = random.Random(args.seed)
    resource = Resource.create({
        "service.name": args.service_name,
        "service.version": "demo",
        "service.instance.id": str(uuid.uuid4()),
        "deployment.environment.name": "local",
        "telemetry.synthetic": True,
    })
    base = args.endpoint.rstrip("/")
    traces = TracerProvider(resource=resource)
    traces.add_span_processor(BatchSpanProcessor(
        OTLPSpanExporter(endpoint=f"{base}/v1/traces", timeout=5)
    ))
    trace.set_tracer_provider(traces)
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{base}/v1/metrics", timeout=5),
        export_interval_millis=1000,
    )
    meters = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(meters)
    logs = LoggerProvider(resource=resource)
    logs.add_log_record_processor(BatchLogRecordProcessor(
        OTLPLogExporter(endpoint=f"{base}/v1/logs", timeout=5)
    ))
    logger = logging.getLogger("seed-telemetry")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    handler = LoggingHandler(level=logging.INFO, logger_provider=logs)
    logger.addHandler(handler)

    tracer = trace.get_tracer("seed-telemetry")
    meter = metrics.get_meter("seed-telemetry")
    count = meter.create_counter("http.server.request.count", unit="{request}")
    duration = meter.create_histogram("http.server.request.duration", unit="s")
    active = meter.create_up_down_counter("http.server.active_requests", unit="{request}")
    routes = [("GET", "/events"), ("GET", "/events/:id"), ("POST", "/events")]
    completed = errors = 0
    print(f"Sending synthetic telemetry to {base} as {args.service_name}", flush=True)
    print("Exporter failures are reported on stderr. Press Ctrl+C to stop and flush.", flush=True)
    try:
        for _ in range(args.requests):
            method, route = rng.choice(routes)
            failed = rng.random() < args.error_rate
            slow = rng.random() < 0.2
            status = 500 if failed else (201 if method == "POST" else 200)
            attributes = {
                "http.request.method": method,
                "http.route": route,
                "http.response.status_code": status,
            }
            started = time.perf_counter()
            active.add(1, {"http.request.method": method})
            try:
                with tracer.start_as_current_span(
                    f"{method} {route}", kind=SpanKind.SERVER, attributes=attributes,
                ) as request:
                    with tracer.start_as_current_span(
                        "SELECT events", kind=SpanKind.CLIENT,
                        attributes={"db.system.name": "postgresql", "db.operation.name": "SELECT"},
                    ) as query:
                        time.sleep(rng.uniform(0.1, 0.25) if slow else rng.uniform(0.002, 0.015))
                        if failed:
                            query.set_status(Status(StatusCode.ERROR, "Synthetic database timeout"))
                            query.set_attribute("error.type", "SyntheticTimeout")
                    if slow:
                        logger.warning("Synthetic slow query", extra={"http.route": route})
                    if failed:
                        request.set_status(Status(StatusCode.ERROR, "Synthetic request failure"))
                        request.set_attribute("error.type", "SyntheticTimeout")
                        logger.error("Synthetic request failed", extra=attributes)
                    else:
                        logger.info("Synthetic request completed", extra=attributes)
                    count.add(1, attributes)
                    duration.record(time.perf_counter() - started, attributes)
                    completed += 1
                    errors += int(failed)
            finally:
                active.add(-1, {"http.request.method": method})
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopping generation.")
    finally:
        # Flush while the providers are still alive, including the final metric batch.
        try:
            traces.force_flush()
            logs.force_flush()
            meters.force_flush()
        finally:
            traces.shutdown()
            logs.shutdown()
            meters.shutdown()
            logger.removeHandler(handler)
            handler.close()
    print(f"Generated {completed} requests, including {errors} synthetic failures.")
    print(f"Select service '{args.service_name}' in your telemetry viewer.")


if __name__ == "__main__":
    main()
