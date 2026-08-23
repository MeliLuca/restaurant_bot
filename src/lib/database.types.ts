// Hand-written to match db/schema.sql. Once a Supabase project is linked,
// regenerate with: npx supabase gen types typescript --linked > src/lib/database.types.ts

export type TableStatus = "available" | "occupied" | "dirty";
export type OrderStatus = "open" | "paid" | "cancelled";
export type OrderType = "dine_in" | "takeaway";
export type ReservationStatus = "booked" | "seated" | "cancelled" | "no_show";
export type PrinterType = "CASSA" | "CUCINA" | "BAR";
export type PaymentKind = "even" | "items";
export type PaperSize = "80mm" | "58mm";
export type PrintJobStatus = "queued" | "sent" | "failed";

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
          target_printer_id: string | null;
          codice: string | null;
          /** True on the single row that IS the cover charge (at most one, enforced by a partial unique index) */
          is_coperto: boolean;
        };
        Insert: {
          id?: string;
          category_id: string;
          name: string;
          price: number;
          is_available?: boolean;
          sort_order?: number;
          target_printer_id?: string | null;
          codice?: string | null;
          is_coperto?: boolean;
        };
        Update: {
          id?: string;
          category_id?: string;
          name?: string;
          price?: number;
          is_available?: boolean;
          sort_order?: number;
          target_printer_id?: string | null;
          codice?: string | null;
          is_coperto?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "menu_items_target_printer_id_fkey";
            columns: ["target_printer_id"];
            referencedRelation: "printers";
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
          ticket_number: number;
          /** Per-night take-away sequence (null for dine-in) */
          delivery_number: number | null;
          /** Guests on this check; drives the coperto line. Null = never asked (legacy rows, take-away) */
          covers: number | null;
          opened_by: string | null;
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
          ticket_number?: number;
          delivery_number?: number | null;
          covers?: number | null;
          opened_by?: string | null;
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
          ticket_number?: number;
          delivery_number?: number | null;
          covers?: number | null;
          opened_by?: string | null;
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
          {
            foreignKeyName: "orders_opened_by_fkey";
            columns: ["opened_by"];
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
        ];
      };
      delivery_counter: {
        Row: { singleton: boolean; last_reset_at: string };
        Insert: { singleton?: boolean; last_reset_at?: string };
        Update: { singleton?: boolean; last_reset_at?: string };
        Relationships: [];
      };
      delivery_labels: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name: string; created_at?: string };
        Update: { id?: string; name?: string; created_at?: string };
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          menu_item_id: string;
          quantity: number;
          unit_price: number;
          notes: string | null;
          paid_by_payment_id: string | null;
          fraction_of: number | null;
          /** Kitchen display bump time; null = still to prepare */
          ready_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          menu_item_id: string;
          quantity: number;
          unit_price: number;
          notes?: string | null;
          paid_by_payment_id?: string | null;
          fraction_of?: number | null;
          ready_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          menu_item_id?: string;
          quantity?: number;
          unit_price?: number;
          notes?: string | null;
          paid_by_payment_id?: string | null;
          fraction_of?: number | null;
          ready_at?: string | null;
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
          {
            foreignKeyName: "order_items_paid_by_payment_id_fkey";
            columns: ["paid_by_payment_id"];
            referencedRelation: "order_payments";
            referencedColumns: ["id"];
          },
        ];
      };
      order_payments: {
        Row: {
          id: string;
          order_id: string;
          kind: PaymentKind;
          amount: number;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          kind: PaymentKind;
          amount: number;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          kind?: PaymentKind;
          amount?: number;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_payments_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_payments_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "app_users";
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
      modifier_groups: {
        Row: {
          id: string;
          name: string;
          min_selections: number;
          max_selections: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          min_selections?: number;
          max_selections?: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          min_selections?: number;
          max_selections?: number;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      modifiers: {
        Row: {
          id: string;
          group_id: string;
          name: string;
          price_adjustment: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          name: string;
          price_adjustment?: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          name?: string;
          price_adjustment?: number;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "modifiers_group_id_fkey";
            columns: ["group_id"];
            referencedRelation: "modifier_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      menu_item_modifier_groups: {
        Row: {
          menu_item_id: string;
          group_id: string;
        };
        Insert: {
          menu_item_id: string;
          group_id: string;
        };
        Update: {
          menu_item_id?: string;
          group_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "menu_item_modifier_groups_menu_item_id_fkey";
            columns: ["menu_item_id"];
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "menu_item_modifier_groups_group_id_fkey";
            columns: ["group_id"];
            referencedRelation: "modifier_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      order_item_modifiers: {
        // name/price_adjustment are order-time snapshots; modifier_id is
        // informational only and nulls out if the menu modifier is deleted
        Row: {
          id: string;
          order_item_id: string;
          modifier_id: string | null;
          name: string;
          price_adjustment: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_item_id: string;
          modifier_id?: string | null;
          name: string;
          price_adjustment: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_item_id?: string;
          modifier_id?: string | null;
          name?: string;
          price_adjustment?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey";
            columns: ["order_item_id"];
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_item_modifiers_modifier_id_fkey";
            columns: ["modifier_id"];
            referencedRelation: "modifiers";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          sender_id: string;
          recipient_id: string | null;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          recipient_id?: string | null;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          sender_id?: string;
          recipient_id?: string | null;
          body?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_recipient_id_fkey";
            columns: ["recipient_id"];
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_reads: {
        Row: {
          user_id: string;
          conversation: string;
          last_read_at: string;
        };
        Insert: {
          user_id: string;
          conversation: string;
          last_read_at?: string;
        };
        Update: {
          user_id?: string;
          conversation?: string;
          last_read_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_reads_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
        ];
      };
      printers: {
        Row: {
          id: string;
          name: string;
          local_ip: string;
          port: number;
          paper_size: PaperSize;
          printer_type: PrinterType;
          is_active: boolean;
          print_prices: boolean;
          print_grand_total: boolean;
          print_legal_footer: boolean;
          header_text: string;
          footer_text: string;
          extra_feed_lines: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          local_ip: string;
          port?: number;
          paper_size?: PaperSize;
          printer_type: PrinterType;
          is_active?: boolean;
          print_prices?: boolean;
          print_grand_total?: boolean;
          print_legal_footer?: boolean;
          header_text?: string;
          footer_text?: string;
          extra_feed_lines?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          local_ip?: string;
          port?: number;
          paper_size?: PaperSize;
          printer_type?: PrinterType;
          is_active?: boolean;
          print_prices?: boolean;
          print_grand_total?: boolean;
          print_legal_footer?: boolean;
          header_text?: string;
          footer_text?: string;
          extra_feed_lines?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      restaurant_settings: {
        // Singleton: exactly one row, primary key is the constant `true`.
        Row: {
          id: boolean;
          business_name: string;
          address: string;
          vat_number: string;
          phone: string;
          receipt_greeting: string;
          legal_footer: string;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          business_name?: string;
          address?: string;
          vat_number?: string;
          phone?: string;
          receipt_greeting?: string;
          legal_footer?: string;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          business_name?: string;
          address?: string;
          vat_number?: string;
          phone?: string;
          receipt_greeting?: string;
          legal_footer?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      print_jobs: {
        // payload is bytea: PostgREST expects/returns it hex-encoded ("\x1b40…")
        Row: {
          id: string;
          printer_id: string;
          order_id: string | null;
          payload: string;
          status: PrintJobStatus;
          attempts: number;
          last_error: string | null;
          created_at: string;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          printer_id: string;
          order_id?: string | null;
          payload: string;
          status?: PrintJobStatus;
          attempts?: number;
          last_error?: string | null;
          created_at?: string;
          sent_at?: string | null;
        };
        Update: {
          id?: string;
          printer_id?: string;
          order_id?: string | null;
          payload?: string;
          status?: PrintJobStatus;
          attempts?: number;
          last_error?: string | null;
          created_at?: string;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "print_jobs_printer_id_fkey";
            columns: ["printer_id"];
            referencedRelation: "printers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "print_jobs_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
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
      printer_type: PrinterType;
      paper_size: PaperSize;
      print_job_status: PrintJobStatus;
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
export type OrderPayment = Database["public"]["Tables"]["order_payments"]["Row"];
export type Role = Database["public"]["Tables"]["roles"]["Row"];
export type AppUser = Database["public"]["Tables"]["app_users"]["Row"];
export type TableTag = Database["public"]["Tables"]["table_tags"]["Row"];
export type Ingredient = Database["public"]["Tables"]["ingredients"]["Row"];
export type ModifierGroup =
  Database["public"]["Tables"]["modifier_groups"]["Row"];
export type Modifier = Database["public"]["Tables"]["modifiers"]["Row"];
export type OrderItemModifier =
  Database["public"]["Tables"]["order_item_modifiers"]["Row"];
export type ChatMessage = Database["public"]["Tables"]["messages"]["Row"];
export type ChatRead = Database["public"]["Tables"]["chat_reads"]["Row"];
export type Printer = Database["public"]["Tables"]["printers"]["Row"];
export type RestaurantSettings =
  Database["public"]["Tables"]["restaurant_settings"]["Row"];
export type PrintJob = Database["public"]["Tables"]["print_jobs"]["Row"];
