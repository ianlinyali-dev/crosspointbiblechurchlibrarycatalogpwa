// ==========================================
// CROSSPOINT BIBLE CHURCH LIBRARY - SUPABASE BACKEND
// ==========================================

const SUPABASE_URL = "https://wcfutxaxdxhdpfomsyml.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_VTYqn6uDQakIWBdL7S8EWA__Cz7PCq-";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allBooks = [];
let filteredBooks = [];
let allMembers = [];
let allBorrows = [];
let allStorageStock = [];
let allDistributionLogs = [];
let allGroups = [];

let displayedCount = 0;
const BOOKS_PER_PAGE = 6;
let currentUser = JSON.parse(localStorage.getItem('cbc_user')) || null;
let isLibrarianActive = sessionStorage.getItem('cbc_librarian_active') === 'true';
let churchLibrarySettings = JSON.parse(localStorage.getItem('cbc_admin_settings')) || { adminName: "Library Coordinator", adminPhone: "+254 704 486 616" };
let activeBookForAction = null;
let currentCirculationFilter = 'All';

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

// MAP SUPABASE TO PASCALCASE OBJECTS
const mapMember = db => ({ MemberID: db.member_id, FullName: db.full_name, Designation: db.designation, Phone: db.phone });
const mapBorrow = db => ({
    BorrowID: db.borrow_id, BookID: db.book_id, BookTitle: db.book_title, MemberID: db.member_id, MemberName: db.member_name,
    MemberPhone: db.member_phone, Type: db.type, PickupDate: db.pickup_date, PickupTime: db.pickup_time, DueDate: db.due_date, 
    Status: db.status, ConditionIssued: db.condition_issued
});
const mapStorage = db => ({
    ItemID: db.item_id, Title: db.title, Author: db.author, AcquisitionType: db.acquisition_type, Source: db.source, 
    DateReceived: db.date_received, TotalReceived: db.total_received, TotalDistributed: db.total_distributed, RemainingStock: db.remaining_stock, Notes: db.notes
});
const mapDist = db => ({ LogID: db.log_id, BookTitle: db.book_title, Recipient: db.recipient, Quantity: db.quantity, Date: db.date, Notes: db.notes });
const mapGroup = db => ({
    GroupID: db.group_id, BookID: db.book_id, BookTitle: db.book_title, LeaderID: db.leader_id, LeaderName: db.leader_name,
    MaxLimit: db.max_limit, JoinedMemberIDs: db.joined_member_ids, MeetingNotes: db.meeting_notes, Status: db.status
});

async function fetchLibraryDataFromSupabase() {
    try {
        const [bRes, mRes, borRes, sRes, dRes, gRes] = await Promise.all([
            supabaseClient.from('books').select('*').order('id', { ascending: false }), 
            supabaseClient.from('members').select('*'),
            supabaseClient.from('borrows').select('*'), 
            supabaseClient.from('storage_stock').select('*'),
            supabaseClient.from('distribution_logs').select('*'),
            supabaseClient.from('group_readings').select('*')
        ]);

        if (bRes.error) throw bRes.error;

        allBooks = (bRes.data || []).map(normalizeBook);
        filteredBooks = allBooks;
        allMembers = (mRes.data || []).map(mapMember);
        allBorrows = (borRes.data || []).map(mapBorrow);
        allStorageStock = (sRes.data || []).map(mapStorage);
        allDistributionLogs = (dRes.data || []).map(mapDist);
        allGroups = (gRes.data || []).map(mapGroup);

        if (currentUser) {
            const ref = allMembers.find(m => String(m.MemberID).toUpperCase() === String(currentUser.id).toUpperCase());
            if (ref) { currentUser.phone = ref.Phone || ''; localStorage.setItem('cbc_user', JSON.stringify(currentUser)); updateUserAuthUI(); }
        }

        initCatalog();
        updateGroupBadges();
        renderCirculationCounts();
        if (isLibrarianActive) renderAdminTables();
    } catch (err) { console.warn("Fetch Error:", err.message); }
}

function normalizeBook(raw) {
    let keys = [];
    try { keys = typeof raw.keywords === 'string' ? JSON.parse(raw.keywords) : (raw.keywords || []); } catch(e) {}
    return {
        id: raw.id, title: raw.title || 'Untitled', author: raw.author || 'Unknown', category: raw.category || 'General',
        copies: raw.copies || 1, pages: raw.pages || 0, classification: raw.classification || 'Borrowable',
        description: raw.description || '', image: raw.image || 'images/churchdiscipline.jpeg', keywords: keys
    };
}

function calculateAvailableCopies(bookId, fallbackCopies) {
    const b = allBooks.find(x => x.id == bookId);
    const total = b ? (b.copies || 1) : (fallbackCopies || 1);
    const active = allBorrows.filter(x => x.BookID == bookId && x.Type !== 'Onsite' && ['Approved', 'Active'].includes((x.Status || '').trim())).length;
    return Math.max(0, total - active);
}

// ---------------- UI CATALOG ----------------
function initCatalog() { displayedCount = 0; const g = document.getElementById('book-grid'); if (g) g.innerHTML = ''; loadMoreBooks(); }

