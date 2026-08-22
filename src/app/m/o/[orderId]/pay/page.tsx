import { PayScreen } from "@/mobile/components/pay-screen";

export default function MobilePayPage({
  params,
}: {
  params: { orderId: string };
}) {
  return <PayScreen orderId={params.orderId} />;
}
