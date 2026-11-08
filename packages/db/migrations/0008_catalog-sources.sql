CREATE TYPE "public"."catalog_source_kind" AS ENUM('shopify', 'woocommerce');--> statement-breakpoint
CREATE TYPE "public"."catalog_source_status" AS ENUM('connected', 'error', 'disconnected');--> statement-breakpoint
CREATE TABLE "catalog_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "catalog_source_kind" NOT NULL,
	"status" "catalog_source_status" DEFAULT 'connected' NOT NULL,
	"shop_url" text NOT NULL,
	"credentials" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_sources_business_kind_unique" UNIQUE("business_id","kind"),
	CONSTRAINT "catalog_sources_id_business_unique" UNIQUE("id","business_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_sources" ADD CONSTRAINT "catalog_sources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_sources_kind_shop_idx" ON "catalog_sources" USING btree ("kind","shop_url");--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_source_fk" FOREIGN KEY ("source_id","business_id") REFERENCES "public"."catalog_sources"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "catalog_sources_tenant_isolation" ON "catalog_sources" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("catalog_sources"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("catalog_sources"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);