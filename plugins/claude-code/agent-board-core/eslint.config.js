// ESLint flat config (v9). Strict TS + unicorn + import-x + promise + n.
// UI subtree gets react/react-hooks/jsx-a11y. Prettier handled separately.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import importX from 'eslint-plugin-import-x';
import promise from 'eslint-plugin-promise';
import nodePlugin from 'eslint-plugin-n';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'ui/dist/**',
      'ui/node_modules/**',
      'db/*.sqlite',
      '**/*.mjs', // legacy modules; migrated incrementally
      'src/*.d.ts', // type sidecars for .mjs modules — not TS source files
      '**/*.config.js',
      'lint-staged.config.js',
      'eslint.config.js',
      'vitest.config.ts',
      // Dev-only scratch scripts — not part of tsconfig project service.
      'sdk-test.ts',
      'test-copilot-agent.ts',
      'test-copilot-sdk.ts',
      'test-copilot-sdk2.ts',
      'test-e2e-copilot.ts',
      'test-sdk.ts',
      // Pre-existing UI files predate this lint setup. Lint-staged picks up
      // edits as they happen; bulk-fixing untouched files is out of scope.
      'ui/src/App.tsx',
      'ui/src/main.tsx',
      'ui/src/i18n.ts',
      'ui/src/i18n/**',
      'ui/src/styles.css',
      'ui/src/vite-env.d.ts',
      'ui/src/data/**',
      'ui/src/theme/**',
      'ui/src/components/**',
      'ui/src/pages/**',
      'ui/src/hooks/useCurrentProjectCode.ts',
      'ui/src/hooks/useDetailView.ts',
      'ui/src/hooks/useProjectCode.ts',
      'ui/src/features/board/Board.tsx',
      'ui/src/features/board/CardView.tsx',
      'ui/src/features/board/ColumnIcons.tsx',
      'ui/src/features/board/CostBadge.tsx',
      'ui/src/features/board/CreateTaskModal.tsx',
      'ui/src/features/board/FileDropZone.tsx',
      'ui/src/features/board/LanguageSelector.tsx',
      'ui/src/features/board/SetupWizard.tsx',
      'ui/src/features/board/TaskDetailPanel.tsx',
      'ui/src/features/sessions/**',
      'ui/vite.config.ts',
      'ui/index.html',
      // api.ts predates this lint setup; full retype is out of scope. New
      // methods are exported from typed interfaces (see ActivityEvent /
      // RunActiveState / Phase). Lint-staged will format on edit.
      'ui/src/api.ts',
    ],
  },

  // Base JS rules (applies to .ts/.tsx)
  js.configs.recommended,

  // TypeScript: strict + stylistic, type-aware
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      unicorn,
      'import-x': importX,
      promise,
      n: nodePlugin,
    },
    rules: {
      // No `any`, no unsafe.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowNullableBoolean: true,
          allowNullableString: true,
          allowNullableNumber: true,
          allowNullableObject: true,
        },
      ],
      // Allow numbers in template literals — `${count}` is universal.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: false },
      ],
      // Don't flag union of literal | string as redundant; we use it
      // intentionally where DB rows return raw strings narrowed elsewhere.
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      // Don't ban `Record<string, unknown>` access without narrowing — we use
      // it for JSON payloads from the wire and narrow with `s()` helpers.
      '@typescript-eslint/no-base-to-string': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Unicorn — pragmatic subset.
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off', // SQLite returns null
      'unicorn/prefer-module': 'off', // already ESM
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      'unicorn/no-array-reduce': 'off',
      'unicorn/prefer-top-level-await': 'off',

      // import-x
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      // import-x/no-cycle requires a working resolver; disable until
      // eslint-import-resolver-typescript is wired in flat-config form.
      'import-x/no-cycle': 'off',
      'import-x/no-unresolved': 'off',
      'import-x/no-self-import': 'error',
      'import-x/no-duplicates': 'error',

      // promise
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/catch-or-return': 'off', // covered by no-floating-promises
      'promise/always-return': 'off',

      // n (Node) — only meaningful for server-side code
      'n/no-deprecated-api': 'error',
      'n/no-unsupported-features/node-builtins': [
        'error',
        { ignores: ['sqlite', 'sqlite.DatabaseSync'] },
      ],
    },
  },

  // UI overrides
  {
    files: ['ui/src/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        EventSource: 'readonly',
        MessageEvent: 'readonly',
        fetch: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react/jsx-key': 'error',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...jsxA11y.configs.recommended.rules,
      'no-console': 'off', // dev UI may log
      // React/UI conventions: PascalCase for components, camelCase for hooks.
      // unicorn/filename-case forces kebab everywhere — too aggressive for UI.
      'unicorn/filename-case': 'off',
      // Browser globals — disable Node plugin's "experimental" flagging.
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },

  // Tests
  {
    files: ['test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  // Prettier — disable conflicting stylistic rules. Keep last.
  prettierConfig,
);
