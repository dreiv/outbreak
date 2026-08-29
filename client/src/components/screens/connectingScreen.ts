import type { ConnectionStatus } from "../../types";

/**
 * Shown before we've ever gotten a state_sync back. Render's free tier can
 * take 30-50s to wake a sleeping instance, and without this the visitor
 * just sees a blank page (or, worse, the lobby form) with no sign anything
 * is happening until the socket finally opens.
 */
export function renderConnectingScreen(
  el: HTMLElement,
  connStatus: ConnectionStatus,
): void {
  const isRetrying = connStatus === "closed";
  el.innerHTML = `
    <div class="lobby-screen">
      <div class="lobby-card" style="text-align:center;">
        <h1>🧬 Outbreak Protocol</h1>
        <p class="tagline">${isRetrying ? "Reconnecting…" : "Connecting to server…"}</p>
        <div class="connect-spinner" aria-hidden="true"></div>
        <p class="connect-note">
          ${
            isRetrying
              ? "Lost the connection — retrying automatically."
              : "If this is the first request in a while, the server may need up to a minute to wake up."
          }
        </p>
      </div>
    </div>
  `;
}
