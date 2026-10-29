// ==========================================
// CROSSPOINT BIBLE CHURCH LIBRARY - SUPABASE SCRIPT
// ==========================================

const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allBooks = [];
let filteredBooks = [];
let allMembers = [];
let allBorrows = [];
let allStorageStock = [];

let displayedCount = 0;
const BOOKS_PER_PAGE = 6;
let currentUser = JSON.parse(localStorage.getItem('cbc_user')) || null;
let isLibrarianActive = sessionStorage.getItem('cbc_librarian_active') === 'true';
let activeBookForAction = null;

document.addEventListener('DOMContentLoaded', () => {
    updateUserAuthUI();
    updateLibrarianUI();
    fetchLibraryDataFromSupabase();

    document.getElementById('search-input')?.addEventListener('input', handleSearchAndFilter);
    document.getElementById('category-filter')?.addEventListener('change', handleSearchAndFilter);
});

async function fetchLibraryDataFromSupabase() {
    try {
        const [booksRes, membersRes, borrowsRes, storageRes] = await Promise.all([
            supabaseClient.from('books').select('*'),
            supabaseClient.from('members').select('*'),
            supabaseClient.from('borrows').select('*'),
            supabaseClient.from('storage_stock').select('*')
        ]);

        if (booksRes.error) throw booksRes.error;

        allBooks = (booksRes.data || []).map(normalizeBook);
        filteredBooks = allBooks;
        allMembers = membersRes.data || [];
        allBorrows = borrowsRes.data || [];
        allStorageStock = storageRes.data || [];

        if (currentUser) {
            const refreshed = allMembers.find(m => m.member_id.toUpperCase() === currentUser.id.toUpperCase());
            if (refreshed) {
                currentUser.phone = refreshed.phone || '';
                localStorage.setItem('cbc_user', JSON.stringify(currentUser));
                updateUserAuthUI();
            }
        }

        initCatalog();
        renderCirculationCounts();
        if (isLibrarianActive) renderAdminTables();

    } catch (err) {
        console.warn("Supabase Fetch Warning (Offline Mode or Config error):", err.message);
    }
}

function normalizeBook(raw) {
    let parsedKeywords = [];
    try {
        parsedKeywords = typeof raw.keywords === 'string' ? JSON.parse(raw.keywords) : (raw.keywords || []);
    } catch(e) { parsedKeywords = []; }

    return {
        id: raw.id,
        title: raw.title || 'Untitled',
        author: raw.author || 'Unknown Author',
        category: raw.category || 'General',
        publicationDate: raw.publication_date || 'N/A',
        totalCopies: raw.copies || 1,
        copies: raw.copies || 1,
        pages: raw.pages || 0,
        classification: raw.classification || 'Borrowable',
        description: raw.description || '',
        image: raw.image || 'images/churchdiscipline.jpeg',
        keywords: parsedKeywords
    };
}

function calculateAvailableCopies(bookId, fallbackCopies) {
    const book = allBooks.find(b => b.id == bookId);
    const total = book ? (book.totalCopies || 1) : (fallbackCopies || 1);
    const activeLoans = allBorrows.filter(b => 
        b.book_id == bookId && 
        b.type !== 'Onsite' && 
        ['Approved', 'Active'].includes((b.status || '').trim())
    ).length;
    return Math.max(0, total - activeLoans);
}

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
        const isBorrowable = (book.classification || '').toLowerCase().includes('borrowable');
        const badgeClass = isBorrowable ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800';
        const copies = calculateAvailableCopies(book.id, book.copies);

        let shortDesc = book.description || '';
        if (shortDesc.length > 110) shortDesc = shortDesc.substring(0, 110).trim() + '...';

        const card = document.createElement('div');
        card.className = "bg-white border border-church-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer";
        card.onclick = () => openBookModal(book);

        card.innerHTML = `
            <div>
                <div class="h-64 bg-church-50 overflow-hidden relative p-2 flex items-center justify-center border-b border-church-100">
                    <img src="${book.image}" alt="${book.title}" loading="lazy" class="w-full h-full object-contain group-hover:scale-105 transition duration-300" onerror="this.src='images/churchdiscipline.jpeg'">
                    <span class="absolute top-3 right-3 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm ${badgeClass}">
                        ${book.classification}
                    </span>
                </div>
                <div class="p-5 space-y-2">
                    <div class="flex items-center justify-between text-xs">
                        <span class="font-medium text-church-600 uppercase tracking-wide">${book.category}</span>
                        <span class="text-church-500"><i class="fa-solid fa-book-open mr-1"></i>${book.pages} pages</span>
                    </div>
                    <h3 class="font-bold text-church-900 text-base leading-snug group-hover:text-church-600 transition">${book.title}</h3>
                    <p class="text-xs text-church-700 font-medium">By ${book.author}</p>
                    <p class="text-xs text-church-600 pt-1 leading-relaxed">${shortDesc}</p>
                </div>
            </div>
            <div class="px-5 pb-5 pt-3 border-t border-church-100 flex items-center justify-between text-xs">
                <span class="${copies > 0 ? 'text-church-800' : 'text-red-600 font-bold'}">
                    <i class="fa-solid fa-copy mr-1"></i> ${copies > 0 ? copies + ' copies available' : 'Out of stock'}
                </span>
                <span class="text-church-600 font-semibold group-hover:translate-x-1 transition-transform">Details &rarr;</span>
            </div>
        `;
        grid.appendChild(card);
    });

    displayedCount += nextBatch.length;
    loadMoreContainer?.classList.toggle('hidden', displayedCount >= filteredBooks.length);
}

