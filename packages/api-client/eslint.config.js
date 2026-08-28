import { baseConfig } from '@territorio/eslint-config/base';

export default [
  ...baseConfig,
  {
    // `src/generated/schema.ts` lo escribe openapi-typescript. Formatearlo o
    // adaptarlo a las reglas de estilo del repo haría que el próximo
    // `pnpm generate` lo revirtiera: se ignora entero, a propósito.
    ignores: ['src/generated/**'],
  },
  {
    /*
      Mismo arreglo local que `packages/geo/eslint.config.js` y
      `apps/web/eslint.config.js`: con `verbatimModuleSyntax: true`, la forma
      inline que pide `import-x/consistent-type-specifier-style` deja un
      `import './modulo';` en runtime — un side effect real, no una cuestión de
      estilo. Se desactiva esa y se conserva `no-import-type-side-effects`.
    */
    rules: {
      'import-x/consistent-type-specifier-style': 'off',
    },
  },
  {
    // CLI de generación: su salida entera es stdout.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
