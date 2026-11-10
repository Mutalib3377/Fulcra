CREATE TYPE "public"."template_status" AS ENUM('not_submitted', 'pending', 'approved', 'rejected', 'paused', 'disabled');--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"category" text DEFAULT 'utility' NOT NULL,
	"body" text NOT NULL,
	"status" "template_status" DEFAULT 'not_submitted' NOT NULL,
	"external_id" text,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_connection_fk" FOREIGN KEY ("connection_id","business_id") REFERENCES "public"."channel_connections"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_connection_name_unique" ON "message_templates" USING btree ("connection_id","name","language");--> statement-breakpoint
CREATE POLICY "message_templates_tenant_isolation" ON "message_templates" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("message_templates"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("message_templates"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);