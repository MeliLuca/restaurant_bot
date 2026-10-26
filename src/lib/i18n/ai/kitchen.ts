// Assistente AI — strings of the "kitchen" task. Owned by that task only.
// Place labels and station names reuse the kitchen.* keys of /kitchen.

export const it = {
  alertsTitle: "Ritardi cucina ({count})",
  alertsCount: "Ritardi cucina: {count}",
  alertsHide: "Nascondi i ritardi",
  seen: "Visto",
  openKitchen: "Apri cucina",
  ticket: "Comanda #{number}",
  over: "soglia {minutes} min",
  tabTitle: "Ritardi in cucina",
  tabHelp: "Piatti in preparazione da più della soglia della loro postazione. Si aggiorna ogni 30 secondi.",
  thresholds: "Soglie: cucina {kitchen} min · bar {bar} min",
  changeThresholds: "Modifica",
  summarize: "Riepilogo AI",
  none: "Nessun ritardo",
  checkedAt: "Aggiornato alle {time}",
  loadError: "Impossibile caricare i ritardi",
};

export const en: typeof it = {
  alertsTitle: "Kitchen delays ({count})",
  alertsCount: "Kitchen delays: {count}",
  alertsHide: "Hide the delays",
  seen: "Seen",
  openKitchen: "Open kitchen",
  ticket: "Ticket #{number}",
  over: "limit {minutes} min",
  tabTitle: "Kitchen delays",
  tabHelp: "Items in preparation for longer than their station's limit. Refreshes every 30 seconds.",
  thresholds: "Limits: kitchen {kitchen} min · bar {bar} min",
  changeThresholds: "Change",
  summarize: "AI summary",
  none: "No delays",
  checkedAt: "Updated at {time}",
  loadError: "Could not load the delays",
};