function handleSearchAndFilter() {
    const query = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('category-filter')?.value || '';

    filteredBooks = allBooks.filter(book => {
        if (cat && book.category !== cat) return false;
        if (!query) return true;

        const title = (book.title || '').toLowerCase();
        const author = (book.author || '').toLowerCase();
        const category = (book.category || '').toLowerCase();
        const description = (book.description || '').toLowerCase();
        const keywords = book.keywords.map(k => String(k).toLowerCase());

        return title.includes(query) || author.includes(query) || category.includes(query) || description.includes(query) || keywords.some(kw => kw.includes(query));
    });

    initCatalog();
}

function updateUserAuthUI() {
    const desktopContainer = document.getElementById('user-auth-badge');
    const mobileContainer = document.getElementById('mobile-user-auth-badge');

    let html = currentUser ? `
        <div class="flex items-center space-x-2 text-xs">
            <span class="bg-church-100 border border-church-300 px-3 py-1.5 rounded-xl font-bold text-church-900">
                <i class="fa-solid fa-user-circle text-amber-700"></i> ${currentUser.name}
            </span>
            <button onclick="logoutUser()" class="text-red-600 hover:text-red-800 text-xs font-semibold px-2">Logout</button>
        </div>` : `
        <button onclick="openLoginModal()" class="bg-church-800 hover:bg-church-900 text-white text-xs px-3.5 py-2 rounded-xl font-bold transition shadow-sm flex items-center gap-1.5">
            <i class="fa-solid fa-id-card"></i> Member Sign In
        </button>`;

    if (desktopContainer) desktopContainer.innerHTML = html;
    if (mobileContainer) mobileContainer.innerHTML = html;
}

async function loginMember() {
    const id = document.getElementById('login-id').value.trim().toUpperCase();
    const name = document.getElementById('login-name').value.trim().toLowerCase();

    if (!id || !name) { alert("Provide Member ID and Full Name."); return; }

    const matched = allMembers.find(m => m.member_id.toUpperCase() === id && m.full_name.trim().toLowerCase() === name);
    if (matched) {
        currentUser = { id: matched.member_id, name: matched.full_name, designation: matched.designation, phone: matched.phone || '' };
        localStorage.setItem('cbc_user', JSON.stringify(currentUser));
        updateUserAuthUI();
        closeModal('login-modal');
        alert(`Welcome back, ${currentUser.name}!`);
    } else {
        alert("Credentials not found in records.");
    }
}

function logoutUser() {
    localStorage.removeItem('cbc_user');
    currentUser = null;
    updateUserAuthUI();
}

