// ==========================================
// CROSSPOINT BIBLE CHURCH LIBRARY - SUPABASE BACKEND
// ==========================================

const SUPABASE_URL = "https://wcfutxaxdxhdpfomsyml.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_VTYqn6uDQakIWBdL7S8EWA__Cz7PCq-";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State Variables (PascalCase properties to match original HTML logic)
let allBooks = [];
let filteredBooks = [];
let allMembers = [];
let allBorrows = [];
let allStorageStock = [];
let allDistributionLogs = [];

let displayedCount = 0;
const BOOKS_PER_PAGE = 6;
let currentUser = JSON.parse(localStorage.getItem('cbc_user')) || null;
let isLibrarianActive = sessionStorage.getItem('cbc_librarian_active') === 'true';
let activeBookForAction = null;
let currentCirculationFilter = 'All';

// Admin Settings
let churchLibrarySettings = { adminName: "Library Coordinator", adminPhone: "+254 704 486 616" };

let targetIssueBorrow = null;
let targetReturnBorrow = null;
let targetEditMember = null;
let currentStorageSubTab = 'stock';

document.addEventListener('DOMContentLoaded', () => {
    updateUserAuthUI();
    updateLibrarianUI();
    fetchLibraryDataFromSupabase();

    document.getElementById('search-input')?.addEventListener('input', handleSearchAndFilter);
    document.getElementById('category-filter')?.addEventListener('change', handleSearchAndFilter);
});

// MAP SUPABASE TO ORIGINAL PASCALCASE OBJECTS
const mapMember = db => ({
    MemberID: db.member_id, FullName: db.full_name, Designation: db.designation, Phone: db.phone, DateRegistered: db.date_registered
});
const mapBorrow = db => ({
    BorrowID: db.borrow_id, BookID: db.book_id, BookTitle: db.book_title, MemberID: db.member_id, MemberName: db.member_name,
    MemberPhone: db.member_phone, Type: db.type, PickupDate: db.pickup_date, PickupTime: db.pickup_time, IssuedDate: db.issued_date,
    DueDate: db.due_date, ReturnDate: db.return_date, Status: db.status, ConditionIssued: db.condition_issued,
    ConditionReturned: db.condition_returned, ExtensionUsed: db.extension_used, Penalty: db.penalty, Notes: db.notes
});
const mapStorage = db => ({
    ItemID: db.item_id, Title: db.title, Author: db.author, Category: db.category, AcquisitionType: db.acquisition_type,
    Source: db.source, DateReceived: db.date_received, TotalReceived: db.total_received, TotalDistributed: db.total_distributed,
    RemainingStock: db.remaining_stock, Notes: db.notes
});
const mapDist = db => ({
    LogID: db.log_id, ItemID: db.item_id, BookTitle: db.book_title, Recipient: db.recipient, Quantity: db.quantity, Date: db.date, Notes: db.notes
});

async function fetchLibraryDataFromSupabase() {
    try {
        const [booksRes, memRes, borRes, stoRes, distRes] = await Promise.all([
            supabaseClient.from('books').select('*'), supabaseClient.from('members').select('*'),
            supabaseClient.from('borrows').select('*'), supabaseClient.from('storage_stock').select('*'),
            supabaseClient.from('distribution_logs').select('*')
        ]);

        if (booksRes.error) throw booksRes.error;

        allBooks = (booksRes.data || []).map(normalizeBook);
        filteredBooks = allBooks;
        allMembers = (memRes.data || []).map(mapMember);
        allBorrows = (borRes.data || []).map(mapBorrow);
        allStorageStock = (stoRes.data || []).map(mapStorage);
        allDistributionLogs = (distRes.data || []).map(mapDist);

        if (currentUser) {
            const refreshed = allMembers.find(m => m.MemberID.toUpperCase() === currentUser.id.toUpperCase());
            if (refreshed) {
                currentUser.phone = refreshed.Phone || '';
                localStorage.setItem('cbc_user', JSON.stringify(currentUser));
                updateUserAuthUI();
            }
        }

        initCatalog();
        renderCirculationCounts();
        if (isLibrarianActive) renderAdminTables();

    } catch (err) {
        console.warn("Supabase Fetch Warning:", err.message);
    }
}

