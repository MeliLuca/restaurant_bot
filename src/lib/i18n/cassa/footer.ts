// Cassa (POS) — strings of the ticket footer. Owned by that part only.
// Keys are read as "cassa.footer.<key>"; add every key to both it and en.

export const it = {
  sendCount: "Invia in cucina ({count})",
  split: "Dividi",
};

export const en: typeof it = {
  sendCount: "Send to kitchen ({count})",
  split: "Split",
};
