"use client";

import { useRouter } from "next/navigation";
import { ConversationList } from "@/components/chat/conversation-list";
import { useT } from "@/lib/i18n/use-translation";
import { useAuthStore } from "@/stores/auth-store";
import { useChatStore } from "@/stores/chat-store";
import { mRoutes } from "@/mobile/lib/routes";
import { MHeader, DesktopSwitch } from "./m-header";

/**
 * Conversation list.
 *
 * ConversationList and MessageThread are reused from @/components/chat rather
 * than reimplemented — the documented exception to the "no desktop components"
 * boundary. They are already phone-shaped (64px rows, back button below `sm`,
 * bubbles at 80% width) and carry no POS coupling: the store does the work.
 *
 * The only real difference here is that selecting a conversation is a *route*,
 * not local state, which is what gives the thread the OS back gesture.
 */
export function ChatList() {
  const t = useT();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const messages = useChatStore((s) => s.messages);
  const reads = useChatStore((s) => s.reads);
  const staff = useChatStore((s) => s.staff);
  const ready = useChatStore((s) => s.ready);

  return (
    <>
      <MHeader title={t("m.tabChat")} action={<DesktopSwitch />} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!user || !ready ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : (
          <ConversationList
            userId={user.id}
            staff={staff}
            messages={messages}
            reads={reads}
            selected={null}
            onSelect={(conversation) =>
              router.push(mRoutes.thread(conversation))
            }
          />
        )}
      </div>
    </>
  );
}