function loadMoreBooks() {
    const grid = document.getElementById('book-grid');
    const container = document.getElementById('load-more-container');
    const noResults = document.getElementById('no-results');
    if (!grid) return;

    if (filteredBooks.length === 0) { noResults?.classList.remove('hidden'); container?.classList.add('hidden'); return; } 
    else noResults?.classList.add('hidden');

    const nextBatch = filteredBooks.slice(displayedCount, displayedCount + BOOKS_PER_PAGE);

    nextBatch.forEach(book => {
        const copies = calculateAvailableCopies(book.id, book.copies);
        const card = document.createElement('div');
        card.className = "bg-white border border-church-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer";
        card.onclick = () => openBookModal(book);

        let desc = book.description || '';
        if (desc.length > 110) desc = desc.substring(0, 110).trim() + '...';

        const activeGroup = allGroups.find(g => g.BookID == book.id && g.Status === 'Open');
        let groupHTML = '';
        if (activeGroup) {
            const joinedMembers = (activeGroup.JoinedMemberIDs || "").toString().split(',').filter(Boolean);
            const remaining = Math.max(0, activeGroup.MaxLimit - joinedMembers.length);
            groupHTML = `<button onclick="event.stopPropagation(); openGroupModal('${activeGroup.GroupID}')" class="w-full mt-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg py-1 px-2.5 text-xs flex items-center justify-between transition"><span><i class="fa-solid fa-users text-amber-700 mr-1.5"></i>Group Reading</span><span class="font-bold bg-amber-200 px-1.5 py-0.5 rounded text-[10px]">${remaining} spots left</span></button>`;
        }

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
                    <p class="text-xs text-church-600 pt-1 leading-relaxed">${desc}</p>
                    ${groupHTML}
                </div>
            </div>
            <div class="px-5 pb-5 pt-3 border-t border-church-100 flex justify-between text-xs">
                <span class="${copies > 0 ? 'text-church-800' : 'text-red-600 font-bold'}"><i class="fa-solid fa-copy mr-1"></i>${copies > 0 ? copies + ' copies available' : 'Out of stock'}</span>
                <span class="text-church-600 font-semibold group-hover:translate-x-1 transition-transform">Details &rarr;</span>
            </div>`;
        grid.appendChild(card);
    });

    displayedCount += nextBatch.length;
    container?.classList.toggle('hidden', displayedCount >= filteredBooks.length);
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
            <button onclick="openMyRequestsModal()" class="bg-church-100 border border-church-300 px-3 py-1.5 rounded-xl font-bold hover:bg-church-200 shadow-sm"><i class="fa-solid fa-user-circle text-amber-700 mr-1"></i>${currentUser.name} (${currentUser.designation})</button>
            <button onclick="logoutUser()" class="text-red-600 hover:text-red-800 font-bold ml-2">Logout</button>
        </div>` : `<button onclick="openLoginModal()" class="bg-church-800 text-white text-xs px-3.5 py-2 rounded-xl font-bold shadow-sm hover:bg-church-900"><i class="fa-solid fa-id-card mr-1"></i> Sign In</button>`;
    if (d) d.innerHTML = h; if (m) m.innerHTML = h;
}

// ---------------- BOOK, BORROW & ONSITE MODALS ----------------
function openBookModal(book) {
    activeBookForAction = book;
    document.getElementById('modal-title').textContent = book.title;
    document.getElementById('modal-img').src = book.image;
    document.getElementById('modal-author').textContent = book.author;
    document.getElementById('modal-category').textContent = book.category;
    document.getElementById('modal-classification').textContent = book.classification;
    document.getElementById('modal-description').textContent = book.description || 'No description available.';
    
    const copies = calculateAvailableCopies(book.id, book.copies);
    document.getElementById('modal-copies').textContent = copies;
    
    const btn = document.getElementById('modal-action-btn');
    const isBorrowable = (book.classification || 'Borrowable').toLowerCase().includes('borrowable');
    const isPastor = currentUser && currentUser.designation.toLowerCase() === 'pastor';

    if (copies <= 0 && isBorrowable) {
        btn.className = "px-4 py-2 bg-gray-400 text-white rounded-xl text-xs font-bold cursor-not-allowed";
        btn.textContent = "Out of Stock"; btn.onclick = null;
    } else if (isBorrowable) {
        btn.className = "px-4 py-2 bg-church-800 text-white rounded-xl text-xs font-bold shadow hover:bg-church-900";
        btn.textContent = "Request to Borrow";
        btn.onclick = () => { if(!currentUser){ openLoginModal(); return; } openBorrowForm(); };
    } else {
        if (isPastor) {
            btn.className = "px-4 py-2 bg-purple-700 text-white rounded-xl text-xs font-bold shadow hover:bg-purple-800";
            btn.textContent = "Borrow (Pastor Privilege)";
            btn.onclick = () => { if(!currentUser){ openLoginModal(); return; } openBorrowForm(); };
        } else {
            btn.className = "px-4 py-2 bg-amber-700 text-white rounded-xl text-xs font-bold shadow hover:bg-amber-800";
            btn.textContent = "Schedule Onsite Reading";
            btn.onclick = () => { if(!currentUser){ openLoginModal(); return; } openOnsiteScheduleForm(); };
        }
    }

    document.getElementById('book-modal').classList.remove('hidden');
}

function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); }

