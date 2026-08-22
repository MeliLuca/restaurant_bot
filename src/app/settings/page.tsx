"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RolesManager } from "@/components/settings/roles-manager";
import { SettingsNav } from "@/components/settings/settings-nav";
import { UiModeCard } from "@/components/settings/ui-mode-card";
import { UsersManager } from "@/components/settings/users-manager";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/use-translation";
import { useLangStore, type Lang } from "@/lib/i18n/store";
import { fetchRoles, fetchStaff, type StaffMember } from "@/lib/staff-api";
import type { Role } from "@/lib/database.types";
import { useAuthStore, usePermission } from "@/stores/auth-store";

export default function SettingsPage() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const user = useAuthStore((s) => s.user);
  const canManageStaff = usePermission("manage_staff");
  const [roles, setRoles] = useState<Role[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canManageStaff) {
      setLoading(false);
      return;
    }
    try {
      const [r, s] = await Promise.all([fetchRoles(), fetchStaff()]);
      setRoles(r);
      setStaff(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.loadStaffFailed"));
    } finally {
      setLoading(false);
    }
  }, [canManageStaff, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <SettingsNav />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("settings.language")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
            <SelectTrigger className="h-11 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="it">{t("settings.italian")}</SelectItem>
              <SelectItem value="en">{t("settings.english")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t("settings.languageHelp")}
          </span>
        </CardContent>
      </Card>

      <UiModeCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5" />{" "}
            {t("settings.signedInAs", { name: user?.name ?? "" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("settings.role", { role: user?.roleName ?? "" })}
          </span>
          {PERMISSIONS.filter((p) =>
            user?.permissions.includes(p.key),
          ).map((p) => (
            <Badge key={p.key} variant="secondary">
              {t(`perm.${p.key}.label`)}
            </Badge>
          ))}
          {user?.permissions.length === 0 && (
            <span className="text-sm text-muted-foreground">
              {t("settings.noPermissions")}
            </span>
          )}
        </CardContent>
      </Card>

      {!canManageStaff ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {t("settings.staffRolesRequiresPerm")}
          </CardContent>
        </Card>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => refresh()}>{t("common.retry")}</Button>
        </div>
      ) : loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : (
        <>
          <UsersManager roles={roles} staff={staff} onChanged={refresh} />
          <RolesManager roles={roles} staff={staff} onChanged={refresh} />
        </>
      )}
    </div>
  );
}
