import type { EventId, RoleId } from "../../../shared/src/types";
import { EVENTS, ROLES } from "../../../shared/src/types";

/**
 * One-letter glyph per role, shown on the board pawn so players are
 * distinguishable at a glance (color alone is ambiguous for color-blind
 * players and when several share a city).
 */
export const ROLE_GLYPHS: Record<RoleId, string> = {
  "logistics-chief": "L",
  "field-medic": "M",
  virologist: "V",
  courier: "C",
  "liaison-officer": "O",
  archivist: "A",
  quartermaster: "Q",
};

/** Glyph for a role, or a neutral dot when the player has none yet. */
export function roleGlyph(roleId: RoleId | null): string {
  return roleId ? ROLE_GLYPHS[roleId] : "•";
}

/** Display name for an event card, falling back to the raw id. */
export function eventName(id: EventId): string {
  return EVENTS.find((e) => e.id === id)?.name ?? id;
}

/** Display name for a role, or "Unassigned" when the player has none. */
export function roleLabel(roleId: RoleId | null): string {
  return ROLES.find((r) => r.id === roleId)?.name ?? "Unassigned";
}

/** One-line description for a role, empty string when unassigned. */
export function roleDesc(roleId: RoleId | null): string {
  return ROLES.find((r) => r.id === roleId)?.description ?? "";
}
