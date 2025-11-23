

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_part_to_build"("build_uuid" "uuid", "part_id" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE public.builds 
    SET part_ids = array_append(part_ids, part_id)
    WHERE id = build_uuid
    AND NOT (part_id = ANY(part_ids)); -- Don't add duplicates
END;
$$;


ALTER FUNCTION "public"."add_part_to_build"("build_uuid" "uuid", "part_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_purchasing_to_build"("build_uuid" "uuid", "purchasing_id" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Add the purchasing ID to the build's part_ids array
    UPDATE public.builds 
    SET part_ids = array_append(part_ids, purchasing_id)
    WHERE id = build_uuid 
    AND NOT (purchasing_id = ANY(part_ids)); -- Avoid duplicates
END;
$$;


ALTER FUNCTION "public"."add_purchasing_to_build"("build_uuid" "uuid", "purchasing_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."frcbet_leaderboard"() RETURNS TABLE("user_id" "uuid", "display_name" "text", "email" "text", "balance" numeric, "rank" bigint, "pool_percentage" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH user_balances_data AS (
    SELECT 
      u.id AS user_id,
      COALESCE(ub.balance, 100.00) AS balance,
      COALESCE(u.raw_user_meta_data->>'display_name', 'Anonymous') AS display_name,
      COALESCE(u.email, 'unknown@example.com') AS email
    FROM auth.users u
    LEFT JOIN public.user_balances ub ON ub.user_id = u.id
  ),
  ranked_balances AS (
    SELECT 
      user_id,
      display_name,
      email,
      balance,
      ROW_NUMBER() OVER (ORDER BY balance DESC) AS rank,
      SUM(balance) OVER () AS total_pool
    FROM user_balances_data
  )
  SELECT 
    ranked_balances.user_id,
    ranked_balances.display_name,
    ranked_balances.email,
    ranked_balances.balance,
    ranked_balances.rank,
    ROUND(
      (ranked_balances.balance / NULLIF(ranked_balances.total_pool, 0) * 100), 
      2
    ) AS pool_percentage
  FROM ranked_balances
  ORDER BY ranked_balances.rank;
$$;


ALTER FUNCTION "public"."frcbet_leaderboard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."frcbet_leaderboard"() IS 'Returns a global leaderboard of all users ranked by their balance. pool_percentage represents each user''s percentage of the total global net worth (sum of all balances). Uses SECURITY DEFINER to bypass RLS policies on user_balances table.';



CREATE OR REPLACE FUNCTION "public"."get_build_with_all_items"("build_uuid" "uuid") RETURNS TABLE("build_data" "jsonb", "parts_data" "jsonb", "purchasing_data" "jsonb")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        to_jsonb(b.*) as build_data,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'id', p.id,
                    'name', p.name,
                    'requester', p.requester,
                    'project_id', p.project_id,
                    'workflow', p.workflow,
                    'status', p.status,
                    'quantity', p.quantity,
                    'material', p.material,
                    'kitting_bin', p.kitting_bin,
                    'delivered', p.delivered,
                    'created_at', p.created_at,
                    'updated_at', p.updated_at
                )
            ) FILTER (WHERE p.id IS NOT NULL),
            '[]'::jsonb
        ) as parts_data,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'id', pur.id,
                    'name', pur.name,
                    'requester', pur.requester,
                    'project_id', pur.project_id,
                    'workflow', pur.workflow,
                    'status', pur.status,
                    'quantity', pur.quantity,
                    'material', pur.material,
                    'vendor', pur.vendor,
                    'url', pur.url,
                    'price', pur.price,
                    'final_price', pur.final_price,
                    'part_number', pur.part_number,
                    'kitting_bin', pur.kitting_bin,
                    'delivered', pur.delivered,
                    'created_at', pur.created_at,
                    'updated_at', pur.updated_at
                )
            ) FILTER (WHERE pur.id IS NOT NULL),
            '[]'::jsonb
        ) as purchasing_data
    FROM public.builds b
    LEFT JOIN public.parts p ON p.id = ANY(b.part_ids)
    LEFT JOIN public.purchasing pur ON pur.id = ANY(b.part_ids)
    WHERE b.id = build_uuid
    GROUP BY b.id, b.subsystem_id, b.release_id, b.release_name, b.build_hash, 
             b.status, b.created_by, b.created_at, b.assembled_at, b.assembled_by, b.part_ids;
END;
$$;


ALTER FUNCTION "public"."get_build_with_all_items"("build_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_build_with_parts"("build_uuid" "uuid") RETURNS TABLE("build_id" "uuid", "subsystem_id" "uuid", "release_id" character varying, "release_name" character varying, "build_hash" character varying, "status" character varying, "created_by" "uuid", "created_at" timestamp with time zone, "assembled_at" timestamp with time zone, "assembled_by" "uuid", "part_ids" integer[], "parts_data" "jsonb")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id,
        b.subsystem_id,
        b.release_id,
        b.release_name,
        b.build_hash,
        b.status,
        b.created_by,
        b.created_at,
        b.assembled_at,
        b.assembled_by,
        b.part_ids,
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', p.id,
                    'name', p.name,
                    'requester', p.requester,
                    'project_id', p.project_id,
                    'workflow', p.workflow,
                    'status', p.status,
                    'quantity', p.quantity,
                    'material', p.material,
                    'kitting_bin', p.kitting_bin,
                    'delivered', p.delivered,
                    'created_at', p.created_at,
                    'updated_at', p.updated_at
                )
            )
            FROM public.parts p
            WHERE p.id = ANY(b.part_ids)
        ) as parts_data
    FROM public.builds b
    WHERE b.id = build_uuid;
