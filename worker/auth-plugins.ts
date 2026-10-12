// Better Auth plugins, shared by the Worker (worker/auth.ts) and the schema script (scripts/auth-schema.ts)
// so the generated tables always match the running configuration.
import { admin, username } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";

export const ROLES = ["view", "edit", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const authPlugins = () => [
  username({ minUsernameLength: 3, maxUsernameLength: 30 }),
  // Roles: view (default), edit, admin. Only admin may use the admin endpoints; edit rights are checked by our API.
  admin({ defaultRole: "view", adminRoles: ["admin"], roles: { view: userAc, edit: userAc, admin: adminAc } }),
];

export const RATE_LIMIT = {
  enabled: true,
  storage: "database" as const, // Worker isolates don't share memory
  customRules: {
    "/sign-in/email": { window: 15 * 60, max: 5 },
    "/sign-in/username": { window: 15 * 60, max: 5 },
  },
};
