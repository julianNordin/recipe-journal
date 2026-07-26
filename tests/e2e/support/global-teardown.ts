import { execSync } from "node:child_process";

/**
 * Put the development site back the way the suite found it.
 *
 * The work is in `scripts/tidy-published.ts`, and this runs it as a child
 * process rather than importing it. **Playwright transpiles its global hooks
 * to CommonJS, and the generated Prisma client is ESM** -- importing it here
 * fails with `Cannot use 'import.meta' outside a module`, which is a long way
 * from anything a reader would connect to a test teardown. `tsx` runs it the
 * same way the seed is run, in a process that has no such problem.
 *
 * `execSync` with one literal command string, not `execFileSync(..., { shell:
 * true })`: Node 24 deprecates the latter because it concatenates arguments
 * unescaped.
 *
 * Never fails the run. A suite that passed should not go red because a
 * tidy-up did, and a suite that failed has a better reason to look at.
 */
export default function globalTeardown(): void {
  try {
    const output = execSync("npx tsx scripts/tidy-published.ts", { encoding: "utf8" });
    process.stdout.write(`\n${output.trim()}\n`);
  } catch {
    process.stdout.write("\nteardown: could not tidy the development database\n");
  }
}