END;
$$;


ALTER FUNCTION "public"."get_build_with_parts"("build_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_onshape_download_url"("document_id" "text", "wvm" "text", "wvmid" "text", "element_id" "text", "part_id" "text", "file_format" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Construct the Onshape API URL based on file format
    IF file_format = 'stl' THEN
        RETURN '/parts/d/' || document_id || '/' || wvm || '/' || wvmid || '/e/' || element_id || '/partid/' || part_id || '/stl';
    ELSIF file_format = 'parasolid' THEN
        RETURN '/parts/d/' || document_id || '/' || wvm || '/' || wvmid || '/e/' || element_id || '/partid/' || part_id || '/parasolid';
    ELSIF file_format = 'step' THEN
        RETURN '/parts/d/' || document_id || '/' || wvm || '/' || wvmid || '/e/' || element_id || '/partid/' || part_id || '/step';
    ELSIF file_format = 'iges' THEN
        RETURN '/parts/d/' || document_id || '/' || wvm || '/' || wvmid || '/e/' || element_id || '/partid/' || part_id || '/iges';
    ELSE
        RETURN NULL;
    END IF;
END;
$$;


ALTER FUNCTION "public"."get_onshape_download_url"("document_id" "text", "wvm" "text", "wvmid" "text", "element_id" "text", "part_id" "text", "file_format" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data->>'name', new.email));
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_onshape_file_format"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.is_onshape_part = true AND NEW.file_format IS NULL THEN
        CASE NEW.workflow
            WHEN '3d-print' THEN
                NEW.file_format := 'stl';
            WHEN 'router' THEN
                NEW.file_format := 'parasolid';
            WHEN 'laser-cut' THEN
                NEW.file_format := 'parasolid';
            WHEN 'mill' THEN
                NEW.file_format := 'parasolid';
            WHEN 'lathe' THEN
                NEW.file_format := 'parasolid';
            ELSE
                NEW.file_format := 'step'; -- Default fallback
        END CASE;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_onshape_file_format"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_purchasing_budget_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_purchasing_budget_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."betting_bets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "market_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "outcome" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "shares" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "betting_bets_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "betting_bets_outcome_check" CHECK (("outcome" = ANY (ARRAY['red'::"text", 'blue'::"text"]))),
    CONSTRAINT "betting_bets_shares_check" CHECK (("shares" >= (0)::numeric))
);


ALTER TABLE "public"."betting_bets" OWNER TO "postgres";


COMMENT ON TABLE "public"."betting_bets" IS 'Executed bets with spending amount and LMSR-calculated shares';



CREATE TABLE IF NOT EXISTS "public"."betting_market_ticks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "market_id" "uuid" NOT NULL,
    "q_red" numeric DEFAULT 0 NOT NULL,
    "q_blue" numeric DEFAULT 0 NOT NULL,
    "price_red" numeric DEFAULT 0 NOT NULL,
    "price_blue" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."betting_market_ticks" OWNER TO "postgres";


COMMENT ON TABLE "public"."betting_market_ticks" IS 'Snapshot of market q and prices over time (recorded at creation and each bet)';



CREATE TABLE IF NOT EXISTS "public"."betting_markets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_key" "text" NOT NULL,
    "event_key" "text",
    "red_team_keys" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "blue_team_keys" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "b" numeric DEFAULT 50 NOT NULL,
    "q_red" numeric DEFAULT 0 NOT NULL,
    "q_blue" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "start_time" bigint,
    "winning_outcome" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "betting_markets_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'settled'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "betting_markets_winning_outcome_check" CHECK (("winning_outcome" = ANY (ARRAY['red'::"text", 'blue'::"text"])))
);


ALTER TABLE "public"."betting_markets" OWNER TO "postgres";


COMMENT ON TABLE "public"."betting_markets" IS 'LMSR markets for FRC matches (Red vs Blue)';



CREATE TABLE IF NOT EXISTS "public"."build_bom" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "build_id" "uuid" NOT NULL,
    "part_name" character varying NOT NULL,
    "part_number" character varying,
    "quantity" integer DEFAULT 1 NOT NULL,
    "part_type" character varying NOT NULL,
    "material" character varying,
    "stock_assignment" character varying,
    "workflow" character varying,
    "bounding_box_x" numeric,
    "bounding_box_y" numeric,
    "bounding_box_z" numeric,
    "onshape_part_id" character varying,
    "status" character varying DEFAULT 'pending'::character varying,
    "onshape_document_id" character varying,
    "onshape_wvm" character varying,
    "onshape_wvmid" character varying,
    "onshape_element_id" character varying,
    "file_format" character varying,
    "is_onshape_part" boolean DEFAULT false,
    "file_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "stock_assignment_custom" "text",
    "added" boolean DEFAULT false,
    "parts_id" bigint,
    "purchasing_id" bigint,
    "kitting_id" bigint,
    CONSTRAINT "build_bom_file_format_check" CHECK ((("file_format")::"text" = ANY (ARRAY[('stl'::character varying)::"text", ('parasolid'::character varying)::"text", ('step'::character varying)::"text", ('iges'::character varying)::"text"]))),
    CONSTRAINT "build_bom_part_type_check" CHECK ((("part_type")::"text" = ANY (ARRAY[('COTS'::character varying)::"text", ('manufactured'::character varying)::"text", ('other'::character varying)::"text"]))),
    CONSTRAINT "build_bom_single_relation" CHECK (((("parts_id" IS NOT NULL) AND ("purchasing_id" IS NULL) AND ("kitting_id" IS NULL)) OR (("parts_id" IS NULL) AND ("purchasing_id" IS NOT NULL) AND ("kitting_id" IS NULL)) OR (("parts_id" IS NULL) AND ("purchasing_id" IS NULL) AND ("kitting_id" IS NOT NULL)) OR (("parts_id" IS NULL) AND ("purchasing_id" IS NULL) AND ("kitting_id" IS NULL)))),
    CONSTRAINT "build_bom_status_check" CHECK ((("status")::"text" = ANY (ARRAY[('pending'::character varying)::"text", ('ordered'::character varying)::"text", ('delivered'::character varying)::"text", ('manufactured'::character varying)::"text", ('in-progress'::character varying)::"text", ('cammed'::character varying)::"text", ('complete'::character varying)::"text"])))
);


