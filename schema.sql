-- Database: tracking_db
-- Jalankan: psql -U postgres -d tracking_db -f schema.sql

CREATE TABLE IF NOT EXISTS targets (
    id SERIAL PRIMARY KEY,
    target_name VARCHAR(255) NOT NULL,
    tracking_code VARCHAR(32) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS location_logs (
    id SERIAL PRIMARY KEY,
    target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION,
    user_agent TEXT,
    ip_address VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_targets_tracking_code ON targets(tracking_code);
CREATE INDEX IF NOT EXISTS idx_location_logs_target_id ON location_logs(target_id);
CREATE INDEX IF NOT EXISTS idx_location_logs_created_at ON location_logs(created_at DESC);
