// All settings arrive as environment variables (ADR-001). No config file holds
// values; this module is the single place that reads process.env.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

// PORT's default of 3000 is repeated in three places that must agree: here,
// `ENV PORT=3000` in the Dockerfile, and `--target-port 3000` in deploy.yml.
const DEFAULT_PORT = 3000;

function readPort(raw: string | undefined): number {
    if (raw === undefined || raw === '') return DEFAULT_PORT;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`PORT must be an integer between 1 and 65535, got "${raw}"`);
    }
    return port;
}

export interface Config {
    port: number;
    /** Directory the built console is served from, if it was built at all. */
    publicDir: string;
    version: string;
    startedAt: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    // The Dockerfile copies ui/dist to <package root>/public. In development
    // that directory usually does not exist, and that is not an error (ADR-003
    // builds the console late; ADR-006 requires Frank to serve MCP without it).
    const here = dirname(fileURLToPath(import.meta.url));
    const packageRoot = resolve(here, '..');

    return {
        port: readPort(env.PORT),
        publicDir: resolve(packageRoot, 'public'),
        version: readVersion(packageRoot),
        startedAt: Date.now()
    };
}

/**
 * The version comes from package.json, not from `npm_package_version`: the
 * image starts Frank with `node dist/index.js`, so npm sets nothing and a
 * hardcoded fallback would report the same number forever.
 */
function readVersion(packageRoot: string): string {
    try {
        const raw = readFileSync(join(packageRoot, 'package.json'), 'utf8');
        const parsed: unknown = JSON.parse(raw);
        const version = (parsed as { version?: unknown }).version;
        if (typeof version === 'string' && version.length > 0) return version;
    } catch {
        // Falls through: an unreadable package.json must not stop Frank booting.
    }
    return 'unknown';
}
