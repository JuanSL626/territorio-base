import { createFileRoute } from '@tanstack/react-router';

import { requireUser } from '~/lib/auth-server';

/**
 * Layout autenticado. El guard corre en el SERVIDOR durante el SSR y otra vez
 * en cada navegación de cliente, así que el navegador nunca pinta un shell
 * logueado que después salta a /login.
 *
 * `requireUser` es del workstream de auth (`~/lib/auth-server`): acá se
 * IMPORTA, no se reimplementa. Devuelve el usuario y lo deja como contexto de
 * ruta para todos los hijos.
 *
 * OJO (regla de TanStack Start): `beforeLoad` protege la NAVEGACIÓN, no los
 * datos. Cada `createServerFn` que devuelva datos privados tiene que validar la
 * sesión por su cuenta — es un endpoint HTTP alcanzable sin pasar por acá.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => ({ user: await requireUser(location) }),
});
