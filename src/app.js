// Packages
const Sentry = require('@sentry/node');
const { ProfilingIntegration } = require('@sentry/profiling-node');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const logger = require('./utils/winston');
const responseTime = require('response-time');
const {
  register,
  totalRequests,
} = require('../../Cadence-Brain/src/utils/promClient.js');

// Helpers
const redisHealthCheck = require('../../Cadence-Brain/src/utils/redisHealthCheck');
const dbHealthCheck = require('../../Cadence-Brain/src/utils/dbHealthCheck');
const {
  MORGAN_REQ_LOG_FORMAT,
} = require('../../Cadence-Brain/src/utils/constants');
const { SENTRY_DSN, NODE_ENV } = require('./utils/config');

const app = express();

if (NODE_ENV === 'production') {
  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
      // enable HTTP calls tracing
      new Sentry.Integrations.Http({ tracing: true }),
      // enable Express.js middleware tracing
      new Sentry.Integrations.Express({ app }),
      new ProfilingIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0,
    // Set sampling rate for profiling - this is relative to tracesSampleRate
    profilesSampleRate: 1.0,
  });
  // The request handler must be the first middleware on the app
  app.use(Sentry.Handlers.requestHandler());
  // TracingHandler creates a trace for every incoming request
  app.use(Sentry.Handlers.tracingHandler());
  // * Error
  app.use(Sentry.Handlers.errorHandler());
  logger.info('🌐 Initialized Sentry successfully');
}

// Middlewares
app.use(express.json({ limit: '50mb' }));
app.use(
  express.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 })
);
app.use(responseTime());

// * Excess time
morgan.token('emoji', (req, res) => {
  const responseTime = res.getHeader('X-Response-Time');
  if (responseTime && parseFloat(responseTime) > 5000) return '⏰';
  return ' ';
});

// * User log
morgan.token('user', (req, res) => {
  if (req.user) return `👤 ${req.user.user_id} ~`;
  return ' ';
});

// * Correlation Id
morgan.token('correlationId', (req, res) => {
  const correlationId = res.correlationId;
  if (correlationId) return `(${correlationId})`;
  return ' ';
});

app.use(cors());
app.use(helmet());
app.use(morgan(MORGAN_REQ_LOG_FORMAT, { stream: logger.stream }));
app.use(express.json());

// Routes imports
const v1Routes = require('./routes/v1');
const v2Routes = require('./routes/v2');

// Routes
app.use('/v1', v1Routes);
app.use('/v2', v2Routes);

app.get('/', (_, res) => {
  res.status(200).send('CRM backend up and running ');
});

app.use((req, res, next) => {
  totalRequests.inc({ method: req.method, hostname: req.hostname });
  next();
});

// Handle the metrics scraping on /metrics path
app.get('/metrics', (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(register.metrics());
});

app.get('/healthcheck', async (_, res) => {
  try {
    const [redisStatus, redisError] = await redisHealthCheck();
    const [dbStatus, dbError] = await dbHealthCheck();

    if (redisStatus && dbStatus)
      res.status(200).json({
        msg: 'All systems are up and running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime() / 60,
      });
    else
      res.status(500).json({
        redis: redisError,
        db: dbError,
      });
  } catch (error) {
    res.status(500).json({ error: error?.message });
  }
});

module.exports = app;
