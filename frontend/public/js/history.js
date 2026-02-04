// Inventory History Page Logic

const API_BASE = '/api';
let currentPage = 1;
const pageSize = 50;
let totalRecords = 0;
let pendingUndoId = null;

// DOM Elements
const historyBody = document.getElementById('history-body');
const emptyState = document.getElementById('empty-state');
const pagination = document.getElementById('pagination');
const paginationInfo = document.getElementById('pagination-info');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const showUndoneCheckbox = document.getElementById('show-undone');
const undoModal = document.getElementById('undo-modal');
const undoProductName = document.getElementById('undo-product-name');
const undoQtyValue = document.getElementById('undo-qty-value');
const undoConfirmBtn = document.getElementById('undo-confirm');
const undoCancelBtn = document.getElementById('undo-cancel');
const toast = document.getElementById('toast');

// Filter elements
const dateFromInput = document.getElementById('date-from');
const dateToInput = document.getElementById('date-to');
const upcSearchInput = document.getElementById('upc-search');
const clearFiltersBtn = document.getElementById('clear-filters');

// Debounce utility
function debounce(func, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadHistory();

    showUndoneCheckbox.addEventListener('change', () => {
        currentPage = 1;
        loadHistory();
    });

    // Filter event listeners
    dateFromInput.addEventListener('change', () => {
        currentPage = 1;
        loadHistory();
    });

    dateToInput.addEventListener('change', () => {
        currentPage = 1;
        loadHistory();
    });

    upcSearchInput.addEventListener('input', debounce(() => {
        currentPage = 1;
        loadHistory();
    }, 300));

    clearFiltersBtn.addEventListener('click', clearFilters);

    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadHistory();
        }
    });

    nextBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(totalRecords / pageSize);
        if (currentPage < totalPages) {
            currentPage++;
            loadHistory();
        }
    });

    undoCancelBtn.addEventListener('click', hideUndoModal);
    undoConfirmBtn.addEventListener('click', confirmUndo);

    // Close modal on overlay click
    undoModal.addEventListener('click', (e) => {
        if (e.target === undoModal) {
            hideUndoModal();
        }
    });
});

function clearFilters() {
    dateFromInput.value = '';
    dateToInput.value = '';
    upcSearchInput.value = '';
    currentPage = 1;
    loadHistory();
}

async function loadHistory() {
    const includeUndone = showUndoneCheckbox.checked;
    const offset = (currentPage - 1) * pageSize;

    historyBody.innerHTML = `
        <tr>
            <td colspan="7" class="loading-cell">
                <div class="spinner"></div>
            </td>
        </tr>
    `;

    try {
        let url = `${API_BASE}/inventory-history?limit=${pageSize}&offset=${offset}&include_undone=${includeUndone}`;
        if (dateFromInput.value) url += `&date_from=${dateFromInput.value}`;
        if (dateToInput.value) url += `&date_to=${dateToInput.value}`;
        if (upcSearchInput.value.trim()) url += `&upc=${encodeURIComponent(upcSearchInput.value.trim())}`;

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load history');
        }

        totalRecords = data.total;
        renderHistory(data.changes);
        updatePagination();
    } catch (error) {
        historyBody.innerHTML = `
            <tr>
                <td colspan="7" class="loading-cell">
                    <div class="alert alert-error">Error: ${error.message}</div>
                </td>
            </tr>
        `;
    }
}

function renderHistory(changes) {
    if (changes.length === 0) {
        historyBody.innerHTML = '';
        emptyState.classList.remove('hidden');
        pagination.classList.add('hidden');
        document.querySelector('.history-table-wrapper').classList.add('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    pagination.classList.remove('hidden');
    document.querySelector('.history-table-wrapper').classList.remove('hidden');

    historyBody.innerHTML = changes.map(change => {
        const isUndone = change.undone_at !== null;
        const rowClass = isUndone ? 'undone' : '';
        const changeSign = change.qty_changed >= 0 ? '+' : '';
        const changeClass = change.qty_changed >= 0 ? 'positive' : 'negative';

        const date = new Date(change.changed_at);
        const formattedDate = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        const formattedTime = date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        const poInfo = change.po_number
            ? `<div class="po-cell">${change.po_number}</div>
               <div class="po-supplier">${change.supplier_name || ''}</div>`
            : '<span class="po-supplier">N/A</span>';

        const actionCell = isUndone
            ? '<span class="undone-badge">Undone</span>'
            : `<button class="undo-btn" onclick="showUndoModal(${change.id}, '${escapeHtml(change.product_description || change.product_upc)}', ${change.qty_changed})">Undo</button>`;

        return `
            <tr class="${rowClass}">
                <td class="date-cell">
                    <div>${formattedDate}</div>
                    <div style="font-size: 12px;">${formattedTime}</div>
                </td>
                <td class="product-cell">
                    <div class="product-desc" title="${escapeHtml(change.product_description || '')}">${escapeHtml(change.product_description || 'Unknown')}</div>
                    <div class="product-upc">${change.product_upc}</div>
                </td>
                <td>${poInfo}</td>
                <td class="text-right qty-cell">${change.qty_before ?? '-'}</td>
                <td class="text-right">
                    <span class="change-badge ${changeClass}">${changeSign}${change.qty_changed}</span>
                </td>
                <td class="text-right qty-cell">${change.qty_after ?? '-'}</td>
                <td class="text-center">${actionCell}</td>
            </tr>
        `;
    }).join('');
}

function updatePagination() {
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;
    paginationInfo.textContent = `Page ${currentPage} of ${totalPages}`;

    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
}

function showUndoModal(id, productName, qty) {
    pendingUndoId = id;
    undoProductName.textContent = productName;
    undoQtyValue.textContent = qty;
    undoModal.classList.remove('hidden');
}

function hideUndoModal() {
    pendingUndoId = null;
    undoModal.classList.add('hidden');
}

async function confirmUndo() {
    if (!pendingUndoId) return;

    undoConfirmBtn.disabled = true;
    undoConfirmBtn.textContent = 'Processing...';

    try {
        const response = await fetch(`${API_BASE}/inventory-history/${pendingUndoId}/undo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (data.success) {
            showToast(data.message, 'success');
            hideUndoModal();
            loadHistory();
        } else {
            showToast(data.error || 'Failed to undo change', 'error');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    } finally {
        undoConfirmBtn.disabled = false;
        undoConfirmBtn.textContent = 'Undo Change';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = '') {
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}
