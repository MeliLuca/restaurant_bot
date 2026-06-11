import { getSupabase } from "@/lib/supabase/client";
import type { AppUser, Role } from "@/lib/database.types";

// app_users uses column-level grants (pin_hash is not readable), so selects
// must list columns explicitly — `select=*` is rejected by the API.
const USER_COLUMNS = "id, name, role_id, is_active, created_at";

export type StaffMember = AppUser & {
  roles: Pick<Role, "name" | "permissions"> | null;
};

export async function fetchRoles(): Promise<Role[]> {
  const { data, error } = await getSupabase()
    .from("roles")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchStaff(): Promise<StaffMember[]> {
  const { data, error } = await getSupabase()
    .from("app_users")
    .select(`${USER_COLUMNS}, roles(name, permissions)`)
    .order("name");
  if (error) throw new Error(error.message);
  return data as unknown as StaffMember[];
}

export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("verify_user_pin", {
    p_user_id: userId,
    p_pin: pin,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function createRole(name: string): Promise<void> {
  const { error } = await getSupabase().from("roles").insert({ name });
  if (error) throw new Error(error.message);
}

export async function updateRolePermissions(
  roleId: string,
  permissions: string[],
): Promise<void> {
  const { error } = await getSupabase()
    .from("roles")
    .update({ permissions })
    .eq("id", roleId);
  if (error) throw new Error(error.message);
}

export async function deleteRole(roleId: string): Promise<void> {
  const { error } = await getSupabase().from("roles").delete().eq("id", roleId);
  if (error) {
    throw new Error(
      error.code === "23503"
        ? "This role still has users assigned to it"
        : error.message,
    );
  }
}

export async function createUser(
  name: string,
  roleId: string,
  pin: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("create_app_user", {
    p_name: name,
    p_role_id: roleId,
    p_pin: pin,
  });
  if (error) throw new Error(error.message);
}

export async function updateUser(
  userId: string,
  patch: { role_id?: string; is_active?: boolean },
): Promise<void> {
  const { error } = await getSupabase()
    .from("app_users")
    .update(patch)
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function setUserPin(userId: string, pin: string): Promise<void> {
  const { error } = await getSupabase().rpc("set_user_pin", {
    p_user_id: userId,
    p_pin: pin,
  });
  if (error) throw new Error(error.message);
}

/**
 * Lockout guard: true if at least one ACTIVE user would still hold
 * `manage_staff` after applying the proposed change.
 */
export function staffManagersRemain(
  staff: StaffMember[],
  roles: Role[],
  change:
    | { kind: "role-perms"; roleId: string; permissions: string[] }
    | { kind: "user"; userId: string; roleId?: string; isActive?: boolean },
): boolean {
  const rolePerms = new Map(roles.map((r) => [r.id, r.permissions]));
  if (change.kind === "role-perms") {
    rolePerms.set(change.roleId, change.permissions);
  }

  return staff.some((u) => {
    let roleId = u.role_id;
    let active = u.is_active;
    if (change.kind === "user" && u.id === change.userId) {
      roleId = change.roleId ?? roleId;
      active = change.isActive ?? active;
    }
    return active && (rolePerms.get(roleId) ?? []).includes("manage_staff");
  });
}