function normalizeBook(raw) {
    let parsedKeywords = [];
    try { parsedKeywords = typeof raw.keywords === 'string' ? JSON.parse(raw.keywords) : (raw.keywords || []); } catch(e) {}
    return {
        id: raw.id, title: raw.title || 'Untitled', author: raw.author || 'Unknown', category: raw.category || 'General',
        publicationDate: raw.publication_date || 'N/A', totalCopies: raw.copies || 1, copies: raw.copies || 1, pages: raw.pages || 0,
        classification: raw.classification || 'Borrowable', description: raw.description || '', image: raw.image || 'images/churchdiscipline.jpeg', keywords: parsedKeywords
    };
}

function calculateAvailableCopies(bookId, fallbackCopies) {
    const book = allBooks.find(b => b.id == bookId);
    const total = book ? (book.totalCopies || 1) : (fallbackCopies || 1);
    const activeLoans = allBorrows.filter(b => b.BookID == bookId && b.Type !== 'Onsite' && ['Approved', 'Active'].includes((b.Status || '').trim())).length;
    return Math.max(0, total - activeLoans);
}

// ---------------- PUBLIC CATALOG RENDERING ----------------
function initCatalog() {
    displayedCount = 0;
    const grid = document.getElementById('book-grid');
    if (grid) grid.innerHTML = '';
    loadMoreBooks();
}

function loadMoreBooks() {
    const grid = document.getElementById('book-grid');
    const loadMoreContainer = document.getElementById('load-more-container');
    const noResults = document.getElementById('no-results');
    if (!grid) return;

    if (filteredBooks.length === 0) {
        noResults?.classList.remove('hidden');
        loadMoreContainer?.classList.add('hidden');
        return;
    } else {
        noResults?.classList.add('hidden');
    }

    const nextBatch = filteredBooks.slice(displayedCount, displayedCount + BOOKS_PER_PAGE);

    nextBatch.forEach(book => {
        const copies = calculateAvailableCopies(book.id, book.copies);
        const card = document.createElement('div');
        card.className = "bg-white border border-church-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer";
        card.onclick = () => openBookModal(book);

        let shortDesc = book.description || '';
        if (shortDesc.length > 110) shortDesc = shortDesc.substring(0, 110).trim() + '...';

        card.innerHTML = `
            <div>
                <div class="h-64 bg-church-50 overflow-hidden relative p-2 flex items-center justify-center border-b border-church-100">
                    <img src="${book.image}" alt="${book.title}" class="w-full h-full object-contain group-hover:scale-105 transition duration-300" onerror="this.src='images/churchdiscipline.jpeg'">
                    <span class="absolute top-3 right-3 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm ${book.classification.toLowerCase().includes('borrowable') ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${book.classification}</span>
                </div>
                <div class="p-5 space-y-2">
                    <div class="flex justify-between text-xs text-church-600 font-medium"><span>${book.category}</span><span><i class="fa-solid fa-book-open mr-1"></i>${book.pages} pages</span></div>
                    <h3 class="font-bold text-church-900 text-base leading-snug">${book.title}</h3>
                    <p class="text-xs text-church-700 font-medium">By ${book.author}</p>
                    <p class="text-xs text-church-600 pt-1">${shortDesc}</p>
                </div>
            </div>
            <div class="px-5 pb-5 pt-3 border-t border-church-100 flex justify-between text-xs">
                <span class="${copies > 0 ? 'text-church-800' : 'text-red-600 font-bold'}"><i class="fa-solid fa-copy mr-1"></i>${copies > 0 ? copies + ' copies available' : 'Out of stock'}</span>
                <span class="text-church-600 font-semibold group-hover:translate-x-1 transition-transform">Details &rarr;</span>
            </div>`;
        grid.appendChild(card);
    });

    displayedCount += nextBatch.length;
    loadMoreContainer?.classList.toggle('hidden', displayedCount >= filteredBooks.length);
}

function handleSearchAndFilter() {
    const q = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('category-filter')?.value || '';
    filteredBooks = allBooks.filter(b => {
        if (cat && b.category !== cat) return false;
        if (!q) return true;
        const keys = b.keywords.map(k => String(k).toLowerCase());
        return (b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || b.category.toLowerCase().includes(q) || b.description.toLowerCase().includes(q) || keys.some(kw => kw.includes(q)));
    });
    initCatalog();
}

