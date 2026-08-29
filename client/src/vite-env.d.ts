/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Public `wss://` URL of the game server. Set at build time when the
   * client and server are deployed separately (e.g. client as a Render
   * Static Site, server as its own Render Web Service).
   */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
