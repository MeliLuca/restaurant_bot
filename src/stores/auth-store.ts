import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Permission } from "@/lib/auth/permissions";

export interface AuthUser {
  id: string;
  name: string;
  roleName: string;
  permissions: string[];
}

interface AuthState {
  user: AuthUser | null;
  signIn: (user: AuthUser) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      signIn: (user) => set({ user }),
      signOut: () => set({ user: null }),
    }),
    { name: "rms-auth" },
  ),
);

export function usePermission(permission: Permission): boolean {
  return useAuthStore(
    (s) => s.user?.permissions.includes(permission) ?? false,
  );
}