async function loginMember() {
    const id = document.getElementById('login-id').value.trim().toUpperCase();
    const name = document.getElementById('login-name').value.trim().toLowerCase();
    
    if (!id || !name) { alert("Provide Member ID and Full Name."); return; }
    if (allMembers.length === 0) { alert("Database is loading or no members exist yet. Please wait a second and try again."); return; }

    const matched = allMembers.find(m => String(m.MemberID).trim().toUpperCase() === id && String(m.FullName).trim().toLowerCase() === name);
    
    if (matched) {
        currentUser = { id: matched.MemberID, name: matched.FullName, designation: matched.Designation, phone: matched.Phone || '' };
        localStorage.setItem('cbc_user', JSON.stringify(currentUser));
        updateUserAuthUI(); closeModal('login-modal'); alert(`Welcome back, ${currentUser.name}!`);
    } else alert("Credentials not found in records. Please check spelling or register with the Librarian.");
}

function logoutUser() { localStorage.removeItem('cbc_user'); currentUser = null; updateUserAuthUI(); }

function openBorrowForm() {
    closeModal('book-modal');
    document.getElementById('borrow-book-title').textContent = activeBookForAction.title;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('borrow-pickup-date').value = today;
    document.getElementById('borrow-due-date').value = new Date(Date.now() + 12096e5).toISOString().split('T')[0];
    document.getElementById('borrow-modal').classList.remove('hidden');
}

async function submitBorrowRequest() {
    const date = document.getElementById('borrow-pickup-date').value;
    const time = document.getElementById('borrow-pickup-time').value;
    const due = document.getElementById('borrow-due-date').value;
    if(!date || !time || !due){ alert("Please complete the form"); return; }

    const borrowId = "BRW-" + Date.now();
    const obj = {
        borrow_id: borrowId, book_id: parseInt(activeBookForAction.id), book_title: activeBookForAction.title, member_id: currentUser.id, 
        member_name: currentUser.name, member_phone: currentUser.phone || '', type: 'Borrow', pickup_date: date, pickup_time: time, 
        due_date: due, status: 'Pending'
    };

    const { error } = await supabaseClient.from('borrows').insert([obj]);
    if (error) { alert(error.message); return; }

    allBorrows.unshift(mapBorrow(obj));
    closeModal('borrow-modal'); initCatalog(); renderCirculationCounts();
    alert("Borrow Request Submitted successfully! Await librarian approval.");
}

function openOnsiteScheduleForm() {
    closeModal('book-modal');
    document.getElementById('onsite-book-title').textContent = activeBookForAction.title;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('onsite-date').min = today;
    document.getElementById('onsite-date').value = today;
    document.getElementById('onsite-modal').classList.remove('hidden');
}

async function submitOnsiteSchedule() {
    const date = document.getElementById('onsite-date').value;
    const time = document.getElementById('onsite-time').value;
    if(!date || !time) { alert("Date and time required."); return; }

    const borrowId = "BRW-" + Date.now();
    const obj = {
        borrow_id: borrowId, book_id: parseInt(activeBookForAction.id), book_title: activeBookForAction.title, member_id: currentUser.id, 
        member_name: currentUser.name, member_phone: currentUser.phone || '', type: 'Onsite', pickup_date: date, pickup_time: time, 
        due_date: date, status: 'Pending'
    };

    const { error } = await supabaseClient.from('borrows').insert([obj]);
    if (error) { alert(error.message); return; }

    allBorrows.unshift(mapBorrow(obj));
    closeModal('onsite-modal'); initCatalog(); renderCirculationCounts();
    alert(`Your reading desk slot for ${date} at ${time} is recorded!`);
}

function openMyRequestsModal() {
    const list = document.getElementById('my-requests-list');
    const myLoans = allBorrows.filter(b => String(b.MemberID).toUpperCase() == String(currentUser.id).toUpperCase());
    list.innerHTML = myLoans.length === 0 ? '<p class="text-church-600 text-center italic py-4">No requests found.</p>' : myLoans.map(b => `<div class="p-3 bg-church-50 border rounded-xl flex justify-between"><div><p class="font-bold">${b.BookTitle}</p><p class="text-[10px] text-church-600">${b.PickupDate}</p></div><span class="font-bold px-2 py-1 bg-amber-100 rounded text-[10px]">${b.Status}</span></div>`).join('');
    document.getElementById('my-requests-modal').classList.remove('hidden');
}

// ---------------- GROUP READING ----------------
function updateGroupBadges() {
    const openGroups = allGroups.filter(g => g.Status === 'Open').length;
    const navEl = document.getElementById('nav-group-count');
    const mobEl = document.getElementById('mobile-nav-group-count');
    if (navEl) navEl.textContent = openGroups;
    if (mobEl) mobEl.textContent = openGroups;
}

function openAllGroupsModal() {
    const list = document.getElementById('all-groups-list');
    const openGroups = allGroups.filter(g => g.Status === 'Open');

    if (openGroups.length === 0) {
        list.innerHTML = `<p class="text-church-600 py-6 text-center italic">No reading circles are active right now. Click on any book in the catalog to start one!</p>`;
    } else {
        list.innerHTML = openGroups.map(g => {
            const members = (g.JoinedMemberIDs || "").toString().split(',').filter(Boolean);
            const remaining = Math.max(0, g.MaxLimit - members.length);
            return `<div class="p-3 bg-church-50 rounded-xl border flex justify-between items-center"><div><p class="font-bold text-church-900">${g.BookTitle}</p><p class="text-[11px] text-church-600">Leader: <strong>${g.LeaderName}</strong></p><p class="text-[10px] text-amber-800 font-semibold mt-1">${remaining} spots remaining</p></div><button onclick="joinGroupReading('${g.GroupID}')" class="px-3 py-1.5 bg-church-800 text-white rounded-lg font-bold text-xs">Join</button></div>`;
        }).join('');
    }
    document.getElementById('all-groups-modal').classList.remove('hidden');
}

