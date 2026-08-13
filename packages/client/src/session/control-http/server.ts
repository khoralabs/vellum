import {
  type CreateVellumControlDispatchOptions,
  createVellumControlDispatch,
  type VellumControlDispatch,
} from "../core";

export function startVellumControlServer(opts: CreateVellumControlDispatchOptions): {
  hostname: string;
  port: number;
  dispatch: VellumControlDispatch;
  stop(): void;
} {
  const dispatch = createVellumControlDispatch(opts);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: dispatch,
  });

  return {
    hostname: server.hostname ?? "127.0.0.1",
    port: Number(server.port ?? 0),
    dispatch,
    stop: () => {
      server.stop();
    },
  };
}
