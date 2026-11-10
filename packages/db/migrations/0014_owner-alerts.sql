CREATE TYPE "public"."owner_alert_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed', 'not_sent');--> statement-breakpoint
CREATE TABLE "owner_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"event_id" uuid,
	"to_phone" text NOT NULL,
	"params" text[] DEFAULT '{}'::text[] NOT NULL,
	"text" text NOT NULL,
	"status" "owner_alert_status" DEFAULT 'pending' NOT NULL,
	"external_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_notification_settings" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"owner_whatsapp" text,
	"alert_paid_orders" boolean DEFAULT true NOT NULL,
	"alert_low_stock" boolean DEFAULT true NOT NULL,
	"alert_unmatched_payments" boolean DEFAULT true NOT NULL,
	"alert_waiting_customers" boolean DEFAULT true NOT NULL,
	"briefing_enabled" boolean DEFAULT true NOT NULL,
	"briefing_time" text DEFAULT '08:00' NOT NULL,
	"customer_messages_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_notification_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"category" text DEFAULT 'utility' NOT NULL,
	"body" text NOT NULL,
	"status" "template_status" DEFAULT 'not_submitted' NOT NULL,
	"external_id" text,
	"status_reason" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_templates_purpose_unique" UNIQUE("purpose")
);
--> statement-breakpoint
ALTER TABLE "platform_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "payment_options" text[] DEFAULT '{link,transfer}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "owner_alerts" ADD CONSTRAINT "owner_alerts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_notification_settings" ADD CONSTRAINT "owner_notification_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_alerts_business_key_unique" ON "owner_alerts" USING btree ("business_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_alerts_external_id_unique" ON "owner_alerts" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "owner_alerts_business_created_idx" ON "owner_alerts" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE POLICY "owner_alerts_tenant_isolation" ON "owner_alerts" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("owner_alerts"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("owner_alerts"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_notification_settings_tenant_isolation" ON "owner_notification_settings" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("owner_notification_settings"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("owner_notification_settings"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);