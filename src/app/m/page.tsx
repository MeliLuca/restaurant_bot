import { redirect } from "next/navigation";
import { mRoutes } from "@/mobile/lib/routes";

export default function MobileHome() {
  redirect(mRoutes.tables());
}
