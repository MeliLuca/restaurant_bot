import { TableDetail } from "@/mobile/components/table-detail";

export default function MobileTablePage({
  params,
}: {
  params: { tableId: string };
}) {
  return <TableDetail tableId={params.tableId} />;
}
