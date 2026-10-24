// The SDK file is bundled into the games Worker as text.
declare module "@zaisma/sdk/zaisma.js" {
  const source: string;
  export default source;
}

// And its types, served beside it.
declare module "@zaisma/sdk/zaisma.d.ts" {
  const source: string;
  export default source;
}

// Zaisma's own scripts for game pages, imported by path: they're not part of the SDK package.
declare module "*/packages/sdk/saves.js" {
  const source: string;
  export default source;
}

declare module "*/packages/sdk/picture.js" {
  const source: string;
  export default source;
}

declare module "*/packages/sdk/relay.js" {
  const source: string;
  export default source;
}

declare module "*/packages/sdk/warm.js" {
  const source: string;
  export default source;
}

declare module "*/packages/sdk/performance.js" {
  const source: string;
  export default source;
}
