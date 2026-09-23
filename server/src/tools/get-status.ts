// ADR-002's first tool: it exists so the pipeline, the client wiring and the
// console can all be proven before any Azure integration exists.
import * as z from 'zod/v4';
import { defineTool, type Tool } from './define.js';

export interface StatusClock {
    now: () => number;
    startedAt: number;
    version: string;
}

export function createGetStatus(clock: StatusClock): Tool {
    return defineTool({
        name: 'get_status',
        description:
            "Returns Frank's version, how long he has been running, and a greeting. " +
            'Use it to check that Frank is reachable and healthy before calling anything else. ' +
            'Takes no parameters and reads nothing outside this process.',
        input: {},
        output: {
            version: z.string().describe("Frank's package version."),
            uptimeSeconds: z.number().describe('Whole seconds since this process started.'),
            greeting: z.string().describe('A greeting from Frank.')
        },
        handler: () => {
            const uptimeSeconds = Math.floor((clock.now() - clock.startedAt) / 1000);
            return {
                summary: `Frank ${clock.version} is up, and has been for ${uptimeSeconds}s.`,
                version: clock.version,
                uptimeSeconds,
                greeting: "Hello, I'm Frank."
            };
        }
    });
}
