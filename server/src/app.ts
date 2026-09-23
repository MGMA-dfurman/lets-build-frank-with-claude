import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import { createMcpServer } from './mcp.js';

const METHOD_NOT_ALLOWED = {
    jsonrpc: '2.0' as const,
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
};

export function createApp(config: Config): Express {
    const app = express();
    app.use(express.json());

    // Container health probe (ADR-001). Deliberately unauthenticated and
    // cheap: Container Apps calls it, and it discloses only version and uptime.
    app.get('/healthz', (_req: Request, res: Response) => {
        res.status(200).json({
            status: 'ok',
            version: config.version,
            uptimeSeconds: Math.floor((Date.now() - config.startedAt) / 1000)
        });
    });

    // Streamable HTTP, stateless: a new server and transport per request, with
    // no session id. Statelessness is what lets ACA scale to zero and back
    // without a client losing a session it thought it had.
    app.post('/mcp', async (req: Request, res: Response) => {
        const server = createMcpServer(config);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        // connect() transfers ownership of the transport to the server, and
        // server.close() closes it. Closing both would double-close; leaving
        // the promise unhandled would surface later as an unhandled rejection.
        let closed = false;
        const cleanup = (): void => {
            if (closed) return;
            closed = true;
            void server.close().catch((error: unknown) => {
                console.error('Error closing MCP server:', error);
            });
        };

        try {
            res.on('close', cleanup);
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            console.error('Error handling MCP request:', error);
            cleanup();
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error' },
                    id: null
                });
            }
        }
    });

    // Stateless means there is no stream to resume and no session to delete.
    app.get('/mcp', (_req: Request, res: Response) => res.status(405).json(METHOD_NOT_ALLOWED));
    app.delete('/mcp', (_req: Request, res: Response) => res.status(405).json(METHOD_NOT_ALLOWED));

    mountConsole(app, config);
    app.use(jsonRpcErrorHandler);
    return app;
}

/**
 * express.json() rejects malformed bodies BEFORE the /mcp handler runs, so
 * without this Express answers with its default error page - which carries the
 * parser's stack and local paths in development, and an HTML page a JSON-RPC
 * client cannot read in production. Both are wrong answers to "your JSON was
 * broken".
 */
function jsonRpcErrorHandler(
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction
): void {
    if (res.headersSent) {
        next(error);
        return;
    }

    const status = (error as { status?: number }).status;
    const type = (error as { type?: string }).type;

    if (type === 'entity.parse.failed') {
        res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error: request body is not valid JSON.' },
            id: null
        });
        return;
    }

    if (type === 'entity.too.large') {
        res.status(413).json({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Request body is too large.' },
            id: null
        });
        return;
    }

    console.error('Unhandled request error:', error);
    res.status(status ?? 500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
    });
}

/**
 * The console is built late (ADR-003) and Frank must deploy and serve MCP long
 * before it exists (ADR-006), so a missing console is a normal state that says
 * so at `/` rather than a 404.
 *
 * The test is for `index.html`, NOT for the directory: the Dockerfile's
 * ui-build stage runs `mkdir -p dist` when there is no console, so `public/`
 * always exists in the image and is merely empty. Branching on the directory
 * mounts express.static over nothing, and `/` 404s in exactly the deployment
 * this message exists for.
 */
function mountConsole(app: Express, config: Config): void {
    if (existsSync(join(config.publicDir, 'index.html'))) {
        app.use(express.static(config.publicDir));
    }

    // Registered last and unconditionally: when the console exists,
    // express.static has already answered `/` and this never runs.
    app.get('/', (_req: Request, res: Response) => {
        res.status(200)
            .type('text/plain')
            .send(
                [
                    'Frank is running, and the console has not been built yet (ADR-003).',
                    'MCP is at POST /mcp and health is at GET /healthz.',
                    ''
                ].join('\n')
            );
    });
}
