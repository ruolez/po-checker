// PO List page logic

const API_BASE = '/api';

let activeSession = null;

// Toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

// Format date for display
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

// Show/hide elements
function showElement(id) {
    document.getElementById(id).classList.remove('hidden');
}

function hideElement(id) {
    document.getElementById(id).classList.add('hidden');
}

// Load suppliers for filter dropdown
async function loadSuppliers() {
    try {
        const response = await fetch(`${API_BASE}/suppliers`);
        if (!response.ok) return;

        const suppliers = await response.json();
        const select = document.getElementById('filter-supplier');

        suppliers.forEach(supplier => {
            const option = document.createElement('option');
            option.value = supplier.id;
            option.textContent = supplier.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Failed to load suppliers:', error);
    }
}

// Load PO list
async function loadPOs() {
    hideElement('error-state');
    hideElement('empty-state');
    hideElement('config-state');
    hideElement('po-list');
    showElement('loading');

    try {
        // Build query params
        const params = new URLSearchParams();
        const supplierId = document.getElementById('filter-supplier').value;
        const dateFrom = document.getElementById('filter-date-from').value;
        const dateTo = document.getElementById('filter-date-to').value;

        if (supplierId) params.append('supplier_id', supplierId);
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);

        const response = await fetch(`${API_BASE}/pos?${params}`);

        if (!response.ok) {
            const error = await response.json();
            if (error.error && error.error.includes('not configured')) {
                hideElement('loading');
                showElement('config-state');
                return;
            }
            throw new Error(error.error || 'Failed to load POs');
        }

        const pos = await response.json();
        hideElement('loading');

        if (pos.length === 0) {
            showElement('empty-state');
            return;
        }

        renderPOList(pos);
        showElement('po-list');
    } catch (error) {
        hideElement('loading');
        document.getElementById('error-state').textContent = error.message;
        showElement('error-state');
    }
}

// Render PO list
function renderPOList(pos) {
    const list = document.getElementById('po-list');
    list.innerHTML = '';

    pos.forEach(po => {
        const li = document.createElement('li');
        li.className = 'po-item';
        li.innerHTML = `
            <div class="po-header">
                <span class="po-number">${po.po_number || 'No Number'}</span>
                <span class="po-date">${formatDate(po.po_date)}</span>
            </div>
            <div class="po-supplier">${po.supplier_name || 'Unknown Supplier'}</div>
            <div class="po-meta">
                <span>📦 ${po.total_qty_ordered || 0} items ordered</span>
                <span>📝 ${po.num_lines || 0} lines</span>
            </div>
        `;
        li.addEventListener('click', () => startReceiving(po));
        list.appendChild(li);
    });
}

// Check for active session
async function checkActiveSession() {
    try {
        const response = await fetch(`${API_BASE}/sessions/active`);
        const session = await response.json();

        if (session && session.id) {
            activeSession = session;
            document.getElementById('resume-po-number').textContent = `PO #${session.po_number}`;
            document.getElementById('resume-supplier').textContent = session.supplier_name || 'Unknown Supplier';
            showElement('resume-modal');
        }
    } catch (error) {
        console.error('Failed to check active session:', error);
    }
}

// Start receiving for a PO
async function startReceiving(po) {
    try {
        // Create new session
        const response = await fetch(`${API_BASE}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                po_id: po.po_id,
                po_number: po.po_number,
                supplier_name: po.supplier_name
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to start session');
        }

        const session = await response.json();
        window.location.href = `/receive.html?session=${session.id}`;
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Resume modal handlers
document.getElementById('resume-continue').addEventListener('click', () => {
    if (activeSession) {
        window.location.href = `/receive.html?session=${activeSession.id}`;
    }
});

document.getElementById('resume-cancel').addEventListener('click', async () => {
    if (activeSession) {
        try {
            await fetch(`${API_BASE}/sessions/${activeSession.id}/cancel`, {
                method: 'POST'
            });
        } catch (error) {
            console.error('Failed to cancel session:', error);
        }
    }
    hideElement('resume-modal');
    activeSession = null;
});

// Filter change handlers
document.getElementById('filter-supplier').addEventListener('change', loadPOs);
document.getElementById('filter-date-from').addEventListener('change', loadPOs);
document.getElementById('filter-date-to').addEventListener('change', loadPOs);

// Refresh button
document.getElementById('refresh-btn').addEventListener('click', loadPOs);

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadSuppliers();
    await loadPOs();
    await checkActiveSession();
});
