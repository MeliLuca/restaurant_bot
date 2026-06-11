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
    key: "checkout_orders",
    label: "Checkout & payments",
    description: "Close orders and take payment",
  },
  {
    key: "manage_staff",
    label: "Manage staff & roles",
    description: "Create users and roles, edit permissions",
  },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
