CREATE TYPE "public"."owner_chat_channel" AS ENUM('dashboard', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."owner_chat_message_status" AS ENUM('received', 'queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."owner_chat_sender" AS ENUM('owner', 'assistant');--> statement-breakpoint
CREATE TABLE "owner_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"sender" "owner_chat_sender" NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"image" jsonb,
	"external_id" text,
	"status" "owner_chat_message_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"channel" "owner_chat_channel" NOT NULL,
	"external_user_id" text NOT NULL,
	"pending_action" jsonb,
	"pending_expires_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_chats_id_business_unique" UNIQUE("id","business_id")
);
--> statement-breakpoint
ALTER TABLE "owner_chats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_chat_messages" ADD CONSTRAINT "owner_chat_messages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_chat_messages" ADD CONSTRAINT "owner_chat_messages_chat_fk" FOREIGN KEY ("chat_id","business_id") REFERENCES "public"."owner_chats"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_chats" ADD CONSTRAINT "owner_chats_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_chat_messages_chat_created_idx" ON "owner_chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "owner_chat_messages_business_created_idx" ON "owner_chat_messages" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_chat_messages_external_unique" ON "owner_chat_messages" USING btree ("business_id","external_id") WHERE "owner_chat_messages"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_chats_business_channel_user_unique" ON "owner_chats" USING btree ("business_id","channel","external_user_id");--> statement-breakpoint
CREATE POLICY "owner_chat_messages_tenant_isolation" ON "owner_chat_messages" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("owner_chat_messages"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("owner_chat_messages"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_chats_tenant_isolation" ON "owner_chats" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("owner_chats"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("owner_chats"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);