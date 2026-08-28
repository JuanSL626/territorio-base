import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.js';

// The flat-config key has moved between majors of eslint-plugin-react-hooks;
// resolve it defensively instead of pinning to one spelling.
const hooksFlat =
  reactHooks.configs['recommended-latest'] ??
  reactHooks.configs.flat?.recommended ??
  reactHooks.configs.recommended;

/**
 * React config: base + hooks + browser globals.
 * Used by apps/web and packages/ui.
 */
export const reactConfig = tseslint.config(
  ...baseConfig,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...hooksFlat.rules,

      // A stale dependency array in a map/layer effect shows up as a layer that
      // silently stops updating — the hardest class of bug to notice in this app.
      // Warning-level is not good enough.
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },

  {
    // Scoped to JSX only: `{count && <Panel/>}` rendering a literal 0 is the bug
    // this rule actually earns its noise for.
    files: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: true,
        },
      ],
    },
  },
);

export default reactConfig;
