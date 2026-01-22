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

-- Excluded products (products to hide from PO checks)
CREATE TABLE IF NOT EXISTS excluded_products (
    id SERIAL PRIMARY KEY,
    product_upc VARCHAR(50) UNIQUE NOT NULL,
    product_description VARCHAR(255),
    excluded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Excluded suppliers (suppliers to hide from PO list)
CREATE TABLE IF NOT EXISTS excluded_suppliers (
    id SERIAL PRIMARY KEY,
    supplier_id INT UNIQUE NOT NULL,
    supplier_name VARCHAR(255),
    excluded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pending S2S syncs (for retry on failure)
CREATE TABLE IF NOT EXISTS pending_s2s_syncs (
    id SERIAL PRIMARY KEY,
    scan_record_id INT REFERENCES scan_records(id) ON DELETE CASCADE,
    line_id INT NOT NULL,
    po_id INT NOT NULL,
    qty_received REAL NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    retry_count INT DEFAULT 0,
    last_error TEXT,
    synced_at TIMESTAMP
);

-- Inventory change history (for undo functionality)
CREATE TABLE IF NOT EXISTS inventory_changes (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES receiving_sessions(id) ON DELETE SET NULL,
    product_upc VARCHAR(50) NOT NULL,
    product_description VARCHAR(255),
    qty_before INT,
    qty_after INT,
    qty_changed INT NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    undone_at TIMESTAMP,
    undo_error TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_status ON receiving_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_po_id ON receiving_sessions(po_id);
CREATE INDEX IF NOT EXISTS idx_scan_records_session ON scan_records(session_id);
CREATE INDEX IF NOT EXISTS idx_config_key ON config(key);
CREATE INDEX IF NOT EXISTS idx_excluded_upc ON excluded_products(product_upc);
CREATE INDEX IF NOT EXISTS idx_excluded_supplier_id ON excluded_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pending_syncs_synced ON pending_s2s_syncs(synced_at) WHERE synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_changes_changed_at ON inventory_changes(changed_at DESC);
