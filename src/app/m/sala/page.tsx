import { HostStand } from "@/mobile/components/host-stand";
import type { HostStandTab } from "@/mobile/lib/routes";

const TABS: HostStandTab[] = ["find", "queue", "today"];

export default function MobileHostStandPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = TABS.find((x) => x === searchParams.tab) ?? "find";
  return <HostStand initialTab={tab} />;
}
