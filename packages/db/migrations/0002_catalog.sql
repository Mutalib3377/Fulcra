CREATE TYPE "public"."brand_font" AS ENUM('clean', 'modern', 'friendly', 'elegant', 'bold');--> statement-breakpoint
CREATE TYPE "public"."brand_voice" AS ENUM('friendly', 'professional', 'playful');--> statement-breakpoint
CREATE TYPE "public"."product_source" AS ENUM('manual', 'shopify', 'woocommerce', 'csv', 'url');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_reason" AS ENUM('initial', 'adjustment', 'sale', 'cancellation', 'return', 'import');--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"logo" jsonb,
	"primary_colour" text DEFAULT '#0f6b55' NOT NULL,
	"accent_colour" text DEFAULT '#f5a524' NOT NULL,
	"font" "brand_font" DEFAULT 'clean' NOT NULL,
	"voice" "brand_voice" DEFAULT 'friendly' NOT NULL,
	"voice_notes" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kits_business_id_unique" UNIQUE("business_id"),
	CONSTRAINT "brand_kits_primary_colour_hex" CHECK (primary_colour ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "brand_kits_accent_colour_hex" CHECK (accent_colour ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "brand_kits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"size" text,
	"colour" text,
	"sku" text,
	"stock" integer DEFAULT 0 NOT NULL,
	"price_override" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "product_variants_stock_not_negative" CHECK ("product_variants"."stock" >= 0),
	CONSTRAINT "product_variants_price_override_valid" CHECK ("product_variants"."price_override" is null or "product_variants"."price_override" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retail_price" integer NOT NULL,
	"wholesale_price" integer,
	"wholesale_min_qty" integer,
	"min_price" integer,
	"low_stock_threshold" integer DEFAULT 3 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"source" "product_source" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "products_retail_price_positive" CHECK ("products"."retail_price" >= 0),
	CONSTRAINT "products_wholesale_complete" CHECK (("products"."wholesale_price" is null) = ("products"."wholesale_min_qty" is null)),
	CONSTRAINT "products_wholesale_valid" CHECK ("products"."wholesale_price" is null or ("products"."wholesale_price" >= 0 and "products"."wholesale_min_qty" >= 2)),
	CONSTRAINT "products_min_price_valid" CHECK ("products"."min_price" is null or "products"."min_price" >= 0),
	CONSTRAINT "products_low_stock_threshold_valid" CHECK ("products"."low_stock_threshold" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"change" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"reason" "stock_movement_reason" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_change_not_zero" CHECK ("stock_movements"."change" <> 0),
	CONSTRAINT "stock_movements_stock_after_valid" CHECK ("stock_movements"."stock_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_fk" FOREIGN KEY ("product_id","business_id") REFERENCES "public"."products"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_fk" FOREIGN KEY ("variant_id","business_id") REFERENCES "public"."product_variants"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_options_unique" ON "product_variants" USING btree ("product_id",lower(coalesce("size", '')),lower(coalesce("colour", ''))) WHERE "product_variants"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_unique" ON "product_variants" USING btree ("business_id",lower("sku")) WHERE "product_variants"."sku" is not null and "product_variants"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_external_id_unique" ON "products" USING btree ("business_id","source","external_id") WHERE "products"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "products_business_category_idx" ON "products" USING btree ("business_id","category");--> statement-breakpoint
CREATE INDEX "stock_movements_variant_idx" ON "stock_movements" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE POLICY "brand_kits_tenant_isolation" ON "brand_kits" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("brand_kits"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("brand_kits"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "product_variants_tenant_isolation" ON "product_variants" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("product_variants"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("product_variants"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("products"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("products"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "stock_movements_tenant_isolation" ON "stock_movements" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("stock_movements"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("stock_movements"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);