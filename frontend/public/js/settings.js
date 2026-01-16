// Settings page logic

const API_BASE = '/api';

// Toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

// Update connection status display
function updateStatus(elementId, connected, message) {
    const el = document.getElementById(elementId);
    if (connected) {
        el.className = 'connection-status connected mb-16';
        el.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>${message || 'Connected'}</span>
        `;
    } else {
        el.className = 'connection-status disconnected mb-16';
        el.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <span>${message || 'Not configured'}</span>
        `;
    }
}

// Load existing configuration
async function loadConfig() {
    try {
        const response = await fetch(`${API_BASE}/config`);
        const config = await response.json();

        // S2S config
        if (config.s2s_connection) {
            document.getElementById('s2s-server').value = config.s2s_connection.server || '';
            document.getElementById('s2s-port').value = config.s2s_connection.port || 1433;
            document.getElementById('s2s-database').value = config.s2s_connection.database || '';
            document.getElementById('s2s-username').value = config.s2s_connection.username || '';
            if (config.s2s_connection.password === '********') {
                document.getElementById('s2s-password').placeholder = '(saved)';
            }
            updateStatus('s2s-status', true, 'Configured');
        }

        // Shipper config
        if (config.shipper_connection) {
            document.getElementById('shipper-server').value = config.shipper_connection.server || '';
            document.getElementById('shipper-port').value = config.shipper_connection.port || 1433;
            document.getElementById('shipper-database').value = config.shipper_connection.database || '';
            document.getElementById('shipper-table').value = config.shipper_connection.table_name || 'case_barcodes';
            document.getElementById('shipper-username').value = config.shipper_connection.username || '';
            if (config.shipper_connection.password === '********') {
                document.getElementById('shipper-password').placeholder = '(saved)';
            }
            updateStatus('shipper-status', true, 'Configured');
        }
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

// Test S2S connection
document.getElementById('s2s-test').addEventListener('click', async () => {
    const btn = document.getElementById('s2s-test');
    btn.disabled = true;
    btn.textContent = 'Testing...';

    try {
        const response = await fetch(`${API_BASE}/config/test-s2s`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                server: document.getElementById('s2s-server').value,
                port: parseInt(document.getElementById('s2s-port').value) || 1433,
                database: document.getElementById('s2s-database').value,
                username: document.getElementById('s2s-username').value,
                password: document.getElementById('s2s-password').value
            })
        });

        const result = await response.json();
        if (result.success) {
            showToast('Connection successful!', 'success');
            updateStatus('s2s-status', true, 'Connection successful');
        } else {
            showToast(`Connection failed: ${result.message}`, 'error');
            updateStatus('s2s-status', false, 'Connection failed');
        }
    } catch (error) {
        showToast('Connection test failed', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Test Connection';
    }
});

// Save S2S config
document.getElementById('s2s-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        const response = await fetch(`${API_BASE}/config/s2s`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                server: document.getElementById('s2s-server').value,
                port: parseInt(document.getElementById('s2s-port').value) || 1433,
                database: document.getElementById('s2s-database').value,
                username: document.getElementById('s2s-username').value,
                password: document.getElementById('s2s-password').value
            })
        });

        if (response.ok) {
            showToast('S2S configuration saved', 'success');
            updateStatus('s2s-status', true, 'Configured');
        } else {
            const error = await response.json();
            showToast(`Save failed: ${error.error}`, 'error');
        }
    } catch (error) {
        showToast('Failed to save configuration', 'error');
    }
});

// Test Shipper connection
document.getElementById('shipper-test').addEventListener('click', async () => {
    const btn = document.getElementById('shipper-test');
    btn.disabled = true;
    btn.textContent = 'Testing...';

    try {
        const response = await fetch(`${API_BASE}/config/test-shipper`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                server: document.getElementById('shipper-server').value,
                port: parseInt(document.getElementById('shipper-port').value) || 1433,
                database: document.getElementById('shipper-database').value,
                table_name: document.getElementById('shipper-table').value,
                username: document.getElementById('shipper-username').value,
                password: document.getElementById('shipper-password').value
            })
        });

        const result = await response.json();
        if (result.success) {
            showToast('Connection successful!', 'success');
            updateStatus('shipper-status', true, 'Connection successful');
        } else {
            showToast(`Connection failed: ${result.message}`, 'error');
            updateStatus('shipper-status', false, 'Connection failed');
        }
    } catch (error) {
        showToast('Connection test failed', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Test Connection';
    }
});

// Save Shipper config
document.getElementById('shipper-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        const response = await fetch(`${API_BASE}/config/shipper`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                server: document.getElementById('shipper-server').value,
                port: parseInt(document.getElementById('shipper-port').value) || 1433,
                database: document.getElementById('shipper-database').value,
                table_name: document.getElementById('shipper-table').value,
                username: document.getElementById('shipper-username').value,
                password: document.getElementById('shipper-password').value
            })
        });

        if (response.ok) {
            showToast('ShipperDB configuration saved', 'success');
            updateStatus('shipper-status', true, 'Configured');
        } else {
            const error = await response.json();
            showToast(`Save failed: ${error.error}`, 'error');
        }
    } catch (error) {
        showToast('Failed to save configuration', 'error');
    }
});

// Excluded products management
async function loadExcludedProducts() {
    const container = document.getElementById('excluded-list');

    try {
        const response = await fetch(`${API_BASE}/excluded-products`);
        const products = await response.json();

        if (products.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-desc">No excluded products</div>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        products.forEach(product => {
            const div = document.createElement('div');
            div.className = 'excluded-item';
            div.innerHTML = `
                <div class="excluded-item-info">
                    <div class="excluded-item-desc">${product.product_description || 'Unknown'}</div>
                    <div class="excluded-item-upc">UPC: ${product.product_upc}</div>
                </div>
                <button class="btn btn-outline btn-sm" onclick="restoreProduct('${product.product_upc.replace(/'/g, "\\'")}')">Restore</button>
            `;
            container.appendChild(div);
        });
    } catch (error) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-desc">Failed to load excluded products</div>
            </div>
        `;
    }
}

async function restoreProduct(upc) {
    try {
        const response = await fetch(`${API_BASE}/excluded-products/${encodeURIComponent(upc)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to restore product');
        }

        showToast('Product restored', 'success');
        loadExcludedProducts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Excluded suppliers management
async function loadExcludedSuppliers() {
    const container = document.getElementById('excluded-suppliers-list');

    try {
        const response = await fetch(`${API_BASE}/excluded-suppliers`);
        const suppliers = await response.json();

        if (suppliers.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-desc">No excluded suppliers</div>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        suppliers.forEach(supplier => {
            const div = document.createElement('div');
            div.className = 'excluded-item';
            div.innerHTML = `
                <div class="excluded-item-info">
                    <div class="excluded-item-desc">${supplier.supplier_name || 'Unknown'}</div>
                    <div class="excluded-item-upc">ID: ${supplier.supplier_id}</div>
                </div>
                <button class="btn btn-outline btn-sm" onclick="restoreSupplier(${supplier.supplier_id})">Restore</button>
            `;
            container.appendChild(div);
        });
    } catch (error) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-desc">Failed to load excluded suppliers</div>
            </div>
        `;
    }
}

async function restoreSupplier(supplierId) {
    try {
        const response = await fetch(`${API_BASE}/excluded-suppliers/${supplierId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to restore supplier');
        }

        showToast('Supplier restored', 'success');
        loadExcludedSuppliers();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Load config on page load
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    loadExcludedProducts();
    loadExcludedSuppliers();
});
