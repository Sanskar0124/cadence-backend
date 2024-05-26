const { EXIT_SIGNALS } = require('../../Cadence-Brain/src/utils/enums');
require('dotenv').config({ path: `./.env.${process.env.NODE_ENV}` });
const { init } = require('../../Cadence-Brain/src/utils/tracing');
const api = require('@opentelemetry/api');
let tracingSDK = null;
if (process.env.NODE_ENV !== 'development')
  tracingSDK = init('crm-backend', process.env.NODE_ENV);

require('./utils/winston');

const { sequelize } = require('../../Cadence-Brain/src/db/models');
const app = require('./app');
const logger = require('./utils/winston');
const http = require('http');
const redis = require('../../Cadence-Brain/src/utils/redis');
const os = require('os');
const path = require('path');
const { WorkerPool } = require('../../Cadence-Brain/src/helper/worker-threads');
const initDBHooks = require('../../Cadence-Brain/src/db/hooks');
// Port setup
const { PORT, NODE_ENV } = require('./utils/config');
const port = PORT || 8080;

// Set up http server
const server = http.createServer(app);
global.io = require('socket.io')(server);
global.worker_pool = new WorkerPool(
  os.cpus().length,
  path.resolve(
    __dirname,
    '../../Cadence-Brain/src/helper/worker-threads/worker.js'
  )
);

// initialize database hooks
initDBHooks();

// Connection to database
sequelize
  .authenticate()
  .then(() => {
    logger.info('🚀 Successfully connected to db');
    server.listen(port, () =>
      logger.info(`🚀 Server running on port ${port} ENV-${NODE_ENV}`)
    );
    // socket connection

    global.io.on('connection', (socket) => {
      // logger.info('USER CONNECTED:- ' + socket.id);
      socket.on('join-room', (token) => {
        // console.log('joining room');
        socket.join(token);
        global.io.to(token).emit('msg', 'room joined');
      });
    });
  })
  .catch((err) => {
    logger.error('Failed to connect to db', err);
  });

// The signals we want to handle
// NOTE: although it is tempting, the SIGKILL signal (9) cannot be intercepted and handled
// let signals = {
//   SIGHUP: 1,
//   SIGINT: 2,
//   SIGTERM: 15,
// };

// Shutdown logic for our application here
const shutdown = (signal, value) => {
  console.log('shutdown!');
  if (tracingSDK)
    tracingSDK
      .shutdown()
      .then(() => console.log('Tracing terminated'))
      .catch((error) => console.log('Error terminating tracing', error));
  server.close(() => {
    console.log(
      `Server is currently cleaning up the remaining process gracefully`
    );
  });
};

// Create a listener for each of the signals that we want to handle
Object.keys(EXIT_SIGNALS).forEach((signal) => {
  process.on(signal, () => {
    console.log(`process received a ${signal} signal`);
    shutdown(signal, EXIT_SIGNALS[signal]);
  });
});
