/** Workers' cloudflare:email module, for loading the site's modules on Node (vitest.config.ts). Nothing is sent. */
export class EmailMessage {
  constructor(
    readonly from: string,
    readonly to: string,
    readonly raw: unknown,
  ) {}
}
