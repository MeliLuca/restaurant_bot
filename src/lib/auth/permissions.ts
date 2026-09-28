// Known permission keys. Roles store an arbitrary subset (text[] in the DB),
// so new keys added here automatically appear as toggles in Settings.
export const PERMISSIONS = [
  {
    key: "manage_tables",
    label: "Update table status",
    description: "Seat guests, mark tables dirty or clean",
  },
  {
    key: "manage_reservations",
    label: "Manage reservations",
    description: "Create, seat, and cancel bookings",
  },
  {
    key: "take_orders",
    label: "Take orders",
    description: "Use the POS to build tickets and send to kitchen",
  },
  {
    key: "view_takeaway",
    label: "Take-away screen",
    description: "See and work the take-away board, on the till and on a phone",
  },
  {
    key: "checkout_orders",
    label: "Checkout & payments",
    description: "Close orders and take payment",
  },
  {
    key: "override_price",
    label: "Override line prices",
    description:
      "Change what a single ticket line is charged; ingredient edits stay open to everyone",
  },
  {
    key: "manage_staff",
    label: "Manage staff & roles",
    description: "Create users and roles, edit permissions",
  },
  {
    key: "manage_menu",
    label: "Manage menu",
    description: "Add and edit menu items, prices, and their ingredients",
  },
  {
    key: "manage_floor",
    label: "Manage floor layout",
    description: "Add and remove tables, manage feature tags",
  },
  {
    key: "manage_availability",
    label: "Manage availability",
    description: "Mark ingredients out of stock to disable items for the night",
  },
  {
    key: "manage_printers",
    label: "Manage printers",
    description: "Configure network printers, ticket layouts, and receipt text",
  },
  {
    key: "edit_print_texts",
    label: "Edit print texts",
    description:
      "Change the fixed texts of print templates (headers, greeting, notes) without touching the layout",
  },
  {
    key: "view_stats",
    label: "View stats",
    description: "See the night's sales totals, items ordered, and past bills",
  },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
