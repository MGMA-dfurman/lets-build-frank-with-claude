import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();

const server: Server = createApp(config).listen(config.port, () => {
    console.log(`Frank ${config.version} listening on ${config.port} (MCP at POST /mcp)`);
});

// Container Apps scales to zero and replaces revisions, so SIGTERM is a normal
// event rather than an emergency. Calling process.exit() on it drops requests
// that are mid-flight; instead stop accepting connections, let the open ones
// finish, and keep a bounded deadline so a stuck request cannot hang the
// shutdown forever.
const SHUTDOWN_DEADLINE_MS = 10_000;
let shuttingDown = false;

function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; draining connections.`);

    const deadline = setTimeout(() => {
        console.error(`Did not drain within ${SHUTDOWN_DEADLINE_MS}ms; exiting anyway.`);
        process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();

    server.close(error => {
        if (error) {
            console.error('Error while closing the server:', error);
            process.exit(1);
        }
        console.log('Drained cleanly.');
        process.exit(0);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
