CREATE TYPE "public"."payment_provider" AS ENUM('paystack', 'manual');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'success', 'failed', 'needs_review');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"reference" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"method" text,
	"checkout_url" text,
	"reported_amount" integer,
	"review_reason" text,
	"paid_at" timestamp with time zone,
	"provider_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_reference_unique" UNIQUE("provider","reference"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "webhook_events_provider_event_unique" UNIQUE("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "payout_bank_code" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "payout_bank_name" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "payout_account_name" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "payout_account_last4" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "receipt_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_fk" FOREIGN KEY ("order_id","business_id") REFERENCES "public"."orders"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_business_status_idx" ON "payments" USING btree ("business_id","status");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_receipt_token_unique" UNIQUE("receipt_token");--> statement-breakpoint
CREATE POLICY "payments_tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("payments"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("payments"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);