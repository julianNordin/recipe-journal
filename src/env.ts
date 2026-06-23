import { parseEnv, type ServerEnv } from "./env.schema";

export { isGitHubEnabled, serverEnvSchema, type ServerEnv } from "./env.schema";

/**
 * The validated environment, parsed once at import time.
 *
 * Importing this module is what makes a missing or malformed variable kill the
 * process at boot, rather than surfacing as a 500 an hour later on whichever
 * request happened to be the first one that needed it. That side effect is the
 * entire point of the module, which is also why the schema and the parsing
 * live in ./env.schema.ts -- pure and directly testable, with no process.env
 * anywhere near them.
 */
export const env: ServerEnv = parseEnv(process.env);
