CREATE TYPE "public"."usage_kind" AS ENUM('ai_call');--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"feature" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_records_business_created_idx" ON "usage_records" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE POLICY "usage_records_tenant_isolation" ON "usage_records" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("usage_records"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("usage_records"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);