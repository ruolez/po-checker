-- PostgreSQL initialization script for PO Checker

-- Configuration storage
CREATE TABLE IF NOT EXISTS config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Receiving sessions (persists progress)
CREATE TABLE IF NOT EXISTS receiving_sessions (
    id SERIAL PRIMARY KEY,
    po_id INT NOT NULL,
    po_number VARCHAR(20) NOT NULL,
    supplier_name VARCHAR(50),
    status VARCHAR(20) DEFAULT 'in_progress',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    notes TEXT
);

-- Individual scan records
CREATE TABLE IF NOT EXISTS scan_records (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES receiving_sessions(id) ON DELETE CASCADE,
    barcode VARCHAR(255) NOT NULL,
    barcode_type VARCHAR(20),
    product_upc VARCHAR(20),
    product_description VARCHAR(50),
    line_id INT,
    quantity INT DEFAULT 1,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_status ON receiving_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_po_id ON receiving_sessions(po_id);
CREATE INDEX IF NOT EXISTS idx_scan_records_session ON scan_records(session_id);
CREATE INDEX IF NOT EXISTS idx_config_key ON config(key);
