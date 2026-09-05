// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        // Points at tsconfig.eslint.json rather than relying on projectService,
        // which resolved to tsconfig.json — a config that excludes every
        // *.spec.ts, so no test file could be parsed and none was linted.
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    /**
     * Tests deliberately pass values the types forbid.
     *
     * `OtpUtil.matches(null, undefined)`, `clampLimit('abc')`,
     * `describe(null)`, a socket context faked as an ExecutionContext — every
     * one of those exists BECAUSE the production code has to survive it, and
     * expressing it requires `as any`. The type-aware `no-unsafe-*` rules flag
     * each as an error, which turns "we tested the bad input" into lint debt
     * and pressures the next person to delete the case rather than the cast.
     *
     * Narrow, and only for specs: the same rules stay on for everything that
     * ships.
     */
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
