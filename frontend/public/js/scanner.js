// Scanner / Receiving page logic

const API_BASE = '/api';

let sessionId = null;
let poData = null;
let receivedTotals = {};
let recentScans = [];
let pendingProduct = null;
let pendingExclude = null;  // { lineId, upc, description }
let quickScanMode = localStorage.getItem('quickScanMode') === 'true';
let autoCompleteTimer = null;
let countdownInterval = null;

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
        document.getElementById('po-number').textContent = `PO #${poData.po_number}`;
        document.getElementById('po-date').textContent = formatDate(poData.po_date);
        document.getElementById('po-supplier').textContent = poData.supplier_name || 'Unknown Supplier';

        // Load received totals from SQL Server PO data
        poData.lines.forEach(line => {
            receivedTotals[line.line_id] = line.qty_received || 0;
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

// Check if PO is fully received
function isPOComplete() {
    if (!poData || poData.lines.length === 0) return false;

    for (const line of poData.lines) {
        const ordered = line.qty_ordered || 0;
        const received = receivedTotals[line.line_id] || 0;
        if (received < ordered) {
            return false;
        }
    }
    return true;
}

// Start auto-complete countdown
function startAutoComplete() {
    let secondsLeft = 5;
    document.getElementById('countdown-seconds').textContent = secondsLeft;
    showElement('auto-complete-overlay');

    countdownInterval = setInterval(() => {
        secondsLeft--;
        document.getElementById('countdown-seconds').textContent = secondsLeft;
    }, 1000);

    autoCompleteTimer = setTimeout(async () => {
        clearInterval(countdownInterval);
        try {
            await fetch(`${API_BASE}/sessions/${sessionId}/complete`, {
                method: 'POST'
            });
            window.location.href = '/';
        } catch (error) {
            hideElement('auto-complete-overlay');
            showToast('Failed to complete session', 'error');
        }
    }, 5000);
}

// Cancel auto-complete
function cancelAutoComplete() {
    if (autoCompleteTimer) {
        clearTimeout(autoCompleteTimer);
        autoCompleteTimer = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    hideElement('auto-complete-overlay');
    document.getElementById('scan-input').focus();
}

// Show exclude confirmation modal
function showExcludeModal(lineId, upc, description) {
    if (!upc) {
        showToast('Cannot exclude product without UPC', 'error');
        return;
    }

    pendingExclude = { lineId, upc, description };
    document.getElementById('exclude-product-name').textContent = description || 'Unknown Product';
    showElement('exclude-modal');
}

// Hide exclude confirmation modal
function hideExcludeModal() {
    hideElement('exclude-modal');
    pendingExclude = null;
    document.getElementById('scan-input').focus();
}

// Confirm exclude product (called when user confirms in modal)
async function confirmExclude() {
    if (!pendingExclude) return;

    const { lineId, upc, description } = pendingExclude;
    hideExcludeModal();

    try {
        const response = await fetch(`${API_BASE}/excluded-products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upc, description })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to exclude product');
        }

        // Remove from poData.lines (critical for completion check)
        poData.lines = poData.lines.filter(l => l.line_id !== lineId);

        // Remove from receivedTotals if scans exist
        delete receivedTotals[lineId];

        // Update progress bar (now excludes this item from total)
        updateProgress();

        // Re-render expected items (removes from UI)
        renderExpectedItems();

        showToast('Product excluded', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Exclude product - shows confirmation modal first
function excludeProduct(lineId, upc, description) {
    showExcludeModal(lineId, upc, description);
}

// Quick scan a product by clicking on it (uses system UPC)
function quickScanProduct(upc) {
    if (!upc) {
        showToast('No barcode available for this product', 'error');
        return;
    }
    // Visual feedback - show barcode in input briefly
    scanInput.value = upc;
    setTimeout(() => { scanInput.value = ''; }, 100);
    // Process the scan using existing logic
    processScan(upc);
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
                <th style="width: 40px"></th>
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
        tr.className = rowClass + ' clickable-row';
        tr.onclick = (e) => {
            // Don't trigger if clicking the exclude button
            if (e.target.closest('.exclude-btn')) return;
            quickScanProduct(line.product_upc || '');
        };
        tr.innerHTML = `
            <td>
                <div style="font-weight: 500">${line.product_description || 'Unknown'}</div>
                <div style="font-size: 12px; color: var(--on-surface-secondary)">${line.product_upc || '-'}</div>
            </td>
            <td style="text-align: right">${ordered}</td>
            <td style="text-align: right; font-weight: 500">${received}</td>
            <td style="text-align: center">
                <button class="exclude-btn" title="Exclude from future POs" onclick="excludeProduct(${line.line_id}, '${(line.product_upc || '').replace(/'/g, "\\'")}', '${(line.product_description || '').replace(/'/g, "\\'")}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </td>
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

// Validate barcode (mode=validate) - returns product info without recording
async function validateBarcode(barcode) {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: barcode.trim(), mode: 'validate' })
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || 'Barcode not found');
    }

    return result;
}

