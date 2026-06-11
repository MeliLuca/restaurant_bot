"use client";

import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, UserPlus, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createUser,
  setUserPin,
  staffManagersRemain,
  updateUser,
  type StaffMember,
} from "@/lib/staff-api";
import type { Role } from "@/lib/database.types";
import { useAuthStore } from "@/stores/auth-store";

const PIN_RE = /^\d{4}$/;

interface UsersManagerProps {
  roles: Role[];
  staff: StaffMember[];
  onChanged: () => Promise<void>;
}

export function UsersManager({ roles, staff, onChanged }: UsersManagerProps) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [busy, setBusy] = useState(false);
  const [pinTarget, setPinTarget] = useState<StaffMember | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newPin, setNewPin] = useState("");

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      toast.success(success);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function changeRole(user: StaffMember, roleId: string) {
    if (
      !staffManagersRemain(staff, roles, { kind: "user", userId: user.id, roleId })
    ) {
      toast.error("That would leave no active user who can manage staff.");
      return;
    }
    void run(
      () => updateUser(user.id, { role_id: roleId }),
      `${user.name}'s role updated`,
    );
  }

  function toggleActive(user: StaffMember) {
    const isActive = !user.is_active;
    if (
      !isActive &&
      !staffManagersRemain(staff, roles, {
        kind: "user",
        userId: user.id,
        isActive,
      })
    ) {
      toast.error("That would leave no active user who can manage staff.");
      return;
    }
    void run(
      () => updateUser(user.id, { is_active: isActive }),
      `${user.name} ${isActive ? "activated" : "deactivated"}`,
    );
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pinTarget) return;
    if (!PIN_RE.test(pinValue)) {
      toast.error("PIN must be exactly 4 digits");
      return;
    }
    const ok = await run(
      () => setUserPin(pinTarget.id, pinValue),
      `PIN updated for ${pinTarget.name}`,
    );
    if (ok) {
      setPinTarget(null);
      setPinValue("");
    }
  }

  async function submitNewUser(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return toast.error("Name is required");
    if (!newRoleId) return toast.error("Pick a role");
    if (!PIN_RE.test(newPin)) return toast.error("PIN must be exactly 4 digits");
    const ok = await run(
      () => createUser(name, newRoleId, newPin),
      `${name} added`,
    );
    if (ok) {
      setAddOpen(false);
      setNewName("");
      setNewRoleId("");
      setNewPin("");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Staff</CardTitle>
        <Button className="h-12" onClick={() => setAddOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" /> Add user
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {staff.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-24 flex-1">
              <div className="font-medium">
                {u.name}
                {u.id === currentUserId && (
                  <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                )}
              </div>
              {!u.is_active && <Badge variant="outline">Inactive</Badge>}
            </div>
            <Select
              value={u.role_id}
              onValueChange={(roleId) => changeRole(u, roleId)}
              disabled={busy}
            >
              <SelectTrigger className="h-11 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => setPinTarget(u)}
            >
              <KeyRound className="mr-1.5 h-4 w-4" /> PIN
            </Button>
            <Button
              variant={u.is_active ? "ghost" : "secondary"}
              className="h-11"
              disabled={busy}
              onClick={() => toggleActive(u)}
            >
              {u.is_active ? "Deactivate" : "Activate"}
            </Button>
          </div>
        ))}

        {/* reset PIN dialog */}
        <Dialog
          open={!!pinTarget}
          onOpenChange={(o) => {
            if (!o) {
              setPinTarget(null);
              setPinValue("");
            }
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>New PIN for {pinTarget?.name}</DialogTitle>
            </DialogHeader>
            <form onSubmit={submitPin} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="pin-input">4-digit PIN</Label>
                <Input
                  id="pin-input"
                  className="h-12 text-center text-xl tracking-[0.5em]"
                  inputMode="numeric"
                  maxLength={4}
                  value={pinValue}
                  onChange={(e) =>
                    setPinValue(e.target.value.replace(/\D/g, ""))
                  }
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="submit" className="h-12" disabled={busy}>
                  Save PIN
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* add user dialog */}
        <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Add staff member</DialogTitle>
            </DialogHeader>
            <form onSubmit={submitNewUser} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-user-name">Name</Label>
                <Input
                  id="new-user-name"
                  className="h-12"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={newRoleId} onValueChange={setNewRoleId}>
                  <SelectTrigger className="h-12">
                    <SelectValue placeholder="Pick a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-user-pin">4-digit PIN</Label>
                <Input
                  id="new-user-pin"
                  className="h-12 text-center text-xl tracking-[0.5em]"
                  inputMode="numeric"
                  maxLength={4}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <DialogFooter>
                <Button type="submit" className="h-12" disabled={busy}>
                  Create user
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
