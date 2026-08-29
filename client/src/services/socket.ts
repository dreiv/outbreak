import type { ClientMessage, ServerMessage } from "../../../shared/src/types";
import type { ConnectionStatus } from "../types";

type MessageHandler = (msg: ServerMessage) => void;
type StatusHandler = (status: ConnectionStatus) => void;

const HEARTBEAT_INTERVAL_MS = 20_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const RECONNECT_BACKOFF_FACTOR = 1.6;

/**
 * Resolves the WebSocket URL. `VITE_WS_URL` is the primary way to point the
 * client at the server once they're deployed separately — set it at build
 * time to the server's public `wss://` URL. The fallback is for local dev
 * only and mirrors the page's protocol: an https page always falls back to
 * `wss`, an http page to `ws`. Without this, an https-deployed client with a
 * missing `VITE_WS_URL` would silently fail (browsers block plain `ws://`
 * "mixed content" from an `https://` page) instead of failing loudly.
 */
function resolveWsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.hostname}:8787`;
}

/**
 * A reconnection-aware WebSocket client for the game server. Outgoing
 * messages sent while the socket is down are queued and flushed on (re)open.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private messageHandlers: MessageHandler[] = [];
  private statusHandler: StatusHandler | null = null;
  private queue: ClientMessage[] = [];
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private heartbeatTimer: number | undefined;
  private status: ConnectionStatus = "connecting";

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(resolveWsUrl());

    this.ws.addEventListener("open", () => {
      this.setStatus("open");
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.flushQueue();
      this.startHeartbeat();
    });

    this.ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        this.messageHandlers.forEach((h) => h(msg));
      } catch {
        // Ignore malformed frames.
      }
    });

    this.ws.addEventListener("close", () => {
      this.setStatus("closed");
      this.stopHeartbeat();
      window.setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(
        this.reconnectDelay * RECONNECT_BACKOFF_FACTOR,
        MAX_RECONNECT_DELAY_MS,
      );
    });

    this.ws.addEventListener("error", () => {
      this.ws?.close();
    });
  }

  onStatus(fn: StatusHandler): void {
    this.statusHandler = fn;
  }

  onMessage(fn: MessageHandler): void {
    this.messageHandlers.push(fn);
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  private flushQueue(): void {
    while (this.queue.length > 0) {
      const msg = this.queue.shift();
      if (msg) this.send(msg);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusHandler?.(status);
  }

  /**
   * Periodic ping so `close` fires promptly on a dropped connection with no
   * clean TCP close (wifi drop, sleep, NAT timeout) — the OS keepalive alone
   * is slower than the reconnect grace period.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}

export const socket = new GameSocket();
