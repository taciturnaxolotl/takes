import { pgTable, text, integer } from "drizzle-orm/pg-core";
import type { Pool } from "pg";

// Define the takes table
export const takes = pgTable("takes", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull(),
	ts: text("ts").notNull(),
	elapsedTimeMs: integer("elapsed_time_ms").notNull().default(0),
	createdAt: text("created_at")
		.$defaultFn(() => new Date().toISOString())
		.notNull(),
	media: text("media").notNull().default("[]"), // array of media urls
	multiplier: text("multiplier").notNull().default("1.0"),
	notes: text("notes").notNull().default(""),
});

export const users = pgTable("users", {
	id: text("id").primaryKey(),
	totalTakesTime: integer("total_takes_time").default(0),
	hackatimeKeys: text("hackatime_keys").notNull().default("[]"),
	projectName: text("project_name").notNull().default(""),
	projectDescription: text("project_description").notNull().default(""),
});

export async function setupTriggers(pool: Pool) {
	await pool.query(`
  		CREATE INDEX IF NOT EXISTS idx_takes_user_id ON takes(user_id);

  		CREATE OR REPLACE FUNCTION update_user_total_time()
        RETURNS TRIGGER AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            UPDATE users
            SET total_takes_time = COALESCE(total_takes_time, 0) + NEW.elapsed_time_ms
            WHERE id = NEW.user_id;
            RETURN NEW;
          ELSIF TG_OP = 'DELETE' THEN
            UPDATE users
            SET total_takes_time = COALESCE(total_takes_time, 0) - OLD.elapsed_time_ms
            WHERE id = OLD.user_id;
            RETURN OLD;
          ELSIF TG_OP = 'UPDATE' THEN
            UPDATE users
            SET total_takes_time = COALESCE(total_takes_time, 0) - OLD.elapsed_time_ms + NEW.elapsed_time_ms
            WHERE id = NEW.user_id;
            RETURN NEW;
          END IF;

          RETURN NULL;  -- Default return for unexpected operations

  			EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'Error updating user total time: %', SQLERRM;
          RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

  		DROP TRIGGER IF EXISTS update_user_total_time_trigger ON takes;

  		CREATE TRIGGER update_user_total_time_trigger
  		AFTER INSERT OR UPDATE OR DELETE ON takes
  		FOR EACH ROW
  		EXECUTE FUNCTION update_user_total_time();
		`);
}
