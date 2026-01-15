// Summary page logic

const API_BASE = '/api';

// Get session ID from URL
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session');

if (!sessionId) {
    window.location.href = '/';
}

// Format date/time
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

// Calculate duration
function formatDuration(start, end) {
    if (!start || !end) return '-';
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate - startDate;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    if (diffHours > 0) {
        return `${diffHours}h ${mins}m`;
    }
    return `${mins}m`;
}

// Load summary data
async function loadSummary() {
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
        const poData = await poResponse.json();

        // Build received totals map
        const receivedTotals = {};
        session.totals.forEach(t => {
            receivedTotals[t.line_id] = t.total_received;
        });

        // Update header
        document.getElementById('po-number').textContent = `PO #${poData.po_number}`;
        document.getElementById('po-supplier').textContent = poData.supplier_name || 'Unknown Supplier';

        // Update status badge
        const badge = document.getElementById('status-badge');
        if (session.status === 'completed') {
            badge.textContent = 'Completed';
            badge.className = 'badge badge-success';
        } else if (session.status === 'cancelled') {
            badge.textContent = 'Cancelled';
            badge.className = 'badge badge-error';
        } else {
            badge.textContent = 'In Progress';
            badge.className = 'badge badge-warning';
        }

        // Session meta
        const duration = formatDuration(session.started_at, session.completed_at);
        document.getElementById('session-meta').innerHTML = `
            <span>Started: ${formatDateTime(session.started_at)}</span>
            <span>Duration: ${duration}</span>
        `;

        // Calculate stats
        let totalOrdered = 0;
        let totalReceived = 0;
        let hasDiscrepancy = false;

        poData.lines.forEach(line => {
            const ordered = line.qty_ordered || 0;
            const received = receivedTotals[line.line_id] || 0;
            totalOrdered += ordered;
            totalReceived += received;
            if (received !== ordered) {
                hasDiscrepancy = true;
            }
        });

        document.getElementById('stat-ordered').textContent = totalOrdered;
        document.getElementById('stat-received').textContent = totalReceived;
        document.getElementById('stat-lines').textContent = poData.lines.length;
        document.getElementById('stat-scans').textContent = session.scans.length;

        // Show appropriate alert
        if (hasDiscrepancy) {
            document.getElementById('discrepancy-alert').classList.remove('hidden');
        } else {
            document.getElementById('complete-alert').classList.remove('hidden');
        }

        // Render summary table
        const tbody = document.getElementById('summary-tbody');
        tbody.innerHTML = '';

        poData.lines.forEach(line => {
            const ordered = line.qty_ordered || 0;
            const received = receivedTotals[line.line_id] || 0;
            const diff = received - ordered;

            let rowClass = '';
            if (received >= ordered && ordered > 0) {
                rowClass = 'complete';
            } else if (received > 0 && received < ordered) {
                rowClass = 'discrepancy';
            } else if (received === 0 && ordered > 0) {
                rowClass = 'missing';
            }

            let diffDisplay = '';
            if (diff > 0) {
                diffDisplay = `<span style="color: var(--warning)">+${diff}</span>`;
            } else if (diff < 0) {
                diffDisplay = `<span style="color: var(--error)">${diff}</span>`;
            } else {
                diffDisplay = `<span style="color: var(--success)">0</span>`;
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
                <td style="text-align: right; font-weight: 500">${diffDisplay}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (error) {
        console.error('Failed to load summary:', error);
        document.getElementById('summary-tbody').innerHTML = `
            <tr>
                <td colspan="4" class="text-center" style="color: var(--error)">
                    Failed to load summary: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', loadSummary);
