ALTER TYPE "public"."usage_kind" ADD VALUE 'whatsapp_message';--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "external_business_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_kind_reference_unique" ON "usage_records" USING btree ("kind","reference");