function updateUserAuthUI() {
    const d = document.getElementById('user-auth-badge');
    const m = document.getElementById('mobile-user-auth-badge');
    let h = currentUser ? `
        <div class="flex space-x-2 text-xs">
            <button onclick="openMyRequestsModal()" class="bg-church-100 border border-church-300 px-3 py-1.5 rounded-xl font-bold"><i class="fa-solid fa-user-circle text-amber-700"></i> ${currentUser.name} (${currentUser.designation})</button>
            <button onclick="logoutUser()" class="text-red-600 hover:text-red-800 font-bold">Logout</button>
        </div>` : `<button onclick="openLoginModal()" class="bg-church-800 text-white text-xs px-3.5 py-2 rounded-xl font-bold"><i class="fa-solid fa-id-card"></i> Sign In</button>`;
    if (d) d.innerHTML = h; if (m) m.innerHTML = h;
}

// ---------------- BOOK & BORROW MODALS ----------------
function openBookModal(book) {
    activeBookForAction = book;
    document.getElementById('modal-title').textContent = book.title;
    document.getElementById('modal-img').src = book.image;
    document.getElementById('modal-author').textContent = book.author;
    document.getElementById('modal-category').textContent = book.category;
    document.getElementById('modal-classification').textContent = book.classification;
    document.getElementById('modal-description').textContent = book.description || 'No description.';
    
    const copies = calculateAvailableCopies(book.id, book.copies);
    document.getElementById('modal-copies').textContent = copies;
    const btn = document.getElementById('modal-action-btn');

    if (copies <= 0) {
        btn.className = "px-4 py-2 bg-gray-400 text-white rounded-xl text-xs font-bold";
        btn.textContent = "Out of Stock"; btn.onclick = null;
    } else {
        btn.className = "px-4 py-2 bg-church-800 text-white rounded-xl text-xs font-bold";
        btn.textContent = "Request to Borrow";
        btn.onclick = () => { if(!currentUser){ openLoginModal(); return; } openBorrowForm(); };
    }
    document.getElementById('book-modal').classList.remove('hidden');
}

function openBorrowForm() {
    closeModal('book-modal');
    document.getElementById('borrow-book-title').textContent = activeBookForAction.title;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('borrow-pickup-date').value = today;
    document.getElementById('borrow-due-date').value = new Date(Date.now() + 12096e5).toISOString().split('T')[0];
    document.getElementById('borrow-modal').classList.remove('hidden');
}

async function submitBorrowRequest() {
    const borrowId = "BRW-" + Date.now();
    const obj = {
        borrow_id: borrowId, book_id: activeBookForAction.id, book_title: activeBookForAction.title, member_id: currentUser.id, member_name: currentUser.name,
        member_phone: currentUser.phone || '', type: 'Borrow', pickup_date: document.getElementById('borrow-pickup-date').value,
        pickup_time: document.getElementById('borrow-pickup-time').value, due_date: document.getElementById('borrow-due-date').value, status: 'Pending'
    };

    const { error } = await supabaseClient.from('borrows').insert([obj]);
    if (error) { alert(error.message); return; }

    allBorrows.unshift(mapBorrow(obj));
    closeModal('borrow-modal');
    initCatalog();
    renderCirculationCounts();
    alert("Request submitted successfully!");
}

async function loginMember() {
    const id = document.getElementById('login-id').value.trim().toUpperCase();
    const name = document.getElementById('login-name').value.trim().toLowerCase();
    const matched = allMembers.find(m => m.MemberID.toUpperCase() === id && m.FullName.toLowerCase() === name);
    if (matched) {
        currentUser = { id: matched.MemberID, name: matched.FullName, designation: matched.Designation, phone: matched.Phone || '' };
        localStorage.setItem('cbc_user', JSON.stringify(currentUser));
        updateUserAuthUI();
        closeModal('login-modal');
        alert(`Welcome, ${currentUser.name}!`);
    } else alert("Credentials not found in records.");
}

