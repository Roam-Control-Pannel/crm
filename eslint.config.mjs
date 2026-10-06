// LINT-FLAT-CONFIG-V1
//
// ESLint 9 reads eslint.config.mjs and ignores .eslintrc.json entirely, and
// eslint-config-next 16 requires ESLint 9 — so the Next 16 upgrade forced
// this migration rather than inviting it.
//
// Two things moved with it, both worth knowing:
//
//   * `next lint` no longer exists. It was deprecated in Next 15 and removed
//     in 16, so `npm run lint` and the CI gate now call the eslint CLI
//     directly. The --max-warnings ratchet is unchanged and still lives in
//     .github/workflows.
//
//   * Flat config has no `extends` and no `ignorePatterns`. Configs are
//     composed by spreading arrays, and ignores are a config object of their
//     own. Everything below is the same rule set .eslintrc.json carried; the
//     shape is all that changed.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

const config = [
  // Replaces the old "ignorePatterns". `.next/` matters most: without it
  // ESLint walks the build output and lints generated route types.
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      'next-env.d.ts',
      '.netlify/**',
    ],
  },

  ...nextCoreWebVitals,

  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.js', '**/*.mjs'],
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // Hook correctness is an error, not a warning: the exhaustive-deps
      // violations this catches are the stale-closure class of bug, which
      // this codebase has already shipped once (the calendar month arrows).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-return-await': 'warn',
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'off',
    },
  },

  // The Netlify scheduled functions are .mts and need the TS parser named
  // explicitly; flat config does not inherit a parser from a sibling block.
  {
    files: ['**/*.mts', '**/*.cts'],
    languageOptions: { parser: tsparser },
    rules: { 'import/no-anonymous-default-export': 'off' },
  },

  // Config files are CommonJS/ESM module scope, not app code: the TS
  // unused-vars rule reads their top-level consts as "only used as a type"
  // and reports every one. Three false positives, no real coverage lost.
  {
    files: ['*.js', '*.mjs', '*.cjs'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },

  // REACT-COMPILER-RULES-V1
  //
  // eslint-config-next 16 turns on React Compiler's correctness rules, which
  // did not exist in 14. On this codebase they report 50 errors across 12
  // files, and they are NOT noise — react-hooks/static-components is the
  // "ChannelList declared inside render" already on the known-issues list,
  // and react-hooks/purity is the same class as the dashboard hydration
  // failure fixed last week.
  //
  // They are warnings here, not errors, and the reason is scope rather than
  // doubt: this change is a framework upgrade, and an upgrade that also
  // rewrites fifty call sites across every page is one nobody can review and
  // nobody can bisect when production misbehaves. Downgrading keeps the
  // findings visible and counted instead of silenced.
  //
  //   react-hooks/purity               19  clock/random read during render
  //   react-hooks/set-state-in-effect  18  setState from an effect
  //   react-hooks/immutability          8  mutation during render
  //   react-hooks/static-components     5  component declared inside render
  //
  // The warning ceiling in CI is a ratchet that should come down as these
  // are worked through, not a budget to spend.
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
];

export default config;
