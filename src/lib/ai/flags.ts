// The Assistente AI is a PROTOTYPE. It exists only where the build says so:
// without NEXT_PUBLIC_AI_PROTOTYPE=1 (client) / AI_PROTOTYPE=1 (server) no
// menu entry, no card and no /api/ai route is there — whatever the database
// switch says. Safe to import from client and server code.

/** Client side: may the UI show the module at all? (inlined at build time) */
export const AI_PROTOTYPE_UI = process.env.NEXT_PUBLIC_AI_PROTOTYPE === "1";
