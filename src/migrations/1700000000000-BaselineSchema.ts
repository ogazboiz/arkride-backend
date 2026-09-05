import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The schema, from nothing.
 *
 * WHY THIS EXISTS
 *
 * Six of the eight tables in this database had NO create migration. `users`,
 * `drivers`, `vehicles`, `rides`, `ratings` and `driver_locations` were only
 * ever produced by `synchronize: true`, which `ormconfig.ts` enables when
 * NODE_ENV is 'development' — and `compose.local.yml` sets it to
 * 'staging'/'production' in every deployed environment. So there was no code
 * path that could build this schema anywhere it actually ran. Migration
 * #1756600000001 says as much in its own header.
 *
 * `migration:run` could not have revealed that, because it was missing the
 * `-d src/data-source.ts` datasource flag TypeORM 0.3 requires, and the
 * production image runs `pnpm prune --prod`, which removes the very `ts-node`
 * that `typeorm-ts-node-commonjs` needs to start. Both are fixed alongside
 * this migration.
 *
 * HOW IT WAS PRODUCED
 *
 * Not by hand. The entities were synchronised into a throwaway Postgres 16
 * (`scripts/dev/sync-schema.ts`), the result was dumped with `pg_dump`, and
 * this file is that dump — constraint names included, so a future
 * `migration:generate` sees no drift and does not propose recreating anything.
 *
 * WHY EVERY STATEMENT IS IDEMPOTENT
 *
 * There are databases out there that `synchronize` already built. This
 * migration has to be a no-op against those and a full build against an empty
 * one, without anybody having to know which they are looking at.
 */
