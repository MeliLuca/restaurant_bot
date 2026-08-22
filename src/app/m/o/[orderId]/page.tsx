import { BillView } from "@/mobile/components/bill-view";

export default function MobileBillPage({
  params,
}: {
  params: { orderId: string };
}) {
  return <BillView orderId={params.orderId} />;
}
