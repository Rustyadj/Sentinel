export type ControlPlaneRole = "owner" | "admin" | "member";

export function canEditConfig(role: ControlPlaneRole) {
  return role === "owner" || role === "admin";
}

export const canRestartAgent = canEditConfig;
export function canViewAgent(_role: ControlPlaneRole) { return true; }
