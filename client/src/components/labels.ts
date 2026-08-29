import type { EventId, RoleId } from "../../../shared/src/types";
import { EVENTS, ROLES } from "../../../shared/src/types";

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
