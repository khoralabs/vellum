/** Minimal fetch subset used by the control plane client. */
export type VellumFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Low-level HTTP-style access to the vellum daemon control server (`127.0.0.1:port`).
 * Future bindings (Unix socket, in-process queue) implement the same surface over synthetic Responses if needed.
 */
export interface VellumControlTransport {
  fetch(path: string, init?: RequestInit): Promise<Response>;
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