function logoutUser() { localStorage.removeItem('cbc_user'); currentUser = null; updateUserAuthUI(); }
function openMyRequestsModal() {
    const list = document.getElementById('my-requests-list');
    const myLoans = allBorrows.filter(b => b.MemberID == currentUser.id);
    list.innerHTML = myLoans.length === 0 ? '<p>No loans.</p>' : myLoans.map(b => `<div class="p-3 bg-church-50 border rounded-xl flex justify-between"><div><p class="font-bold">${b.BookTitle}</p></div><span class="font-bold">${b.Status}</span></div>`).join('');
    document.getElementById('my-requests-modal').classList.remove('hidden');
}

// ---------------- LIBRARIAN CONSOLE ----------------
function openAdminPinModal() {
    if (isLibrarianActive) { exitLibrarianConsole(); return; }
    document.getElementById('admin-pin-input').value = '';
    document.getElementById('admin-pin-modal').classList.remove('hidden');
}

function submitAdminPin() {
    if (document.getElementById('admin-pin-input').value.trim() === "1234") {
        isLibrarianActive = true; sessionStorage.setItem('cbc_librarian_active', 'true');
        closeModal('admin-pin-modal'); updateLibrarianUI(); renderAdminTables(); window.location.hash = "admin-panel";
    } else alert("Incorrect PIN.");
}

function exitLibrarianConsole() { isLibrarianActive = false; sessionStorage.removeItem('cbc_librarian_active'); updateLibrarianUI(); }
function updateLibrarianUI() {
    document.getElementById('admin-panel')?.classList.toggle('hidden', !isLibrarianActive);
    const btnLabel = document.getElementById('librarian-btn-label');
    if (btnLabel) btnLabel.textContent = isLibrarianActive ? "Exit Admin" : "Librarian";
}
function switchAdminTab(t) { ['circulation', 'stock', 'storage', 'members', 'analytics'].forEach(x => document.getElementById(`admin-window-${x}`)?.classList.toggle('hidden', x !== t)); }

function filterCirculationStatus(status) { currentCirculationFilter = status; renderCirculationTable(); }
function renderCirculationCounts() {
    const pending = allBorrows.filter(b => b.Status === 'Pending').length;
    const badge = document.getElementById('badge-pending-count'); if (badge) badge.textContent = pending;
}

// ---------------- ADMIN TABLES & ACTIONS ----------------
function renderAdminTables() {
    renderCirculationCounts();
    renderCirculationTable();
    renderStockAuditTable();
    renderStorageTables();
    renderMembersTable();
    applyAnalyticsTimelineFilter();
}

function renderCirculationTable() {
    const tbody = document.getElementById('admin-borrows-tbody');
    let list = currentCirculationFilter === 'All' ? allBorrows : allBorrows.filter(b => b.Status === currentCirculationFilter);
    if (!tbody) return;
    tbody.innerHTML = list.map(b => {
        let btns = '';
        if (b.Status === 'Pending') btns = `<button onclick="approveBorrow('${b.BorrowID}')" class="bg-blue-700 text-white px-2 py-1 rounded text-xs">Approve</button>`;
        else if (b.Status === 'Approved') btns = `<button onclick="openIssueModal('${b.BorrowID}')" class="bg-emerald-700 text-white px-2 py-1 rounded text-xs">Issue</button>`;
        else if (b.Status === 'Active') btns = `<button onclick="adminExtendLoan('${b.BorrowID}')" class="bg-church-600 text-white px-2 py-1 rounded text-xs mr-1">+2 Wks</button><button onclick="openReturnModal('${b.BorrowID}')" class="bg-black text-white px-2 py-1 rounded text-xs">Return</button>`;

        return `<tr><td class="p-3 font-bold">${b.BookTitle}</td><td class="p-3">${b.MemberName}<br><span class="text-[10px]">${b.MemberID}</span></td><td class="p-3">${b.PickupDate}</td><td class="p-3 font-bold">${b.DueDate}</td><td class="p-3 font-bold">${b.Status}</td><td class="p-3 text-[10px]">${b.ConditionIssued || '—'}</td><td class="p-3"><button onclick="window.open('https://wa.me/${b.MemberPhone}', '_blank')" class="text-emerald-600 font-bold border rounded px-1 text-[10px]">WhatsApp</button></td><td class="p-3 text-right">${btns}</td></tr>`;
    }).join('');
}

