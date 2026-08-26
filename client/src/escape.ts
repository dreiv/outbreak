// Player names are free text (server only trims) and get interpolated into
// innerHTML and HTML attributes in several places — escape on the way in,
// every time, or a name like `<img src=x onerror=…>` would execute in every
// connected client.
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}