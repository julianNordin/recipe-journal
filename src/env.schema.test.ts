import { describe, expect, it } from "vitest";

import { isGitHubEnabled, parseEnv } from "./env.schema";

/** A complete, valid environment. Each test invalidates exactly one thing. */
function validEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pw@localhost:5432/recipe_journal",
    NEXTAUTH_SECRET: "0123456789abcdef0123456789abcdef",
    NEXTAUTH_URL: "http://localhost:3000",
  };
}

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    const env = parseEnv(validEnv());
    expect(env.DATABASE_URL).toContain("recipe_journal");
    expect(env.NODE_ENV).toBe("test");
  });

  it("defaults NODE_ENV to development when absent", () => {
    const { NODE_ENV: _NODE_ENV, ...rest } = validEnv();
    expect(parseEnv(rest).NODE_ENV).toBe("development");
  });

  it.each(["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL"])(
    "throws when %s is missing",
    (key) => {
      const source = validEnv();
      delete source[key];
      expect(() => parseEnv(source)).toThrow(new RegExp(key));
    },
  );

  it("rejects a DATABASE_URL that is not a postgres connection string", () => {
    expect(() => parseEnv({ ...validEnv(), DATABASE_URL: "mysql://localhost/x" })).toThrow(
      /postgresql:\/\//,
    );
  });

  it("rejects a NEXTAUTH_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv({ ...validEnv(), NEXTAUTH_SECRET: "tooshort" })).toThrow(
      /at least 32 characters/,
    );
  });

  it("rejects a relative NEXTAUTH_URL", () => {
    expect(() => parseEnv({ ...validEnv(), NEXTAUTH_URL: "/api/auth" })).toThrow(/absolute URL/);
  });

  it("names every offending variable at once rather than only the first", () => {
    let message = "";
    try {
      parseEnv({ NODE_ENV: "test" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("NEXTAUTH_SECRET");
    expect(message).toContain("NEXTAUTH_URL");
  });

  describe("GitHub credentials", () => {
    it("accepts neither half", () => {
      expect(isGitHubEnabled(parseEnv(validEnv()))).toBe(false);
    });

    it("accepts both halves", () => {
      const env = parseEnv({ ...validEnv(), GITHUB_ID: "id", GITHUB_SECRET: "secret" });
      expect(isGitHubEnabled(env)).toBe(true);
    });

    it.each(["GITHUB_ID", "GITHUB_SECRET"])("rejects %s on its own", (key) => {
      expect(() => parseEnv({ ...validEnv(), [key]: "value" })).toThrow(/must be set together/);
    });
  });
});