function openCreateGroupModal() {
    if (!currentUser) { openLoginModal(); return; }
    closeModal('book-modal'); document.getElementById('create-group-modal').classList.remove('hidden');
}

async function submitCreateGroup() {
    if (!currentUser) return;
    const limit = document.getElementById('create-grp-limit').value;
    const notes = document.getElementById('create-grp-notes').value;
    
    const obj = { group_id: "GRP-" + Date.now(), book_id: activeBookForAction.id, book_title: activeBookForAction.title, leader_id: currentUser.id, leader_name: currentUser.name, max_limit: parseInt(limit), joined_member_ids: currentUser.id, meeting_notes: notes, status: "Open" };
    const { error } = await supabaseClient.from('group_readings').insert([obj]);
    if (error) { alert(error.message); return; }
    
    allGroups.push(mapGroup(obj)); closeModal('create-group-modal'); updateGroupBadges(); initCatalog(); alert("Group reading circle published!");
}

function openGroupModal(id) {
    const g = allGroups.find(x => x.GroupID === id); if (!g) return;
    document.getElementById('grp-book-title').textContent = g.BookTitle; document.getElementById('grp-leader').textContent = g.LeaderName; document.getElementById('grp-notes').textContent = g.MeetingNotes || "No notes.";
    const members = (g.JoinedMemberIDs || "").toString().split(',').filter(Boolean);
    document.getElementById('grp-capacity').textContent = `${members.length} / ${g.MaxLimit} members joined`;
    document.getElementById('btn-join-group').onclick = () => joinGroupReading(g.GroupID);
    document.getElementById('group-modal').classList.remove('hidden');
}

async function joinGroupReading(id) {
    if (!currentUser) { openLoginModal(); return; }
    const g = allGroups.find(x => x.GroupID === id); if (!g) return;
    let members = (g.JoinedMemberIDs || "").toString().split(',').filter(Boolean);
    if (members.includes(currentUser.id)) { alert("You have already joined this group!"); return; }
    
    members.push(currentUser.id);
    const newStatus = members.length >= g.MaxLimit ? 'Full' : 'Open';
    const { error } = await supabaseClient.from('group_readings').update({ joined_member_ids: members.join(','), status: newStatus }).eq('group_id', id);
    if (error) { alert(error.message); return; }
    
    g.JoinedMemberIDs = members.join(','); g.Status = newStatus;
    closeModal('group-modal'); closeModal('all-groups-modal'); updateGroupBadges(); initCatalog(); alert("Successfully joined the group!");
}

// ---------------- LIBRARIAN ----------------
function openAdminSettingsModal() { 
    document.getElementById('setting-admin-name').value = churchLibrarySettings.adminName || '';
    document.getElementById('admin-settings-modal').classList.remove('hidden'); 
}
function saveAdminSettings() {
    churchLibrarySettings.adminName = document.getElementById('setting-admin-name').value.trim() || "Library Coordinator";
    localStorage.setItem('cbc_admin_settings', JSON.stringify(churchLibrarySettings));
    alert("Settings saved!"); closeModal('admin-settings-modal');
}

function openAdminPinModal() {
    if (isLibrarianActive) { isLibrarianActive = false; sessionStorage.removeItem('cbc_librarian_active'); updateLibrarianUI(); return; }
    document.getElementById('admin-pin-input').value = '';
    document.getElementById('admin-pin-modal').classList.remove('hidden');
}
function submitAdminPin() {
    if (document.getElementById('admin-pin-input').value.trim() === "1234") {
        isLibrarianActive = true; sessionStorage.setItem('cbc_librarian_active', 'true');
        closeModal('admin-pin-modal'); updateLibrarianUI(); renderAdminTables(); window.location.hash = "admin-panel";
    } else alert("Incorrect PIN.");
}
function updateLibrarianUI() {
    document.getElementById('admin-panel')?.classList.toggle('hidden', !isLibrarianActive);
    const btn = document.getElementById('librarian-btn-label'); if (btn) btn.textContent = isLibrarianActive ? "Exit Admin" : "Librarian";
}
function switchAdminTab(t) { ['circulation', 'stock', 'storage', 'members', 'analytics'].forEach(x => document.getElementById(`admin-window-${x}`)?.classList.toggle('hidden', x !== t)); }

