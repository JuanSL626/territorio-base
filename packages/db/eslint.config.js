import { baseConfig } from '@territorio/eslint-config/base';

export default [
  ...baseConfig,
  {
    // Generated SQL and migration journal.
    ignores: ['drizzle/**'],
  },
  {
    // Operator-facing CLIs. Their entire output is stdout, so the shared
    // "warn/error only" console rule would be backwards here.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
