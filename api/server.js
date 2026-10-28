'use strict';

/**
 * Process entry point: starts the HTTP server + graceful shutdown.
 * The Express app itself is built in app.js (no listen there), so tests can
 * import app.js without opening a port.
 */

const app = require('./app');
const { config } = require('./config/env');

// iisnode process.env.PORT ko named pipe path deta hai (e.g. \\.\pipe\xyz),
// number nahi. Us case me sirf pipe path pe listen karo - host arg pass mat
// karo (named pipe listen(path, host, cb) overload support nahi karta).
const isNamedPipe = typeof config.port === 'string' && config.port.indexOf('\\\\.\\pipe\\') === 0;

const server = isNamedPipe
  ? app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(`[boot] LoanDesk API listening on named pipe ${config.port}  (env=${config.env}, encryption=${config.crypto.enabled ? 'on' : 'off'})`);
    })
  : app.listen(config.port, config.host, () => {
      // eslint-disable-next-line no-console
      console.log(
        `[boot] LoanDesk API listening on http://${config.host}:${config.port}  (env=${config.env}, encryption=${config.crypto.enabled ? 'on' : 'off'})`
      );
    });

// Keep the Outlook -> Enquiry Graph subscription alive (no-op if not configured).
try {
  const { startSubscriptionRenewal } = require('./jobs/outlookSubscription.job');
  startSubscriptionRenewal();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[boot] outlook subscription renewal failed to start:', err.message);
}

try {
  const { startPortfolioFollowupJob } = require('./jobs/portfolioFollowup.job');
  startPortfolioFollowupJob();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[boot] portfolio follow-up job failed to start:', err.message);
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) process.exit(0); // second Ctrl+C = force quit now
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`\n[shutdown] ${signal} received, closing...`);
  // drop keep-alive sockets so close() does not hang (Node >=18.2)
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  server.close(() => {
    const db = require('./config/database');
    Promise.resolve(db.close && db.close())
      .catch(() => {})
      .finally(() => process.exit(0));
  });
  // hard fail-safe if something still hangs
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
