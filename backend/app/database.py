import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
import pymssql
from contextlib import contextmanager


class PostgresManager:
    def __init__(self):
        self.database_url = os.environ.get('DATABASE_URL', 'postgresql://pochecker:pochecker@postgres:5432/pochecker')

    @contextmanager
    def get_connection(self):
        conn = psycopg2.connect(self.database_url)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_config(self, key):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT value FROM config WHERE key = %s", (key,))
                row = cur.fetchone()
                if row and row['value']:
                    try:
                        return json.loads(row['value'])
                    except json.JSONDecodeError:
                        return row['value']
                return None

    def set_config(self, key, value):
        value_str = json.dumps(value) if isinstance(value, dict) else str(value)
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO config (key, value, updated_at)
                    VALUES (%s, %s, CURRENT_TIMESTAMP)
                    ON CONFLICT (key) DO UPDATE SET
                        value = EXCLUDED.value,
                        updated_at = CURRENT_TIMESTAMP
                """, (key, value_str))

    def get_all_config(self):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT key, value FROM config")
                rows = cur.fetchall()
                result = {}
                for row in rows:
                    try:
                        result[row['key']] = json.loads(row['value'])
                    except (json.JSONDecodeError, TypeError):
                        result[row['key']] = row['value']
                return result

    # Session management
    def create_session(self, po_id, po_number, supplier_name):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO receiving_sessions (po_id, po_number, supplier_name, status)
                    VALUES (%s, %s, %s, 'in_progress')
                    RETURNING *
                """, (po_id, po_number, supplier_name))
                return cur.fetchone()

    def get_session(self, session_id):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT * FROM receiving_sessions WHERE id = %s", (session_id,))
                return cur.fetchone()

    def get_active_session(self):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT * FROM receiving_sessions
                    WHERE status = 'in_progress'
                    ORDER BY started_at DESC
                    LIMIT 1
                """)
                return cur.fetchone()

    def update_session_status(self, session_id, status):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if status in ('completed', 'cancelled'):
                    cur.execute("""
                        UPDATE receiving_sessions
                        SET status = %s, completed_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                        RETURNING *
                    """, (status, session_id))
                else:
                    cur.execute("""
                        UPDATE receiving_sessions
                        SET status = %s
                        WHERE id = %s
                        RETURNING *
                    """, (status, session_id))
                return cur.fetchone()

    # Scan records
    def add_scan_record(self, session_id, barcode, barcode_type, product_upc, product_description, line_id, quantity):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO scan_records
                    (session_id, barcode, barcode_type, product_upc, product_description, line_id, quantity)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING *
                """, (session_id, barcode, barcode_type, product_upc, product_description, line_id, quantity))
                return cur.fetchone()

    def get_session_scans(self, session_id):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT * FROM scan_records
                    WHERE session_id = %s
                    ORDER BY scanned_at DESC
                """, (session_id,))
                return cur.fetchall()

    def get_session_totals(self, session_id):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT
                        line_id,
                        product_upc,
                        product_description,
                        SUM(quantity) as total_received
                    FROM scan_records
                    WHERE session_id = %s
                    GROUP BY line_id, product_upc, product_description
                """, (session_id,))
                return cur.fetchall()

    # Excluded products management
    def ensure_excluded_products_table(self):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS excluded_products (
                        id SERIAL PRIMARY KEY,
                        product_upc VARCHAR(50) UNIQUE NOT NULL,
                        product_description VARCHAR(255),
                        excluded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_excluded_upc ON excluded_products(product_upc)")

    def get_excluded_upcs(self):
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT product_upc FROM excluded_products")
                    return {row[0] for row in cur.fetchall()}
        except Exception:
            # Table might not exist, try to create it
            try:
                self.ensure_excluded_products_table()
                return set()
            except Exception:
                return set()

    def add_excluded_product(self, upc, description):
        self.ensure_excluded_products_table()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO excluded_products (product_upc, product_description)
                    VALUES (%s, %s)
                    ON CONFLICT (product_upc) DO UPDATE SET
                        product_description = EXCLUDED.product_description
                    RETURNING *
                """, (upc, description))
                return cur.fetchone()

    def remove_excluded_product(self, upc):
        self.ensure_excluded_products_table()
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM excluded_products WHERE product_upc = %s", (upc,))
                return cur.rowcount > 0

    def get_excluded_products(self):
        self.ensure_excluded_products_table()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, product_upc, product_description, excluded_at
                    FROM excluded_products
                    ORDER BY excluded_at DESC
                """)
                return cur.fetchall()

    # Excluded suppliers management
    def ensure_excluded_suppliers_table(self):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS excluded_suppliers (
                        id SERIAL PRIMARY KEY,
                        supplier_id INT UNIQUE NOT NULL,
                        supplier_name VARCHAR(255),
                        excluded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_excluded_supplier_id ON excluded_suppliers(supplier_id)")

    def get_excluded_supplier_ids(self):
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT supplier_id FROM excluded_suppliers")
                    return {row[0] for row in cur.fetchall()}
        except Exception:
            try:
                self.ensure_excluded_suppliers_table()
                return set()
            except Exception:
                return set()

    def add_excluded_supplier(self, supplier_id, supplier_name):
        self.ensure_excluded_suppliers_table()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO excluded_suppliers (supplier_id, supplier_name)
                    VALUES (%s, %s)
                    ON CONFLICT (supplier_id) DO UPDATE SET
                        supplier_name = EXCLUDED.supplier_name
                    RETURNING *
                """, (supplier_id, supplier_name))
                return cur.fetchone()

    def remove_excluded_supplier(self, supplier_id):
        self.ensure_excluded_suppliers_table()
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM excluded_suppliers WHERE supplier_id = %s", (supplier_id,))
                return cur.rowcount > 0

    def get_excluded_suppliers(self):
        self.ensure_excluded_suppliers_table()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, supplier_id, supplier_name, excluded_at
                    FROM excluded_suppliers
                    ORDER BY excluded_at DESC
                """)
                return cur.fetchall()

    # Pending S2S sync management
    def ensure_pending_syncs_table(self):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
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
                    )
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_pending_syncs_synced
                    ON pending_s2s_syncs(synced_at) WHERE synced_at IS NULL
                """)

    def add_pending_sync(self, scan_record_id, line_id, po_id, qty_received, error=None):
        self.ensure_pending_syncs_table()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO pending_s2s_syncs (scan_record_id, line_id, po_id, qty_received, last_error)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING *
                """, (scan_record_id, line_id, po_id, qty_received, error))
                return cur.fetchone()

    def mark_sync_complete(self, sync_id):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE pending_s2s_syncs
                    SET synced_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (sync_id,))

    def get_pending_syncs(self, limit=100):
        self.ensure_pending_syncs_table()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, scan_record_id, line_id, po_id, qty_received, created_at, retry_count, last_error
                    FROM pending_s2s_syncs
                    WHERE synced_at IS NULL
                    ORDER BY created_at ASC
                    LIMIT %s
                """, (limit,))
                return cur.fetchall()

    def get_pending_sync_count(self):
        self.ensure_pending_syncs_table()
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM pending_s2s_syncs WHERE synced_at IS NULL")
                return cur.fetchone()[0]

    def update_sync_error(self, sync_id, error):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE pending_s2s_syncs
                    SET last_error = %s, retry_count = retry_count + 1
                    WHERE id = %s
                """, (error, sync_id))

    def get_line_total_received(self, session_id, line_id):
        """Get cumulative total received for a specific line in a session."""
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT COALESCE(SUM(quantity), 0)
                    FROM scan_records
                    WHERE session_id = %s AND line_id = %s
                """, (session_id, line_id))
                return cur.fetchone()[0]

    def cancel_all_active_sessions(self):
        """Cancel all in-progress sessions (called before creating new session)."""
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE receiving_sessions
                    SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
                    WHERE status = 'in_progress'
                """)
                return cur.rowcount

    # Inventory change history management
    def ensure_inventory_changes_table(self):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
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
                    )
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_inventory_changes_changed_at
                    ON inventory_changes(changed_at DESC)
                """)

    def add_inventory_change(self, session_id, product_upc, product_description, qty_before, qty_changed, changed_at=None):
        self.ensure_inventory_changes_table()
        qty_after = (qty_before or 0) + qty_changed
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if changed_at:
                    cur.execute("""
                        INSERT INTO inventory_changes
                        (session_id, product_upc, product_description, qty_before, qty_after, qty_changed, changed_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        RETURNING *
                    """, (session_id, product_upc, product_description, qty_before, qty_after, qty_changed, changed_at))
                else:
                    cur.execute("""
                        INSERT INTO inventory_changes
                        (session_id, product_upc, product_description, qty_before, qty_after, qty_changed)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        RETURNING *
                    """, (session_id, product_upc, product_description, qty_before, qty_after, qty_changed))
                return cur.fetchone()

    def get_inventory_history(self, limit=50, offset=0, include_undone=False):
        self.ensure_inventory_changes_table()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                where_clause = "" if include_undone else "WHERE ic.undone_at IS NULL"
                cur.execute(f"""
                    SELECT
                        ic.id,
                        ic.session_id,
                        ic.product_upc,
                        ic.product_description,
                        ic.qty_before,
                        ic.qty_after,
                        ic.qty_changed,
                        ic.changed_at,
                        ic.undone_at,
                        ic.undo_error,
                        rs.po_number,
                        rs.supplier_name
                    FROM inventory_changes ic
                    LEFT JOIN receiving_sessions rs ON ic.session_id = rs.id
                    {where_clause}
                    ORDER BY ic.changed_at DESC
                    LIMIT %s OFFSET %s
                """, (limit, offset))
                return cur.fetchall()

    def get_inventory_history_count(self, include_undone=False):
        self.ensure_inventory_changes_table()
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                where_clause = "" if include_undone else "WHERE undone_at IS NULL"
                cur.execute(f"SELECT COUNT(*) FROM inventory_changes {where_clause}")
                return cur.fetchone()[0]

    def get_inventory_change(self, change_id):
        self.ensure_inventory_changes_table()
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT * FROM inventory_changes WHERE id = %s
                """, (change_id,))
                return cur.fetchone()

    def mark_inventory_change_undone(self, change_id, error=None):
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    UPDATE inventory_changes
                    SET undone_at = CURRENT_TIMESTAMP, undo_error = %s
                    WHERE id = %s
                    RETURNING *
                """, (error, change_id))
                return cur.fetchone()


class MSSQLManager:
    def __init__(self, server, port, database, username, password):
        self.server = server
        self.port = int(port) if port else 1433
        self.database = database
        self.username = username
        self.password = password

    @contextmanager
    def get_connection(self):
        conn = pymssql.connect(
            server=self.server,
            port=self.port,
            database=self.database,
            user=self.username,
            password=self.password
        )
        try:
            yield conn
        finally:
            conn.close()

    def test_connection(self):
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                cursor.fetchone()
                return True, "Connection successful"
        except Exception as e:
            return False, str(e)


class S2SManager(MSSQLManager):
    def get_open_pos(self, supplier_id=None, date_from=None, date_to=None):
        with self.get_connection() as conn:
            cursor = conn.cursor(as_dict=True)
            query = """
                SELECT
                    po.PoID,
                    po.PoNumber,
                    po.PoDate,
                    po.RequiredDate,
                    po.SupplierID,
                    po.BusinessName,
                    po.PoTitle,
                    po.Status,
                    po.TotQtyOrd,
                    po.TotQtyRcv,
                    po.NoLines
                FROM PurchaseOrders_tbl po
                WHERE (po.Status = 0 OR po.Status IS NULL)
            """
            params = []

            if supplier_id:
                query += " AND po.SupplierID = %s"
                params.append(supplier_id)

            if date_from:
                query += " AND po.PoDate >= %s"
                params.append(date_from)

            if date_to:
                query += " AND po.PoDate <= %s"
                params.append(date_to)

            query += " ORDER BY po.PoID DESC"

            cursor.execute(query, tuple(params))
            return cursor.fetchall()

    def get_po_details(self, po_id):
        with self.get_connection() as conn:
            cursor = conn.cursor(as_dict=True)

            # Get PO header
            cursor.execute("""
                SELECT
                    po.PoID,
                    po.PoNumber,
                    po.PoDate,
                    po.RequiredDate,
                    po.SupplierID,
                    po.BusinessName,
                    po.PoTitle,
                    po.Status,
                    po.TotQtyOrd,
                    po.TotQtyRcv,
                    po.NoLines,
                    po.Notes
                FROM PurchaseOrders_tbl po
                WHERE po.PoID = %s
            """, (po_id,))
            po = cursor.fetchone()

            if not po:
                return None

            # Get PO line items
            cursor.execute("""
                SELECT
                    pod.LineID,
                    pod.PoID,
                    pod.ProductID,
                    pod.ProductSKU,
                    pod.ProductUPC,
                    pod.ProductDescription,
                    pod.UnitDesc,
                    pod.UnitQty,
                    pod.QtyOrdered,
                    pod.QtyReceived,
                    pod.UnitCost,
                    pod.ExtendedCost,
                    pod.ItemSize
                FROM PurchaseOrdersDetails_tbl pod
                WHERE pod.PoID = %s
                ORDER BY pod.LineID
            """, (po_id,))
            po['lines'] = cursor.fetchall()

            return po

    def get_suppliers(self):
        with self.get_connection() as conn:
            cursor = conn.cursor(as_dict=True)
            cursor.execute("""
                SELECT DISTINCT
                    s.SupplierID,
                    s.BusinessName
                FROM Suppliers_tbl s
                INNER JOIN PurchaseOrders_tbl po ON s.SupplierID = po.SupplierID
                WHERE s.Discontinued = 0 OR s.Discontinued IS NULL
                ORDER BY s.BusinessName
            """)
            return cursor.fetchall()

    def find_product_by_upc(self, upc):
        with self.get_connection() as conn:
            cursor = conn.cursor(as_dict=True)
            cursor.execute("""
                SELECT
                    ProductID,
                    ProductSKU,
                    ProductUPC,
                    ProductDescription
                FROM Items_tbl
                WHERE ProductUPC = %s
            """, (upc,))
            return cursor.fetchone()

    def update_line_qty_received(self, line_id, qty_received):
        """SET QtyReceived and DateReceived for a PO line item."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE PurchaseOrdersDetails_tbl
                    SET QtyReceived = %s,
                        DateReceived = CASE WHEN DateReceived IS NULL THEN GETDATE() ELSE DateReceived END
                    WHERE LineID = %s
                """, (qty_received, line_id))
                conn.commit()
                return True, None
        except Exception as e:
            return False, str(e)

    def update_po_total_received(self, po_id):
        """Recalculate TotQtyRcv and update RequiredDate."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE PurchaseOrders_tbl
                    SET TotQtyRcv = (
                        SELECT ISNULL(SUM(ISNULL(QtyReceived, 0)), 0)
                        FROM PurchaseOrdersDetails_tbl
                        WHERE PoID = %s
                    ),
                    RequiredDate = GETDATE()
                    WHERE PoID = %s
                """, (po_id, po_id))
                conn.commit()
                return True, None
        except Exception as e:
            return False, str(e)

    def update_item_inventory(self, product_upc, qty_received):
        """Update Items_tbl QuantOnHand and LastReceived when product is received."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE Items_tbl
                    SET QuantOnHand = ISNULL(QuantOnHand, 0) + %s,
                        LastReceived = CAST(GETDATE() AS smalldatetime)
                    WHERE ProductUPC = %s
                """, (qty_received, product_upc))
                conn.commit()
                return True, None
        except Exception as e:
            return False, str(e)

    def get_item_inventory(self, product_upc):
        """Get current QuantOnHand for a product before updating."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor(as_dict=True)
                cursor.execute("""
                    SELECT ProductUPC, ISNULL(QuantOnHand, 0) as QuantOnHand
                    FROM Items_tbl
                    WHERE ProductUPC = %s
                """, (product_upc,))
                return cursor.fetchone()
        except Exception:
            return None

    def subtract_item_inventory(self, product_upc, qty):
        """Subtract from Items_tbl QuantOnHand (for undo functionality)."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE Items_tbl
                    SET QuantOnHand = ISNULL(QuantOnHand, 0) - %s
                    WHERE ProductUPC = %s
                """, (qty, product_upc))
                conn.commit()
                return True, None
        except Exception as e:
            return False, str(e)

    def get_server_datetime(self):
        """Get current datetime from SQL Server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT GETDATE()")
            return cursor.fetchone()[0]


class ShipperDBManager(MSSQLManager):
    def __init__(self, server, port, database, username, password, table_name='case_barcodes'):
        super().__init__(server, port, database, username, password)
        self.table_name = table_name

    def find_case_barcode(self, barcode):
        with self.get_connection() as conn:
            cursor = conn.cursor(as_dict=True)
            query = f"""
                SELECT
                    id,
                    barcode,
                    unit_barcode,
                    quantity
                FROM {self.table_name}
                WHERE barcode = %s
            """
            cursor.execute(query, (barcode,))
            return cursor.fetchone()


# Global instances
postgres = PostgresManager()


def get_s2s_manager():
    config = postgres.get_config('s2s_connection')
    if not config:
        return None
    return S2SManager(
        server=config.get('server'),
        port=config.get('port', 1433),
        database=config.get('database'),
        username=config.get('username'),
        password=config.get('password')
    )


def get_shipper_manager():
    config = postgres.get_config('shipper_connection')
    if not config:
        return None
    return ShipperDBManager(
        server=config.get('server'),
        port=config.get('port', 1433),
        database=config.get('database'),
        username=config.get('username'),
        password=config.get('password'),
        table_name=config.get('table_name', 'case_barcodes')
    )
