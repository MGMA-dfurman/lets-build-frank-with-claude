import { describe, expect, it } from 'vitest';
import { createGetStatus } from '../src/tools/get-status.js';

const startedAt = 1_000_000;
const tool = createGetStatus({ now: () => startedAt + 42_000, startedAt, version: '1.2.3' });

describe('get_status', () => {
    it('returns version, uptime and a greeting (ADR-002)', async () => {
        const result = await tool.handler({});
        expect(result).toEqual({
            summary: 'Frank 1.2.3 is up, and has been for 42s.',
            version: '1.2.3',
            uptimeSeconds: 42,
            greeting: "Hello, I'm Frank."
        });
    });

    it('produces output matching its declared outputSchema', async () => {
        const result = await tool.handler({});
        expect(tool.outputSchema.safeParse(result).success).toBe(true);
    });

    it('takes no parameters', () => {
        expect(Object.keys(tool.inputSchema.shape)).toHaveLength(0);
    });
});
