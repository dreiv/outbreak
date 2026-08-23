import type { ClientMessage, ServerMessage } from '../../shared/src/types';

type Handler = (msg: ServerMessage) => void;

const WS_URL = (import.meta as any).env?.VITE_WS_URL || `ws://${location.hostname}:8787`;
const HEARTBEAT_INTERVAL_MS = 20000;

export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private queue: ClientMessage[] = [];
  private reconnectDelay = 1000;
  private heartbeatTimer: number | undefined;
  public status: 'connecting' | 'open' | 'closed' = 'connecting';
  private onStatusChange: ((s: 'connecting' | 'open' | 'closed') => void) | null = null;

  connect() {
    this.status = 'connecting';
    this.onStatusChange?.(this.status);
    this.ws = new WebSocket(WS_URL);

    this.ws.addEventListener('open', () => {
      this.status = 'open';
      this.onStatusChange?.(this.status);
      this.reconnectDelay = 1000;
      while (this.queue.length) this.send(this.queue.shift()!);

      // The server already handles a `ping` message (see server/src/index.ts),
      // but nothing ever sent one — a dropped connection with no clean TCP
      // close (wifi drop, laptop sleep, NAT timeout) wasn't detected until
      // the OS's own TCP keepalive eventually gave up, which can take far
      // longer than this game's 2-minute reconnect grace period expects.
      // A periodic ping means `close` fires promptly once the underlying
      // socket is actually gone.
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => {
        this.send({ type: 'ping' });
      }, HEARTBEAT_INTERVAL_MS);
    });

    this.ws.addEventListener('message', (ev) => {
      try {
        const msg: ServerMessage = JSON.parse(ev.data);
        this.handlers.forEach((h) => h(msg));
      } catch {
        // ignore malformed
      }
    });

    this.ws.addEventListener('close', () => {
      this.status = 'closed';
      this.onStatusChange?.(this.status);
      window.clearInterval(this.heartbeatTimer);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 10000);
    });

    this.ws.addEventListener('error', () => {
      this.ws?.close();
    });
  }

  onStatus(fn: (s: 'connecting' | 'open' | 'closed') => void) {
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