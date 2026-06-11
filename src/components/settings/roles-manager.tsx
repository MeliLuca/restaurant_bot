"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  createRole,
  deleteRole,
  staffManagersRemain,
  updateRolePermissions,
  type StaffMember,
} from "@/lib/staff-api";
import type { Role } from "@/lib/database.types";
import { cn } from "@/lib/utils";

interface RolesManagerProps {
  roles: Role[];
  staff: StaffMember[];
  onChanged: () => Promise<void>;
}

export function RolesManager({ roles, staff, onChanged }: RolesManagerProps) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function togglePermission(role: Role, key: string) {
    const has = role.permissions.includes(key);
    const next = has
      ? role.permissions.filter((p) => p !== key)
      : [...role.permissions, key];

    if (
      has &&
      key === "manage_staff" &&
      !staffManagersRemain(staff, roles, {
        kind: "role-perms",
        roleId: role.id,
        permissions: next,
      })
    ) {
      toast.error(
        "That would leave no active user who can manage staff — someone must keep this permission.",
      );
      return;
    }
    void run(
      () => updateRolePermissions(role.id, next),
      `${role.name} updated`,
    );
  }

  function handleDelete(role: Role) {
    if (staff.some((u) => u.role_id === role.id)) {
      toast.error(`Reassign the users in “${role.name}” first`);
      return;
    }
    void run(() => deleteRole(role.id), `Role “${role.name}” deleted`);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await run(() => createRole(name), `Role “${name}” created`);
    setNewName("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles &amp; permissions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {roles.map((role) => {
          const userCount = staff.filter((u) => u.role_id === role.id).length;
          return (
            <div key={role.id} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <span className="font-semibold">{role.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {userCount} user{userCount === 1 ? "" : "s"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted-foreground"
                  aria-label={`Delete role ${role.name}`}
                  disabled={busy}
                  onClick={() => handleDelete(role)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {PERMISSIONS.map((p) => {
                  const active = role.permissions.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={busy}
                      title={p.description}
                      onClick={() => togglePermission(role, p.key)}
                      className={cn(
                        "flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors disabled:opacity-50",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {active && <Check className="h-3.5 w-3.5" />}
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <form onSubmit={handleCreate} className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New role name (e.g. Busser)"
            className="h-12"
            aria-label="New role name"
          />
          <Button
            type="submit"
            className="h-12"
            disabled={busy || !newName.trim()}
          >
            <Plus className="mr-1 h-4 w-4" /> Add role
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
