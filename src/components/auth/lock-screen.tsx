"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, UserRound, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/use-translation";
import { fetchStaff, verifyPin, type StaffMember } from "@/lib/staff-api";
import { useAuthStore } from "@/stores/auth-store";
import { PinPad } from "./pin-pad";

export function LockScreen() {
  const t = useT();
  const signIn = useAuthStore((s) => s.signIn);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStaff()
      .then((s) => setStaff(s.filter((u) => u.is_active)))
      .catch((e) =>
        setError(e instanceof Error ? e.message : t("auth.loadStaffFailed")),
      )
      .finally(() => setLoading(false));
  }, [t]);

  async function handlePin(pin: string): Promise<boolean> {
    if (!selected) return false;
    try {
      const ok = await verifyPin(selected.id, pin);
      if (!ok) {
        toast.error(t("auth.wrongPin"));
        return false;
      }
      signIn({
        id: selected.id,
        name: selected.name,
        roleName: selected.roles?.name ?? "—",
        permissions: selected.roles?.permissions ?? [],
      });
      toast.success(t("auth.welcome", { name: selected.name }));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("auth.signInFailed"));
      return false;
    }
  }

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-8 bg-background p-6">
      <div className="flex items-center gap-3">
        <UtensilsCrossed className="h-10 w-10 text-primary" />
        <span className="text-3xl font-semibold">{t("nav.brand")}</span>
      </div>

      {error && (
        <p className="max-w-md text-center text-sm text-destructive">{error}</p>
      )}

      {!selected ? (
        <>
          <p className="text-muted-foreground">{t("auth.whosWorking")}</p>
          <div className="grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
            {loading &&
              Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-32 w-40 animate-pulse rounded-xl bg-muted"
                />
              ))}
            {staff.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelected(u)}
                className="flex h-32 w-40 flex-col items-center justify-center gap-2 rounded-xl border-2 bg-card transition-colors hover:bg-accent active:scale-[0.98]"
              >
                <UserRound className="h-10 w-10 text-muted-foreground" />
                <span className="font-semibold">{u.name}</span>
                <span className="text-xs text-muted-foreground">
                  {u.roles?.name}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl font-semibold">{selected.name}</span>
            <span className="text-sm text-muted-foreground">
              {t("auth.enterPin")}
            </span>
          </div>
          <PinPad onComplete={handlePin} />
          <Button
            variant="ghost"
            className="h-12"
            onClick={() => setSelected(null)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> {t("auth.differentUser")}
          </Button>
        </>
      )}
    </div>
  );
}
