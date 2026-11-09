CREATE TYPE "public"."connection_mode" AS ENUM('live', 'test');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('connected', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."conversation_handler" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('customer', 'agent', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('received', 'queued', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'image', 'audio', 'video', 'document', 'location', 'buttons', 'list', 'button_reply', 'unsupported');--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"tool" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"greeting" text DEFAULT '' NOT NULL,
	"away_message" text DEFAULT '' NOT NULL,
	"business_hours" jsonb,
	"policies" text DEFAULT '' NOT NULL,
	"handoff_topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_settings_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
ALTER TABLE "agent_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channel_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"mode" "connection_mode" DEFAULT 'live' NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"credentials" text,
	"status" "connection_status" DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"expires_at" timestamp with time zone,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_connections_id_business_unique" UNIQUE("id","business_id")
);
--> statement-breakpoint
ALTER TABLE "channel_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"handled_by" "conversation_handler" DEFAULT 'agent' NOT NULL,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"attention_reason" text,
	"last_customer_message_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_preview" text DEFAULT '' NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_id_business_unique" UNIQUE("id","business_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"sender" "message_sender" NOT NULL,
	"sent_by_user_id" uuid,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"media" jsonb,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_id" text,
	"status" "message_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_id_business_unique" UNIQUE("id","business_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_conversation_fk" FOREIGN KEY ("conversation_id","business_id") REFERENCES "public"."conversations"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_fk" FOREIGN KEY ("customer_id","business_id") REFERENCES "public"."customers"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connection_fk" FOREIGN KEY ("connection_id","business_id") REFERENCES "public"."channel_connections"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("conversation_id","business_id") REFERENCES "public"."conversations"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_actions_conversation_idx" ON "agent_actions" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_account_unique" ON "channel_connections" USING btree ("channel","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_open_unique" ON "conversations" USING btree ("connection_id","customer_id") WHERE "conversations"."status" = 'open';--> statement-breakpoint
CREATE INDEX "conversations_business_last_message_idx" ON "conversations" USING btree ("business_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_unique" ON "messages" USING btree ("business_id","external_id") WHERE "messages"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE POLICY "agent_actions_tenant_isolation" ON "agent_actions" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("agent_actions"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("agent_actions"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "agent_settings_tenant_isolation" ON "agent_settings" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("agent_settings"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("agent_settings"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "channel_connections_tenant_isolation" ON "channel_connections" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("channel_connections"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("channel_connections"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "conversations_tenant_isolation" ON "conversations" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("conversations"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("conversations"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "messages_tenant_isolation" ON "messages" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("messages"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("messages"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);