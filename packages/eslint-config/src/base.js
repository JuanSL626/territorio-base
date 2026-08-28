import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * `01-engine-decision-memo.md`: do not build on geoblaze, georaster, loam, or
 * geojson-validation — all stale to abandoned. `03-critique-2.md` (H13) adds
 * that `geoblaze.median` is *zonal*, not temporal, so porting the NDVI
 * composite with it ships a plausible, wrong number. A lint rule is the only
 * place this warning survives contact with a new contributor.
 */
const bannedGeoLibraries = [
  {
    name: 'geoblaze',
    message:
      'Prohibido (memo §caveats, H13): abandonado y `geoblaze.median` es zonal, no temporal. El raster vive en services/api (Python).',
  },
  {
    name: 'georaster',
    message:
      'Prohibido (memo §caveats): sin mantenimiento desde 2023. El raster vive en services/api.',
  },
  {
    name: 'loam',
    message: 'Prohibido (memo §caveats): sin mantenimiento. El raster vive en services/api.',
  },
  {
    name: 'geojson-validation',
    message: 'Prohibido (memo §caveats): sin mantenimiento. Validar GeoJSON con zod + @turf/turf.',
  },
];

/** Files no linter should ever look at. */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  // `TB_DIST_DIR` da salidas paralelas (`dist-a`, `dist-b`, …). Sin esta línea
  // `pnpm lint` levanta decenas de miles de errores del bundle generado. Ver
  // `apps/web/vite.config.ts`.
  '**/dist-*/**',
  '**/.output/**',
  '**/.vinxi/**',
  '**/.nitro/**',
  '**/.tanstack/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/.venv/**',
  '**/routeTree.gen.ts',
];

/**
 * Base config: TypeScript, type-aware, for every package in the workspace.
 *
 * `tsconfigRootDir: process.cwd()` is correct because Turborepo runs `eslint .`
 * with the package directory as cwd. Never lint from the repo root.
 */
export const baseConfig = tseslint.config(
  { ignores },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: { 'import-x': importX },
    rules: {
      // --- Async correctness -------------------------------------------------
      // Everything in this app is a network call to a slow, flaky upstream
      // (Overpass, WDPA, MEPyD ArcGIS, Planetary Computer). A dropped promise is
      // a silently missing layer, which is exactly the failure class the
      // inventory's regression list is made of.
      '@typescript-eslint/no-floating-promises': ['error', { checkThenables: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/promise-function-async': 'error',

      // --- Type discipline ---------------------------------------------------
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      // Layer kinds, themes and export formats are closed unions (design brief
      // §1.2). Adding a member must break every switch that handles them.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // --- Imports -----------------------------------------------------------
      'import-x/order': [
        'error',
        {
          groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index'], 'type'],
          pathGroups: [{ pattern: '@territorio/**', group: 'internal', position: 'before' }],
          pathGroupsExcludedImportTypes: ['type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      'import-x/no-mutable-exports': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: true }],
      'import-x/consistent-type-specifier-style': ['error', 'prefer-inline'],
      'no-restricted-imports': ['error', { paths: bannedGeoLibraries }],

      // --- General -----------------------------------------------------------
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-param-reassign': ['error', { props: true }],
      'object-shorthand': ['error', 'always'],
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-var': 'error',
      curly: ['error', 'multi-line'],
    },
  },

  // Plain JS (config files, scripts): no type information available.
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Tests: fixtures are allowed to be blunt.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}', '**/*.bench.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'no-console': 'off',
    },
  },
);

export default baseConfig;
