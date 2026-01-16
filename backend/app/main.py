from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime
from .database import (
    postgres,
    get_s2s_manager,
    get_shipper_manager,
    S2SManager,
    ShipperDBManager
)

app = Flask(__name__)
CORS(app)


def add_no_cache_headers(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


app.after_request(add_no_cache_headers)


@app.route('/health')
def health():
    return jsonify({'status': 'healthy', 'timestamp': datetime.utcnow().isoformat()})


# Configuration endpoints
@app.route('/api/config', methods=['GET'])
def get_config():
    config = postgres.get_all_config()
    safe_config = {}
    for key, value in config.items():
        if isinstance(value, dict) and 'password' in value:
            value = {k: v for k, v in value.items() if k != 'password'}
            value['password'] = '********' if config.get(key, {}).get('password') else ''
        safe_config[key] = value
    return jsonify(safe_config)


@app.route('/api/config/s2s', methods=['POST'])
def save_s2s_config():
    data = request.json
    required = ['server', 'database', 'username', 'password']
    if not all(data.get(f) for f in required):
        return jsonify({'error': 'Missing required fields'}), 400

    postgres.set_config('s2s_connection', {
        'server': data['server'],
        'port': data.get('port', 1433),
        'database': data['database'],
        'username': data['username'],
        'password': data['password']
    })
    return jsonify({'success': True})


@app.route('/api/config/shipper', methods=['POST'])
def save_shipper_config():
    data = request.json
    required = ['server', 'database', 'username', 'password']
    if not all(data.get(f) for f in required):
        return jsonify({'error': 'Missing required fields'}), 400

    postgres.set_config('shipper_connection', {
        'server': data['server'],
        'port': data.get('port', 1433),
        'database': data['database'],
        'table_name': data.get('table_name', 'case_barcodes'),
        'username': data['username'],
        'password': data['password']
    })
    return jsonify({'success': True})


@app.route('/api/config/test-s2s', methods=['POST'])
def test_s2s_connection():
    data = request.json
    manager = S2SManager(
        server=data['server'],
        port=data.get('port', 1433),
        database=data['database'],
        username=data['username'],
        password=data['password']
    )
    success, message = manager.test_connection()
    return jsonify({'success': success, 'message': message})


@app.route('/api/config/test-shipper', methods=['POST'])
def test_shipper_connection():
    data = request.json
    manager = ShipperDBManager(
        server=data['server'],
        port=data.get('port', 1433),
        database=data['database'],
        username=data['username'],
        password=data['password'],
        table_name=data.get('table_name', 'case_barcodes')
    )
    success, message = manager.test_connection()
    return jsonify({'success': success, 'message': message})


# Excluded products endpoints
@app.route('/api/excluded-products', methods=['GET'])
def get_excluded_products():
    try:
        products = postgres.get_excluded_products()
        return jsonify([{
            'id': p['id'],
            'product_upc': p['product_upc'],
            'product_description': p['product_description'],
            'excluded_at': p['excluded_at'].isoformat() if p['excluded_at'] else None
        } for p in products])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/excluded-products', methods=['POST'])
def add_excluded_product():
    data = request.json
    upc = data.get('upc', '').strip()
    description = data.get('description', '').strip()

    if not upc:
        return jsonify({'error': 'UPC is required'}), 400

    try:
        product = postgres.add_excluded_product(upc, description)
        return jsonify({
            'success': True,
            'product': {
                'id': product['id'],
                'product_upc': product['product_upc'],
                'product_description': product['product_description'],
                'excluded_at': product['excluded_at'].isoformat() if product['excluded_at'] else None
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/excluded-products/<path:upc>', methods=['DELETE'])
def remove_excluded_product(upc):
    try:
        removed = postgres.remove_excluded_product(upc)
        if not removed:
            return jsonify({'error': 'Product not found in exclusion list'}), 404
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Excluded suppliers endpoints
@app.route('/api/excluded-suppliers', methods=['GET'])
def get_excluded_suppliers():
    try:
        suppliers = postgres.get_excluded_suppliers()
        return jsonify([{
            'id': s['id'],
            'supplier_id': s['supplier_id'],
            'supplier_name': s['supplier_name'],
            'excluded_at': s['excluded_at'].isoformat() if s['excluded_at'] else None
        } for s in suppliers])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/excluded-suppliers', methods=['POST'])
def add_excluded_supplier():
    data = request.json
    supplier_id = data.get('supplier_id')
    supplier_name = data.get('supplier_name', '').strip()

    if not supplier_id:
        return jsonify({'error': 'Supplier ID is required'}), 400

    try:
        supplier = postgres.add_excluded_supplier(supplier_id, supplier_name)
        return jsonify({
            'success': True,
            'supplier': {
                'id': supplier['id'],
                'supplier_id': supplier['supplier_id'],
                'supplier_name': supplier['supplier_name'],
                'excluded_at': supplier['excluded_at'].isoformat() if supplier['excluded_at'] else None
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/excluded-suppliers/<int:supplier_id>', methods=['DELETE'])
def remove_excluded_supplier(supplier_id):
    try:
        removed = postgres.remove_excluded_supplier(supplier_id)
        if not removed:
            return jsonify({'error': 'Supplier not found in exclusion list'}), 404
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Purchase Order endpoints
@app.route('/api/pos', methods=['GET'])
def get_pos():
    s2s = get_s2s_manager()
    if not s2s:
        return jsonify({'error': 'S2S database not configured'}), 400

    try:
        supplier_id = request.args.get('supplier_id')
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')

        pos = s2s.get_open_pos(supplier_id, date_from, date_to)

        # Get excluded supplier IDs to filter out
        excluded_supplier_ids = postgres.get_excluded_supplier_ids()

        result = []
        for po in pos:
            # Skip POs from excluded suppliers
            if po['SupplierID'] in excluded_supplier_ids:
                continue
            result.append({
                'po_id': po['PoID'],
                'po_number': po['PoNumber'],
                'po_date': po['PoDate'].isoformat() if po['PoDate'] else None,
                'required_date': po['RequiredDate'].isoformat() if po['RequiredDate'] else None,
                'supplier_id': po['SupplierID'],
                'supplier_name': po['BusinessName'],
                'title': po['PoTitle'],
                'total_qty_ordered': po['TotQtyOrd'],
                'total_qty_received': po['TotQtyRcv'],
                'num_lines': po['NoLines']
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/pos/<int:po_id>', methods=['GET'])
def get_po_details(po_id):
    s2s = get_s2s_manager()
    if not s2s:
        return jsonify({'error': 'S2S database not configured'}), 400

    try:
        po = s2s.get_po_details(po_id)
        if not po:
            return jsonify({'error': 'PO not found'}), 404

        # Get excluded UPCs to filter out
        excluded_upcs = postgres.get_excluded_upcs()

        result = {
            'po_id': po['PoID'],
            'po_number': po['PoNumber'],
            'po_date': po['PoDate'].isoformat() if po['PoDate'] else None,
            'required_date': po['RequiredDate'].isoformat() if po['RequiredDate'] else None,
            'supplier_id': po['SupplierID'],
            'supplier_name': po['BusinessName'],
            'title': po['PoTitle'],
            'total_qty_ordered': po['TotQtyOrd'],
            'total_qty_received': po['TotQtyRcv'],
            'num_lines': po['NoLines'],
            'notes': po['Notes'],
            'lines': []
        }

        for line in po['lines']:
            # Skip excluded products
            if line['ProductUPC'] in excluded_upcs:
                continue
            result['lines'].append({
                'line_id': line['LineID'],
                'product_id': line['ProductID'],
                'product_sku': line['ProductSKU'],
                'product_upc': line['ProductUPC'],
                'product_description': line['ProductDescription'],
                'unit_desc': line['UnitDesc'],
                'unit_qty': line['UnitQty'],
                'qty_ordered': line['QtyOrdered'],
                'qty_received': line['QtyReceived'],
                'unit_cost': float(line['UnitCost']) if line['UnitCost'] else 0,
                'item_size': line['ItemSize']
            })

        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/suppliers', methods=['GET'])
def get_suppliers():
    s2s = get_s2s_manager()
    if not s2s:
        return jsonify({'error': 'S2S database not configured'}), 400

    try:
        suppliers = s2s.get_suppliers()
        result = [{'id': s['SupplierID'], 'name': s['BusinessName']} for s in suppliers]
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Session endpoints
@app.route('/api/sessions', methods=['POST'])
def create_session():
    data = request.json
    required = ['po_id', 'po_number']
    if not all(data.get(f) for f in required):
        return jsonify({'error': 'Missing required fields'}), 400

    try:
        session = postgres.create_session(
            po_id=data['po_id'],
            po_number=data['po_number'],
            supplier_name=data.get('supplier_name')
        )
        return jsonify({
            'id': session['id'],
            'po_id': session['po_id'],
            'po_number': session['po_number'],
            'supplier_name': session['supplier_name'],
            'status': session['status'],
            'started_at': session['started_at'].isoformat()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/active', methods=['GET'])
def get_active_session():
    try:
        session = postgres.get_active_session()
        if not session:
            return jsonify(None)
        return jsonify({
            'id': session['id'],
            'po_id': session['po_id'],
            'po_number': session['po_number'],
            'supplier_name': session['supplier_name'],
            'status': session['status'],
            'started_at': session['started_at'].isoformat()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>', methods=['GET'])
def get_session(session_id):
    try:
        session = postgres.get_session(session_id)
        if not session:
            return jsonify({'error': 'Session not found'}), 404

        scans = postgres.get_session_scans(session_id)
        totals = postgres.get_session_totals(session_id)

        return jsonify({
            'id': session['id'],
            'po_id': session['po_id'],
            'po_number': session['po_number'],
            'supplier_name': session['supplier_name'],
            'status': session['status'],
            'started_at': session['started_at'].isoformat(),
            'completed_at': session['completed_at'].isoformat() if session['completed_at'] else None,
            'scans': [{
                'id': s['id'],
                'barcode': s['barcode'],
                'barcode_type': s['barcode_type'],
                'product_upc': s['product_upc'],
                'product_description': s['product_description'],
                'line_id': s['line_id'],
                'quantity': s['quantity'],
                'scanned_at': s['scanned_at'].isoformat()
            } for s in scans],
            'totals': [{
                'line_id': t['line_id'],
                'product_upc': t['product_upc'],
                'product_description': t['product_description'],
                'total_received': t['total_received']
            } for t in totals]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/scan', methods=['POST'])
def process_scan(session_id):
    data = request.json
    barcode = data.get('barcode', '').strip()

    if not barcode:
        return jsonify({'error': 'Barcode is required'}), 400

    # Get session and PO details
    session = postgres.get_session(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    s2s = get_s2s_manager()
    if not s2s:
        return jsonify({'error': 'S2S database not configured'}), 400

    shipper = get_shipper_manager()

    try:
        po = s2s.get_po_details(session['po_id'])
        if not po:
            return jsonify({'error': 'PO not found'}), 404

        # Check if barcode is a case barcode
        unit_barcode = barcode
        quantity = 1
        barcode_type = 'product'

        if shipper:
            case_info = shipper.find_case_barcode(barcode)
            if case_info:
                unit_barcode = case_info['unit_barcode']
                quantity = case_info['quantity']
                barcode_type = 'case'

        # Find matching line in PO
        matching_line = None
        for line in po['lines']:
            if line['ProductUPC'] == unit_barcode:
                matching_line = line
                break

        if not matching_line:
            return jsonify({
                'error': f'Item not found in PO',
                'barcode': barcode,
                'unit_barcode': unit_barcode if barcode_type == 'case' else None
            }), 400

        # Record the scan
        scan = postgres.add_scan_record(
            session_id=session_id,
            barcode=barcode,
            barcode_type=barcode_type,
            product_upc=unit_barcode,
            product_description=matching_line['ProductDescription'],
            line_id=matching_line['LineID'],
            quantity=quantity
        )

        # Get updated totals
        totals = postgres.get_session_totals(session_id)

        return jsonify({
            'success': True,
            'scan': {
                'id': scan['id'],
                'barcode': scan['barcode'],
                'barcode_type': scan['barcode_type'],
                'product_upc': scan['product_upc'],
                'product_description': scan['product_description'],
                'quantity': scan['quantity'],
                'scanned_at': scan['scanned_at'].isoformat()
            },
            'totals': [{
                'line_id': t['line_id'],
                'product_upc': t['product_upc'],
                'product_description': t['product_description'],
                'total_received': t['total_received']
            } for t in totals]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/complete', methods=['POST'])
def complete_session(session_id):
    try:
        session = postgres.update_session_status(session_id, 'completed')
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        return jsonify({
            'id': session['id'],
            'status': session['status'],
            'completed_at': session['completed_at'].isoformat()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/cancel', methods=['POST'])
def cancel_session(session_id):
    try:
        session = postgres.update_session_status(session_id, 'cancelled')
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        return jsonify({
            'id': session['id'],
            'status': session['status'],
            'completed_at': session['completed_at'].isoformat()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
