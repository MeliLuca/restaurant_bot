import { TakeawayOrderScreen } from "@/mobile/components/takeaway-order-screen";

export default function MobileTakeawayOrderPage({
  params,
}: {
  params: { orderId: string };
}) {
  return <TakeawayOrderScreen orderId={params.orderId} />;
}
