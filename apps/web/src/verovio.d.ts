declare module "verovio/wasm" {
  const createModule: () => Promise<unknown>;
  export default createModule;
}

declare module "verovio/esm" {
  export class VerovioToolkit {
    constructor(module: unknown);
  }
}