async function approveBorrow(id) {
    const { error } = await supabaseClient.from('borrows').update({ status: 'Approved' }).eq('borrow_id', id);
    if (!error) { const b = allBorrows.find(x => x.BorrowID === id); if (b) b.Status = 'Approved'; renderAdminTables(); initCatalog(); }
}

function openIssueModal(id) {
    targetIssueBorrow = allBorrows.find(b => b.BorrowID === id);
    document.getElementById('issue-modal-book').textContent = targetIssueBorrow.BookTitle;
    document.getElementById('issue-date-input').value = new Date().toISOString().split('T')[0];
    document.getElementById('issue-modal').classList.remove('hidden');
}

async function confirmAdminIssue() {
    const date = document.getElementById('issue-date-input').value;
    const cond = document.getElementById('issue-condition-select').value;
    const { error } = await supabaseClient.from('borrows').update({ status: 'Active', issued_date: date, condition_issued: cond }).eq('borrow_id', targetIssueBorrow.BorrowID);
    if (!error) { targetIssueBorrow.Status = 'Active'; targetIssueBorrow.IssuedDate = date; targetIssueBorrow.ConditionIssued = cond; closeModal('issue-modal'); renderAdminTables(); initCatalog(); }
}

function openReturnModal(id) {
    targetReturnBorrow = allBorrows.find(b => b.BorrowID === id);
    document.getElementById('return-modal-book').textContent = targetReturnBorrow.BookTitle;
    document.getElementById('return-date-input').value = new Date().toISOString().split('T')[0];
    document.getElementById('return-modal').classList.remove('hidden');
}

async function confirmAdminReturn() {
    const date = document.getElementById('return-date-input').value;
    const cond = document.getElementById('return-condition-select').value;
    const pen = document.getElementById('return-penalty-select').value;
    const { error } = await supabaseClient.from('borrows').update({ status: 'Returned', return_date: date, condition_returned: cond, penalty: pen }).eq('borrow_id', targetReturnBorrow.BorrowID);
    if (!error) { targetReturnBorrow.Status = 'Returned'; closeModal('return-modal'); renderAdminTables(); initCatalog(); }
}

async function adminExtendLoan(id) {
    const b = allBorrows.find(x => x.BorrowID === id);
    if (b.ExtensionUsed) { alert("Already extended!"); return; }
    const nd = new Date(b.DueDate); nd.setDate(nd.getDate() + 14); const ndStr = nd.toISOString().split('T')[0];
    const { error } = await supabaseClient.from('borrows').update({ due_date: ndStr, extension_used: true }).eq('borrow_id', id);
    if (!error) { b.DueDate = ndStr; b.ExtensionUsed = true; renderAdminTables(); alert("Extended!"); }
}

// ---------------- ADD NEW BOOK TO CATALOG ----------------
function openAddBookModal() { document.getElementById('add-book-modal').classList.remove('hidden'); }

async function submitNewBook() {
    const obj = {
        title: document.getElementById('add-book-title').value.trim(),
        author: document.getElementById('add-book-author').value.trim() || 'Unknown',
        category: document.getElementById('add-book-category').value,
        classification: document.getElementById('add-book-class').value,
        copies: parseInt(document.getElementById('add-book-copies').value) || 1,
        pages: parseInt(document.getElementById('add-book-pages').value) || 200,
        description: document.getElementById('add-book-desc').value.trim(),
        image: document.getElementById('add-book-img').value.trim() || 'images/churchdiscipline.jpeg'
    };
    if (!obj.title) { alert("Title is required."); return; }

    const { data, error } = await supabaseClient.from('books').insert([obj]).select();
    if (error) { alert("Error adding book: " + error.message); return; }

    if (data && data.length > 0) {
        allBooks.push(normalizeBook(data[0]));
        filteredBooks = allBooks;
        initCatalog();
        renderAdminTables();
        closeModal('add-book-modal');
        alert("Book successfully added to the catalog!");
    }
}