ALTER TABLE "public"."build_bom" OWNER TO "postgres";


COMMENT ON COLUMN "public"."build_bom"."added" IS 'Whether this BOM item was selected for inclusion in the build';



COMMENT ON COLUMN "public"."build_bom"."parts_id" IS 'Reference to the parts table entry (created immediately when build is created)';



COMMENT ON COLUMN "public"."build_bom"."purchasing_id" IS 'Reference to the purchasing table entry (created immediately when build is created)';



COMMENT ON COLUMN "public"."build_bom"."kitting_id" IS 'Reference to the kitting table entry (created immediately when build is created)';



CREATE TABLE IF NOT EXISTS "public"."builds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subsystem_id" "uuid",
    "release_id" character varying(255) NOT NULL,
    "release_name" character varying(255) NOT NULL,
    "build_hash" character varying(64) NOT NULL,
    "status" character varying(50) DEFAULT 'pending'::character varying,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "assembled_at" timestamp with time zone,
    "assembled_by" "uuid",
    "project_id" "text",
    CONSTRAINT "builds_status_check" CHECK ((("status")::"text" = ANY (ARRAY[('pending'::character varying)::"text", ('manufacturing'::character varying)::"text", ('ready_to_assemble'::character varying)::"text", ('assembled'::character varying)::"text"])))
);


ALTER TABLE "public"."builds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gantt_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_key" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'e2e'::"text" NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gantt_links_project_key_check" CHECK (("char_length"("project_key") > 0)),
    CONSTRAINT "no_self_link" CHECK (("source_id" <> "target_id"))
);


ALTER TABLE "public"."gantt_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gantt_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_key" "text" NOT NULL,
    "text" "text" DEFAULT ''::"text" NOT NULL,
    "start_date" timestamp with time zone NOT NULL,
    "end_date" timestamp with time zone NOT NULL,
    "progress" numeric DEFAULT 0 NOT NULL,
    "type" "text" DEFAULT 'task'::"text" NOT NULL,
    "parent_id" "uuid",
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "end_after_start" CHECK (("end_date" >= "start_date")),
    CONSTRAINT "gantt_tasks_project_key_check" CHECK (("char_length"("project_key") > 0)),
    CONSTRAINT "gantt_tasks_type_check" CHECK (("type" = ANY (ARRAY['task'::"text", 'summary'::"text", 'milestone'::"text"])))
);


ALTER TABLE "public"."gantt_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kitting" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "requester" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "material" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "workflow" "text" DEFAULT 'kit'::"text" NOT NULL,
    "kitting_bin" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kitting_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "kitting_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'kitted'::"text"]))),
    CONSTRAINT "kitting_workflow_check" CHECK (("workflow" = 'kit'::"text"))
);


ALTER TABLE "public"."kitting" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kitting_bins" (
    "bin_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."kitting_bins" OWNER TO "postgres";


ALTER TABLE "public"."kitting" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."kitting_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" bigint NOT NULL,
    "order_number" "text" NOT NULL,
    "vendor" "text",
    "total_items" integer DEFAULT 0 NOT NULL,
    "total_cost" numeric DEFAULT 0 NOT NULL,
    "shipping_cost" numeric DEFAULT 0 NOT NULL,
    "placed_by" "uuid",
    "placed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "order_total" numeric DEFAULT 0 NOT NULL,
    "delivery_date" "date"
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


ALTER TABLE "public"."orders" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."orders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."parts" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "requester" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "workflow" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "kitting_bin" "text",
    "delivered" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "material" "text" DEFAULT ''::"text" NOT NULL,
    "gcode_file_name" "text",
    "gcode_file_url" "text",
    "onshape_document_id" character varying,
    "onshape_wvm" character varying,
    "onshape_wvmid" character varying,
    "onshape_element_id" character varying,
    "onshape_part_id" character varying,
    "file_format" character varying,
    "is_onshape_part" boolean DEFAULT false,
    "cut_date" timestamp with time zone,
    "layout_x" numeric,
    "layout_y" numeric,
    "layout_rotation" numeric DEFAULT 0,
    "onshape_drawing_element_id" character varying,
    "stock_assignment" "text",
    CONSTRAINT "parts_file_format_check" CHECK ((("file_format")::"text" = ANY (ARRAY[('stl'::character varying)::"text", ('parasolid'::character varying)::"text", ('step'::character varying)::"text", ('iges'::character varying)::"text"]))),
    CONSTRAINT "parts_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "parts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in-progress'::"text", 'cammed'::"text", 'machined'::"text", 'inspected'::"text", 'deburred'::"text", 'complete'::"text"]))),
    CONSTRAINT "parts_workflow_check" CHECK (("workflow" = ANY (ARRAY['laser-cut'::"text", 'router'::"text", 'lathe'::"text", 'mill'::"text", '3d-print'::"text", 'purchase'::"text"])))
);


