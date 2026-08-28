import { reactConfig } from '@territorio/eslint-config/react';

/**
 * Dos reglas del config compartido se contradicen entre sí para los imports
 * que son 100% de tipos, y no hay forma de escribirlos que satisfaga a las dos:
 *
 *   import type { LayerDef } from './types';   → `import-x/consistent-type-specifier-style`
 *                                                ('prefer-inline') pide inline
 *   import { type LayerDef } from './types';   → `@typescript-eslint/no-import-type-side-effects`
 *                                                pide el calificador de arriba
 *
 * Se desactiva `consistent-type-specifier-style` y no la otra porque, con
 * `verbatimModuleSyntax: true` (activo en `@territorio/tsconfig/base`), la
 * forma inline **deja un `import './types';` en el runtime**: un side effect
 * real, no una cuestión de estilo. Los imports mixtos siguen usando
 * especificadores inline igual, porque `import-x/no-duplicates` está
 * configurado con `prefer-inline` y los fusiona.
 *
 * Mismo arreglo local que `packages/geo/eslint.config.js`. Lo correcto es
 * resolverlo en `packages/eslint-config`, que este paquete no es dueño de tocar.
 */
export default [
  ...reactConfig,
  {
    rules: {
      'import-x/consistent-type-specifier-style': 'off',
    },
  },
];
