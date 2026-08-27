/**
 * The argv a CLI script should actually parse.
 *
 * `pnpm run <script> -- --email ana@ejemplo.do` forwards the `--` **literally**,
 * so `process.argv` ends up as `['--', '--email', 'ana@ejemplo.do']`. Node's
 * `parseArgs` reads `--` as the end-of-options marker: with
 * `allowPositionals: false` it throws, and — far worse — with positionals
 * allowed it silently files every flag under `positionals` and hands you an
 * empty `values`. A `--days 7` that quietly becomes the default is exactly the
 * kind of bug nobody notices until an invite outlives its welcome.
 *
 * Dropping a leading `--` makes both invocations mean the same thing:
 *
 *     pnpm ... db:create-invite -- --email ana@ejemplo.do
 *     pnpm ... db:create-invite --email ana@ejemplo.do
 */
export function cliArgs(argv: string[] = process.argv.slice(2)): string[] {
  return argv[0] === '--' ? argv.slice(1) : argv;
}
