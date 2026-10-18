/** Workers' cloudflare:workers module, for loading the site's modules on Node (vitest.config.ts): only what they import. */
export class WorkerEntrypoint<Env = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: Env,
  ) {}
}
