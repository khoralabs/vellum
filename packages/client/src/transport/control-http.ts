/** Minimal fetch subset used by the control plane client. */
export type VellumFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Low-level HTTP-style access to the vellum control plane.
 * Implementations: loopback HTTP ({@link FetchVellumControlTransport}) and
 * in-process dispatch ({@link InProcessControlTransport}).
 */
export interface VellumControlTransport {
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** Synthetic Request dispatcher shared with Bun.serve / session control. */
export type VellumControlDispatchFn = (req: Request) => Promise<Response>;

/**
 * Route control POSTs through an in-process dispatcher (no loopback HTTP).
 * Used by {@link VellumPool} / embedded {@link runVellumSession}.
 */
export class InProcessControlTransport implements VellumControlTransport {
  readonly #dispatch: VellumControlDispatchFn;

  constructor(dispatch: VellumControlDispatchFn) {
    this.#dispatch = dispatch;
  }

  fetch(path: string, init?: RequestInit): Promise<Response> {
    const p = path.startsWith("/") ? path : `/${path}`;
    return this.#dispatch(new Request(`http://vellum.local${p}`, init));
  }
}

export type FetchVellumControlTransportOptions = {
  /** Resolved whenever a request runs so ports discovered late still work. */
  resolveBaseUrl: () => string;
  fetch?: VellumFetch;
};

export class FetchVellumControlTransport implements VellumControlTransport {
  readonly fetchImpl: VellumFetch;
  readonly resolveBaseUrl: () => string;

  constructor(opts: FetchVellumControlTransportOptions) {
    this.resolveBaseUrl = opts.resolveBaseUrl;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  fetch(path: string, init?: RequestInit): Promise<Response> {
    const base = this.resolveBaseUrl().trim().replace(/\/$/, "");
    const p = path.startsWith("/") ? path : `/${path}`;
    return this.fetchImpl(`${base}${p}`, init);
  }
}

export type CreateVellumControlTransportFromEnvOptions = {
  resolveBaseUrl: () => string;
  fetch?: VellumFetch;
  env?: NodeJS.ProcessEnv;
};

/** Deploy-time selection; today only `http` loopback is implemented. */
export function createVellumControlTransportFromEnv(
  opts: CreateVellumControlTransportFromEnvOptions,
): VellumControlTransport {
  const env = opts.env ?? process.env;
  const mode = (env.VELLUM_CONTROL_TRANSPORT ?? "http").trim().toLowerCase();
  if (mode === "http" || mode === "") {
    return new FetchVellumControlTransport({
      resolveBaseUrl: opts.resolveBaseUrl,
      fetch: opts.fetch,
    });
  }
  throw new Error(
    `VELLUM_CONTROL_TRANSPORT=${mode} is not implemented; supported: http (omit or set explicitly).`,
  );
}
