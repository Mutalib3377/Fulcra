CREATE TYPE "public"."business_category" AS ENUM('fashion', 'beauty', 'food', 'gadgets', 'other');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'staff', 'rider');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"category" "business_category" NOT NULL,
	"whatsapp_number" text NOT NULL,
	"timezone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"has_external_website" boolean DEFAULT false NOT NULL,
	"website_url" text,
	"paystack_subaccount_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_subdomain_unique" UNIQUE("subdomain"),
	CONSTRAINT "businesses_subdomain_format" CHECK ("businesses"."subdomain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
);
--> statement-breakpoint
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "member_invites_not_owner" CHECK ("member_invites"."role" <> 'owner')
);
--> statement-breakpoint
ALTER TABLE "member_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_business_user_unique" UNIQUE("business_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_invites_business_id_idx" ON "member_invites" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "members_user_id_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "businesses_tenant_isolation" ON "businesses" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("businesses"."id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("businesses"."id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "member_invites_tenant_isolation" ON "member_invites" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("member_invites"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("member_invites"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "members_tenant_isolation" ON "members" AS PERMISSIVE FOR ALL TO "fulcra_app" USING ("members"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK ("members"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid);