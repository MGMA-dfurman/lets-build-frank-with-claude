// The tool registry. One module per tool (ADR-002); this file is the only
// place that knows the whole set.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '../config.js';
import { createGetStatus } from './get-status.js';
import { ToolError, type Tool } from './define.js';

export function buildTools(config: Config): Tool[] {
    return [
        createGetStatus({
            now: () => Date.now(),
            startedAt: config.startedAt,
            version: config.version
        })
    ];
}

/**
 * Bridges tool definitions to the SDK.
 *
 * Every failure becomes `isError: true` with a plain-language message
 * (ADR-002). Only two kinds of message reach the caller: schema complaints,
 * which name the offending field and nothing else, and `ToolError`, which a
 * tool raises when it means the text to be read. Anything else is reported
 * generically and logged server-side — an arbitrary `Error.message` can carry
 * paths, URLs or response fragments, and omitting the stack is not enough.
 */
export function registerTools(server: McpServer, tools: Tool[]): void {
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: tool.inputSchema,
                outputSchema: tool.outputSchema
            },
            async (args: unknown): Promise<CallToolResult> => {
                try {
                    const output = await tool.handler(args);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
                        structuredContent: output
                    };
                } catch (error) {
                    return {
                        content: [{ type: 'text', text: publicMessage(tool.name, error) }],
                        isError: true
                    };
                }
            }
        );
    }
}

function publicMessage(toolName: string, error: unknown): string {
    if (isZodError(error)) {
        return `${toolName} was called with invalid arguments. ${describeIssues(error.issues)}`;
    }
    if (error instanceof ToolError) {
        return `${toolName} could not complete: ${error.message}`;
    }
    // Deliberately says nothing about the failure. The detail goes to the
    // container log, where an operator can see it and a caller cannot.
    console.error(`[${toolName}] unexpected failure:`, error);
    return `${toolName} failed unexpectedly. The error has been logged; ask an operator to check Frank's logs.`;
}

interface ZodIssue {
    path: PropertyKey[];
    message: string;
}

function isZodError(error: unknown): error is { issues: ZodIssue[] } {
    return (
        typeof error === 'object' &&
        error !== null &&
        Array.isArray((error as { issues?: unknown }).issues)
    );
}

function describeIssues(issues: ZodIssue[]): string {
    if (issues.length === 0) return 'The arguments did not match the tool schema.';
    return issues
        .map(issue => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
        .join('; ');
}