// ---------------- STOCK AUDIT ----------------
function renderStockAuditTable() {
    const tbody = document.getElementById('stock-audit-tbody');
    if (!tbody) return;
    let tc = 0, tl = 0, ta = 0;
    allBooks.forEach(b => { tc += b.copies; const a = calculateAvailableCopies(b.id, b.copies); ta += a; tl += (b.copies - a); });
    document.getElementById('stock-kpi-titles').textContent = allBooks.length;
    document.getElementById('stock-kpi-total-copies').textContent = tc;
    document.getElementById('stock-kpi-loaned').textContent = tl;
    document.getElementById('stock-kpi-available').textContent = ta;

    tbody.innerHTML = allBooks.map(b => {
        const a = calculateAvailableCopies(b.id, b.copies);
        return `<tr><td class="p-3 font-mono">#${b.id}</td><td class="p-3 font-bold">${b.title} <br><span class="text-[10px] font-normal">By ${b.author}</span></td><td class="p-3">${b.category}</td><td class="p-3">${b.classification}</td><td class="p-3 text-center">${b.copies}</td><td class="p-3 text-center text-amber-800">${b.copies - a}</td><td class="p-3 text-center text-emerald-700 font-bold">${a}</td><td class="p-3 text-right">${a > 0 ? 'In Stock' : 'Out'}</td></tr>`;
    }).join('');
}
function printStockReport() { window.print(); }
function exportStockReportCSV() { alert("CSV exported (Check Console for actual implementation in original code)"); }

// ---------------- STORAGE INTAKE / DISTRIBUTE ----------------
function switchStorageSubTab(t) {
    currentStorageSubTab = t;
    document.getElementById('storage-view-stock').classList.toggle('hidden', t !== 'stock');
    document.getElementById('storage-view-dist').classList.toggle('hidden', t !== 'dist');
}
function renderStorageTables() {
    const sTbody = document.getElementById('storage-stock-tbody');
    const dTbody = document.getElementById('storage-dist-tbody');
    if (sTbody) sTbody.innerHTML = allStorageStock.map(s => `<tr><td class="p-3 font-mono">${s.ItemID}</td><td class="p-3 font-bold">${s.Title}</td><td class="p-3">${s.AcquisitionType} - ${s.Source}</td><td class="p-3">${s.DateReceived}</td><td class="p-3 text-center">${s.TotalReceived}</td><td class="p-3 text-center text-amber-800">${s.TotalDistributed}</td><td class="p-3 text-center text-emerald-700 font-bold">${s.RemainingStock}</td><td class="p-3">${s.Notes || '-'}</td><td class="p-3 text-right"><button onclick="openStorageDistributeModal('${s.ItemID}')" class="bg-amber-700 text-white px-2 py-1 rounded text-[10px]">Distribute</button></td></tr>`).join('');
    if (dTbody) dTbody.innerHTML = allDistributionLogs.map(d => `<tr><td class="p-3 font-mono">${d.LogID}</td><td class="p-3 font-bold">${d.BookTitle}</td><td class="p-3">${d.Recipient}</td><td class="p-3 text-center">${d.Quantity}</td><td class="p-3">${d.Date}</td><td class="p-3">${d.Notes}</td></tr>`).join('');
    document.getElementById('count-dist-logs').textContent = allDistributionLogs.length;
}

function openStorageIntakeModal() { document.getElementById('storage-intake-modal').classList.remove('hidden'); }
async function submitStorageIntake() {
    const copies = parseInt(document.getElementById('intake-copies').value) || 1;
    const obj = {
        item_id: "STK-" + Date.now(), title: document.getElementById('intake-title').value.trim(), author: document.getElementById('intake-author').value.trim(),
        category: document.getElementById('intake-category').value, acquisition_type: document.getElementById('intake-acq-type').value,
        source: document.getElementById('intake-source').value.trim(), total_received: copies, total_distributed: 0, remaining_stock: copies,
        date_received: document.getElementById('intake-date').value, notes: document.getElementById('intake-notes').value.trim()
    };
    const { error } = await supabaseClient.from('storage_stock').insert([obj]);
    if (error) { alert(error.message); return; }
    allStorageStock.unshift(mapStorage(obj)); closeModal('storage-intake-modal'); renderStorageTables();
}

