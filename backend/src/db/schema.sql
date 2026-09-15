-- ============================================================
-- Smart Farm-to-Buyer Supply Chain Platform
-- PostgreSQL Schema v2.0 — Supabase Compatible
-- Run via: npm run migrate  (from backend/)
-- ============================================================

-- ============================================================
-- USERS (Authentication & Role)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK(role IN ('admin','farmer','customer')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login          TIMESTAMPTZ,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ
);

-- ============================================================
-- FARMER PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS farmer_profiles (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL UNIQUE REFERENCES users(id),
  full_name             TEXT NOT NULL,
  mobile                TEXT NOT NULL,
  address               TEXT NOT NULL,
  village               TEXT,
  taluk                 TEXT,
  district              TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'Tamil Nadu',
  pincode               TEXT NOT NULL,
  gps_lat               DOUBLE PRECISION,
  gps_lng               DOUBLE PRECISION,
  gov_id_type           TEXT CHECK(gov_id_type IN ('aadhaar','voter_id','pan','driving_license')),
  gov_id_number         TEXT,
  gov_id_verified       INTEGER NOT NULL DEFAULT 0,
  bank_account          TEXT,
  bank_ifsc             TEXT,
  bank_name             TEXT,
  account_holder        TEXT,
  verification_status   TEXT NOT NULL DEFAULT 'pending'
                          CHECK(verification_status IN ('pending','approved','rejected','info_required')),
  verification_notes    TEXT,
  verified_by           INTEGER REFERENCES users(id),
  verified_at           TIMESTAMPTZ,
  profile_photo         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

-- ============================================================
-- FARM LANDS
-- ============================================================
CREATE TABLE IF NOT EXISTS farm_lands (
  id                    SERIAL PRIMARY KEY,
  farmer_profile_id     INTEGER NOT NULL REFERENCES farmer_profiles(id),
  land_area_acres       DOUBLE PRECISION NOT NULL,
  irrigation_type       TEXT NOT NULL CHECK(irrigation_type IN ('drip','sprinkler','flood','rainfed','borewell','canal')),
  soil_type             TEXT CHECK(soil_type IN ('red','black','alluvial','clay','sandy','loamy')),
  survey_number         TEXT,
  location_description  TEXT,
  gps_lat               DOUBLE PRECISION,
  gps_lng               DOUBLE PRECISION,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CROP YIELD REFERENCE (AI estimation base data)
-- ============================================================
CREATE TABLE IF NOT EXISTS crop_yield_reference (
  id                        SERIAL PRIMARY KEY,
  crop_name                 TEXT NOT NULL,
  crop_variety              TEXT,
  min_yield_kg_per_acre     DOUBLE PRECISION NOT NULL,
  max_yield_kg_per_acre     DOUBLE PRECISION NOT NULL,
  avg_yield_kg_per_acre     DOUBLE PRECISION NOT NULL,
  growth_days_min           INTEGER,
  growth_days_max           INTEGER,
  season                    TEXT CHECK(season IN ('kharif','rabi','zaid','year_round')),
  suitable_regions          TEXT,  -- JSON array of districts
  notes                     TEXT
);

-- ============================================================
-- CROP LISTINGS (Current + Expected Supply)
-- ============================================================
CREATE TABLE IF NOT EXISTS crop_listings (
  id                        SERIAL PRIMARY KEY,
  farmer_profile_id         INTEGER NOT NULL REFERENCES farmer_profiles(id),
  land_id                   INTEGER REFERENCES farm_lands(id),
  crop_name                 TEXT NOT NULL,
  crop_variety              TEXT,
  sowing_date               DATE,
  expected_harvest_date     DATE,
  cultivated_area_acres     DOUBLE PRECISION NOT NULL,
  supply_type               TEXT NOT NULL CHECK(supply_type IN ('current','expected')),
  estimated_yield_min_kg    DOUBLE PRECISION,
  estimated_yield_max_kg    DOUBLE PRECISION,
  estimated_yield_avg_kg    DOUBLE PRECISION,
  confidence_level          TEXT DEFAULT 'medium' CHECK(confidence_level IN ('low','medium','high')),
  farmer_confirmed_qty_kg   DOUBLE PRECISION,
  available_kg              DOUBLE PRECISION DEFAULT 0,
  grade                     TEXT DEFAULT 'A' CHECK(grade IN ('A','B','C')),
  price_per_kg_expected     DOUBLE PRECISION,
  minimum_order_kg          DOUBLE PRECISION DEFAULT 50,
  status                    TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','sold','expired','cancelled')),
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ
);

-- ============================================================
-- ORDER FARMER ASSIGNMENTS (referenced by crop_photos below)
-- ============================================================
CREATE TABLE IF NOT EXISTS order_farmer_assignments (
  id                      SERIAL PRIMARY KEY,
  order_id                INTEGER NOT NULL,  -- FK added after orders table
  farmer_profile_id       INTEGER NOT NULL REFERENCES farmer_profiles(id),
  crop_listing_id         INTEGER NOT NULL REFERENCES crop_listings(id),
  quantity_kg_assigned    DOUBLE PRECISION NOT NULL,
  price_per_kg_agreed     DOUBLE PRECISION,
  farmer_status           TEXT NOT NULL DEFAULT 'pending'
                            CHECK(farmer_status IN ('pending','accepted','rejected','fulfilled','cancelled')),
  farmer_response_notes   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CROP PHOTOS (Evidence before transport)
-- ============================================================
CREATE TABLE IF NOT EXISTS crop_photos (
  id                      SERIAL PRIMARY KEY,
  crop_listing_id         INTEGER NOT NULL REFERENCES crop_listings(id),
  farmer_profile_id       INTEGER NOT NULL REFERENCES farmer_profiles(id),
  photo_path              TEXT NOT NULL,
  photo_type              TEXT NOT NULL CHECK(photo_type IN ('pre_transport','field','harvest','quality_check')),
  uploaded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                   TEXT,
  order_assignment_id     INTEGER REFERENCES order_farmer_assignments(id)
);

-- ============================================================
-- CUSTOMER PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_profiles (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL UNIQUE REFERENCES users(id),
  full_name             TEXT NOT NULL,
  business_name         TEXT,
  business_type         TEXT CHECK(business_type IN ('supermarket','hotel','restaurant','processor','institution','retailer','individual','other')),
  mobile                TEXT NOT NULL,
  address               TEXT NOT NULL,
  district              TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'Tamil Nadu',
  pincode               TEXT NOT NULL,
  gps_lat               DOUBLE PRECISION,
  gps_lng               DOUBLE PRECISION,
  gov_id_type           TEXT,
  gov_id_number         TEXT,
  verification_status   TEXT NOT NULL DEFAULT 'pending'
                          CHECK(verification_status IN ('pending','approved','rejected')),
  verification_notes    TEXT,
  verified_by           INTEGER REFERENCES users(id),
  verified_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

-- ============================================================
-- ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                          SERIAL PRIMARY KEY,
  order_ref                   TEXT NOT NULL UNIQUE,
  customer_profile_id         INTEGER NOT NULL REFERENCES customer_profiles(id),
  order_type                  TEXT NOT NULL DEFAULT 'bulk' CHECK(order_type IN ('bulk','retail')),
  crop_name                   TEXT NOT NULL,
  crop_variety                TEXT,
  grade_required              TEXT DEFAULT 'A' CHECK(grade_required IN ('A','B','C')),
  quantity_kg_requested       DOUBLE PRECISION NOT NULL,
  quantity_kg_fulfilled       DOUBLE PRECISION DEFAULT 0,
  price_per_kg_max            DOUBLE PRECISION,
  delivery_location           TEXT NOT NULL,
  delivery_district           TEXT NOT NULL,
  delivery_state              TEXT NOT NULL DEFAULT 'Tamil Nadu',
  delivery_gps_lat            DOUBLE PRECISION,
  delivery_gps_lng            DOUBLE PRECISION,
  delivery_date_required      DATE NOT NULL,
  delivery_date_actual        DATE,
  special_requirements        TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK(status IN ('pending','matched','confirmed','in_fulfillment','delivered','cancelled','disputed')),
  payment_status              TEXT NOT NULL DEFAULT 'unpaid'
                                CHECK(payment_status IN ('unpaid','partial','paid','refunded')),
  payment_50_status           TEXT NOT NULL DEFAULT 'unpaid'
                                CHECK(payment_50_status IN ('unpaid','paid')),
  payment_50_remaining_status TEXT NOT NULL DEFAULT 'unpaid'
                                CHECK(payment_50_remaining_status IN ('unpaid','paid')),
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

-- Add FK for order_farmer_assignments now that orders exists
ALTER TABLE order_farmer_assignments
  ADD CONSTRAINT fk_ofa_order_id
  FOREIGN KEY (order_id) REFERENCES orders(id)
  NOT VALID;

-- ============================================================
-- PAYMENTS (Razorpay integration + 50/50 split)
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id                  SERIAL PRIMARY KEY,
  order_id            INTEGER NOT NULL REFERENCES orders(id),
  payment_ref         TEXT NOT NULL UNIQUE,
  payment_phase       TEXT NOT NULL CHECK(payment_phase IN ('advance_50','balance_50','full')),
  gateway             TEXT NOT NULL DEFAULT 'razorpay',
  gateway_order_id    TEXT,
  gateway_payment_id  TEXT,
  gateway_signature   TEXT,
  amount_paise        BIGINT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  payment_status      TEXT NOT NULL DEFAULT 'created'
                        CHECK(payment_status IN ('created','paid','failed','refunded')),
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- FARMER SETTLEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS farmer_settlements (
  id                            SERIAL PRIMARY KEY,
  order_farmer_assignment_id    INTEGER NOT NULL REFERENCES order_farmer_assignments(id),
  farmer_profile_id             INTEGER NOT NULL REFERENCES farmer_profiles(id),
  amount_inr                    DOUBLE PRECISION NOT NULL,
  settlement_status             TEXT NOT NULL DEFAULT 'pending'
                                  CHECK(settlement_status IN ('pending','processed','failed')),
  settlement_ref                TEXT,
  settled_at                    TIMESTAMPTZ,
  notes                         TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LOGISTICS
-- ============================================================
CREATE TABLE IF NOT EXISTS logistics (
  id                      SERIAL PRIMARY KEY,
  order_id                INTEGER NOT NULL REFERENCES orders(id),
  provider_name           TEXT,
  vehicle_type            TEXT CHECK(vehicle_type IN ('mini_truck','medium_truck','large_truck','tempo','refrigerated')),
  vehicle_capacity_kg     DOUBLE PRECISION,
  vehicle_number          TEXT,
  driver_name             TEXT,
  driver_mobile           TEXT,
  pickup_plan             TEXT,          -- JSON
  route_plan              TEXT,          -- JSON
  tracking_points         TEXT DEFAULT '[]',  -- JSON
  current_lat             DOUBLE PRECISION,
  current_lng             DOUBLE PRECISION,
  last_location_update    TIMESTAMPTZ,
  delivery_location       TEXT,
  delivery_gps_lat        DOUBLE PRECISION,
  delivery_gps_lng        DOUBLE PRECISION,
  estimated_distance_km   DOUBLE PRECISION,
  estimated_duration_min  INTEGER,
  status                  TEXT NOT NULL DEFAULT 'planned'
                            CHECK(status IN ('planned','loading','in_transit','delivered','failed')),
  dispatched_at           TIMESTAMPTZ,
  delivered_at            TIMESTAMPTZ,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DEMAND HISTORY (Day-wise sales per crop per region)
-- ============================================================
CREATE TABLE IF NOT EXISTS demand_history (
  id                  SERIAL PRIMARY KEY,
  crop_name           TEXT NOT NULL,
  region_district     TEXT NOT NULL,
  region_state        TEXT NOT NULL DEFAULT 'Tamil Nadu',
  sale_date           DATE NOT NULL,
  quantity_kg_sold    DOUBLE PRECISION NOT NULL DEFAULT 0,
  order_count         INTEGER NOT NULL DEFAULT 0,
  avg_price_per_kg    DOUBLE PRECISION,
  source              TEXT NOT NULL DEFAULT 'order' CHECK(source IN ('order','manual','seeded')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(crop_name, region_district, sale_date)
);

-- ============================================================
-- DEMAND FORECASTS (Computed cache)
-- ============================================================
CREATE TABLE IF NOT EXISTS demand_forecasts (
  id                    SERIAL PRIMARY KEY,
  crop_name             TEXT NOT NULL,
  region_district       TEXT NOT NULL,
  region_state          TEXT NOT NULL DEFAULT 'Tamil Nadu',
  forecast_date         DATE NOT NULL,
  predicted_demand_kg   DOUBLE PRECISION,
  demand_direction      TEXT CHECK(demand_direction IN ('increasing','stable','decreasing')),
  demand_level          TEXT CHECK(demand_level IN ('low','medium','high','very_high')),
  confidence            TEXT NOT NULL CHECK(confidence IN ('unavailable','low','medium','high')),
  supply_available_kg   DOUBLE PRECISION DEFAULT 0,
  supply_expected_kg    DOUBLE PRECISION DEFAULT 0,
  gap_kg                DOUBLE PRECISION DEFAULT 0,
  gap_type              TEXT CHECK(gap_type IN ('shortage','surplus','balanced')),
  data_points_used      INTEGER DEFAULT 0,
  forecast_method       TEXT,
  weekly_breakdown      TEXT,  -- JSON
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(crop_name, region_district, forecast_date)
);

-- ============================================================
-- AUDIT LOGS (Append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id              SERIAL PRIMARY KEY,
  admin_user_id   INTEGER REFERENCES users(id),
  user_email      TEXT,
  action          TEXT NOT NULL,
  target_entity   TEXT,
  target_id       INTEGER,
  result          TEXT NOT NULL DEFAULT 'success' CHECK(result IN ('success','failure')),
  metadata        TEXT,  -- JSON
  ip_address      TEXT,
  user_agent      TEXT,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_email           ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role            ON users(role);
CREATE INDEX IF NOT EXISTS idx_farmer_profiles_user  ON farmer_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_farmer_district       ON farmer_profiles(district);
CREATE INDEX IF NOT EXISTS idx_farmer_status         ON farmer_profiles(verification_status);
CREATE INDEX IF NOT EXISTS idx_crop_listings_name    ON crop_listings(crop_name);
CREATE INDEX IF NOT EXISTS idx_crop_listings_farmer  ON crop_listings(farmer_profile_id);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer       ON orders(customer_profile_id);
CREATE INDEX IF NOT EXISTS idx_orders_crop           ON orders(crop_name);
CREATE INDEX IF NOT EXISTS idx_demand_history_key    ON demand_history(crop_name, region_district, sale_date);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp       ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_action          ON audit_logs(action);
