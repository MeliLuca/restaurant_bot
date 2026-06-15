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
import { useT } from "@/lib/i18n/use-translation";
import { useAuthStore } from "@/stores/auth-store";

const PIN_RE = /^\d{4}$/;

interface UsersManagerProps {
  roles: Role[];
  staff: StaffMember[];
  onChanged: () => Promise<void>;
}

export function UsersManager({ roles, staff, onChanged }: UsersManagerProps) {
  const t = useT();
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
      toast.error(e instanceof Error ? e.message : t("common.somethingWrong"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function changeRole(user: StaffMember, roleId: string) {
    if (
      !staffManagersRemain(staff, roles, { kind: "user", userId: user.id, roleId })
    ) {
      toast.error(t("users.leaveNoStaffManagerShort"));
      return;
    }
    void run(
      () => updateUser(user.id, { role_id: roleId }),
      t("users.roleUpdatedUser", { name: user.name }),
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
      toast.error(t("users.leaveNoStaffManagerShort"));
      return;
    }
    void run(
      () => updateUser(user.id, { is_active: isActive }),
      isActive
        ? t("users.userActivated", { name: user.name })
        : t("users.userDeactivated", { name: user.name }),
    );
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pinTarget) return;
    if (!PIN_RE.test(pinValue)) {
      toast.error(t("users.pinMust4"));
      return;
    }
    const ok = await run(
      () => setUserPin(pinTarget.id, pinValue),
      t("users.pinUpdatedFor", { name: pinTarget.name }),
    );
    if (ok) {
      setPinTarget(null);
      setPinValue("");
    }
  }

  async function submitNewUser(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return toast.error(t("users.nameRequired"));
    if (!newRoleId) return toast.error(t("users.pickRole"));
    if (!PIN_RE.test(newPin)) return toast.error(t("users.pinMust4"));
    const ok = await run(
      () => createUser(name, newRoleId, newPin),
      t("users.userAdded", { name }),
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
        <CardTitle>{t("users.staff")}</CardTitle>
        <Button className="h-12" onClick={() => setAddOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" /> {t("users.addUser")}
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
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({t("users.you")})
                  </span>
                )}
              </div>
              {!u.is_active && <Badge variant="outline">{t("users.inactive")}</Badge>}
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
              <KeyRound className="mr-1.5 h-4 w-4" /> {t("users.pin")}
            </Button>
            <Button
              variant={u.is_active ? "ghost" : "secondary"}
              className="h-11"
              disabled={busy}
              onClick={() => toggleActive(u)}
            >
              {u.is_active ? t("users.deactivate") : t("users.activate")}
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
              <DialogTitle>
                {t("users.newPinFor", { name: pinTarget?.name ?? "" })}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={submitPin} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="pin-input">{t("users.fourDigitPin")}</Label>
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
                  {t("users.savePin")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* add user dialog */}
        <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("users.addStaffMember")}</DialogTitle>
            </DialogHeader>
            <form onSubmit={submitNewUser} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-user-name">{t("users.name")}</Label>
                <Input
                  id="new-user-name"
                  className="h-12"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("users.role")}</Label>
                <Select value={newRoleId} onValueChange={setNewRoleId}>
                  <SelectTrigger className="h-12">
                    <SelectValue placeholder={t("users.pickRole")} />
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
                <Label htmlFor="new-user-pin">{t("users.fourDigitPin")}</Label>
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
                  {t("users.createUser")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