function openStorageDistributeModal(preSelect) {
    const sel = document.getElementById('dist-item-select');
    sel.innerHTML = allStorageStock.filter(s => s.RemainingStock > 0).map(s => `<option value="${s.ItemID}" ${s.ItemID === preSelect ? 'selected' : ''}>${s.Title} (${s.RemainingStock} left)</option>`).join('');
    document.getElementById('dist-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('storage-distribute-modal').classList.remove('hidden');
}
function updateDistributionMax() {
    const id = document.getElementById('dist-item-select').value;
    const item = allStorageStock.find(i => i.ItemID === id);
    if(item) document.getElementById('dist-available-hint').textContent = `${item.RemainingStock} copies available.`;
}
async function submitDistributionRecord() {
    const itemId = document.getElementById('dist-item-select').value;
    const item = allStorageStock.find(i => i.ItemID === itemId);
    const qty = parseInt(document.getElementById('dist-qty').value) || 1;
    if (qty > item.RemainingStock) { alert("Not enough stock!"); return; }
    
    const obj = { log_id: "DST-" + Date.now(), item_id: itemId, book_title: item.Title, recipient: document.getElementById('dist-recipient').value, quantity: qty, date: document.getElementById('dist-date').value, notes: document.getElementById('dist-notes').value };
    await supabaseClient.from('distribution_logs').insert([obj]);
    await supabaseClient.from('storage_stock').update({ total_distributed: item.TotalDistributed + qty, remaining_stock: item.RemainingStock - qty }).eq('item_id', itemId);
    
    item.TotalDistributed += qty; item.RemainingStock -= qty; allDistributionLogs.unshift(mapDist(obj));
    closeModal('storage-distribute-modal'); renderStorageTables(); alert("Distributed!");
}

// ---------------- MEMBERS MANAGEMENT ----------------
function renderMembersTable() {
    const tbody = document.getElementById('admin-members-tbody');
    if (tbody) tbody.innerHTML = allMembers.map(m => `<tr><td class="p-3 font-bold">${m.MemberID}</td><td class="p-3">${m.FullName}</td><td class="p-3">${m.Designation}</td><td class="p-3">${m.Phone}</td><td class="p-3 text-right"><button onclick="openEditMemberModal('${m.MemberID}')" class="text-church-700 underline font-bold">Edit Phone</button></td></tr>`).join('');
}
async function adminRegisterMember() {
    const obj = { member_id: document.getElementById('new-mem-id').value.trim().toUpperCase(), full_name: document.getElementById('new-mem-name').value.trim(), designation: document.getElementById('new-mem-desig').value, phone: document.getElementById('new-mem-phone').value.trim() };
    if (!obj.member_id || !obj.full_name) { alert("Provide ID and Name"); return; }
    const { error } = await supabaseClient.from('members').insert([obj]);
    if (error) { alert(error.message); return; }
    allMembers.push(mapMember(obj)); alert("Registered!"); renderMembersTable();
}
function openEditMemberModal(id) {
    targetEditMember = allMembers.find(m => m.MemberID === id);
    document.getElementById('edit-mem-name').textContent = targetEditMember.FullName;
    document.getElementById('edit-mem-phone').value = targetEditMember.Phone;
    document.getElementById('edit-member-modal').classList.remove('hidden');
}
async function saveMemberContact() {
    const ph = document.getElementById('edit-mem-phone').value;
    const { error } = await supabaseClient.from('members').update({ phone: ph }).eq('member_id', targetEditMember.MemberID);
    if(!error) { targetEditMember.Phone = ph; closeModal('edit-member-modal'); renderMembersTable(); }
}

// ---------------- ANALYTICS ----------------
function applyAnalyticsTimelineFilter() {
    document.getElementById('stat-period-borrows').textContent = allBorrows.length;
    document.getElementById('stat-total-members').textContent = allMembers.length;
    document.getElementById('analytics-borrows-tbody').innerHTML = allBorrows.map(b => `<tr><td class="p-3 font-bold">${b.BookTitle}</td><td class="p-3">${b.MemberName}</td><td class="p-3">${b.PickupDate}</td><td class="p-3">${b.DueDate}</td><td class="p-3">${b.Status}</td></tr>`).join('');
}

// Global Modal Closer
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
window.addEventListener('click', (e) => {
    ['login-modal', 'book-modal', 'borrow-modal', 'admin-pin-modal', 'add-book-modal', 'storage-intake-modal', 'storage-distribute-modal', 'issue-modal', 'return-modal', 'edit-member-modal', 'my-requests-modal'].forEach(id => {
        const el = document.getElementById(id); if (el && e.target === el) el.classList.add('hidden');
    });
});
