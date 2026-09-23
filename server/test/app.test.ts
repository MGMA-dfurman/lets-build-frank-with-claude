// End-to-end over real HTTP with the SDK's own client. ADR-001 claims one
// deployed Frank serves many clients concurrently; that claim is only worth
// anything if a test exercises more than one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
    // listen(0) picks a free port; PORT is deliberately not set, since loadConfig
    // rejects 0 as a misconfiguration for a container.
    const config = loadConfig({});
    await new Promise<void>(resolve => {
        server = createApp(config).listen(0, () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
});

async function connect(): Promise<Client> {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    return client;
}

describe('GET /healthz', () => {
    it('returns 200 for the container probe (ADR-001)', async () => {
        const response = await fetch(`${baseUrl}/healthz`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ status: 'ok' });
    });
});

describe('POST /mcp', () => {
    it('discovers get_status with a description and a schema', async () => {
        const client = await connect();
        const { tools } = await client.listTools();
        const getStatus = tools.find(tool => tool.name === 'get_status');
        expect(getStatus).toBeDefined();
        expect(getStatus?.description ?? '').not.toHaveLength(0);
        await client.close();
    });

    it('returns structured content with a summary (ADR-002)', async () => {
        const client = await connect();
        const result = await client.callTool({ name: 'get_status', arguments: {} });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toMatchObject({
            version: expect.any(String),
            uptimeSeconds: expect.any(Number),
            greeting: expect.any(String),
            summary: expect.any(String)
        });
        await client.close();
    });

    it('serves two independent clients concurrently (ADR-001)', async () => {
        const [first, second] = await Promise.all([connect(), connect()]);
        const [a, b] = await Promise.all([
            first.callTool({ name: 'get_status', arguments: {} }),
            second.callTool({ name: 'get_status', arguments: {} })
        ]);
        expect(a.isError).toBeFalsy();
        expect(b.isError).toBeFalsy();
        await Promise.all([first.close(), second.close()]);
    });

    // The earlier version of this test caught the promise and fabricated
    // `{ isError: true }`, so a transport failure would have looked like
    // successful ADR-002 enforcement. It now asserts the real result.
    it('rejects unknown arguments and says which field (ADR-002)', async () => {
        const client = await connect();
        const result = await client.callTool({
            name: 'get_status',
            arguments: { notAParameter: 1 }
        });

        expect(result.isError).toBe(true);
        const text = JSON.stringify(result.content);
        expect(text).toMatch(/notAParameter/);
        expect(text).toMatch(/invalid arguments/i);
        // A rejected call must not have produced a status payload.
        expect(result.structuredContent).toBeUndefined();
        await client.close();
    });

    it('never returns a stack trace or an internal path (ADR-002)', async () => {
        const client = await connect();
        const result = await client.callTool({
            name: 'get_status',
            arguments: { notAParameter: 1 }
        });
        const text = JSON.stringify(result);
        // Substrings rather than a regex: each is something a leaked stack
        // frame, source map or container path would drag into the response.
        for (const forbidden of ['.ts:', '.js:', 'node_modules', '/app/', 'Error:']) {
            expect(text, `leaked ${forbidden}`).not.toContain(forbidden);
        }
        await client.close();
    });

    it('answers malformed JSON with a JSON-RPC parse error, not an HTML page', async () => {
        const response = await fetch(`${baseUrl}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{ this is not json'
        });
        expect(response.status).toBe(400);
        expect(response.headers.get('content-type')).toMatch(/application\/json/);
        const body = (await response.json()) as { error?: { code?: number } };
        expect(body.error?.code).toBe(-32700);
        expect(JSON.stringify(body)).not.toContain('node_modules');
    });
});

describe('unsupported methods on /mcp', () => {
    it.each(['GET', 'DELETE'])('%s returns 405 because Frank is stateless', async method => {
        const response = await fetch(`${baseUrl}/mcp`, { method });
        expect(response.status).toBe(405);
    });
});

describe('GET /', () => {
    it('says the console is not built yet rather than 404ing (ADR-003, ADR-006)', async () => {
        const response = await fetch(`${baseUrl}/`);
        expect(response.status).toBe(200);
        expect(await response.text()).toMatch(/console has not been built/i);
    });
});

// Regression: the Dockerfile's ui-build stage runs `mkdir -p dist` when there
// is no console, so the deployed image always HAS a public/ directory - it is
// just empty. Branching on the directory rather than on index.html made `/`
// return 404 in exactly the deployment ADR-006 requires to work.
describe('GET / with an empty public/ (the pre-console deployed state)', () => {
    it('still explains itself instead of 404ing', async () => {
        const { mkdtempSync, rmSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const emptyPublic = mkdtempSync(`${tmpdir()}/frank-public-`);
        const config = { ...loadConfig({}), publicDir: emptyPublic };

        const local = createApp(config);
        const listening = await new Promise<Server>(resolve => {
            const s = local.listen(0, () => resolve(s));
        });
        const address = listening.address();
        if (address === null || typeof address === 'string') throw new Error('no port');

        try {
            const response = await fetch(`http://127.0.0.1:${address.port}/`);
            expect(response.status).toBe(200);
            expect(await response.text()).toMatch(/console has not been built/i);
        } finally {
            await new Promise<void>(resolve => listening.close(() => resolve()));
            rmSync(emptyPublic, { recursive: true, force: true });
        }
    });
});
