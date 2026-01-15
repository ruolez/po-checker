// Scanner / Receiving page logic

const API_BASE = '/api';

let sessionId = null;
let poData = null;
let receivedTotals = {};
let recentScans = [];

// Get session ID from URL
const urlParams = new URLSearchParams(window.location.search);
sessionId = urlParams.get('session');

if (!sessionId) {
    window.location.href = '/';
}

// Toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

// Show/hide elements
function showElement(id) {
    document.getElementById(id).classList.remove('hidden');
}

function hideElement(id) {
    document.getElementById(id).classList.add('hidden');
}

// Format date
function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

// Load session and PO data
async function loadSession() {
    try {
        // Get session
        const sessionResponse = await fetch(`${API_BASE}/sessions/${sessionId}`);
        if (!sessionResponse.ok) {
            throw new Error('Session not found');
        }
        const session = await sessionResponse.json();

        // Get PO details
        const poResponse = await fetch(`${API_BASE}/pos/${session.po_id}`);
        if (!poResponse.ok) {
            throw new Error('PO not found');
        }
        poData = await poResponse.json();

        // Update UI with PO info
        document.getElementById('po-title').textContent = `PO #${poData.po_number}`;
        document.getElementById('po-number').textContent = `PO #${poData.po_number}`;
        document.getElementById('po-date').textContent = formatDate(poData.po_date);
        document.getElementById('po-supplier').textContent = poData.supplier_name || 'Unknown Supplier';

        // Load existing scan totals
        session.totals.forEach(t => {
            receivedTotals[t.line_id] = t.total_received;
        });

        // Load recent scans
        recentScans = session.scans.slice(0, 10);

        updateProgress();
        renderExpectedItems();
        renderRecentScans();

    } catch (error) {
        showToast(error.message, 'error');
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
    }
}

// Calculate and update progress
function updateProgress() {
    if (!poData) return;

    let totalOrdered = 0;
    let totalReceived = 0;

    poData.lines.forEach(line => {
        totalOrdered += line.qty_ordered || 0;
        totalReceived += receivedTotals[line.line_id] || 0;
    });

    const percentage = totalOrdered > 0 ? Math.min(100, (totalReceived / totalOrdered) * 100) : 0;

    document.getElementById('progress-text').textContent = `${totalReceived} / ${totalOrdered} items`;
    document.getElementById('progress-fill').style.width = `${percentage}%`;
}

// Render expected items list
function renderExpectedItems() {
    if (!poData) return;

    const container = document.getElementById('expected-items');
    container.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'summary-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Item</th>
                <th style="width: 60px; text-align: right">Ord</th>
                <th style="width: 60px; text-align: right">Rcv</th>
            </tr>
        </thead>
        <tbody id="expected-tbody"></tbody>
    `;

    const tbody = table.querySelector('#expected-tbody');

    poData.lines.forEach(line => {
        const ordered = line.qty_ordered || 0;
        const received = receivedTotals[line.line_id] || 0;
        const diff = received - ordered;

        let rowClass = '';
        if (received >= ordered && ordered > 0) {
            rowClass = 'complete';
        } else if (received > 0) {
            rowClass = 'discrepancy';
        } else if (ordered > 0) {
            rowClass = 'missing';
        }

        const tr = document.createElement('tr');
        tr.className = rowClass;
        tr.innerHTML = `
            <td>
                <div style="font-weight: 500">${line.product_description || 'Unknown'}</div>
                <div style="font-size: 12px; color: var(--on-surface-secondary)">${line.product_upc || '-'}</div>
            </td>
            <td style="text-align: right">${ordered}</td>
            <td style="text-align: right; font-weight: 500">${received}</td>
        `;
        tbody.appendChild(tr);
    });

    container.appendChild(table);
}

// Render recent scans
function renderRecentScans() {
    const container = document.getElementById('scan-list');

    if (recentScans.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-desc">No items scanned yet</div>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    recentScans.forEach(scan => {
        const div = document.createElement('div');
        div.className = 'scan-item';
        div.innerHTML = `
            <div class="scan-item-info">
                <div class="scan-item-desc">${scan.product_description || 'Unknown'}</div>
                <div class="scan-item-upc">${scan.barcode}${scan.barcode_type === 'case' ? ' (Case)' : ''}</div>
            </div>
            <span class="scan-item-qty">+${scan.quantity}</span>
        `;
        container.appendChild(div);
    });
}

// Process barcode scan
async function processScan(barcode) {
    if (!barcode.trim()) return;

    hideElement('scan-error');
    document.getElementById('scan-status').textContent = 'Processing...';

    try {
        const response = await fetch(`${API_BASE}/sessions/${sessionId}/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barcode: barcode.trim() })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Scan failed');
        }

        // Update received totals
        result.totals.forEach(t => {
            receivedTotals[t.line_id] = t.total_received;
        });

        // Add to recent scans
        recentScans.unshift(result.scan);
        if (recentScans.length > 10) {
            recentScans.pop();
        }

        // Update UI
        updateProgress();
        renderExpectedItems();
        renderRecentScans();

        // Show success
        const qty = result.scan.quantity;
        const type = result.scan.barcode_type === 'case' ? ' (Case)' : '';
        document.getElementById('scan-status').textContent = `Added ${qty}x ${result.scan.product_description}${type}`;
        showToast(`+${qty} ${result.scan.product_description}`, 'success');

    } catch (error) {
        document.getElementById('scan-error').textContent = error.message;
        showElement('scan-error');
        document.getElementById('scan-status').textContent = 'Scan failed - try again';
        showToast(error.message, 'error');
    }
}

// Scan input handling
const scanInput = document.getElementById('scan-input');

scanInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const barcode = scanInput.value;
        scanInput.value = '';
        processScan(barcode);
    }
});

// Keep focus on scan input
scanInput.addEventListener('blur', () => {
    setTimeout(() => {
        scanInput.focus();
    }, 100);
});

// Cancel button
document.getElementById('cancel-btn').addEventListener('click', () => {
    showElement('cancel-modal');
});

document.getElementById('cancel-no').addEventListener('click', () => {
    hideElement('cancel-modal');
    scanInput.focus();
});

document.getElementById('cancel-yes').addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE}/sessions/${sessionId}/cancel`, {
            method: 'POST'
        });
        window.location.href = '/';
    } catch (error) {
        showToast('Failed to cancel session', 'error');
    }
});

// Complete button
document.getElementById('complete-btn').addEventListener('click', () => {
    // Check if all items received
    let hasDiscrepancy = false;
    if (poData) {
        poData.lines.forEach(line => {
            const ordered = line.qty_ordered || 0;
            const received = receivedTotals[line.line_id] || 0;
            if (received < ordered) {
                hasDiscrepancy = true;
            }
        });
    }

    if (hasDiscrepancy) {
        showElement('complete-warning');
    } else {
        hideElement('complete-warning');
    }

    showElement('complete-modal');
});

document.getElementById('complete-no').addEventListener('click', () => {
    hideElement('complete-modal');
    scanInput.focus();
});

document.getElementById('complete-yes').addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE}/sessions/${sessionId}/complete`, {
            method: 'POST'
        });
        window.location.href = `/summary.html?session=${sessionId}`;
    } catch (error) {
        showToast('Failed to complete session', 'error');
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSession();
    scanInput.focus();
});
