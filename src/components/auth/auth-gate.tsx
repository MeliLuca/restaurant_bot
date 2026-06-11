"use client";

import { useEffect, useState } from "react";
import { fetchStaff } from "@/lib/staff-api";
import { useAuthStore } from "@/stores/auth-store";
import { LockScreen } from "./lock-screen";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id);
  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);
  // the store is persisted to localStorage; render nothing until it's
  // rehydrated so the server and first client render agree
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  // refresh role/permissions from the DB so edits apply without re-login;
  // sign out users that were deactivated since their last visit
  useEffect(() => {
    if (!hydrated || !userId) return;
    fetchStaff()
      .then((staff) => {
        const fresh = staff.find((u) => u.id === userId);
        if (!fresh || !fresh.is_active) {
          signOut();
          return;
        }
        signIn({
          id: fresh.id,
          name: fresh.name,
          roleName: fresh.roles?.name ?? "—",
          permissions: fresh.roles?.permissions ?? [],
        });
      })
      .catch(() => {
        // DB unreachable: keep the cached session rather than locking out
      });
  }, [hydrated, userId, signIn, signOut]);

  if (!hydrated) return null;
  return userId ? <>{children}</> : <LockScreen />;
}