ALTER TABLE "public"."parts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."parts"."status" IS 'Part manufacturing status: pending -> in-progress -> cammed (router only) -> machined -> inspected -> deburred (router only) -> complete';



COMMENT ON COLUMN "public"."parts"."gcode_file_name" IS 'G-code filename for router workflow (after CAM processing)';



COMMENT ON COLUMN "public"."parts"."gcode_file_url" IS 'G-code file URL in storage for router workflow';



COMMENT ON COLUMN "public"."parts"."onshape_document_id" IS 'Onshape document ID for on-demand file retrieval';



COMMENT ON COLUMN "public"."parts"."onshape_wvm" IS 'Onshape workspace/version/microversion type (w/v/m)';



COMMENT ON COLUMN "public"."parts"."onshape_wvmid" IS 'Onshape workspace/version/microversion ID - CRITICAL for version consistency';



COMMENT ON COLUMN "public"."parts"."onshape_element_id" IS 'Onshape element ID containing the part';



COMMENT ON COLUMN "public"."parts"."onshape_part_id" IS 'Onshape part ID for the specific part';



COMMENT ON COLUMN "public"."parts"."file_format" IS 'File format to request from Onshape API (stl for 3D printing, parasolid for router)';



COMMENT ON COLUMN "public"."parts"."is_onshape_part" IS 'True if this part should be downloaded via Onshape API, false if using storage bucket';



COMMENT ON COLUMN "public"."parts"."onshape_drawing_element_id" IS 'Onshape Drawing element ID (24-char hex) used to translate to PDF for lathe/mill workflows';



CREATE SEQUENCE IF NOT EXISTS "public"."parts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."parts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."parts_id_seq" OWNED BY "public"."parts"."id";



CREATE TABLE IF NOT EXISTS "public"."predict_settings" (
    "id" "text" DEFAULT 'global'::"text" NOT NULL,
    "demo" boolean DEFAULT false NOT NULL,
    "competitions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "tab_visible" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."predict_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."predict_settings" IS 'Global settings for Predict feature (demo toggle, competitions, tab visibility)';



COMMENT ON COLUMN "public"."predict_settings"."demo" IS 'Demo mode toggle for Predict';



COMMENT ON COLUMN "public"."predict_settings"."competitions" IS 'List of active competition/event codes (e.g. 2025casj)';



COMMENT ON COLUMN "public"."predict_settings"."tab_visible" IS 'If true, Predict tab visible to all users (with CAN_SEE_ROUTES); otherwise only Spartan Predict Admins see it';



CREATE SEQUENCE IF NOT EXISTS "public"."purchasing_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."purchasing_id_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchasing" (
    "id" bigint DEFAULT "nextval"('"public"."purchasing_id_seq"'::"regclass") NOT NULL,
    "name" "text" NOT NULL,
    "requester" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "material" "text" DEFAULT ''::"text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "vendor" "text",
    "url" "text",
    "price" numeric(10,2),
    "final_price" numeric(10,2),
    "part_number" "text",
    "kitting_bin" "text",
    "delivered" boolean DEFAULT false,
    "workflow" "text" DEFAULT 'purchase'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "approved" boolean DEFAULT false NOT NULL,
    "approver" "text",
    "notes" "text",
    "purchaser" "uuid",
    "slack_channel" "text",
    "slack_ts" "text",
    "order_id" bigint,
    "shipping_cost_allocated" numeric DEFAULT 0,
    "delivery_date" "date",
    CONSTRAINT "purchasing_new_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'ordered'::"text", 'delivered'::"text", 'kitted'::"text", 'rejected'::"text"]))),
    CONSTRAINT "purchasing_new_workflow_check" CHECK (("workflow" = 'purchase'::"text")),
    CONSTRAINT "purchasing_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'ordered'::"text", 'delivered'::"text", 'kitted'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."purchasing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchasing_budgets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "scope_type" "text" NOT NULL,
    "scope_value" "text",
    "amount" numeric NOT NULL,
    "period_type" "text" DEFAULT 'fixed'::"text" NOT NULL,
    "period_interval" "text",
    "start_date" "date",
    "end_date" "date",
    "spend_mode" "text" DEFAULT 'all_costs'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "purchasing_budgets_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "purchasing_budgets_date_order" CHECK ((("end_date" IS NULL) OR ("start_date" IS NULL) OR ("start_date" <= "end_date"))),
    CONSTRAINT "purchasing_budgets_period_interval_check" CHECK ((("period_interval" IS NULL) OR ("period_interval" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'quarterly'::"text", 'yearly'::"text"])))),
    CONSTRAINT "purchasing_budgets_period_type_check" CHECK (("period_type" = ANY (ARRAY['fixed'::"text", 'recurring'::"text"]))),
    CONSTRAINT "purchasing_budgets_recurring_interval" CHECK ((("period_type" <> 'recurring'::"text") OR (("period_interval" IS NOT NULL) AND ("start_date" IS NOT NULL)))),
    CONSTRAINT "purchasing_budgets_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['overall'::"text", 'project'::"text", 'subsystem'::"text", 'build'::"text", 'build_group'::"text"]))),
    CONSTRAINT "purchasing_budgets_scope_value_required" CHECK (((("scope_type" = 'overall'::"text") AND ("scope_value" IS NULL)) OR (("scope_type" <> 'overall'::"text") AND ("scope_value" IS NOT NULL)))),
    CONSTRAINT "purchasing_budgets_spend_mode_check" CHECK (("spend_mode" = ANY (ARRAY['all_costs'::"text", 'item_only'::"text", 'shipping_only'::"text"])))
);


