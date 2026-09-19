/**
 * OpenTelemetry Integration Readiness
 *
 * Defines the interface and hooks needed for OpenTelemetry integration.
 * This is a no-op implementation by default; production deployments
 * should implement the OTelTracer interface to emit distributed traces.
 */

/**
 * Minimal OpenTelemetry tracer interface.
 * Subset of OTel SDK used by orchestration layer.
 */
export interface OTelSpan {
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  setStatus(status: { code: string; message?: string }): void;
  end(): void;
}

export interface OTelTracer {
  /**
   * Start a new span for tracing a discrete operation.
   * The span remains active until end() is called.
   */
  startSpan(name: string, options?: OTelSpanOptions): OTelSpan;
}

export interface OTelSpanOptions {
  attributes?: Record<string, unknown>;
  links?: Array<{
    context: unknown;
    attributes?: Record<string, unknown>;
  }>;
}

/**
 * No-op span implementation (default).
 * Used when OpenTelemetry is not configured.
 */
export class NoOpSpan implements OTelSpan {
  addEvent(name: string, attributes?: Record<string, unknown>): void {
    // no-op
  }

  setStatus(status: { code: string; message?: string }): void {
    // no-op
  }

  end(): void {
    // no-op
  }
}

/**
 * No-op tracer implementation (default).
 * Used when OpenTelemetry is not configured.
 */
export class NoOpTracer implements OTelTracer {
  startSpan(name: string, options?: OTelSpanOptions): OTelSpan {
    return new NoOpSpan();
  }
}

/**
 * Integration hooks for orchestration layer.
 * Enables distributed tracing, metrics, and logging without tight coupling.
 */
export interface OrchestrationTelemetry {
  /**
   * Tracer for instrumenting run execution flow.
   * Each span represents a logical unit of work (claim, execute, retry, etc).
   */
  readonly tracer: OTelTracer;

  /**
   * Metrics for recording observability data.
   * Should emit to OpenTelemetry metric exporters.
   */
  readonly metrics?: {
    recordQueueLatency(delayMs: number, provider: string): void;
    recordExecutionDuration(delayMs: number, provider: string): void;
    recordExecutionSuccess(provider: string): void;
    recordExecutionFailure(provider: string, errorKind: string): void;
    recordRetryScheduled(provider: string, attempt: number): void;
    recordRateLimited(provider: string): void;
    recordTokens(
      provider: string,
      inputTokens: number,
      outputTokens: number,
    ): void;
    recordCost(provider: string, costUsd: number): void;
  };

  /**
   * Context propagation for distributed tracing.
   * Links parent traces (e.g., from API request) to child spans (orchestration).
   */
  readonly contextPropagation?: {
    /**
     * Extract trace context from incoming request headers.
     * Returns opaque context object suitable for link() below.
     */
    extractFromHeaders(
      headers: Record<string, string>,
    ): unknown | null;

    /**
     * Link this trace to a parent trace context.
     * Used to correlate orchestration spans with API request spans.
     */
    linkToParent(parentContext: unknown): void;
  };
}

/**
 * Default OpenTelemetry telemetry configuration (no-op).
 * Production deployments should override with real OTel SDK.
 */
export const defaultOTelTelemetry: OrchestrationTelemetry = {
  tracer: new NoOpTracer(),
};

/**
 * Example: Structured logging with OpenTelemetry correlation.
 *
 * This is how production deployments would integrate:
 *
 * ```ts
 * import {
 *   MeterProvider,
 *   PeriodicExportingMetricReader,
 * } from "@opentelemetry/sdk-metrics";
 * import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
 * import {
 *   NodeTracerProvider,
 *   BatchSpanProcessor,
 * } from "@opentelemetry/sdk-trace-node";
 * import {
 *   OTLPTraceExporter,
 * } from "@opentelemetry/exporter-trace-otlp-http";
 *
 * export function createProductionTelemetry(): OrchestrationTelemetry {
 *   // Set up trace exporter (sends to Jaeger, Datadog, New Relic, etc)
 *   const traceExporter = new OTLPTraceExporter({
 *     url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
 *   });
 *   const traceProvider = new NodeTracerProvider();
 *   traceProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
 *
 *   // Set up metric exporter
 *   const metricExporter = new OTLPMetricExporter({
 *     url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
 *   });
 *   const meterProvider = new MeterProvider({
 *     readers: [
 *       new PeriodicExportingMetricReader({
 *         exporter: metricExporter,
 *       }),
 *     ],
 *   });
 *
 *   // Set global providers
 *   global.otel = {
 *     trace: traceProvider,
 *     metrics: meterProvider,
 *   };
 *
 *   return {
 *     tracer: traceProvider.getTracer("agentboard"),
 *     metrics: {
 *       recordQueueLatency: (delayMs, provider) => {
 *         const meter = meterProvider.getMeter("agentboard");
 *         meter.createHistogram("queue.latency.ms").record(delayMs, {
 *           provider,
 *         });
 *       },
 *       // ... other metrics ...
 *     },
 *     contextPropagation: {
 *       extractFromHeaders: (headers) => {
 *         const tracer = require("@opentelemetry/api");
 *         return tracer.extract(
 *           tracer.defaultTextMapPropagator(),
 *           headers,
 *         );
 *       },
 *       linkToParent: (parentContext) => {
 *         // Link spans using context propagation
 *       },
 *     },
 *   };
 * }
 * ```
 */

/**
 * Usage in orchestration layer:
 *
 * ```ts
 * export async function executeRun(
 *   runId: string,
 *   ports: RunExecutionPorts,
 *   telemetry: OrchestrationTelemetry = defaultOTelTelemetry,
 * ): Promise<RunCoordinatorResult> {
 *   const span = telemetry.tracer.startSpan("run.execute", {
 *     attributes: {
 *       "run.id": runId,
 *       "run.provider": provider,
 *     },
 *   });
 *
 *   try {
 *     // Claim run
 *     span.addEvent("run.claimed", { "queue.latency.ms": queueLatency });
 *     telemetry.metrics?.recordQueueLatency(queueLatency, provider);
 *
 *     // Execute
 *     const executeSpan = telemetry.tracer.startSpan("execution.invoke", {
 *       links: [{ context: span }],
 *     });
 *     const result = await ports.runtime.invoke(invocation);
 *     executeSpan.end();
 *
 *     telemetry.metrics?.recordExecutionDuration(duration, provider);
 *
 *     // Record success
 *     span.setStatus({ code: "OK" });
 *     telemetry.metrics?.recordExecutionSuccess(provider);
 *
 *   } catch (error) {
 *     span.setStatus({
 *       code: "ERROR",
 *       message: errorMessage(error),
 *     });
 *     span.addEvent("execution.failed", { error: errorMessage(error) });
 *     telemetry.metrics?.recordExecutionFailure(provider, errorKind);
 *   } finally {
 *     span.end();
 *   }
 * }
 * ```
 */
