import { OrderScreen } from "@/mobile/components/order-screen";

export default function MobileOrderPage({
  params,
  searchParams,
}: {
  params: { tableId: string };
  searchParams: { s?: string };
}) {
  // subtable travels as ?s= because it is nullable and free-text
  return (
    <OrderScreen tableId={params.tableId} subtable={searchParams.s ?? null} />
  );
}
