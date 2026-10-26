"use client";

// Assistente AI (PROTOTYPE) — one page, a chat plus one tab per task. Each
// tab is its own component (components/ai/*-tab.tsx); this file only gates
// and lays them out. Desktop only, like the rest of the prototype.

import { useState } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiChat } from "@/components/ai/chat";
import { OrderTab } from "@/components/ai/order-tab";
import { TablesTab } from "@/components/ai/tables-tab";
import { KitchenTab } from "@/components/ai/kitchen-tab";
import { AnalyticsTab } from "@/components/ai/analytics-tab";
import { useT } from "@/lib/i18n/use-translation";
import { usePermission } from "@/stores/auth-store";
import { useAiModule } from "@/stores/ai-store";

const TABS = ["chat", "order", "tables", "kitchen", "analytics"] as const;
type Tab = (typeof TABS)[number];

export default function AssistantPage() {
  const t = useT();
  const canUse = usePermission("use_ai");
  const ai = useAiModule();
  const [tab, setTab] = useState<Tab>("chat");

  if (!ai.available || (ai.loaded && !ai.enabled) || !canUse) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <p className="max-w-md text-sm text-muted-foreground">
          {!canUse ? t("ai.noPermission") : t("ai.off")}
        </p>
      </div>
    );
  }
  if (!ai.settings) {
    return <div className="m-4 h-64 animate-pulse rounded-xl bg-muted" />;
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="h-7 w-7 text-violet-600" />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {t("ai.title")}
            <Badge variant="outline" className="border-amber-500 text-amber-600">
              {t("ai.prototype")}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">{t("ai.subtitle")}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex flex-1 flex-col">
        <TabsList className="self-start">
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`ai.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="chat" className="flex-1">
          <AiChat />
        </TabsContent>
        <TabsContent value="order">
          <OrderTab settings={ai.settings} />
        </TabsContent>
        <TabsContent value="tables">
          <TablesTab />
        </TabsContent>
        <TabsContent value="kitchen">
          <KitchenTab settings={ai.settings} />
        </TabsContent>
        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
