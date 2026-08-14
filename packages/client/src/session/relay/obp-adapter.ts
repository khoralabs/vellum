import { Buffer } from "node:buffer";
import { createWebSocketDuplexByteStream } from "@khoralabs/obp-core";
import {
  connectObpFrameChannelSession,
  type ObpFrameConnection,
  type ObpWebSocketConnectOptions,
} from "@khoralabs/obp-wire/ws";
import type { FabricByteChannel } from "../core/fabric";

type ObpSessionResult = Awaited<ReturnType<typeof connectObpFrameChannelSession>>;

export function webSocketUrlWithReplay(base: string, replayAfter?: number): string {
  if (replayAfter === undefined || !Number.isFinite(replayAfter)) return base;
  const u = new URL(base);
  u.searchParams.set("replayAfter", String(replayAfter));
  return u.toString();
}

export async function openRelayByteDuplex(args: {
  webSocketUrl: string;
  webSocketProtocols?: string | string[] | undefined;
  WebSocketCtor: typeof WebSocket;
}): Promise<{ channel: FabricByteChannel; dispose(): void }> {
  const WS = args.WebSocketCtor;
  const ws =
    args.webSocketProtocols !== undefined
      ? new WS(args.webSocketUrl, args.webSocketProtocols)
      : new WS(args.webSocketUrl);
  ws.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onErr = (e: Event): void => {
      cleanup();
      reject(new Error(`WebSocket error: ${String((e as ErrorEvent).message ?? "error")}`));
    };
    const cleanup = (): void => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onErr);
    };
    ws.addEventListener("open", onOpen, { once: true });
    ws.addEventListener("error", onErr, { once: true });
  });

  const bridge = createWebSocketDuplexByteStream((bytes) => {
    // DOM WebSocket.send expects ArrayBuffer-backed views; DuplexByteStream uses ArrayBufferLike.
    ws.send(bytes.slice());
  });

  const onMessage = (ev: MessageEvent): void => {
    const d = ev.data;
    if (d instanceof ArrayBuffer) {
      bridge.onMessage(d);
    } else if (d instanceof Uint8Array) {
      bridge.onMessage(d);
    } else if (Buffer.isBuffer(d)) {
      bridge.onMessage(new Uint8Array(d));
    } else if (typeof Blob !== "undefined" && d instanceof Blob) {
      void d.arrayBuffer().then((b) => bridge.onMessage(b));
    }
  };
  const onClose = (): void => {
    bridge.onClose();
  };
  ws.addEventListener("message", onMessage);
  ws.addEventListener("close", onClose);

  return {
    channel: bridge.channel,
    dispose(): void {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Wrap a DuplexByteStream so that init frames for sessions in `ownedIds` are
 * dropped from the read side. The relay broadcasts every frame to all channel
 * members including the sender, so outbound inits echo back — the multiplex
 * must not see them as inbound peer-initiated sessions.
 *
 * Non-init uplink echoes are passed through (same as a dedicated per-DID socket).
 */
export function filterEchoedInits(
  inner: FabricByteChannel,
  ownedIds: Set<string>,
): { channel: FabricByteChannel; getFrameCount: () => number } {
  let frameCount = 0;
  const channel: FabricByteChannel = {
    async *read() {
      for await (const chunk of inner.read()) {
        if (ownedIds.size > 0) {
          try {
            // OBP wire format: uint32_be(length) followed by JSON payload.
            // Must skip the 4-byte length prefix before parsing JSON.
            if (chunk.length > 4) {
              const text = new TextDecoder().decode(chunk.subarray(4));
              const parsed = JSON.parse(text) as unknown;
              if (
                parsed !== null &&
                typeof parsed === "object" &&
                "init" in parsed &&
                parsed.init !== null &&
                typeof parsed.init === "object" &&
                "session_id" in parsed.init &&
                typeof (parsed.init as Record<string, unknown>).session_id === "string" &&
                ownedIds.has((parsed.init as Record<string, unknown>).session_id as string)
              ) {
                continue; // drop echoed init
              }
            }
          } catch {
            // not JSON or malformed — pass through and let the multiplex handle it
          }
        }
        frameCount++;
        yield chunk;
      }
    },
    write: (bytes: Uint8Array) => inner.write(bytes),
    close: (reason?: unknown) => inner.close(reason),
  };
  return { channel, getFrameCount: () => frameCount };
}

/** Run OBP multiplex over an already-open fabric byte channel (with owned-init echo filter). */
export async function connectObpOverByteChannel(
  options: Omit<ObpWebSocketConnectOptions, "channel" | "WebSocketCtor" | "webSocketUrl"> & {
    channel: FabricByteChannel;
    onChannelClose?: () => void;
  },
  runner: (conn: ObpFrameConnection, getFrameCount: () => number) => Promise<void>,
): Promise<ObpSessionResult> {
  const { channel: rawChannel, onChannelClose, ...rest } = options;
  const ownedSessionIds = new Set<string>();
  const { channel: filteredChannel, getFrameCount } = filterEchoedInits(
    rawChannel,
    ownedSessionIds,
  );

  const wrappedRunner = async (conn: ObpFrameConnection): Promise<void> => {
    const interceptedConn: ObpFrameConnection = {
      async init(init, hooks) {
        ownedSessionIds.add(init.session_id);
        try {
          return await conn.init(init, hooks);
        } catch (e) {
          ownedSessionIds.delete(init.session_id);
          throw e;
        }
      },
      close: () => conn.close(),
    };
    await runner(interceptedConn, getFrameCount);
  };

  try {
    return await connectObpFrameChannelSession(
      { ...rest, channel: filteredChannel },
      wrappedRunner,
    );
  } finally {
    onChannelClose?.();
    try {
      await rawChannel.close();
    } catch {
      /* ignore */
    }
  }
}

export async function connectObpOverRelay(
  options: Omit<ObpWebSocketConnectOptions, "channel" | "WebSocketCtor"> & {
    WebSocketCtor?: typeof WebSocket;
    replayAfter?: number;
  },
  runner: (conn: ObpFrameConnection, getFrameCount: () => number) => Promise<void>,
): Promise<ObpSessionResult> {
  const { webSocketUrl, webSocketProtocols, WebSocketCtor, replayAfter, ...rest } = options;
  const handle = await openRelayByteDuplex({
    webSocketUrl: webSocketUrlWithReplay(webSocketUrl, replayAfter),
    webSocketProtocols,
    WebSocketCtor: WebSocketCtor ?? WebSocket,
  });

  return connectObpOverByteChannel(
    { ...rest, channel: handle.channel, onChannelClose: () => handle.dispose() },
    runner,
  );
}
