// Hand-written to match db/schema.sql. Once a Supabase project is linked,
// regenerate with: npx supabase gen types typescript --linked > src/lib/database.types.ts

export type TableStatus = "available" | "occupied" | "dirty";
export type OrderStatus = "open" | "paid" | "cancelled";
export type OrderType = "dine_in" | "takeaway";
export type ReservationStatus = "booked" | "seated" | "cancelled" | "no_show";

export interface Database {
  public: {
    Tables: {
      tables: {
        Row: {
          id: string;
          name: string;
          capacity: number;
          status: TableStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          capacity: number;
          status?: TableStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          capacity?: number;
          status?: TableStatus;
          created_at?: string;
        };
        Relationships: [];
      };
      reservations: {
        Row: {
          id: string;
          table_id: string;
          customer_name: string;
          party_size: number;
          reserved_at: string;
          status: ReservationStatus;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          table_id: string;
          customer_name: string;
          party_size: number;
          reserved_at: string;
          status?: ReservationStatus;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          table_id?: string;
          customer_name?: string;
          party_size?: number;
          reserved_at?: string;
          status?: ReservationStatus;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reservations_table_id_fkey";
            columns: ["table_id"];
            referencedRelation: "tables";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          id: string;
          name: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          name: string;
          sort_order?: number;
        };
        Update: {
          id?: string;
          name?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      menu_items: {
        Row: {
          id: string;
          category_id: string;
          name: string;
          price: number;
          is_available: boolean;
          sort_order: number;
        };
        Insert: {
          id?: string;
          category_id: string;
          name: string;
          price: number;
          is_available?: boolean;
          sort_order?: number;
        };
        Update: {
          id?: string;
          category_id?: string;
          name?: string;
          price?: number;
          is_available?: boolean;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          id: string;
          table_id: string | null;
          order_type: OrderType;
          customer_name: string | null;
          subtable: string | null;
          status: OrderStatus;
          tax_rate: number;
          subtotal: number;
          tax: number;
          total: number;
          opened_at: string;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          table_id?: string | null;
          order_type?: OrderType;
          customer_name?: string | null;
          subtable?: string | null;
          status?: OrderStatus;
          tax_rate?: number;
          subtotal?: number;
          tax?: number;
          total?: number;
          opened_at?: string;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          table_id?: string | null;
          order_type?: OrderType;
          customer_name?: string | null;
          subtable?: string | null;
          status?: OrderStatus;
          tax_rate?: number;
          subtotal?: number;
          tax?: number;
          total?: number;
          opened_at?: string;
          closed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_table_id_fkey";
            columns: ["table_id"];
            referencedRelation: "tables";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          menu_item_id: string;
          quantity: number;
          unit_price: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          menu_item_id: string;
          quantity: number;
          unit_price: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          menu_item_id?: string;
          quantity?: number;
          unit_price?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_menu_item_id_fkey";
            columns: ["menu_item_id"];
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
        ];
      };
      table_tags: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      table_tag_links: {
        Row: {
          table_id: string;
          tag_id: string;
        };
        Insert: {
          table_id: string;
          tag_id: string;
        };
        Update: {
          table_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "table_tag_links_table_id_fkey";
            columns: ["table_id"];
            referencedRelation: "tables";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "table_tag_links_tag_id_fkey";
            columns: ["tag_id"];
            referencedRelation: "table_tags";
            referencedColumns: ["id"];
          },
        ];
      };
      ingredients: {
        Row: {
          id: string;
          name: string;
          is_available: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          is_available?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          is_available?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      menu_item_ingredients: {
        Row: {
          menu_item_id: string;
          ingredient_id: string;
        };
        Insert: {
          menu_item_id: string;
          ingredient_id: string;
        };
        Update: {
          menu_item_id?: string;
          ingredient_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "menu_item_ingredients_menu_item_id_fkey";
            columns: ["menu_item_id"];
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "menu_item_ingredients_ingredient_id_fkey";
            columns: ["ingredient_id"];
            referencedRelation: "ingredients";
            referencedColumns: ["id"];
          },
        ];
      };
      roles: {
        Row: {
          id: string;
          name: string;
          permissions: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          permissions?: string[];
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          permissions?: string[];
          created_at?: string;
        };
        Relationships: [];
      };
      app_users: {
        // pin_hash exists in the DB but is not selectable via the API
        Row: {
          id: string;
          name: string;
          role_id: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: never; // users are created via the create_app_user function
        Update: {
          name?: string;
          role_id?: string;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "app_users_role_id_fkey";
            columns: ["role_id"];
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      verify_user_pin: {
        Args: { p_user_id: string; p_pin: string };
        Returns: boolean;
      };
      create_app_user: {
        Args: { p_name: string; p_role_id: string; p_pin: string };
        Returns: string;
      };
      set_user_pin: {
        Args: { p_user_id: string; p_pin: string };
        Returns: undefined;
      };
    };
    Enums: {
      table_status: TableStatus;
      order_status: OrderStatus;
      order_type: OrderType;
      reservation_status: ReservationStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

// Convenience row aliases for app code
export type RestaurantTable = Database["public"]["Tables"]["tables"]["Row"];
export type Reservation = Database["public"]["Tables"]["reservations"]["Row"];
export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type MenuItem = Database["public"]["Tables"]["menu_items"]["Row"];
export type Order = Database["public"]["Tables"]["orders"]["Row"];
export type OrderItem = Database["public"]["Tables"]["order_items"]["Row"];
export type Role = Database["public"]["Tables"]["roles"]["Row"];
export type AppUser = Database["public"]["Tables"]["app_users"]["Row"];
export type TableTag = Database["public"]["Tables"]["table_tags"]["Row"];
export type Ingredient = Database["public"]["Tables"]["ingredients"]["Row"];
