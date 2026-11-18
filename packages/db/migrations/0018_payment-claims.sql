CREATE TYPE "public"."payment_claim_source" AS ENUM('screenshot', 'customer_said');--> statement-breakpoint
CREATE TYPE "public"."payment_claim_status" AS ENUM('waiting', 'confirmed', 'not_received', 'dismissed');--> statement-breakpoint
CREATE TABLE "payment_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"conversation_id" uuid,
	"message_id" uuid,
	"source" "payment_claim_source" NOT NULL,
	"status" "payment_claim_status" DEFAULT 'waiting' NOT NULL,
	"claimed_amount" integer,
	"bank" text,
	"sender_name" text,
	"reference" text,
	"claimed_paid_at" timestamp with time zone,
	"image" jsonb,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"received_amount" integer,
	"confirmed_at" timestamp with time zone,
	"not_received_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_customer_fk" FOREIGN KEY ("customer_id","business_id") REFERENCES "public"."customers"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_order_fk" FOREIGN KEY ("order_id","business_id") REFERENCES "public"."orders"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_conversation_fk" FOREIGN KEY ("conversation_id","business_id") REFERENCES "public"."conversations"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_message_fk" FOREIGN KEY ("message_id","business_id") REFERENCES "public"."messages"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_claims_message_unique" ON "payment_claims" USING btree ("business_id","message_id") WHERE "payment_claims"."message_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_claims_business_status_idx" ON "payment_claims" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "payment_claims_order_idx" ON "payment_claims" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_claims_reference_idx" ON "payment_claims" USING btree ("business_id","reference") WHERE "payment_claims"."reference" is not null;--> statement-breakpoint
CREATE POLICY "payment_claims_tenant_isolation" ON "payment_claims" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("payment_claims"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("payment_claims"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);