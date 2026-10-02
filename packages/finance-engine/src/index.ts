import { startAirtableSyncLoop } from './airtable.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createFinanceEngineServer } from './server.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const airtableSync = startAirtableSyncLoop(db, config.airtable);
const server = createFinanceEngineServer({ config, db });

server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'finance-engine started',
      host: config.host,
      port: config.port,
      airtableSyncEnabled: config.airtable.enabled,
      airtableSyncIntervalMinutes: config.airtable.enabled
        ? config.airtable.syncIntervalMinutes
        : null,
    }),
  );
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  airtableSync.stop();

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'finance-engine stopping',
      signal,
    }),
  );

  server.close(() => {
    db.close();
    process.exit(0);
  });

  setTimeout(() => {
    db.close();
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