ALTER TABLE "public"."purchasing_budgets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."router_group_parts" (
    "group_id" "uuid" NOT NULL,
    "part_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."router_group_parts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."router_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."router_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scout_data_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_key" "text" NOT NULL,
    "match_number" integer,
    "team_key" "text" NOT NULL,
    "phase" "text",
    "event_type" "text" NOT NULL,
    "event_value" "text",
    "coral_in_robot" boolean,
    "algae_in_robot" boolean,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."scout_data_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scout_match_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scouting_type" "text" NOT NULL,
    "match_key" "text" NOT NULL,
    "team_key" "text" NOT NULL,
    "assigned_user" "uuid",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."scout_match_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scout_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "match_key" "text" NOT NULL,
    "match_number" integer,
    "team_key" "text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."scout_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_notification_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE,
    "event_type" "text" NOT NULL,
    "entity_key" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_notification_logs_pkey" PRIMARY KEY ("id")
);


ALTER TABLE "public"."user_notification_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subsystem_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subsystem_id" "uuid",
    "user_id" "uuid",
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subsystem_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subsystems" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "lead_user_id" "uuid",
    "onshape_url" "text",
    "onshape_document_id" character varying(255),
    "onshape_workspace_id" character varying(255),
    "onshape_element_id" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subsystems" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_balances" (
    "user_id" "uuid" NOT NULL,
    "balance" numeric DEFAULT 100 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_balances" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_balances" IS 'Fake currency balances per user for the betting feature';



CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "email" character varying(255),
    "full_name" character varying(255),
    "role" character varying(100) DEFAULT 'member'::character varying,
    "permissions" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "banned" boolean DEFAULT false,
    "header_tabs" "jsonb",
    "dashboard_layout" "text" DEFAULT 'grid'::"text",
    "notification_settings" "jsonb" DEFAULT '{}'::"jsonb",
    "slack_user_id" "text",
    "slack_dm_channel" "text"
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "url_base" "text" NOT NULL,
    "free_shipping" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


ALTER TABLE "public"."vendors" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."vendors_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."parts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."parts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."betting_bets"
    ADD CONSTRAINT "betting_bets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."betting_market_ticks"
    ADD CONSTRAINT "betting_market_ticks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."betting_markets"
    ADD CONSTRAINT "betting_markets_match_key_key" UNIQUE ("match_key");



ALTER TABLE ONLY "public"."betting_markets"
    ADD CONSTRAINT "betting_markets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."build_bom"
    ADD CONSTRAINT "build_bom_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_build_hash_key" UNIQUE ("build_hash");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gantt_links"
    ADD CONSTRAINT "gantt_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gantt_tasks"
    ADD CONSTRAINT "gantt_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kitting_bins"
    ADD CONSTRAINT "kitting_bins_pkey" PRIMARY KEY ("bin_id");



ALTER TABLE ONLY "public"."kitting"
    ADD CONSTRAINT "kitting_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_order_number_key" UNIQUE ("order_number");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parts"
    ADD CONSTRAINT "parts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."predict_settings"
    ADD CONSTRAINT "predict_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchasing_budgets"
    ADD CONSTRAINT "purchasing_budgets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchasing"
    ADD CONSTRAINT "purchasing_new_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."router_group_parts"
    ADD CONSTRAINT "router_group_parts_pkey" PRIMARY KEY ("group_id", "part_id");



ALTER TABLE ONLY "public"."router_groups"
    ADD CONSTRAINT "router_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scout_data_events"
    ADD CONSTRAINT "scout_data_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scout_match_assignments"
    ADD CONSTRAINT "scout_match_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scout_notes"
    ADD CONSTRAINT "scout_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subsystem_members"
    ADD CONSTRAINT "subsystem_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subsystem_members"
    ADD CONSTRAINT "subsystem_members_subsystem_id_user_id_key" UNIQUE ("subsystem_id", "user_id");



ALTER TABLE ONLY "public"."subsystems"
    ADD CONSTRAINT "subsystems_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_balances"
    ADD CONSTRAINT "user_balances_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_name_unique" UNIQUE ("name");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



CREATE INDEX "betting_bets_market_idx" ON "public"."betting_bets" USING "btree" ("market_id");



CREATE INDEX "betting_bets_user_idx" ON "public"."betting_bets" USING "btree" ("user_id");



CREATE INDEX "betting_market_ticks_created_idx" ON "public"."betting_market_ticks" USING "btree" ("created_at");



CREATE INDEX "betting_market_ticks_market_idx" ON "public"."betting_market_ticks" USING "btree" ("market_id");



CREATE INDEX "betting_markets_event_idx" ON "public"."betting_markets" USING "btree" ("event_key");



CREATE INDEX "betting_markets_status_idx" ON "public"."betting_markets" USING "btree" ("status");



CREATE INDEX "idx_build_bom_added" ON "public"."build_bom" USING "btree" ("build_id", "added");



CREATE INDEX "idx_build_bom_build_id" ON "public"."build_bom" USING "btree" ("build_id");



CREATE INDEX "idx_build_bom_kitting_id" ON "public"."build_bom" USING "btree" ("kitting_id");



CREATE INDEX "idx_build_bom_other" ON "public"."build_bom" USING "btree" ("build_id") WHERE (("part_type")::"text" = 'other'::"text");



CREATE INDEX "idx_build_bom_part_type" ON "public"."build_bom" USING "btree" ("part_type");



CREATE INDEX "idx_build_bom_parts_id" ON "public"."build_bom" USING "btree" ("parts_id");



CREATE INDEX "idx_build_bom_purchasing_id" ON "public"."build_bom" USING "btree" ("purchasing_id");



CREATE INDEX "idx_build_bom_status" ON "public"."build_bom" USING "btree" ("status");



CREATE INDEX "idx_builds_build_hash" ON "public"."builds" USING "btree" ("build_hash");



CREATE INDEX "idx_builds_project_id" ON "public"."builds" USING "btree" ("project_id");



CREATE INDEX "idx_builds_status" ON "public"."builds" USING "btree" ("status");



CREATE INDEX "idx_builds_subsystem_id" ON "public"."builds" USING "btree" ("subsystem_id");



CREATE INDEX "idx_gantt_tasks_parent" ON "public"."gantt_tasks" USING "btree" ("parent_id");



CREATE INDEX "idx_gantt_tasks_project" ON "public"."gantt_tasks" USING "btree" ("project_key");



CREATE INDEX "idx_gantt_tasks_start" ON "public"."gantt_tasks" USING "btree" ("start_date");



CREATE INDEX "idx_parts_onshape_params" ON "public"."parts" USING "btree" ("onshape_document_id", "onshape_wvmid", "onshape_element_id", "onshape_part_id") WHERE ("is_onshape_part" = true);



CREATE INDEX "idx_parts_project_id" ON "public"."parts" USING "btree" ("project_id");



CREATE INDEX "idx_parts_status" ON "public"."parts" USING "btree" ("status");



CREATE INDEX "idx_parts_status_cammed" ON "public"."parts" USING "btree" ("status") WHERE ("status" = 'cammed'::"text");



CREATE INDEX "idx_parts_workflow" ON "public"."parts" USING "btree" ("workflow");



CREATE INDEX "idx_parts_workflow_status" ON "public"."parts" USING "btree" ("workflow", "status");



CREATE INDEX "idx_purchasing_kitting_bin" ON "public"."purchasing" USING "btree" ("kitting_bin");



CREATE INDEX "idx_purchasing_project_id" ON "public"."purchasing" USING "btree" ("project_id");



CREATE INDEX "idx_purchasing_purchaser" ON "public"."purchasing" USING "btree" ("purchaser");



CREATE INDEX "idx_purchasing_status" ON "public"."purchasing" USING "btree" ("status");



CREATE INDEX "idx_purchasing_vendor" ON "public"."purchasing" USING "btree" ("vendor");



CREATE INDEX "kitting_bins_name_idx" ON "public"."kitting_bins" USING "btree" ("name");



CREATE INDEX "kitting_project_idx" ON "public"."kitting" USING "btree" ("project_id");



CREATE INDEX "kitting_status_idx" ON "public"."kitting" USING "btree" ("status");



CREATE INDEX "orders_placed_at_idx" ON "public"."orders" USING "btree" ("placed_at");



CREATE INDEX "orders_placed_by_idx" ON "public"."orders" USING "btree" ("placed_by");



CREATE INDEX "orders_vendor_idx" ON "public"."orders" USING "btree" ("vendor");



CREATE INDEX "purchasing_budgets_period_idx" ON "public"."purchasing_budgets" USING "btree" ("period_type", "period_interval");



CREATE INDEX "purchasing_budgets_scope_idx" ON "public"."purchasing_budgets" USING "btree" ("scope_type", "scope_value");



CREATE INDEX "purchasing_order_id_idx" ON "public"."purchasing" USING "btree" ("order_id");



CREATE INDEX "router_group_parts_part_id_idx" ON "public"."router_group_parts" USING "btree" ("part_id");



CREATE INDEX "scout_data_events_match_idx" ON "public"."scout_data_events" USING "btree" ("match_key");



CREATE INDEX "scout_data_events_team_idx" ON "public"."scout_data_events" USING "btree" ("team_key");



CREATE UNIQUE INDEX "scout_match_assignments_unique" ON "public"."scout_match_assignments" USING "btree" ("scouting_type", "match_key", "team_key");



CREATE INDEX "scout_match_assignments_user_idx" ON "public"."scout_match_assignments" USING "btree" ("assigned_user");



CREATE INDEX "scout_notes_match_key_idx" ON "public"."scout_notes" USING "btree" ("match_key");


CREATE UNIQUE INDEX "user_notification_logs_key" ON "public"."user_notification_logs" USING "btree" ("user_id", "event_type", "entity_key");



CREATE INDEX "scout_notes_team_key_idx" ON "public"."scout_notes" USING "btree" ("team_key");



CREATE UNIQUE INDEX "uniq_gantt_links" ON "public"."gantt_links" USING "btree" ("project_key", "source_id", "target_id");



CREATE INDEX "vendors_name_idx" ON "public"."vendors" USING "btree" ("name");



CREATE INDEX "vendors_url_base_idx" ON "public"."vendors" USING "btree" ("url_base");



CREATE OR REPLACE TRIGGER "kitting_set_updated_at" BEFORE UPDATE ON "public"."kitting" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_parts_onshape_file_format" BEFORE INSERT OR UPDATE ON "public"."parts" FOR EACH ROW EXECUTE FUNCTION "public"."set_onshape_file_format"();



CREATE OR REPLACE TRIGGER "tr_purchasing_budgets_updated_at" BEFORE UPDATE ON "public"."purchasing_budgets" FOR EACH ROW EXECUTE FUNCTION "public"."set_purchasing_budget_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_updated_at_gantt_tasks" BEFORE UPDATE ON "public"."gantt_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_touch_scout_assign" BEFORE UPDATE ON "public"."scout_match_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "update_orders_updated_at" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_parts_updated_at" BEFORE UPDATE ON "public"."parts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_purchasing_updated_at" BEFORE UPDATE ON "public"."purchasing" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."betting_bets"
    ADD CONSTRAINT "betting_bets_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."betting_markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."betting_bets"
    ADD CONSTRAINT "betting_bets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."betting_market_ticks"
    ADD CONSTRAINT "betting_market_ticks_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."betting_markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_bom"
    ADD CONSTRAINT "build_bom_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."build_bom"
    ADD CONSTRAINT "build_bom_kitting_id_fkey" FOREIGN KEY ("kitting_id") REFERENCES "public"."kitting"("id");



ALTER TABLE ONLY "public"."build_bom"
    ADD CONSTRAINT "build_bom_parts_id_fkey" FOREIGN KEY ("parts_id") REFERENCES "public"."parts"("id");



ALTER TABLE ONLY "public"."build_bom"
    ADD CONSTRAINT "build_bom_purchasing_id_fkey" FOREIGN KEY ("purchasing_id") REFERENCES "public"."purchasing"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_assembled_by_fkey" FOREIGN KEY ("assembled_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."builds"
    ADD CONSTRAINT "builds_subsystem_id_fkey" FOREIGN KEY ("subsystem_id") REFERENCES "public"."subsystems"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gantt_links"
    ADD CONSTRAINT "gantt_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."gantt_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gantt_links"
    ADD CONSTRAINT "gantt_links_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."gantt_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gantt_tasks"
    ADD CONSTRAINT "gantt_tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."gantt_tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kitting"
    ADD CONSTRAINT "kitting_kitting_bin_fkey" FOREIGN KEY ("kitting_bin") REFERENCES "public"."kitting_bins"("bin_id") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_placed_by_fkey" FOREIGN KEY ("placed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."purchasing_budgets"
    ADD CONSTRAINT "purchasing_budgets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."purchasing"
    ADD CONSTRAINT "purchasing_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."purchasing"
    ADD CONSTRAINT "purchasing_purchaser_fkey" FOREIGN KEY ("purchaser") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."router_group_parts"
    ADD CONSTRAINT "router_group_parts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."router_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."router_group_parts"
    ADD CONSTRAINT "router_group_parts_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subsystem_members"
    ADD CONSTRAINT "subsystem_members_subsystem_id_fkey" FOREIGN KEY ("subsystem_id") REFERENCES "public"."subsystems"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subsystem_members"
    ADD CONSTRAINT "subsystem_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subsystems"
    ADD CONSTRAINT "subsystems_lead_user_id_fkey" FOREIGN KEY ("lead_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_balances"
    ADD CONSTRAINT "user_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Allow all operations on parts" ON "public"."parts" USING (true) WITH CHECK (true);



CREATE POLICY "Subsystem leads can create builds" ON "public"."builds" FOR INSERT WITH CHECK (("subsystem_id" IN ( SELECT "subsystems"."id"
   FROM "public"."subsystems"
  WHERE ("subsystems"."lead_user_id" = "auth"."uid"()))));



CREATE POLICY "Subsystem leads can delete their subsystems" ON "public"."subsystems" FOR DELETE USING (("auth"."uid"() = "lead_user_id"));



CREATE POLICY "Subsystem leads can update their subsystems" ON "public"."subsystems" FOR UPDATE USING (("auth"."uid"() = "lead_user_id"));



CREATE POLICY "Subsystem members can update builds" ON "public"."builds" FOR UPDATE USING (("subsystem_id" IN ( SELECT "subsystem_members"."subsystem_id"
   FROM "public"."subsystem_members"
  WHERE ("subsystem_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can access purchasing" ON "public"."purchasing" USING (true) WITH CHECK (true);



CREATE POLICY "Users can create subsystems" ON "public"."subsystems" FOR INSERT WITH CHECK (("auth"."uid"() = "lead_user_id"));



CREATE POLICY "Users can insert own profile" ON "public"."user_profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can join subsystems" ON "public"."subsystem_members" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can leave subsystems" ON "public"."subsystem_members" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."user_profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view all profiles" ON "public"."user_profiles" FOR SELECT USING (true);



CREATE POLICY "Users can view all subsystem memberships" ON "public"."subsystem_members" FOR SELECT USING (true);



CREATE POLICY "Users can view all subsystems" ON "public"."subsystems" FOR SELECT USING (true);



CREATE POLICY "Users can view builds for subsystems they're in" ON "public"."builds" FOR SELECT USING (("subsystem_id" IN ( SELECT "subsystem_members"."subsystem_id"
   FROM "public"."subsystem_members"
  WHERE ("subsystem_members"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."gantt_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gantt_links_delete_authenticated" ON "public"."gantt_links" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "gantt_links_insert_authenticated" ON "public"."gantt_links" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "gantt_links_select_authenticated" ON "public"."gantt_links" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "gantt_links_update_authenticated" ON "public"."gantt_links" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."gantt_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gantt_tasks_delete_authenticated" ON "public"."gantt_tasks" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "gantt_tasks_insert_authenticated" ON "public"."gantt_tasks" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "gantt_tasks_select_authenticated" ON "public"."gantt_tasks" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "gantt_tasks_update_authenticated" ON "public"."gantt_tasks" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."user_balances" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."add_part_to_build"("build_uuid" "uuid", "part_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."add_part_to_build"("build_uuid" "uuid", "part_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_part_to_build"("build_uuid" "uuid", "part_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."add_purchasing_to_build"("build_uuid" "uuid", "purchasing_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."add_purchasing_to_build"("build_uuid" "uuid", "purchasing_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_purchasing_to_build"("build_uuid" "uuid", "purchasing_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."frcbet_leaderboard"() TO "anon";
GRANT ALL ON FUNCTION "public"."frcbet_leaderboard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."frcbet_leaderboard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_build_with_all_items"("build_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_build_with_all_items"("build_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_build_with_all_items"("build_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_build_with_parts"("build_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_build_with_parts"("build_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_build_with_parts"("build_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_onshape_download_url"("document_id" "text", "wvm" "text", "wvmid" "text", "element_id" "text", "part_id" "text", "file_format" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_onshape_download_url"("document_id" "text", "wvm" "text", "wvmid" "text", "element_id" "text", "part_id" "text", "file_format" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_onshape_download_url"("document_id" "text", "wvm" "text", "wvmid" "text", "element_id" "text", "part_id" "text", "file_format" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_onshape_file_format"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_onshape_file_format"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_onshape_file_format"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_purchasing_budget_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_purchasing_budget_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_purchasing_budget_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."betting_bets" TO "anon";
GRANT ALL ON TABLE "public"."betting_bets" TO "authenticated";
GRANT ALL ON TABLE "public"."betting_bets" TO "service_role";



GRANT ALL ON TABLE "public"."betting_market_ticks" TO "anon";
GRANT ALL ON TABLE "public"."betting_market_ticks" TO "authenticated";
GRANT ALL ON TABLE "public"."betting_market_ticks" TO "service_role";



GRANT ALL ON TABLE "public"."betting_markets" TO "anon";
GRANT ALL ON TABLE "public"."betting_markets" TO "authenticated";
GRANT ALL ON TABLE "public"."betting_markets" TO "service_role";



GRANT ALL ON TABLE "public"."build_bom" TO "anon";
GRANT ALL ON TABLE "public"."build_bom" TO "authenticated";
GRANT ALL ON TABLE "public"."build_bom" TO "service_role";



GRANT ALL ON TABLE "public"."builds" TO "anon";
GRANT ALL ON TABLE "public"."builds" TO "authenticated";
GRANT ALL ON TABLE "public"."builds" TO "service_role";



GRANT ALL ON TABLE "public"."gantt_links" TO "anon";
GRANT ALL ON TABLE "public"."gantt_links" TO "authenticated";
GRANT ALL ON TABLE "public"."gantt_links" TO "service_role";



GRANT ALL ON TABLE "public"."gantt_tasks" TO "anon";
GRANT ALL ON TABLE "public"."gantt_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."gantt_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."kitting" TO "anon";
GRANT ALL ON TABLE "public"."kitting" TO "authenticated";
GRANT ALL ON TABLE "public"."kitting" TO "service_role";



GRANT ALL ON TABLE "public"."kitting_bins" TO "anon";
GRANT ALL ON TABLE "public"."kitting_bins" TO "authenticated";
GRANT ALL ON TABLE "public"."kitting_bins" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kitting_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kitting_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kitting_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."parts" TO "anon";
GRANT ALL ON TABLE "public"."parts" TO "authenticated";
GRANT ALL ON TABLE "public"."parts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."parts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."parts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."parts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."predict_settings" TO "anon";
GRANT ALL ON TABLE "public"."predict_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."predict_settings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."purchasing_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."purchasing_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."purchasing_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."purchasing" TO "anon";
GRANT ALL ON TABLE "public"."purchasing" TO "authenticated";
GRANT ALL ON TABLE "public"."purchasing" TO "service_role";



GRANT ALL ON TABLE "public"."purchasing_budgets" TO "anon";
GRANT ALL ON TABLE "public"."purchasing_budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."purchasing_budgets" TO "service_role";



GRANT ALL ON TABLE "public"."router_group_parts" TO "anon";
GRANT ALL ON TABLE "public"."router_group_parts" TO "authenticated";
GRANT ALL ON TABLE "public"."router_group_parts" TO "service_role";



GRANT ALL ON TABLE "public"."router_groups" TO "anon";
GRANT ALL ON TABLE "public"."router_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."router_groups" TO "service_role";



GRANT ALL ON TABLE "public"."scout_data_events" TO "anon";
GRANT ALL ON TABLE "public"."scout_data_events" TO "authenticated";
GRANT ALL ON TABLE "public"."scout_data_events" TO "service_role";



GRANT ALL ON TABLE "public"."scout_match_assignments" TO "anon";
GRANT ALL ON TABLE "public"."scout_match_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."scout_match_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."scout_notes" TO "anon";
GRANT ALL ON TABLE "public"."scout_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."scout_notes" TO "service_role";



GRANT ALL ON TABLE "public"."subsystem_members" TO "anon";
GRANT ALL ON TABLE "public"."subsystem_members" TO "authenticated";
GRANT ALL ON TABLE "public"."subsystem_members" TO "service_role";



GRANT ALL ON TABLE "public"."subsystems" TO "anon";
GRANT ALL ON TABLE "public"."subsystems" TO "authenticated";
GRANT ALL ON TABLE "public"."subsystems" TO "service_role";



GRANT ALL ON TABLE "public"."user_balances" TO "anon";
GRANT ALL ON TABLE "public"."user_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."user_balances" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT ALL ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendors_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendors_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendors_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























