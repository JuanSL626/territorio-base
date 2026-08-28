CREATE TYPE "public"."analysis_status" AS ENUM('pending', 'running', 'ok', 'partial', 'error');--> statement-breakpoint
CREATE TABLE "analysis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"aoi_geojson" jsonb NOT NULL,
	"area_ha" real,
	"status" "analysis_status" DEFAULT 'pending' NOT NULL,
	"result_json" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" bigint,
	"last_request" bigint
);
--> statement-breakpoint
ALTER TABLE "rate_limit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analysis" ADD CONSTRAINT "analysis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_user_id_created_at_idx" ON "analysis" USING btree ("user_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "analysis_raster_job_id_idx" ON "analysis" USING btree (("result_json" ->> 'raster_job_id'));--> statement-breakpoint
CREATE INDEX "analysis_coastal_cache_key_idx" ON "analysis" USING btree (("result_json" -> 'coastal' ->> 'cache_key'));--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_unique" ON "rate_limit" USING btree ("key");