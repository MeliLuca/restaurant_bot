// Assistente AI — the model names a chat after its first answer, like a
// normal chat app. Runs after the reply has gone out; until it lands (or if
// the model is down) the chat keeps the first words of its first message.

import { chatText, tryAi } from "../ollama";
import { setGeneratedTitle } from "./store";

/** "«Tavolo per 6 con la partita».\n" → "Tavolo per 6 con la partita" */
export function cleanTitle(raw: string): string | null {
  const line = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const t = line
    .replace(/^(titolo|title)\s*:\s*/i, "")
    .replace(/^["'«“*#\s]+|["'»”*.\s]+$/g, "")
    .trim();
  if (t.length < 3) return null;
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t;
}

export async function nameConversation(
  conversationId: string,
  question: string,
  reply: string,
): Promise<void> {
  const result = await tryAi(() =>
    chatText(
      [
        {
          role: "system",
          content:
            "Dai un titolo a questa conversazione tra il personale di un ristorante e l'assistente: " +
            "da 2 a 5 parole, in italiano, senza virgolette e senza punto finale. Rispondi solo con il titolo.",
        },
        {
          role: "user",
          content: `Domanda: ${question.slice(0, 300)}\nRisposta: ${reply.slice(0, 300)}`,
        },
      ],
      { numPredict: 16, temperature: 0.2 },
    ),
  );
  const title = result ? cleanTitle(result.data) : null;
  if (title) await setGeneratedTitle(conversationId, title);
}