export class BaselineSchema1700000000000 implements MigrationInterface {
  name = 'BaselineSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is built in from Postgres 13, but the entities were
    // synchronised against uuid-ossp and the column defaults reference
    // uuid_generate_v4(); keeping the extension keeps those defaults valid.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // --- enum types -------------------------------------------------------
    // CREATE TYPE has no IF NOT EXISTS, so each is wrapped. Swallowing only
    // duplicate_object means a genuinely malformed type still fails loudly.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE drivers_role_enum AS ENUM ( 'user', 'driver', 'admin' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE drivers_verificationstatus_enum AS ENUM ( 'pending', 'approved', 'rejected' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE emergency_incidents_status_enum AS ENUM ( 'active', 'resolved', 'false_alarm' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE emergency_incidents_triggeredby_enum AS ENUM ( 'rider', 'driver' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE ledger_entries_stakeholdertype_enum AS ENUM ( 'driver', 'rider', 'platform' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE ledger_entries_status_enum AS ENUM ( 'pending', 'completed', 'failed', 'reversed' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE ledger_entries_type_enum AS ENUM ( 'ride_fare_driver', 'ride_fare_platform', 'ride_fare_rider_cashback', 'driver_fuel_support_mfb', 'driver_payout_linkpay' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE refresh_tokens_subjecttype_enum AS ENUM ( 'user', 'driver', 'admin' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE rides_category_enum AS ENUM ( 'private', 'shared', 'okada', 'car' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE rides_originchannel_enum AS ENUM ( 'app', 'whatsapp', 'voice' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE rides_status_enum AS ENUM ( 'requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE users_role_enum AS ENUM ( 'user', 'driver', 'admin' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE vehicles_type_enum AS ENUM ( 'keke', 'bike', 'car', 'courier' );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // --- tables -----------------------------------------------------------
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS driver_locations ( id uuid DEFAULT uuid_generate_v4() NOT NULL, latitude numeric(10,8) NOT NULL, longitude numeric(11,8) NOT NULL, "updatedAt" timestamp without time zone DEFAULT now() NOT NULL, "createdAt" timestamp without time zone DEFAULT now() NOT NULL, driver_id uuid )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS drivers ( id uuid DEFAULT uuid_generate_v4() NOT NULL, name character varying NOT NULL, phone character varying NOT NULL, email character varying NOT NULL, password character varying, "licenseNumber" character varying NOT NULL, "licenseExpiry" date NOT NULL, role drivers_role_enum DEFAULT 'driver'::drivers_role_enum NOT NULL, "verificationStatus" drivers_verificationstatus_enum DEFAULT 'pending'::drivers_verificationstatus_enum NOT NULL, "isOnline" boolean DEFAULT false NOT NULL, "isActive" boolean DEFAULT true NOT NULL, "ratingAverage" numeric(3,2) DEFAULT '0'::numeric NOT NULL, "totalCompletedRides" integer DEFAULT 0 NOT NULL, "walletBalance" numeric(10,2) DEFAULT '0'::numeric NOT NULL, "privyDid" character varying, "walletAddressEvm" character varying, "otpCode" character varying, "otpExpiry" timestamp without time zone, "createdAt" timestamp without time zone DEFAULT now() NOT NULL, "updatedAt" timestamp without time zone DEFAULT now() NOT NULL )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS emergency_incidents ( id uuid DEFAULT uuid_generate_v4() NOT NULL, "rideId" uuid NOT NULL, "triggeredBy" emergency_incidents_triggeredby_enum NOT NULL, "triggeredById" uuid NOT NULL, location jsonb, note text, status emergency_incidents_status_enum DEFAULT 'active'::emergency_incidents_status_enum NOT NULL, "resolutionNote" text, "resolvedAt" timestamp without time zone, "createdAt" timestamp without time zone DEFAULT now() NOT NULL, "updatedAt" timestamp without time zone DEFAULT now() NOT NULL )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ledger_entries ( id uuid DEFAULT uuid_generate_v4() NOT NULL, "rideId" uuid, type ledger_entries_type_enum NOT NULL, "stakeholderType" ledger_entries_stakeholdertype_enum NOT NULL, "stakeholderId" uuid, amount numeric(12,2) NOT NULL, currency character varying(3) DEFAULT 'NGN'::character varying NOT NULL, status ledger_entries_status_enum DEFAULT 'completed'::ledger_entries_status_enum NOT NULL, "providerReference" character varying, metadata jsonb, "createdAt" timestamp without time zone DEFAULT now() NOT NULL )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ratings ( id uuid DEFAULT uuid_generate_v4() NOT NULL, "rideId" uuid NOT NULL, "raterId" uuid NOT NULL, "rateeId" uuid NOT NULL, "rateeType" character varying NOT NULL, rating integer NOT NULL, comment text, "createdAt" timestamp without time zone DEFAULT now() NOT NULL, "updatedAt" timestamp without time zone DEFAULT now() NOT NULL )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS refresh_tokens ( id uuid DEFAULT uuid_generate_v4() NOT NULL, "tokenHash" character varying(64) NOT NULL, "familyId" uuid NOT NULL, "subjectId" uuid NOT NULL, "subjectType" refresh_tokens_subjecttype_enum NOT NULL, "expiresAt" timestamp without time zone NOT NULL, "revokedAt" timestamp without time zone, "revokedReason" character varying, "userAgent" character varying, "ipAddress" character varying, "createdAt" timestamp without time zone DEFAULT now() NOT NULL )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS rides ( id uuid DEFAULT uuid_generate_v4() NOT NULL, "userId" uuid NOT NULL, "driverId" uuid, "vehicleId" uuid, pickup jsonb NOT NULL, dropoff jsonb NOT NULL, "distanceKm" numeric(10,2), category rides_category_enum DEFAULT 'private'::rides_category_enum NOT NULL, "estimatedFare" numeric(10,2), "finalFare" numeric(10,2), status rides_status_enum DEFAULT 'requested'::rides_status_enum NOT NULL, "originChannel" rides_originchannel_enum DEFAULT 'app'::rides_originchannel_enum NOT NULL, "cancellationReason" text, "requestedAt" timestamp without time zone DEFAULT now() NOT NULL, "acceptedAt" timestamp without time zone, "startedAt" timestamp without time zone, "completedAt" timestamp without time zone, "createdAt" timestamp without time zone DEFAULT now() NOT NULL, "updatedAt" timestamp without time zone DEFAULT now() NOT NULL )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS users ( id uuid DEFAULT uuid_generate_v4() NOT NULL, name character varying NOT NULL, email character varying NOT NULL, phone character varying, password character varying, provider character varying, "providerId" character varying, "privyDid" character varying, "walletAddressEvm" character varying, "walletAddressSolana" character varying, "walletAddressTron" character varying, "otpCode" character varying, "otpExpiry" timestamp without time zone, "isVerified" boolean DEFAULT false NOT NULL, role users_role_enum DEFAULT 'user'::users_role_enum NOT NULL, "ratingAverage" numeric(3,2) DEFAULT '0'::numeric NOT NULL, "totalRides" integer DEFAULT 0 NOT NULL, "cashbackBalance" numeric(12,2) DEFAULT '0'::numeric NOT NULL, "isBlocked" boolean DEFAULT false NOT NULL, "createdAt" timestamp without time zone DEFAULT now() NOT NULL, "updatedAt" timestamp without time zone DEFAULT now() NOT NULL )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS vehicles ( id uuid DEFAULT uuid_generate_v4() NOT NULL, "driverId" uuid NOT NULL, type vehicles_type_enum NOT NULL, "plateNumber" character varying NOT NULL, color character varying NOT NULL, model character varying NOT NULL, year integer NOT NULL, "isActive" boolean DEFAULT true NOT NULL, "createdAt" timestamp without time zone DEFAULT now() NOT NULL, "updatedAt" timestamp without time zone DEFAULT now() NOT NULL )`);

    // --- primary keys and unique constraints ------------------------------
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ratings'::regclass AND contype = 'p') THEN
          ALTER TABLE ONLY "ratings" ADD CONSTRAINT "PK_0f31425b073219379545ad68ed9" PRIMARY KEY (id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'vehicles'::regclass AND contype = 'p') THEN
          ALTER TABLE ONLY "vehicles" ADD CONSTRAINT "PK_18d8646b59304dce4af3a9e35b6" PRIMARY KEY (id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'driver_locations'::regclass AND contype = 'p') THEN
          ALTER TABLE ONLY "driver_locations" ADD CONSTRAINT "PK_31aae5c417762bf01ec26a53f02" PRIMARY KEY (id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ledger_entries'::regclass AND contype = 'p') THEN
          ALTER TABLE ONLY "ledger_entries" ADD CONSTRAINT "PK_6efcb84411d3f08b08450ae75d5" PRIMARY KEY (id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'refresh_tokens'::regclass AND contype = 'p') THEN
          ALTER TABLE ONLY "refresh_tokens" ADD CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY (id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'drivers'::regclass AND contype = 'p') THEN
          ALTER TABLE ONLY "drivers" ADD CONSTRAINT "PK_92ab3fb69e566d3eb0cae896047" PRIMARY KEY (id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'p') THEN
          ALTER TABLE ONLY "users" ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY (id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'emergency_incidents'::regclass AND contype = 'p') THEN
          ALTER TABLE ONLY "emergency_incidents" ADD CONSTRAINT "PK_b0ed14bd0a0f7d7ca5f71d95df5" PRIMARY KEY (id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rides'::regclass AND contype = 'p') THEN
          ALTER TABLE ONLY "rides" ADD CONSTRAINT "PK_ca6f62fc1e999b139c7f28f07fd" PRIMARY KEY (id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'driver_locations'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (driver_id)') THEN
          ALTER TABLE ONLY "driver_locations" ADD CONSTRAINT "REL_096de534e1c6301cf7f2a4bf03" UNIQUE (driver_id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE ("privyDid")') THEN
          ALTER TABLE ONLY "users" ADD CONSTRAINT "UQ_27bc7580e0592d498a83041f70b" UNIQUE ("privyDid");
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'vehicles'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE ("plateNumber")') THEN
          ALTER TABLE ONLY "vehicles" ADD CONSTRAINT "UQ_66ea96381a7a7ceb35c72f36625" UNIQUE ("plateNumber");
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'drivers'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE ("licenseNumber")') THEN
          ALTER TABLE ONLY "drivers" ADD CONSTRAINT "UQ_754b3d50a8cc64f7ad5c24f62b4" UNIQUE ("licenseNumber");
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'drivers'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE ("privyDid")') THEN
          ALTER TABLE ONLY "drivers" ADD CONSTRAINT "UQ_788d5a89008be4ae891e9065677" UNIQUE ("privyDid");
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (email)') THEN
          ALTER TABLE ONLY "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE (email);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (phone)') THEN
          ALTER TABLE ONLY "users" ADD CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE (phone);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'drivers'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (phone)') THEN
          ALTER TABLE ONLY "drivers" ADD CONSTRAINT "UQ_b97a5a68c766d2d1ec25e6a85b2" UNIQUE (phone);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'refresh_tokens'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE ("tokenHash")') THEN
          ALTER TABLE ONLY "refresh_tokens" ADD CONSTRAINT "UQ_c25bc63d248ca90e8dcc1d92d06" UNIQUE ("tokenHash");
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'drivers'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (email)') THEN
          ALTER TABLE ONLY "drivers" ADD CONSTRAINT "UQ_d4cfc1aafe3a14622aee390edb2" UNIQUE (email);
        END IF;
      END $$;
    `);

    // --- indexes ----------------------------------------------------------
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_emergency_ride ON emergency_incidents USING btree ("rideId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_emergency_status ON emergency_incidents USING btree (status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ledger_stakeholder ON ledger_entries USING btree ("stakeholderType", "stakeholderId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_rating_ratee ON ratings USING btree ("rateeId", "rateeType")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens USING btree ("familyId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_refresh_subject ON refresh_tokens USING btree ("subjectId", "subjectType")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_ride_type ON ledger_entries USING btree ("rideId", type) WHERE ("rideId" IS NOT NULL)`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_ride_rater ON ratings USING btree ("rideId", "raterId")`);

    // --- foreign keys -----------------------------------------------------
    // Last, so every table they reference exists regardless of dump order.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rides'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY ("userId")%') THEN
          ALTER TABLE ONLY "rides" ADD CONSTRAINT "FK_0023f8784105268f52413528568" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'driver_locations'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (driver_id)%') THEN
          ALTER TABLE ONLY "driver_locations" ADD CONSTRAINT "FK_096de534e1c6301cf7f2a4bf032" FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rides'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY ("driverId")%') THEN
          ALTER TABLE ONLY "rides" ADD CONSTRAINT "FK_0adda088d567495e71d21b6c691" FOREIGN KEY ("driverId") REFERENCES drivers(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'vehicles'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY ("driverId")%') THEN
          ALTER TABLE ONLY "vehicles" ADD CONSTRAINT "FK_28d7607488252336b22511e9e80" FOREIGN KEY ("driverId") REFERENCES drivers(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ratings'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY ("rideId")%') THEN
          ALTER TABLE ONLY "ratings" ADD CONSTRAINT "FK_5ea4e6b760b74bd49b9cdc58ca0" FOREIGN KEY ("rideId") REFERENCES rides(id);
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rides'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY ("vehicleId")%') THEN
          ALTER TABLE ONLY "rides" ADD CONSTRAINT "FK_75e480e353cb430ffbb664bbb07" FOREIGN KEY ("vehicleId") REFERENCES vehicles(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'emergency_incidents'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY ("rideId")%') THEN
          ALTER TABLE ONLY "emergency_incidents" ADD CONSTRAINT "FK_e6d8cd8a5554daf4d2c24d5ea9a" FOREIGN KEY ("rideId") REFERENCES rides(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  }

  /**
   * Drops everything this created.
   *
   * CASCADE on the tables removes the foreign keys and indexes with them, so
   * they are not dropped individually. Reverse dependency order is still
   * observed for readability.
   *
   * This is a genuinely destructive down migration — it is the reverse of
   * "create the whole database" — and is here for local resets, not for
   * production rollback.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ratings" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "emergency_incidents" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledger_entries" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "driver_locations" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rides" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vehicles" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "drivers" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);

    await queryRunner.query(`DROP TYPE IF EXISTS "drivers_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "drivers_verificationstatus_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "emergency_incidents_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "emergency_incidents_triggeredby_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ledger_entries_stakeholdertype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ledger_entries_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ledger_entries_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "refresh_tokens_subjecttype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "rides_category_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "rides_originchannel_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "rides_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vehicles_type_enum"`);
  }
}
