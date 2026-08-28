import { baseConfig } from '@territorio/eslint-config/base';

/**
 * Dos reglas del config compartido se contradicen entre sí para los imports
 * que son 100% de tipos, y no hay forma de escribirlos que satisfaga a las dos:
 *
 *   import type { Aoi } from './aoi';   → `import-x/consistent-type-specifier-style`
 *                                         ('prefer-inline') pide inline
 *   import { type Aoi } from './aoi';   → `@typescript-eslint/no-import-type-side-effects`
 *                                         pide el calificador de arriba
 *
 * Se desactiva `consistent-type-specifier-style` y no la otra porque, con
 * `verbatimModuleSyntax: true` (activo en `@territorio/tsconfig/base`), la
 * forma inline **deja un `import './aoi';` en el runtime**: un side effect
 * real, no una cuestión de estilo. Los imports mixtos siguen usando
 * especificadores inline igual, porque `import-x/no-duplicates` está
 * configurado con `prefer-inline` y los fusiona.
 *
 * Es un arreglo local: lo correcto es resolverlo en `packages/eslint-config`,
 * que este paquete no es dueño de tocar.
 */
export default [
  ...baseConfig,
  {
    rules: {
      'import-x/consistent-type-specifier-style': 'off',
    },
  },
];
