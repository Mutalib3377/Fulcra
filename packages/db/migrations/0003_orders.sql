CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'instagram', 'web');--> statement-breakpoint
CREATE TYPE "public"."event_actor" AS ENUM('user', 'system', 'agent', 'customer');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_method" AS ENUM('delivery', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('manual', 'whatsapp', 'instagram', 'web', 'store');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'awaiting_payment', 'paid', 'dispatched', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "customer_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_user_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text,
	"email" text,
	"address" text DEFAULT '' NOT NULL,
	"delivery_zone_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "customers_phone_e164" CHECK ("customers"."phone" is null or "customers"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fee" integer NOT NULL,
	"estimated_time" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_zones_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "delivery_zones_fee_valid" CHECK ("delivery_zones"."fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "delivery_zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_type" "event_actor" NOT NULL,
	"actor_id" uuid,
	"order_id" uuid,
	"customer_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_type_format" CHECK ("events"."type" ~ '^[a-z_]+\.[a-z_]+$')
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"variant_label" text DEFAULT '' NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"is_wholesale" boolean DEFAULT false NOT NULL,
	"line_total" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_line_total_valid" CHECK ("order_items"."unit_price" >= 0 and "order_items"."line_total" = "order_items"."quantity" * "order_items"."unit_price")
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"order_number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'new' NOT NULL,
	"channel" "order_channel" DEFAULT 'manual' NOT NULL,
	"fulfilment" "fulfilment_method" NOT NULL,
	"delivery_zone_id" uuid,
	"delivery_zone_name" text DEFAULT '' NOT NULL,
	"delivery_address" text DEFAULT '' NOT NULL,
	"subtotal" integer NOT NULL,
	"delivery_fee" integer DEFAULT 0 NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"payment_method" text,
	"notes" text DEFAULT '' NOT NULL,
	"cancel_reason" text DEFAULT '' NOT NULL,
	"paid_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "orders_number_unique" UNIQUE("business_id","order_number"),
	CONSTRAINT "orders_amounts_valid" CHECK ("orders"."subtotal" >= 0 and "orders"."delivery_fee" >= 0 and "orders"."discount" >= 0 and "orders"."amount_paid" >= 0),
	CONSTRAINT "orders_total_valid" CHECK ("orders"."total" = "orders"."subtotal" + "orders"."delivery_fee" - "orders"."discount" and "orders"."total" >= 0),
	CONSTRAINT "orders_pickup_no_fee" CHECK ("orders"."fulfilment" = 'delivery' or "orders"."delivery_fee" = 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "last_order_number" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customer_fk" FOREIGN KEY ("customer_id","business_id") REFERENCES "public"."customers"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_delivery_zone_fk" FOREIGN KEY ("delivery_zone_id","business_id") REFERENCES "public"."delivery_zones"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_order_fk" FOREIGN KEY ("order_id","business_id") REFERENCES "public"."orders"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_customer_fk" FOREIGN KEY ("customer_id","business_id") REFERENCES "public"."customers"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("order_id","business_id") REFERENCES "public"."orders"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_fk" FOREIGN KEY ("variant_id","business_id") REFERENCES "public"."product_variants"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_fk" FOREIGN KEY ("customer_id","business_id") REFERENCES "public"."customers"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_zone_fk" FOREIGN KEY ("delivery_zone_id","business_id") REFERENCES "public"."delivery_zones"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identities_unique" ON "customer_identities" USING btree ("business_id","channel","external_user_id");--> statement-breakpoint
CREATE INDEX "customer_identities_customer_idx" ON "customer_identities" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_unique" ON "customers" USING btree ("business_id","phone") WHERE "customers"."phone" is not null;--> statement-breakpoint
CREATE INDEX "customers_business_name_idx" ON "customers" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zones_name_unique" ON "delivery_zones" USING btree ("business_id",lower("name")) WHERE "delivery_zones"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "events_business_created_idx" ON "events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "events_order_idx" ON "events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "events_customer_idx" ON "events" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_business_status_idx" ON "orders" USING btree ("business_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE POLICY "customer_identities_tenant_isolation" ON "customer_identities" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("customer_identities"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("customer_identities"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "customers_tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("customers"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("customers"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "delivery_zones_tenant_isolation" ON "delivery_zones" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("delivery_zones"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("delivery_zones"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "events_tenant_isolation" ON "events" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("events"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("events"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "order_items_tenant_isolation" ON "order_items" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("order_items"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("order_items"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "orders_tenant_isolation" ON "orders" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("orders"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("orders"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);