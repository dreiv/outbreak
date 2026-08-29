/**
 * Escapes a string for safe interpolation into `innerHTML` and HTML
 * attributes. Player names are free text (the server only trims them) and
 * are interpolated throughout the UI, so a name like
 * `<img src=x onerror=…>` would otherwise execute in every connected client.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