function openBookModal(book) {
    activeBookForAction = book;
    document.getElementById('modal-title').textContent = book.title;
    document.getElementById('modal-img').src = book.image;
    document.getElementById('modal-author').textContent = book.author;
    document.getElementById('modal-category').textContent = book.category;
    document.getElementById('modal-copies').textContent = calculateAvailableCopies(book.id, book.copies);
    document.getElementById('modal-description').textContent = book.description || 'No description.';

    const actionBtn = document.getElementById('modal-action-btn');
    const copies = calculateAvailableCopies(book.id, book.copies);

    if (copies <= 0) {
        actionBtn.className = "px-4 py-2 bg-gray-400 text-white rounded-xl text-xs font-bold cursor-not-allowed";
        actionBtn.textContent = "Out of Stock";
        actionBtn.onclick = null;
    } else {
        actionBtn.className = "px-4 py-2 bg-church-800 text-white rounded-xl text-xs font-bold";
        actionBtn.textContent = "Request to Borrow";
        actionBtn.onclick = () => {
            if (!currentUser) { openLoginModal(); return; }
            openBorrowForm();
        };
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
    const newBorrow = {
        borrow_id: borrowId,
        book_id: activeBookForAction.id,
        book_title: activeBookForAction.title,
        member_id: currentUser.id,
        member_name: currentUser.name,
        member_phone: currentUser.phone || '',
        type: 'Borrow',
        pickup_date: document.getElementById('borrow-pickup-date').value,
        pickup_time: document.getElementById('borrow-pickup-time').value,
        due_date: document.getElementById('borrow-due-date').value,
        status: 'Pending'
    };

    const { error } = await supabaseClient.from('borrows').insert([newBorrow]);
    if (error) { alert("Error: " + error.message); return; }

    allBorrows.unshift(newBorrow);
    closeModal('borrow-modal');
    initCatalog();
    renderCirculationCounts();
    alert("Request submitted successfully!");
}

// LIBRARIAN CONTROLS
function openAdminPinModal() {
    if (isLibrarianActive) { exitLibrarianConsole(); return; }
    document.getElementById('admin-pin-input').value = '';
    document.getElementById('admin-pin-modal').classList.remove('hidden');
}

function submitAdminPin() {
    if (document.getElementById('admin-pin-input').value.trim() === "1234") {
        isLibrarianActive = true;
        sessionStorage.setItem('cbc_librarian_active', 'true');
        closeModal('admin-pin-modal');
        updateLibrarianUI();
        renderAdminTables();
    } else {
        alert("Incorrect PIN.");
    }
}

function exitLibrarianConsole() {
    isLibrarianActive = false;
    sessionStorage.removeItem('cbc_librarian_active');
    updateLibrarianUI();
}

function updateLibrarianUI() {
    document.getElementById('admin-panel')?.classList.toggle('hidden', !isLibrarianActive);
    const btnLabel = document.getElementById('librarian-btn-label');
    if (btnLabel) btnLabel.textContent = isLibrarianActive ? "Exit Admin" : "Librarian";
}

function switchAdminTab(tabName) {
    ['circulation', 'stock', 'storage', 'members'].forEach(t => {
        document.getElementById(`admin-window-${t}`)?.classList.toggle('hidden', t !== tabName);
    });
}

function renderCirculationCounts() {
    const pending = allBorrows.filter(b => b.status === 'Pending').length;
    const badge = document.getElementById('badge-pending-count');
    if (badge) badge.textContent = pending;
}

function renderAdminTables() {
    renderCirculationCounts();
    const tbody = document.getElementById('admin-borrows-tbody');
    if (tbody) {
        tbody.innerHTML = allBorrows.map(b => `
            <tr class="hover:bg-church-50">
                <td class="p-3 font-bold">${b.book_title}</td>
                <td class="p-3">${b.member_name} (${b.member_id})</td>
                <td class="p-3 font-bold">${b.due_date}</td>
                <td class="p-3"><span class="px-2 py-0.5 rounded bg-amber-100 font-bold">${b.status}</span></td>
                <td class="p-3 text-right">
                    ${b.status === 'Pending' ? `<button onclick="approveBorrow('${b.borrow_id}')" class="bg-blue-700 text-white px-2 py-1 rounded text-xs">Approve</button>` : ''}
                </td>
            </tr>
        `).join('');
    }

    const stockTbody = document.getElementById('stock-audit-tbody');
    if (stockTbody) {
        stockTbody.innerHTML = allBooks.map(b => `
            <tr>
                <td class="p-3 font-mono">#${b.id}</td>
                <td class="p-3 font-bold">${b.title}</td>
                <td class="p-3 text-center">${b.totalCopies}</td>
                <td class="p-3 text-center text-emerald-700 font-bold">${calculateAvailableCopies(b.id, b.copies)}</td>
            </tr>
        `).join('');
    }

    const storageTbody = document.getElementById('storage-stock-tbody');
    if (storageTbody) {
        storageTbody.innerHTML = allStorageStock.map(s => `
            <tr>
                <td class="p-3 font-mono">${s.item_id}</td>
                <td class="p-3 font-bold">${s.title}</td>
                <td class="p-3 text-center font-bold text-emerald-700">${s.remaining_stock}</td>
            </tr>
        `).join('');
    }
}

async function approveBorrow(borrowId) {
    const { error } = await supabaseClient.from('borrows').update({ status: 'Approved' }).eq('borrow_id', borrowId);
    if (!error) {
        const b = allBorrows.find(x => x.borrow_id === borrowId);
        if (b) b.status = 'Approved';
        renderAdminTables();
        initCatalog();
    }
}

async function adminRegisterMember() {
    const id = document.getElementById('new-mem-id').value.trim().toUpperCase();
    const name = document.getElementById('new-mem-name').value.trim();
    const phone = document.getElementById('new-mem-phone').value.trim();

    if (!id || !name) { alert("Provide Member ID and Name"); return; }

    const newMem = { member_id: id, full_name: name, designation: 'Church Member', phone: phone };
    const { error } = await supabaseClient.from('members').insert([newMem]);
    if (error) { alert(error.message); return; }

    allMembers.push(newMem);
    alert("Member registered!");
    document.getElementById('new-mem-id').value = '';
    document.getElementById('new-mem-name').value = '';
}

function openStorageIntakeModal() { document.getElementById('storage-intake-modal').classList.remove('hidden'); }

async function submitStorageIntake() {
    const title = document.getElementById('intake-title').value.trim();
    const copies = parseInt(document.getElementById('intake-copies').value) || 1;
    const newItem = {
        item_id: "STK-" + Date.now(), title: title, author: document.getElementById('intake-author').value.trim() || 'Unknown',
        total_received: copies, total_distributed: 0, remaining_stock: copies
    };

    const { error } = await supabaseClient.from('storage_stock').insert([newItem]);
    if (error) { alert(error.message); return; }

    allStorageStock.unshift(newItem);
    closeModal('storage-intake-modal');
    renderAdminTables();
    alert("Storage intake saved!");
}

function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }