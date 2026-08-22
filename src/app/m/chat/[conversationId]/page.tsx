import { ChatThread } from "@/mobile/components/chat-thread";

export default function MobileChatThreadPage({
  params,
}: {
  params: { conversationId: string };
}) {
  return <ChatThread conversationId={params.conversationId} />;
}
