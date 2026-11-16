CREATE TYPE "public"."billing_interval" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled', 'expired');--> statement-breakpoint
ALTER TYPE "public"."usage_kind" ADD VALUE 'agent_conversation';--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean,
	"limit_value" integer,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plans" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"monthly_price" integer NOT NULL,
	"annual_price" integer NOT NULL,
	"paystack_monthly_plan_code" text,
	"paystack_annual_plan_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"plan_code" text NOT NULL,
	"interval" "billing_interval" NOT NULL,
	"amount" integer NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"plan_code" text NOT NULL,
	"interval" "billing_interval" DEFAULT 'monthly' NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"pending_plan_code" text,
	"paystack_customer_code" text,
	"paystack_subscription_code" text,
	"paystack_email_token" text,
	"paystack_authorization_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_business_feature_unique" ON "entitlements" USING btree ("business_id","feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_reference_unique" ON "subscription_payments" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "subscription_payments_business_idx" ON "subscription_payments" USING btree ("business_id","paid_at");--> statement-breakpoint
CREATE INDEX "subscriptions_paystack_subscription_idx" ON "subscriptions" USING btree ("paystack_subscription_code");--> statement-breakpoint
CREATE INDEX "subscriptions_paystack_customer_idx" ON "subscriptions" USING btree ("paystack_customer_code");--> statement-breakpoint
CREATE POLICY "entitlements_tenant_isolation" ON "entitlements" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("entitlements"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("entitlements"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subscription_payments_tenant_isolation" ON "subscription_payments" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("subscription_payments"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("subscription_payments"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_isolation" ON "subscriptions" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("subscriptions"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("subscriptions"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
-- Every existing business starts a 14-day trial (with all of Growth) when billing goes live.
INSERT INTO "subscriptions" ("business_id", "plan_code", "status", "trial_ends_at")
SELECT "id", 'growth', 'trialing', now() + interval '14 days' FROM "businesses"
ON CONFLICT ("business_id") DO NOTHING;
