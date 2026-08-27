import type { ClientMessage, ServerMessage } from "../../shared/src/types";

type Handler = (msg: ServerMessage) => void;

// VITE_WS_URL is the primary way to point the client at the server once
// they're deployed separately (e.g. client as a Render Static Site, server
// as its own Render Web Service) — set it at build time to the server's
// public wss:// URL. The fallback below is for local dev only, and now
// mirrors the page's protocol: an https page always falls back to wss, an
// http page to ws. Without this, an https-deployed client with a missing
// VITE_WS_URL would silently fail (browsers block plain ws:// "mixed
// content" from an https:// page) instead of failing loudly.
function defaultWsUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.hostname}:8787`;
}

const WS_URL = (import.meta as any).env?.VITE_WS_URL || defaultWsUrl();
const HEARTBEAT_INTERVAL_MS = 20000;

export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private queue: ClientMessage[] = [];
  private reconnectDelay = 1000;
  private heartbeatTimer: number | undefined;
  public status: "connecting" | "open" | "closed" = "connecting";
  private onStatusChange:
    | ((s: "connecting" | "open" | "closed") => void)
    | null = null;

  connect() {
    this.status = "connecting";
    this.onStatusChange?.(this.status);
    this.ws = new WebSocket(WS_URL);

    this.ws.addEventListener("open", () => {
      this.status = "open";
      this.onStatusChange?.(this.status);
      this.reconnectDelay = 1000;
      while (this.queue.length) this.send(this.queue.shift()!);

      // Periodic ping so `close` fires promptly on a dropped connection with
      // no clean TCP close (wifi drop, sleep, NAT timeout) — the OS keepalive
      // alone is slower than the 2-minute reconnect grace period.
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => {
        this.send({ type: "ping" });
      }, HEARTBEAT_INTERVAL_MS);
    });

    this.ws.addEventListener("message", (ev) => {
      try {
        const msg: ServerMessage = JSON.parse(ev.data);
        this.handlers.forEach((h) => h(msg));
      } catch {
        // ignore malformed
      }
    });

    this.ws.addEventListener("close", () => {
      this.status = "closed";
      this.onStatusChange?.(this.status);
      window.clearInterval(this.heartbeatTimer);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 10000);
    });

    this.ws.addEventListener("error", () => {
      this.ws?.close();
    });
  }

  onStatus(fn: (s: "connecting" | "open" | "closed") => void) {
    this.onStatusChange = fn;
  }

  onMessage(fn: Handler) {
    this.handlers.push(fn);
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }
}

export const socket = new GameSocket();
