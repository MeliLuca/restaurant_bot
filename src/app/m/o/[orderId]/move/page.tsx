import { MoveScreen } from "@/mobile/components/move-screen";

export default function MobileMovePage({
  params,
}: {
  params: { orderId: string };
}) {
  return <MoveScreen orderId={params.orderId} />;
}
