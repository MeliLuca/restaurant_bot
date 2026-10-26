// Composes the `ai` i18n domain from one file per piece, so each task's
// strings can change without touching the others (or dictionaries.ts).
import * as common from "./common";
import * as order from "./order";
import * as tables from "./tables";
import * as kitchen from "./kitchen";
import * as analytics from "./analytics";

export const aiIt = {
  ...common.it,
  order: order.it,
  tables: tables.it,
  kitchen: kitchen.it,
  analytics: analytics.it,
};

export const aiEn: typeof aiIt = {
  ...common.en,
  order: order.en,
  tables: tables.en,
  kitchen: kitchen.en,
  analytics: analytics.en,
};
