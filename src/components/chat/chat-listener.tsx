"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { chatRouteFor } from "@/lib/mobile-route";
import { useAuthStore } from "@/stores/auth-store";
import { useChatStore } from "@/stores/chat-store";

/**
 * Headless app-wide chat wiring: starts/stops the realtime subscription with
 * the signed-in user and toasts incoming messages while you're not on /chat.
 * Mounted once in the root layout.
 */
export function ChatListener() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const init = useChatStore((s) => s.init);
  const teardown = useChatStore((s) => s.teardown);
  const setOnIncoming = useChatStore((s) => s.setOnIncoming);

  useEffect(() => {
    if (!userId) {
      teardown();
      return;
    }
    init(userId);
  }, [userId, init, teardown]);

  useEffect(() => {
    setOnIncoming((m) => {
      // Whichever UI the user is in, don't toast a message they are already
      // looking at — including inside a thread (/chat/… or /m/chat/…).
      const chatRoute = chatRouteFor(pathRef.current);
      if (
        pathRef.current === chatRoute ||
        pathRef.current.startsWith(`${chatRoute}/`)
      ) {
        return;
      }
      const sender = useChatStore
        .getState()
        .staff.find((u) => u.id === m.sender_id);
      const title = `${sender?.name ?? "Staff"}${m.recipient_id === null ? " · team" : ""}`;
      const preview = m.body.length > 80 ? `${m.body.slice(0, 80)}…` : m.body;
      toast(title, {
        description: preview,
        action: {
          label: "Open",
          onClick: () => router.push(chatRouteFor(pathRef.current)),
        },
      });
    });
    return () => setOnIncoming(null);
  }, [router, setOnIncoming]);

  return null;
}
