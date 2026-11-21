CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
CREATE INDEX "admin_actions_business_created_idx" ON "admin_actions" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_actions_created_idx" ON "admin_actions" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "admin_actions_tenant_isolation" ON "admin_actions" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("admin_actions"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("admin_actions"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);