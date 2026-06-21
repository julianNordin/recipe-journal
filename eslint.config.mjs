import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma's generator output lands here from Phase 03. Linting generated
    // code reports problems nobody can fix.
    "src/generated/**",
  ]),

  ...nextVitals,
  ...nextTs,

  // Type-aware rules. These need a TypeScript program, so they are scoped to
  // the files tsconfig.json actually includes -- pointing them at a config
  // file that is not in the project is the usual way this blows up.
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unused argument named _foo is a deliberate signature placeholder,
      // not an oversight.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // A floating promise in a Server Action or a route handler is a silently
      // dropped write, which is exactly the class of bug this project is about.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },

  // Config files are plain JS and are not part of the TypeScript program.
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Must stay last: turns off every rule that would fight the formatter.
  prettier,
]);

export default eslintConfig;
