import { z } from "zod";

/**
 * Environment contract.
 *
 * Pure: a schema and two functions, no process.env and no side effects, so
 * the failure cases are directly testable. The singleton that actually reads
 * the environment and fails the boot lives in ./env.ts.
 *
 * Everything here is server-only. Anything a browser needs would have to be
 * prefixed `NEXT_PUBLIC_` and inlined at build time, and nothing in this
 * project does.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Postgres. Required from Phase 03; validated as a URL so a typo fails here
  // rather than inside the driver with a less useful message.
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (v) => v.startsWith("postgresql://") || v.startsWith("postgres://"),
      "DATABASE_URL must be a postgresql:// connection string",
    ),

  // Signs and encrypts the session cookie. A short secret is a weak secret, so
  // the length is a hard floor rather than advice in a README.
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be at least 32 characters"),
  NEXTAUTH_URL: z.url("NEXTAUTH_URL must be an absolute URL"),

  // Optional: the app runs without GitHub sign-in, it just does not offer it.
  // Required together -- half a set of OAuth credentials is a misconfiguration
  // that would otherwise only show up at the callback.
  GITHUB_ID: z.string().min(1).optional(),
  GITHUB_SECRET: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Formats a Zod error into something readable in a terminal at 3am. */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    .sort()
    .join("\n");
}

/**
 * Parses and cross-validates. Exported separately from the module-level
 * singleton so tests can drive it with arbitrary input and assert on the
 * failures, which is the only part of this file with any logic in it.
 */
export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid environment:\n${formatIssues(result.error)}`);
  }

  const env = result.data;

  const hasId = env.GITHUB_ID !== undefined;
  const hasSecret = env.GITHUB_SECRET !== undefined;
  if (hasId !== hasSecret) {
    throw new Error(
      "Invalid environment:\n  GITHUB_ID and GITHUB_SECRET must be set together, or neither",
    );
  }

  return env;
}

/** True when both halves of the GitHub OAuth credentials are present. */
export function isGitHubEnabled(env: ServerEnv): boolean {
  return env.GITHUB_ID !== undefined && env.GITHUB_SECRET !== undefined;
}