// WHATSAPP AUTOMATION
function triggerBorrowerWhatsApp(memberId, memberName, bookTitle, stage, dueDate) {
    const mem = allMembers.find(m => String(m.MemberID).toUpperCase() === String(memberId).toUpperCase());
    const phone = mem && mem.Phone ? mem.Phone : null;
    if (!phone) { alert(`No phone number on file for ${memberName}. Please add their number in Members Tab.`); return; }
    
    let cleanPhone = String(phone).replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '254' + cleanPhone.substring(1);
    else if (!cleanPhone.startsWith('254') && cleanPhone.length === 9) cleanPhone = '254' + cleanPhone;

    let msg = "";
    const admin = churchLibrarySettings.adminName || "Library Coordinator";
    
    if (stage === 'Approved') {
        msg = `Hello ${memberName},\n\nYour borrow request for "${bookTitle}" at Crosspoint Bible Church Library has been APPROVED!\n\nPlease collect your volume at the church study desk in Kiamunyi.\n\nBlessings,\n${admin}`;
    } else if (stage === 'Active') {
        msg = `Reminder from Crosspoint Bible Church Library:\n\nHello ${memberName}, your borrowed book "${bookTitle}" is due on ${dueDate}. Please prepare to return it or request a 2-week extension.\n\nBlessings,\n${admin}`;
    } else {
        msg = `Hello ${memberName}, this is regarding your library request for "${bookTitle}" at Crosspoint Bible Church.`;
    }
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

function filterCirculationStatus(s) { currentCirculationFilter = s; renderCirculationTable(); }
function renderCirculationCounts() {
    const pend = allBorrows.filter(b => b.Status === 'Pending').length;
    const badge = document.getElementById('badge-pending-count'); if (badge) badge.textContent = pend;
}

function renderAdminTables() {
    renderCirculationCounts(); renderCirculationTable(); renderStockAuditTable(); renderStorageTables(); renderMembersTable(); applyAnalyticsTimelineFilter();
}
function renderCirculationTable() {
    const tb = document.getElementById('admin-borrows-tbody');
    let list = currentCirculationFilter === 'All' ? allBorrows : allBorrows.filter(b => b.Status === currentCirculationFilter);
    if (!tb) return;
    tb.innerHTML = list.map(b => {
        let btns = '';
        if (b.Status === 'Pending') btns = `<button onclick="approveBorrow('${b.BorrowID}')" class="bg-blue-700 text-white px-2 py-1 rounded text-xs font-bold">Approve</button>`;
        else if (b.Status === 'Approved') btns = `<button onclick="openIssueModal('${b.BorrowID}')" class="bg-emerald-700 text-white px-2 py-1 rounded text-xs font-bold">Issue</button>`;
        else if (b.Status === 'Active') btns = `<button onclick="adminExtendLoan('${b.BorrowID}')" class="bg-church-600 text-white px-2 py-1 rounded text-xs mr-1">+2 Wks</button><button onclick="openReturnModal('${b.BorrowID}')" class="bg-black text-white px-2 py-1 rounded text-xs">Return</button>`;

        return `<tr class="hover:bg-church-50 border-b"><td class="p-3 font-bold">${b.BookTitle}</td><td class="p-3">${b.MemberName}<br><span class="text-[10px] text-church-500">${b.MemberID}</span></td><td class="p-3">${b.PickupDate}</td><td class="p-3 font-bold">${b.DueDate}</td><td class="p-3 font-bold text-[10px]">${b.Status}</td><td class="p-3"><button onclick="triggerBorrowerWhatsApp('${b.MemberID}', '${b.MemberName}', '${b.BookTitle}', '${b.Status}', '${b.DueDate}')" class="text-emerald-700 border border-emerald-300 rounded px-1.5 py-0.5 text-[10px] bg-emerald-50">WhatsApp</button></td><td class="p-3 text-right">${btns}</td></tr>`;
    }).join('');
}
async function approveBorrow(id) { const { error } = await supabaseClient.from('borrows').update({ status: 'Approved' }).eq('borrow_id', id); if (!error) { const b = allBorrows.find(x => x.BorrowID === id); if (b) b.Status = 'Approved'; renderAdminTables(); initCatalog(); } }
function openIssueModal(id) { targetIssueBorrow = allBorrows.find(b => b.BorrowID === id); document.getElementById('issue-modal-book').textContent = targetIssueBorrow.BookTitle; document.getElementById('issue-date-input').value = new Date().toISOString().split('T')[0]; document.getElementById('issue-modal').classList.remove('hidden'); }
async function confirmAdminIssue() { const date = document.getElementById('issue-date-input').value; const cond = document.getElementById('issue-condition-select').value; const { error } = await supabaseClient.from('borrows').update({ status: 'Active', issued_date: date, condition_issued: cond }).eq('borrow_id', targetIssueBorrow.BorrowID); if (!error) { targetIssueBorrow.Status = 'Active'; targetIssueBorrow.IssuedDate = date; targetIssueBorrow.ConditionIssued = cond; closeModal('issue-modal'); renderAdminTables(); initCatalog(); } }
function openReturnModal(id) { targetReturnBorrow = allBorrows.find(b => b.BorrowID === id); document.getElementById('return-modal-book').textContent = targetReturnBorrow.BookTitle; document.getElementById('return-date-input').value = new Date().toISOString().split('T')[0]; document.getElementById('return-modal').classList.remove('hidden'); }
async function confirmAdminReturn() { const date = document.getElementById('return-date-input').value; const { error } = await supabaseClient.from('borrows').update({ status: 'Returned', return_date: date }).eq('borrow_id', targetReturnBorrow.BorrowID); if (!error) { targetReturnBorrow.Status = 'Returned'; closeModal('return-modal'); renderAdminTables(); initCatalog(); } }
async function adminExtendLoan(id) { const b = allBorrows.find(x => x.BorrowID === id); const nd = new Date(b.DueDate); nd.setDate(nd.getDate() + 14); const nStr = nd.toISOString().split('T')[0]; const { error } = await supabaseClient.from('borrows').update({ due_date: nStr }).eq('borrow_id', id); if (!error) { b.DueDate = nStr; renderAdminTables(); alert("Extended"); } }

// ---------------- ADD, EDIT, DELETE BOOKS ----------------
function openAddBookModal() { document.getElementById('add-book-modal').classList.remove('hidden'); }
async function submitNewBook() {
    const title = document.getElementById('add-book-title').value.trim();
    if (!title) { alert("Title is required."); return; }
    const obj = { title: title, author: document.getElementById('add-book-author').value.trim() || 'Unknown', category: document.getElementById('add-book-category').value, classification: document.getElementById('add-book-class').value, copies: parseInt(document.getElementById('add-book-copies').value) || 1, pages: parseInt(document.getElementById('add-book-pages').value) || 200, description: document.getElementById('add-book-desc').value.trim(), image: document.getElementById('add-book-img').value.trim() || 'images/churchdiscipline.jpeg' };
    const { error } = await supabaseClient.from('books').insert([obj]);
    if (error) { alert("Error adding book: " + error.message); return; }
    document.getElementById('add-book-title').value = ''; document.getElementById('add-book-author').value = ''; document.getElementById('add-book-desc').value = '';
    closeModal('add-book-modal'); alert("Book successfully added to Catalog!"); fetchLibraryDataFromSupabase();
}

function openEditBookModal(id) {
    const book = allBooks.find(b => b.id === id); if (!book) return;
    document.getElementById('edit-book-id').value = book.id; document.getElementById('edit-book-title').value = book.title; document.getElementById('edit-book-author').value = book.author; document.getElementById('edit-book-category').value = book.category; document.getElementById('edit-book-class').value = book.classification; document.getElementById('edit-book-copies').value = book.copies; document.getElementById('edit-book-pages').value = book.pages; document.getElementById('edit-book-desc').value = book.description; document.getElementById('edit-book-img').value = book.image;
    document.getElementById('edit-book-modal').classList.remove('hidden');
}

async function submitEditBook() {
    const id = parseInt(document.getElementById('edit-book-id').value);
    const title = document.getElementById('edit-book-title').value.trim();
    if (!title) { alert("Title is required."); return; }
    const obj = { title: title, author: document.getElementById('edit-book-author').value.trim() || 'Unknown', category: document.getElementById('edit-book-category').value, classification: document.getElementById('edit-book-class').value, copies: parseInt(document.getElementById('edit-book-copies').value) || 1, pages: parseInt(document.getElementById('edit-book-pages').value) || 200, description: document.getElementById('edit-book-desc').value.trim(), image: document.getElementById('edit-book-img').value.trim() || 'images/churchdiscipline.jpeg' };
    const { error } = await supabaseClient.from('books').update(obj).eq('id', id);
    if (error) { alert("Error updating book: " + error.message); return; }
    closeModal('edit-book-modal'); alert("Book successfully updated!"); fetchLibraryDataFromSupabase();
}

async function deleteBook(id) {
    if (!confirm("Are you sure you want to PERMANENTLY delete this book from the catalog?")) return;
    const { error } = await supabaseClient.from('books').delete().eq('id', id);
    if (error) { alert("Error deleting book: " + error.message); return; }
    alert("Book removed from catalog!"); fetchLibraryDataFromSupabase();
}

// ---------------- STOCK, STORAGE & MEMBERS ----------------
function renderStockAuditTable() {
    const tb = document.getElementById('stock-audit-tbody'); if (!tb) return;
    let tc = 0, tl = 0, ta = 0;
    allBooks.forEach(b => { tc += b.copies; const a = calculateAvailableCopies(b.id, b.copies); ta += a; tl += (b.copies - a); });
    
    if(document.getElementById('stock-kpi-titles')) document.getElementById('stock-kpi-titles').textContent = allBooks.length; 
    if(document.getElementById('stock-kpi-total-copies')) document.getElementById('stock-kpi-total-copies').textContent = tc; 
    if(document.getElementById('stock-kpi-loaned')) document.getElementById('stock-kpi-loaned').textContent = tl; 
    if(document.getElementById('stock-kpi-available')) document.getElementById('stock-kpi-available').textContent = ta;

    const q = (document.getElementById('stock-search-input')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('stock-category-filter')?.value || '';
    const acc = document.getElementById('stock-classification-filter')?.value || '';
    const availF = document.getElementById('stock-availability-filter')?.value || '';

    const list = allBooks.filter(b => {
        if(q && !b.title.toLowerCase().includes(q) && !b.author.toLowerCase().includes(q)) return false;
        if(cat && b.category !== cat) return false;
        if(acc && b.classification !== acc) return false;
        const a = calculateAvailableCopies(b.id, b.copies);
        if(availF === 'available' && a <= 0) return false;
        if(availF === 'out' && a > 0) return false;
        return true;
    });

    tb.innerHTML = list.map(b => { 
        const a = calculateAvailableCopies(b.id, b.copies); 
        return `<tr class="border-b"><td class="p-3 font-mono">#${b.id}</td><td class="p-3 font-bold">${b.title} <br><span class="text-[10px] font-normal text-church-500">By ${b.author}</span></td><td class="p-3">${b.category}</td><td class="p-3 text-[10px] font-bold">${b.classification}</td><td class="p-3 text-center">${b.copies}</td><td class="p-3 text-center text-amber-800">${b.copies - a}</td><td class="p-3 text-center text-emerald-700 font-bold">${a}</td><td class="p-3 text-center">${a > 0 ? '<span class="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded text-[10px]">In Stock</span>' : '<span class="bg-red-100 text-red-800 px-1.5 py-0.5 rounded text-[10px]">Out</span>'}</td><td class="p-3 text-right"><button onclick="openEditBookModal(${b.id})" class="text-blue-600 hover:text-blue-800 mr-2" title="Edit Book"><i class="fa-solid fa-pen-to-square"></i></button><button onclick="deleteBook(${b.id})" class="text-red-600 hover:text-red-800" title="Delete Book"><i class="fa-solid fa-trash"></i></button></td></tr>`; 
    }).join('');
}

function switchStorageSubTab(t) { currentStorageSubTab = t; document.getElementById('storage-view-stock').classList.toggle('hidden', t !== 'stock'); document.getElementById('storage-view-dist').classList.toggle('hidden', t !== 'dist'); }
function renderStorageTables() {
    const sT = document.getElementById('storage-stock-tbody'); const dT = document.getElementById('storage-dist-tbody');
    if (sT) sT.innerHTML = allStorageStock.map(s => `<tr><td class="p-3 font-mono">${s.ItemID}</td><td class="p-3 font-bold">${s.Title}</td><td class="p-3">${s.Source}</td><td class="p-3">${s.DateReceived}</td><td class="p-3 text-center">${s.TotalReceived}</td><td class="p-3 text-center text-amber-800">${s.TotalDistributed}</td><td class="p-3 text-center text-emerald-700 font-bold">${s.RemainingStock}</td><td class="p-3 text-right"><button onclick="openStorageDistributeModal('${s.ItemID}')" class="bg-amber-700 text-white px-2 py-1 rounded text-[10px]">Distribute</button></td></tr>`).join('');
    if (dT) dT.innerHTML = allDistributionLogs.map(d => `<tr><td class="p-3 font-mono">${d.LogID}</td><td class="p-3 font-bold">${d.BookTitle}</td><td class="p-3">${d.Recipient}</td><td class="p-3 text-center">${d.Quantity}</td><td class="p-3">${d.Date}</td><td class="p-3">${d.Notes}</td></tr>`).join('');
    if(document.getElementById('count-dist-logs')) document.getElementById('count-dist-logs').textContent = allDistributionLogs.length;
}

function openStorageIntakeModal() { document.getElementById('storage-intake-modal').classList.remove('hidden'); }
async function submitStorageIntake() {
    const copies = parseInt(document.getElementById('intake-copies').value) || 1;
    const obj = { item_id: "STK-" + Date.now(), title: document.getElementById('intake-title').value.trim(), author: document.getElementById('intake-author').value.trim(), category: document.getElementById('intake-category').value, acquisition_type: document.getElementById('intake-acq-type').value, source: document.getElementById('intake-source').value.trim(), total_received: copies, total_distributed: 0, remaining_stock: copies, date_received: document.getElementById('intake-date').value };
    const { error } = await supabaseClient.from('storage_stock').insert([obj]); if (error) { alert(error.message); return; }
    allStorageStock.unshift(mapStorage(obj)); closeModal('storage-intake-modal'); renderStorageTables();
}

function openStorageDistributeModal(p) {
    const s = document.getElementById('dist-item-select'); s.innerHTML = allStorageStock.filter(x => x.RemainingStock > 0).map(x => `<option value="${x.ItemID}" ${x.ItemID === p ? 'selected' : ''}>${x.Title} (${x.RemainingStock} left)</option>`).join('');
    document.getElementById('dist-date').value = new Date().toISOString().split('T')[0]; document.getElementById('storage-distribute-modal').classList.remove('hidden'); updateDistributionMax();
}
function updateDistributionMax() {
    const i = allStorageStock.find(x => x.ItemID === document.getElementById('dist-item-select').value);
    if(i && document.getElementById('dist-available-hint')) document.getElementById('dist-available-hint').textContent = `${i.RemainingStock} copies available.`;
}
async function submitDistributionRecord() {
    const id = document.getElementById('dist-item-select').value; const i = allStorageStock.find(x => x.ItemID === id); const q = parseInt(document.getElementById('dist-qty').value) || 1;
    if (q > i.RemainingStock) { alert("Not enough stock!"); return; }
    const obj = { log_id: "DST-" + Date.now(), item_id: id, book_title: i.Title, recipient: document.getElementById('dist-recipient').value, quantity: q, date: document.getElementById('dist-date').value };
    await supabaseClient.from('distribution_logs').insert([obj]); await supabaseClient.from('storage_stock').update({ total_distributed: i.TotalDistributed + q, remaining_stock: i.RemainingStock - q }).eq('item_id', id);
    i.TotalDistributed += q; i.RemainingStock -= q; allDistributionLogs.unshift(mapDist(obj)); closeModal('storage-distribute-modal'); renderStorageTables(); alert("Distributed!");
}

function renderMembersTable() { const tb = document.getElementById('admin-members-tbody'); if (tb) tb.innerHTML = allMembers.map(m => `<tr><td class="p-3 font-bold">${m.MemberID}</td><td class="p-3">${m.FullName}</td><td class="p-3">${m.Designation}</td><td class="p-3">${m.Phone}</td><td class="p-3 text-right"><button onclick="openEditMemberModal('${m.MemberID}')" class="text-church-700 underline font-bold text-xs">Edit Phone</button></td></tr>`).join(''); }
async function adminRegisterMember() {
    const obj = { member_id: document.getElementById('new-mem-id').value.trim().toUpperCase(), full_name: document.getElementById('new-mem-name').value.trim(), designation: document.getElementById('new-mem-desig').value, phone: document.getElementById('new-mem-phone').value.trim() };
    if (!obj.member_id || !obj.full_name) { alert("Provide ID and Name"); return; }
    const { error } = await supabaseClient.from('members').insert([obj]); if (error) { alert(error.message); return; }
    allMembers.push(mapMember(obj)); alert("Registered!"); renderMembersTable(); document.getElementById('new-mem-id').value = ''; document.getElementById('new-mem-name').value = '';
}
function openEditMemberModal(id) { targetEditMember = allMembers.find(m => m.MemberID === id); document.getElementById('edit-mem-name').textContent = targetEditMember.FullName; document.getElementById('edit-mem-phone').value = targetEditMember.Phone; document.getElementById('edit-member-modal').classList.remove('hidden'); }
async function saveMemberContact() { const ph = document.getElementById('edit-mem-phone').value; const { error } = await supabaseClient.from('members').update({ phone: ph }).eq('member_id', targetEditMember.MemberID); if(!error) { targetEditMember.Phone = ph; closeModal('edit-member-modal'); renderMembersTable(); } }

// ---------------- REPORTS & ANALYTICS ----------------
function applyAnalyticsTimelineFilter() {
    const fromDate = document.getElementById('analytics-date-from')?.value;
    const toDate = document.getElementById('analytics-date-to')?.value;
    const cat = document.getElementById('analytics-category')?.value || '';
    const q = (document.getElementById('analytics-search-query')?.value || '').toLowerCase().trim();

    const filtered = allBorrows.filter(b => {
        const pDate = new Date(b.PickupDate);
        if (fromDate && pDate < new Date(fromDate)) return false;
        if (toDate && pDate > new Date(toDate)) return false;
        
        const book = allBooks.find(bk => bk.id == b.BookID);
        if (cat && book && book.category !== cat) return false;
        
        if (q && !(b.BookTitle.toLowerCase().includes(q) || b.MemberName.toLowerCase().includes(q))) return false;
        return true;
    });

    document.getElementById('stat-period-borrows').textContent = filtered.length;
    document.getElementById('stat-total-members').textContent = allMembers.length;

    const counts = {}; filtered.forEach(b => { counts[b.BookTitle] = (counts[b.BookTitle] || 0) + 1; });
    let topBook = "None", max = 0; for (let t in counts) { if (counts[t] > max) { max = counts[t]; topBook = t; } }
    document.getElementById('stat-top-book').textContent = topBook;

    const tb = document.getElementById('analytics-borrows-tbody');
    if (tb) {
        tb.innerHTML = filtered.map(b => `<tr class="border-b hover:bg-church-50"><td class="p-3 font-bold">${b.BookTitle}</td><td class="p-3">${b.MemberName}</td><td class="p-3">${b.PickupDate}</td><td class="p-3 font-bold">${b.DueDate}</td><td class="p-3">${b.Status}</td></tr>`).join('');
    }
}

function exportAnalyticsCSV() {
    const fromDate = document.getElementById('analytics-date-from')?.value;
    const toDate = document.getElementById('analytics-date-to')?.value;
    const cat = document.getElementById('analytics-category')?.value || '';
    const q = (document.getElementById('analytics-search-query')?.value || '').toLowerCase().trim();

    const filtered = allBorrows.filter(b => {
        const pDate = new Date(b.PickupDate);
        if (fromDate && pDate < new Date(fromDate)) return false;
        if (toDate && pDate > new Date(toDate)) return false;
        const book = allBooks.find(bk => bk.id == b.BookID);
        if (cat && book && book.category !== cat) return false;
        if (q && !(b.BookTitle.toLowerCase().includes(q) || b.MemberName.toLowerCase().includes(q))) return false;
        return true;
    });

    if (filtered.length === 0) { alert("No records found for the selected filters."); return; }

    const headers = ["Borrow ID", "Book Title", "Category", "Borrower Name", "Borrower ID", "Pickup Date", "Due Date", "Return Date", "Status"];
    const rows = filtered.map(b => {
        const book = allBooks.find(bk => bk.id == b.BookID);
        return [`"${b.BorrowID}"`, `"${b.BookTitle}"`, `"${book ? book.category : 'Unknown'}"`, `"${b.MemberName}"`, `"${b.MemberID}"`, `"${b.PickupDate}"`, `"${b.DueDate}"`, `"${b.ReturnDate || ''}"`, `"${b.Status}"`];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url); link.setAttribute("download", `CBC_Library_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
}

// ---------------- EVENT LISTENERS ----------------
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
window.addEventListener('click', (e) => { 
    ['login-modal', 'book-modal', 'borrow-modal', 'onsite-modal', 'admin-pin-modal', 'add-book-modal', 'edit-book-modal', 'storage-intake-modal', 'storage-distribute-modal', 'issue-modal', 'return-modal', 'edit-member-modal', 'my-requests-modal', 'create-group-modal', 'group-modal', 'all-groups-modal', 'admin-settings-modal'].forEach(id => { 
        const el = document.getElementById(id); if (el && e.target === el) el.classList.add('hidden'); 
    }); 
});
