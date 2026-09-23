// The shape every Frank tool has, and the one place ADR-002's rules are
// enforced rather than merely described.
//
// Enforcement here is STRUCTURAL, not by inspection. An earlier version took a
// finished schema and checked whether it looked strict; `.passthrough()` and
// `.catchall(...)` both passed that check while happily accepting unknown
// fields. A tool now hands over a raw shape and this module builds the strict
// schema, so "unknown fields are rejected" is not something a tool author can
// get wrong.
import * as z from 'zod/v4';

/** ADR-002's closed verb set. `create`/`update`/`delete`/`run` are absent on purpose. */
export const ALLOWED_VERBS = ['get', 'list', 'search', 'summarize'] as const;

export const TOOL_NAME_PATTERN = new RegExp(`^(${ALLOWED_VERBS.join('|')})(_[a-z0-9]+)+$`);

/**
 * A failure whose message is safe to show a caller.
 *
 * Everything else is reported generically: an arbitrary `Error.message` can
 * carry filesystem paths, request URLs or response fragments, and ADR-002's
 * "plain-language message, never a stack trace" is about what the caller
 * learns, not only about stack frames.
 */
export class ToolError extends Error {
    override readonly name = 'ToolError';
}

export interface ToolSpec<TInput extends z.ZodRawShape, TOutput extends z.ZodRawShape> {
    name: string;
    description: string;
    /** Raw shape. `defineTool` wraps it in a strict object; `{}` means "no parameters". */
    input: TInput;
    /** Raw shape of the detail fields. `summary` is added automatically. */
    output: TOutput;
    handler: (
        input: z.infer<z.ZodObject<TInput>>
    ) => Promise<ToolOutput<TOutput>> | ToolOutput<TOutput>;
}

type ToolOutput<TOutput extends z.ZodRawShape> = z.infer<z.ZodObject<TOutput>> & {
    summary: string;
};

export interface Tool {
    name: string;
    description: string;
    inputSchema: z.ZodObject;
    outputSchema: z.ZodObject;
    handler: (input: unknown) => Promise<Record<string, unknown>>;
}

export function defineTool<TInput extends z.ZodRawShape, TOutput extends z.ZodRawShape>(
    spec: ToolSpec<TInput, TOutput>
): Tool {
    if (!TOOL_NAME_PATTERN.test(spec.name)) {
        throw new Error(
            `Tool "${spec.name}" breaks ADR-002: names are verb_noun in lower snake_case, ` +
                `and the verb must be one of ${ALLOWED_VERBS.join(', ')}.`
        );
    }

    if (spec.description.trim().length < 20) {
        throw new Error(
            `Tool "${spec.name}" breaks ADR-002: every tool needs a description written ` +
                'for a model deciding whether to call it.'
        );
    }

    // Strict on both sides: unknown input is rejected (ADR-002), and a handler
    // that returns a field it never declared fails its own output contract.
    const inputSchema = z.strictObject(spec.input);
    const outputSchema = z.strictObject({
        summary: z.string().describe('One-line, human- and model-readable result.'),
        ...spec.output
    });

    return {
        name: spec.name,
        description: spec.description,
        inputSchema,
        outputSchema,
        handler: async (input: unknown) => {
            const parsed = inputSchema.parse(input) as z.infer<z.ZodObject<TInput>>;
            return (await spec.handler(parsed)) as Record<string, unknown>;
        }
    };
}
