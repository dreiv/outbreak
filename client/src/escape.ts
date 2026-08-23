// Player names are free text chosen by whoever joins a room, and the server
// does no sanitization beyond a trim/fallback (see server/src/index.ts).
// They end up interpolated into innerHTML in several places (lobby list,
// sidebar player chips, the activity log — which embeds names inside
// strings like "${name} joined the room." — and share-knowledge button
// labels), as well as into a couple of double-quoted HTML attributes (the
// name/room-code <input value="...">). A name like `<img src=x onerror=…>`
// would otherwise execute in every connected client. Escape on the way in,
// every time.
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
