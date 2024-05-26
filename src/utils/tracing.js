'use strict';

const { BatchSpanProcessor } = require('@opentelemetry/tracing');
const { Resource } = require('@opentelemetry/resources');
const {
  SemanticResourceAttributes,
} = require('@opentelemetry/semantic-conventions');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { OTTracePropagator } = require('@opentelemetry/propagator-ot-trace');
const {
  SequelizeInstrumentation,
} = require('opentelemetry-instrumentation-sequelize');

const endpoint =
  process.env.OTEL_TRACE_ENDPOINT || 'http://localhost:14268/api/traces';

const options = {
  tags: [],
  endpoint,
};

const init = (serviceName, environment) => {
  const exporter = new JaegerExporter(options);

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
    }),
  });

  provider.addSpanProcessor(new BatchSpanProcessor(exporter));

  provider.register({ propagator: new OTTracePropagator() });

  console.log(`tracing to ${options.endpoint}`);

  registerInstrumentations({
    instrumentations: [
      getNodeAutoInstrumentations(),
      new SequelizeInstrumentation(),
    ],
  });

  const tracer = provider.getTracer(serviceName);
  return { tracer };
};

module.exports = {
  init: init,
};