// Record scan with quantity (mode=record)
async function recordScan(barcode, quantity = null) {
    const body = { barcode: barcode.trim(), mode: 'record' };
    if (quantity !== null) {
        body.quantity = quantity;
    }

    const response = await fetch(`${API_BASE}/sessions/${sessionId}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || 'Scan failed');
    }

    return result;
}

// Show quantity modal
function showQuantityModal(product, barcode) {
    const nameEl = document.getElementById('qty-product-name');
    const upcEl = document.getElementById('qty-product-upc');
    const typeEl = document.getElementById('qty-scan-type');
    const orderedEl = document.getElementById('qty-ordered');
    const receivedEl = document.getElementById('qty-received');
    const remainingEl = document.getElementById('qty-remaining');
    const labelEl = document.getElementById('qty-label');
    const inputEl = document.getElementById('qty-input');

    nameEl.textContent = product.product_description || 'Unknown Product';
    upcEl.textContent = product.product_upc;

    if (product.barcode_type === 'case') {
        typeEl.textContent = `Case (${product.detected_quantity} units each)`;
        typeEl.className = 'qty-scan-type case';
        labelEl.textContent = `Cases (×${product.detected_quantity} units each)`;
    } else {
        typeEl.textContent = 'Unit';
        typeEl.className = 'qty-scan-type product';
        labelEl.textContent = 'Quantity';
    }

    orderedEl.textContent = product.qty_ordered;
    receivedEl.textContent = product.qty_received;
    remainingEl.textContent = product.remaining;

    // Set default value: 1 for units, or remaining/detected_quantity for cases (rounded up)
    if (product.barcode_type === 'case') {
        const casesRemaining = Math.ceil(product.remaining / product.detected_quantity);
        inputEl.value = Math.max(1, casesRemaining);
    } else {
        inputEl.value = Math.max(1, product.remaining);
    }

    pendingProduct = { ...product, barcode };
    showElement('quantity-modal');

    // Focus and select input
    setTimeout(() => {
        inputEl.focus();
        inputEl.select();
    }, 100);
}

// Hide quantity modal
function hideQuantityModal() {
    hideElement('quantity-modal');
    pendingProduct = null;
    document.getElementById('scan-input').focus();
}

// Calculate final quantity from modal input
function calculateFinalQuantity() {
    const inputEl = document.getElementById('qty-input');
    let quantity = parseInt(inputEl.value, 10);

    if (isNaN(quantity) || quantity < 1) {
        return null;
    }

    // For case scans, multiply by units per case
    if (pendingProduct && pendingProduct.barcode_type === 'case') {
        quantity = quantity * pendingProduct.detected_quantity;
    }

    return quantity;
}

// Process barcode scan - main entry point
async function processScan(barcode) {
    if (!barcode.trim()) return;

    // If modal is open and new scan comes in, cancel current and process new
    if (pendingProduct) {
        hideQuantityModal();
    }

    hideElement('scan-error');
    document.getElementById('scan-status').textContent = 'Processing...';

    try {
        if (quickScanMode) {
            // Quick Scan Mode: Record immediately with detected quantity
            const result = await recordScan(barcode);
            handleScanSuccess(result);
        } else {
            // Normal Mode: Validate first, show modal
            const result = await validateBarcode(barcode);
            if (result.success && result.product) {
                document.getElementById('scan-status').textContent = 'Enter quantity...';
                showQuantityModal(result.product, barcode);
            }
        }
    } catch (error) {
        document.getElementById('scan-error').textContent = error.message;
        showElement('scan-error');
        document.getElementById('scan-status').textContent = 'Scan failed - try again';
        showToast(error.message, 'error');
    }
}

// Handle successful scan record
function handleScanSuccess(result) {
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

    // Check if PO is complete and start auto-complete countdown
    if (isPOComplete()) {
        startAutoComplete();
    }
}

// Confirm quantity from modal
async function confirmQuantity() {
    if (!pendingProduct) return;

    const quantity = calculateFinalQuantity();
    if (quantity === null) {
        showToast('Please enter a valid quantity', 'error');
        return;
    }

    const barcode = pendingProduct.barcode;
    hideQuantityModal();

    try {
        const result = await recordScan(barcode, quantity);
        handleScanSuccess(result);
    } catch (error) {
        document.getElementById('scan-error').textContent = error.message;
        showElement('scan-error');
        document.getElementById('scan-status').textContent = 'Scan failed - try again';
        showToast(error.message, 'error');
    }
}

// Receive all remaining
async function receiveAll() {
    if (!pendingProduct) return;

    const remaining = pendingProduct.remaining;
    if (remaining < 1) {
        showToast('No remaining items to receive', 'error');
        return;
    }

    const barcode = pendingProduct.barcode;
    hideQuantityModal();

    try {
        const result = await recordScan(barcode, remaining);
        handleScanSuccess(result);
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

// Keep focus on scan input (unless modal is open)
scanInput.addEventListener('blur', () => {
    setTimeout(() => {
        if (!pendingProduct) {
            scanInput.focus();
        }
    }, 100);
});

// Quick Scan Mode toggle
const quickScanToggle = document.getElementById('quick-scan-toggle');
quickScanToggle.checked = quickScanMode;

quickScanToggle.addEventListener('change', () => {
    quickScanMode = quickScanToggle.checked;
    localStorage.setItem('quickScanMode', quickScanMode);
    showToast(quickScanMode ? 'Quick Scan Mode ON' : 'Quick Scan Mode OFF', 'info');
});

// Quantity modal handlers
document.getElementById('qty-cancel').addEventListener('click', hideQuantityModal);
document.getElementById('qty-confirm').addEventListener('click', confirmQuantity);
document.getElementById('qty-receive-all').addEventListener('click', receiveAll);

// Handle Enter key in quantity input
document.getElementById('qty-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        confirmQuantity();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        hideQuantityModal();
    }
});

// Close modal on overlay click
document.getElementById('quantity-modal').addEventListener('click', (e) => {
    if (e.target.id === 'quantity-modal') {
        hideQuantityModal();
    }
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
        window.location.href = '/';
    } catch (error) {
        showToast('Failed to complete session', 'error');
    }
});

// Auto-complete cancel button
document.getElementById('cancel-auto-complete').addEventListener('click', cancelAutoComplete);

// Exclude modal handlers
document.getElementById('exclude-no').addEventListener('click', hideExcludeModal);
document.getElementById('exclude-yes').addEventListener('click', confirmExclude);
document.getElementById('exclude-modal').addEventListener('click', (e) => {
    if (e.target.id === 'exclude-modal') {
        hideExcludeModal();
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSession();
    scanInput.focus();
});
