import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing.
 *
 * In `src/server` rather than `src/domain` because it is not pure: every hash
 * draws a fresh random salt. The domain layer's rule is that a function given
 * the same input returns the same output, and this one must not.
 */

/**
 * OWASP's current Argon2id guidance: 19 MiB of memory, two passes, one lane.
 *
 * Stated rather than left to the library's defaults, because these are a
 * security decision and a default can move under a minor upgrade without
 * anyone reading the changelog. They also travel *inside* the hash string, so
 * raising them later does not invalidate existing passwords -- an old hash
 * still verifies under the parameters it was written with.
 *
 * **The algorithm is the exception, and cannot be named here.** The library
 * exports `Algorithm` as an ambient `const enum`, which `isolatedModules`
 * forbids reading -- Next requires that flag, so `tsc` rejects
 * `Algorithm.Argon2id` outright (TS2748) even though the tests pass, because
 * the enum is erased to an empty object at runtime. The library's default is
 * already argon2id, and what pins it is better than a constant would be: the
 * unit test asserts the produced hash begins `$argon2id$v=19$m=19456,t=2,p=1$`,
 * so a changed default fails on the actual output rather than on a number we
 * hoped still mapped to the right thing.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A real hash of a password nobody has, used to spend the same time on a
 * sign-in attempt for an account that does not exist.
 *
 * Hard-coded rather than computed at import, which would put ~40 ms of work
 * into every process start including the ones that never check a password.
 * There is no secret here: it is the hash of the literal string
 * "not-a-real-password", and it exists only to be compared against and fail.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$QZNg/zfgGwDLJXHycrzp9A$9quT+udOxBrTjLUhfgJifUpiTAD8T6iikraOL+F0tkU";

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * Whether `plain` is the password behind `stored`.
 *
 * Returns false for a stored value that is not a valid hash rather than
 * throwing. A malformed row is a corrupt record, and the right response to one
 * is a failed sign-in -- not a 500 on the sign-in form, which is both a worse
 * experience and a signal that something about that account is unusual.
 */
export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * The same check for a user who may not exist, or who may have no password
 * because they only ever sign in through GitHub.
 *
 * The null case still hashes, against `DUMMY_HASH`. Returning early would make
 * a missing account fail in microseconds while a real one takes tens of
 * milliseconds, and that difference answers "is this address registered here?"
 * for anyone willing to time the response. Always false -- a null password
 * hash is never a password that matches.
 */
export async function verifyPasswordOrDummy(
  stored: string | null,
  plain: string,
): Promise<boolean> {
  if (stored === null) {
    await verifyPassword(DUMMY_HASH, plain);
    return false;
  }

  return verifyPassword(stored, plain);
}
