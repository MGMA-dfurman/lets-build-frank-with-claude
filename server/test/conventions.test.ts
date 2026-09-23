// ADR-002 is policy, so it gets executable assertions rather than a review
// checklist. The `tool-conventions` agent is a second pair of eyes, not a
// substitute for these.
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { ALLOWED_VERBS, defineTool } from '../src/tools/define.js';
import { buildTools } from '../src/tools/index.js';
import { loadConfig } from '../src/config.js';

const tools = buildTools(loadConfig({ PORT: '3000' }));

describe('ADR-002 naming', () => {
    it('every registered tool is verb_noun from the closed verb set', () => {
        for (const tool of tools) {
            const [verb] = tool.name.split('_');
            expect(ALLOWED_VERBS, `${tool.name} uses an out-of-policy verb`).toContain(verb);
            expect(tool.name).toMatch(/^[a-z]+(_[a-z0-9]+)+$/);
        }
    });

    it.each(['create_thing', 'update_thing', 'delete_thing', 'run_thing'])(
        'refuses to define %s',
        badName => {
            expect(() =>
                defineTool({
                    name: badName,
                    description: 'A sufficiently long tool description here.',
                    input: {},
                    output: {},
                    handler: () => ({ summary: 'x' })
                })
            ).toThrow(/ADR-002/);
        }
    );
});

describe('ADR-002 schemas', () => {
    it('every tool rejects unknown input fields rather than stripping them', () => {
        for (const tool of tools) {
            const result = tool.inputSchema.safeParse({ definitelyNotAParameter: 1 });
            expect(result.success, `${tool.name} accepted an unknown field`).toBe(false);
        }
    });

    // Regression: an earlier defineTool INSPECTED a finished schema to decide
    // whether it was strict. Both of these passed that check while accepting
    // unknown fields, so strictness is now constructed rather than checked -
    // a tool hands over a raw shape and cannot supply a lenient schema at all.
    it('builds strict schemas rather than trusting the caller to supply one', () => {
        const tool = defineTool({
            name: 'get_thing',
            description: 'A sufficiently long tool description here.',
            input: { wanted: z.string() },
            output: {},
            handler: () => ({ summary: 'x' })
        });
        expect(tool.inputSchema.safeParse({ wanted: 'a', sneaky: 'b' }).success).toBe(false);
        expect(tool.inputSchema.safeParse({ wanted: 'a' }).success).toBe(true);
    });

    it('refuses a description too short to route on', () => {
        expect(() =>
            defineTool({
                name: 'get_thing',
                description: 'x',
                input: {},
                output: {},
                handler: () => ({ summary: 'x' })
            })
        ).toThrow(/ADR-002/);
    });

    it('every tool describes itself and its output carries a summary', () => {
        for (const tool of tools) {
            expect(tool.description.length).toBeGreaterThan(20);
            expect(Object.keys(tool.outputSchema.shape)).toContain('summary');
        }
    });
});
