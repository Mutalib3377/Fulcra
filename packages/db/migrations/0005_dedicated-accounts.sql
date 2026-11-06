CREATE TYPE "public"."dedicated_account_status" AS ENUM('pending', 'active', 'failed');--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'unmatched';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'dismissed';--> statement-breakpoint
CREATE TABLE "dedicated_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" "payment_provider" DEFAULT 'paystack' NOT NULL,
	"provider_customer_code" text,
	"account_number" text,
	"account_name" text,
	"bank_name" text,
	"status" "dedicated_account_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dedicated_accounts_customer_unique" UNIQUE("business_id","customer_id"),
	CONSTRAINT "dedicated_accounts_provider_customer_unique" UNIQUE("provider","provider_customer_code"),
	CONSTRAINT "dedicated_accounts_account_number_unique" UNIQUE("provider","account_number")
);
--> statement-breakpoint
ALTER TABLE "dedicated_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "dedicated_accounts" ADD CONSTRAINT "dedicated_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedicated_accounts" ADD CONSTRAINT "dedicated_accounts_customer_fk" FOREIGN KEY ("customer_id","business_id") REFERENCES "public"."customers"("id","business_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_fk" FOREIGN KEY ("customer_id","business_id") REFERENCES "public"."customers"("id","business_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_customer_idx" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE POLICY "dedicated_accounts_tenant_isolation" ON "dedicated_accounts" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("dedicated_accounts"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("dedicated_accounts"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);