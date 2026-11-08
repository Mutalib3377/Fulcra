CREATE TYPE "public"."catalog_import_kind" AS ENUM('csv', 'shopify', 'woocommerce', 'url');--> statement-breakpoint
CREATE TYPE "public"."catalog_import_status" AS ENUM('queued', 'fetching', 'review', 'saving', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."import_item_decision" AS ENUM('pending', 'approved', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."import_item_result" AS ENUM('created', 'updated', 'failed');--> statement-breakpoint
CREATE TABLE "catalog_import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_ref" text DEFAULT '' NOT NULL,
	"data" jsonb NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" "import_item_decision" DEFAULT 'pending' NOT NULL,
	"result" "import_item_result",
	"result_message" text,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_import_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "catalog_import_kind" NOT NULL,
	"status" "catalog_import_status" DEFAULT 'queued' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_imports_id_business_unique" UNIQUE("id","business_id"),
	CONSTRAINT "catalog_imports_counts_valid" CHECK ("catalog_imports"."processed_items" >= 0 and "catalog_imports"."processed_items" <= "catalog_imports"."total_items")
);
--> statement-breakpoint
ALTER TABLE "catalog_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_import_items" ADD CONSTRAINT "catalog_import_items_import_fk" FOREIGN KEY ("import_id","business_id") REFERENCES "public"."catalog_imports"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_import_items" ADD CONSTRAINT "catalog_import_items_product_fk" FOREIGN KEY ("product_id","business_id") REFERENCES "public"."products"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_import_items_import_idx" ON "catalog_import_items" USING btree ("import_id","position");--> statement-breakpoint
CREATE INDEX "catalog_imports_business_created_idx" ON "catalog_imports" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE POLICY "catalog_import_items_tenant_isolation" ON "catalog_import_items" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("catalog_import_items"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("catalog_import_items"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "catalog_imports_tenant_isolation" ON "catalog_imports" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("catalog_imports"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("catalog_imports"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);