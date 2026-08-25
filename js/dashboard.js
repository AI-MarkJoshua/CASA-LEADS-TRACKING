const dashboardClient = supabase.createClient(
  window.CASA_CONFIG.supabaseUrl,
  window.CASA_CONFIG.supabasePublishableKey
);
let currentUserRole = null;
let loadedLeads = [];
let selectedLeadId = null;
let currentPage = 1;
let toastTimer = null;
const leadStatuses = ['new', 'qualified', 'unqualified', 'voicemail', 'contacted', 'call_no_answer'];

async function requireSession() {
  const { data, error } = await dashboardClient.auth.getSession();
  if (error || !data.session) {
    window.location.replace('index.html');
    return;
  }
  document.getElementById('userEmail').textContent = data.session.user.email;

  const { data: profile, error: profileError } = await dashboardClient
    .from('profiles')
    .select('full_name, role, is_active')
    .eq('id', data.session.user.id)
    .single();

  if (profileError || !profile?.is_active) {
    await dashboardClient.auth.signOut();
    window.location.replace('index.html');
    return;
  }

  document.getElementById('userRole').textContent = profile.role;
  currentUserRole = profile.role;
  const displayName = profile.full_name || data.session.user.email.split('@')[0];
  document.getElementById('sidebarRole').textContent = profile.role;
  document.getElementById('sidebarName').textContent = displayName;
  document.getElementById('userInitial').textContent = displayName.charAt(0).toUpperCase();
  document.getElementById('welcomeName').textContent = `Welcome, ${displayName}`;
  if (profile.role === 'supervisor') {
    document.querySelectorAll('.supervisor-only').forEach((element) => {
      element.hidden = false;
    });
    document.querySelectorAll('.owner-column').forEach((column) => { column.hidden = false; });
    document.getElementById('emptyLeadsCell').colSpan = 8;
    await loadSalesOwners();
  }
  await loadLeads();
  document.getElementById('loadingMessage').hidden = true;
  document.querySelector('.app-shell').hidden = false;
}

document.getElementById('logoutButton').addEventListener('click', async () => {
  await dashboardClient.auth.signOut();
  window.location.replace('index.html');
});

dashboardClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') window.location.replace('index.html');
});

requireSession();

const sectionTitles = { dashboardSection: 'Dashboard', leadsSection: 'My Leads', registerSection: 'Register Account' };
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.page-section').forEach((section) => { section.hidden = true; section.classList.remove('active'); });
    const target = document.getElementById(link.dataset.section);
    target.hidden = false;
    target.classList.add('active');
    link.classList.add('active');
    document.getElementById('pageTitle').textContent = sectionTitles[link.dataset.section];
    closeSidebar();
  });
});

const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
document.getElementById('menuButton').addEventListener('click', () => { sidebar.classList.add('open'); sidebarOverlay.classList.add('show'); });
sidebarOverlay.addEventListener('click', closeSidebar);
function closeSidebar() { sidebar.classList.remove('open'); sidebarOverlay.classList.remove('show'); }

document.getElementById('createUserForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('createUserButton');
  const message = document.getElementById('createUserMessage');
  button.disabled = true;
  button.textContent = 'Creating account...';
  message.textContent = '';

  const { data, error } = await dashboardClient.functions.invoke('create-user', {
    body: {
      fullName: document.getElementById('newFullName').value.trim(),
      email: document.getElementById('newEmail').value.trim(),
      password: document.getElementById('newPassword').value,
      role: document.getElementById('newRole').value
    }
  });

  message.className = `form-message ${error ? 'error' : 'success'}`;
  if (error) {
    const functionUnavailable = error.name === 'FunctionsFetchError' ||
      error.message?.includes('Failed to send a request');
    message.textContent = functionUnavailable
      ? 'The create-user Edge Function is not deployed or cannot be reached.'
      : (data?.error || error.message || 'Unable to create the account.');
    console.error('Create user failed:', error, data);
  } else {
    message.textContent = `Account created for ${data.user.email}.`;
    await loadSalesOwners();
  }

  if (!error) event.target.reset();
  button.disabled = false;
  button.textContent = 'Create account';
});

const importModal = document.getElementById('importModal');
document.getElementById('openImportButton').addEventListener('click', async () => {
  importModal.hidden = false;
  await loadSalesOwners();
});
document.getElementById('closeImportButton').addEventListener('click', closeImportModal);
importModal.addEventListener('click', (event) => { if (event.target === importModal) closeImportModal(); });
function closeImportModal() { importModal.hidden = true; document.getElementById('importMessage').textContent = ''; }

async function loadSalesOwners() {
  const select = document.getElementById('leadOwner');
  const message = document.getElementById('importMessage');
  select.disabled = true;
  select.replaceChildren(new Option('Loading sales owners...', ''));

  const { data, error } = await dashboardClient
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'sales')
    .eq('is_active', true)
    .order('full_name');

  select.replaceChildren(new Option('Select a sales owner', ''));
  if (error) {
    console.error('Unable to load sales owners:', error);
    select.replaceChildren(new Option('Unable to load sales owners', ''));
    message.className = 'form-message error';
    message.textContent = 'Sales owners could not be loaded. Check that the latest Supabase migrations were applied.';
  } else if (!data?.length) {
    select.replaceChildren(new Option('No active sales accounts found', ''));
    message.className = 'form-message error';
    message.textContent = 'Create an active Sales account before importing leads.';
  } else {
    data.forEach((owner) => select.add(new Option(owner.full_name || 'Sales user', owner.id)));
    message.textContent = '';
  }
  select.disabled = false;
}

async function loadLeads() {
  const { data, error } = await dashboardClient
    .from('leads')
    .select('id, lead_name, interest, email, phone, timezone, status, status_updated_at, created_at, note, owner:profiles!leads_owner_id_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (error) { console.error('Unable to load leads:', error); return; }
  loadedLeads = (data || []).map((lead) => ({ ...lead, timezone: detectTimezone(lead.phone) }));
  renderFilteredLeads();
}

document.getElementById('statusFilter').addEventListener('change', resetLeadPage);
document.getElementById('timezoneFilter').addEventListener('change', resetLeadPage);
document.getElementById('leadSearch').addEventListener('input', resetLeadPage);
document.getElementById('pageSize').addEventListener('change', resetLeadPage);
document.getElementById('previousPage').addEventListener('click', () => changeLeadPage(-1));
document.getElementById('nextPage').addEventListener('click', () => changeLeadPage(1));

function resetLeadPage() {
  currentPage = 1;
  renderFilteredLeads();
}

function changeLeadPage(direction) {
  currentPage += direction;
  renderFilteredLeads();
  document.querySelector('.table-scroll').scrollTo({ top: 0, behavior: 'smooth' });
}

function renderFilteredLeads() {
  const selectedStatus = document.getElementById('statusFilter').value;
  const selectedTimezone = document.getElementById('timezoneFilter').value;
  const query = document.getElementById('leadSearch').value.trim().toLowerCase();
  const queryDigits = query.replace(/\D/g, '');
  const statusMatches = selectedStatus === 'all'
    ? loadedLeads
    : loadedLeads.filter((lead) => lead.status === selectedStatus);
  const timezoneMatches = selectedTimezone === 'all'
    ? statusMatches
    : statusMatches.filter((lead) => lead.timezone === selectedTimezone);
  const filteredLeads = !query ? timezoneMatches : timezoneMatches.filter((lead) => {
    const textMatches = [lead.lead_name, lead.interest]
      .some((value) => String(value || '').toLowerCase().includes(query));
    const phone = String(lead.phone || '');
    const phoneMatches = phone.toLowerCase().includes(query) ||
      (queryDigits && phone.replace(/\D/g, '').includes(queryDigits));
    return textMatches || phoneMatches;
  });
  const sortedLeads = [...filteredLeads].sort((first, second) => {
    const firstActivity = first.status_updated_at ? new Date(first.status_updated_at).getTime() : -Infinity;
    const secondActivity = second.status_updated_at ? new Date(second.status_updated_at).getTime() : -Infinity;
    if (secondActivity !== firstActivity) return secondActivity - firstActivity;
    return new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
  });
  const pageSize = Number(document.getElementById('pageSize').value) || 10;
  const totalPages = Math.max(1, Math.ceil(sortedLeads.length / pageSize));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  renderLeads(sortedLeads.slice(pageStart, pageStart + pageSize));
  renderPagination(sortedLeads.length, pageStart, pageSize, totalPages);
}

function renderPagination(total, pageStart, pageSize, totalPages) {
  const first = total ? pageStart + 1 : 0;
  const last = Math.min(pageStart + pageSize, total);
  document.getElementById('paginationSummary').textContent = total
    ? `Showing ${first}-${last} of ${total} leads`
    : '0 leads';
  document.getElementById('pageIndicator').textContent = `Page ${currentPage} of ${totalPages}`;
  document.getElementById('previousPage').disabled = currentPage === 1;
  document.getElementById('nextPage').disabled = currentPage === totalPages;
}

function renderLeads(leads) {
  const body = document.getElementById('leadsTableBody');
  body.replaceChildren();
  if (!leads.length) {
    const row = document.createElement('tr'); row.className = 'empty-row';
    const cell = document.createElement('td'); cell.colSpan = currentUserRole === 'supervisor' ? 8 : 7;
    cell.innerHTML = '<span>◎</span><strong>No leads yet</strong><small>Your assigned leads will appear here.</small>';
    row.appendChild(cell); body.appendChild(row); return;
  }
  leads.forEach((lead) => {
    const row = document.createElement('tr');
    row.className = 'lead-row';
    row.tabIndex = 0;
    row.addEventListener('click', () => openLeadDrawer(lead));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLeadDrawer(lead); }
    });
    [lead.lead_name, lead.interest, lead.email, lead.phone, lead.timezone].forEach((value, index) => {
      const cell = document.createElement('td'); cell.textContent = value || '—'; row.appendChild(cell);
      if (index === 3 && value) {
        cell.classList.add('phone-cell');
        const copyButton = document.createElement('button');
        copyButton.className = 'phone-copy'; copyButton.type = 'button';
        copyButton.setAttribute('aria-label', `Copy phone number ${value}`);
        copyButton.title = 'Copy phone number';
        copyButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          try {
            await copyText(String(value));
            copyButton.classList.add('copied');
            copyButton.title = 'Copied';
            window.setTimeout(() => { copyButton.classList.remove('copied'); copyButton.title = 'Copy phone number'; }, 1200);
          } catch (error) { console.error('Unable to copy phone number:', error); }
        });
        copyButton.addEventListener('keydown', (event) => event.stopPropagation());
        cell.appendChild(copyButton);
      }
    });
    const statusCell = document.createElement('td');
    const status = document.createElement('select'); status.className = `status-select status-${lead.status}`;
    status.addEventListener('click', (event) => event.stopPropagation());
    status.addEventListener('keydown', (event) => event.stopPropagation());
    leadStatuses
      .filter((value) => value !== 'new' || lead.status === 'new')
      .forEach((value) => status.add(new Option(formatStatus(value), value)));
    status.value = lead.status;
    const date = document.createElement('small'); date.className = 'activity-date'; date.textContent = formatActivity(lead.status_updated_at);
    status.addEventListener('change', () => updateLeadStatus(lead.id, status, date));
    statusCell.appendChild(status); row.appendChild(statusCell);
    const activity = document.createElement('td'); activity.appendChild(date); row.appendChild(activity);
    if (currentUserRole === 'supervisor') { const owner = document.createElement('td'); owner.textContent = lead.owner?.full_name || 'Unassigned'; row.appendChild(owner); }
    body.appendChild(row);
  });
}

async function updateLeadStatus(id, select, dateLabel) {
  select.disabled = true;
  const changedAt = new Date().toISOString();
  const { error } = await dashboardClient.from('leads').update({ status: select.value, status_updated_at: changedAt }).eq('id', id);
  if (error) { showToast('Status could not be updated.', 'error'); await loadLeads(); return; }
  select.className = `status-select status-${select.value}`;
  dateLabel.textContent = formatActivity(changedAt);
  const lead = loadedLeads.find((item) => item.id === id);
  if (lead) { lead.status = select.value; lead.status_updated_at = changedAt; }
  select.disabled = false;
  renderFilteredLeads();
  showToast(`Status successfully set to ${formatStatus(select.value)}.`);
}

const leadDrawer = document.getElementById('leadDrawer');
const leadDrawerOverlay = document.getElementById('leadDrawerOverlay');
document.getElementById('closeLeadDrawer').addEventListener('click', closeLeadDrawer);
leadDrawerOverlay.addEventListener('click', closeLeadDrawer);
document.querySelectorAll('.copy-detail').forEach((button) => {
  button.addEventListener('click', async () => {
    const value = document.getElementById(button.dataset.copyTarget).textContent.trim();
    if (!value) return;
    try {
      await copyText(value);
      const original = button.innerHTML;
      button.textContent = 'Copied';
      button.classList.add('copied');
      window.setTimeout(() => { button.innerHTML = original; button.classList.remove('copied'); }, 1200);
    } catch (error) {
      console.error('Unable to copy lead detail:', error);
      button.title = 'Copy failed';
    }
  });
});

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

async function openLeadDrawer(lead) {
  selectedLeadId = lead.id;
  document.getElementById('leadDrawerTitle').textContent = 'Lead information';
  document.getElementById('detailName').textContent = lead.lead_name || '';
  document.getElementById('detailEmail').textContent = lead.email || '';
  document.getElementById('detailPhone').textContent = lead.phone || '';
  document.getElementById('detailInterest').textContent = lead.interest || '';
  document.getElementById('detailTimezone').textContent = lead.timezone || 'Unknown';
  document.getElementById('detailStatus').textContent = formatStatus(lead.status);
  document.getElementById('detailActivity').textContent = formatActivity(lead.status_updated_at);
  document.getElementById('detailOwner').textContent = lead.owner?.full_name || 'Unassigned';
  document.getElementById('detailNote').value = '';
  document.getElementById('noteMessage').textContent = '';
  leadDrawer.hidden = false;
  leadDrawerOverlay.hidden = false;
  await loadLastNote(lead);
}

async function loadLastNote(lead) {
  const noteText = document.getElementById('lastNoteText');
  const noteDate = document.getElementById('lastNoteDate');
  noteText.textContent = 'Loading...';
  noteDate.textContent = '';
  const { data, error } = await dashboardClient
    .from('lead_notes')
    .select('note, created_at')
    .eq('lead_id', lead.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selectedLeadId !== lead.id) return;
  if (error) {
    console.error('Unable to load the last note:', error);
    noteText.textContent = lead.note || 'No notes yet.';
    return;
  }
  noteText.textContent = data?.note || lead.note || 'No notes yet.';
  noteDate.textContent = data?.created_at ? formatActivity(data.created_at) : '';
}

function closeLeadDrawer() {
  leadDrawer.hidden = true;
  leadDrawerOverlay.hidden = true;
  selectedLeadId = null;
}

document.getElementById('leadNoteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedLeadId) return;
  const note = document.getElementById('detailNote').value.trim();
  if (!note) return;
  const button = document.getElementById('saveNoteButton');
  const message = document.getElementById('noteMessage');
  button.disabled = true;
  message.textContent = '';
  const leadId = selectedLeadId;
  const { error } = await dashboardClient.from('lead_notes').insert({ lead_id: leadId, note });
  if (error) {
    message.className = 'form-message error';
    message.textContent = 'Notes could not be saved.';
    showToast('Note could not be added.', 'error');
  } else {
    const lead = loadedLeads.find((item) => item.id === leadId);
    if (lead) lead.note = note;
    await dashboardClient.from('leads').update({ note }).eq('id', leadId);
    document.getElementById('detailNote').value = '';
    if (lead) await loadLastNote(lead);
    message.className = 'form-message success';
    message.textContent = 'Note added.';
    showToast('Note successfully added.');
  }
  button.disabled = false;
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !leadDrawer.hidden) closeLeadDrawer();
});

document.getElementById('importLeadsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = document.getElementById('leadsFile').files[0];
  const ownerId = document.getElementById('leadOwner').value;
  const button = document.getElementById('importButton');
  const message = document.getElementById('importMessage');
  button.disabled = true; button.textContent = 'Importing...'; message.textContent = '';
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    const leads = rows.map(normalizeLeadRow).filter((lead) => lead.lead_name && lead.email);
    if (!leads.length) throw new Error('No valid rows found. Check the required column names.');
    leads.forEach((lead) => { lead.owner_id = ownerId; });
    const { error } = await dashboardClient.from('leads').insert(leads);
    if (error) throw error;
    message.className = 'form-message success'; message.textContent = `${leads.length} lead${leads.length === 1 ? '' : 's'} imported successfully.`;
    showToast(`${leads.length} lead${leads.length === 1 ? '' : 's'} successfully created.`);
    event.target.reset(); await loadLeads();
  } catch (error) {
    message.className = 'form-message error';
    message.textContent = error.message || 'The file could not be imported.';
    showToast(message.textContent, 'error');
  }
  button.disabled = false; button.textContent = 'Import leads';
});

function normalizeLeadRow(row) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), value
  ]));
  const value = (key) => String(normalized[key] ?? '').trim();
  const phone = value('phone') || value('phone_number') || value('contact_number');
  const importedStatus = value('status').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const status = leadStatuses.includes(importedStatus) ? importedStatus : 'new';
  const statusDate = normalized.status_date ?? normalized.last_activity ?? normalized.activity_date;
  return {
    lead_name: value('lead_name') || value('lead') || value('name'),
    email: value('email') || value('email_address'),
    phone,
    interest: value('interest'),
    timezone: detectTimezone(phone),
    status,
    status_updated_at: status === 'new' ? null : parseSpreadsheetDate(statusDate),
    note: value('note') || value('notes')
  };
}

function parseSpreadsheetDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 12)).toISOString();
  }
  const text = String(value).trim();
  const parts = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (parts) return new Date(Date.UTC(Number(parts[3]), Number(parts[1]) - 1, Number(parts[2]), 12)).toISOString();
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function detectTimezone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  const nationalNumber = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (nationalNumber.length !== 10) return 'Unknown';
  const areaCode = nationalNumber.slice(0, 3);
  const timezoneAreaCodes = {
    Eastern: new Set(('201 202 203 207 212 215 216 220 223 226 227 229 231 234 239 240 242 248 249 252 267 272 276 278 289 301 302 304 305 313 315 317 321 326 329 330 332 336 339 343 347 351 352 363 365 380 386 401 404 407 410 412 413 416 418 419 423 434 437 438 440 445 450 463 470 475 478 484 508 513 516 517 518 519 540 551 561 567 570 571 579 581 582 585 586 603 607 609 610 613 614 616 617 631 640 646 647 649 656 667 678 680 681 689 703 704 705 706 716 717 724 727 740 743 754 762 770 772 774 781 786 802 803 804 810 813 814 828 839 843 845 848 854 856 857 859 860 862 863 864 865 873 878 904 908 910 912 914 917 919 929 930 934 937 941 943 947 954 959 973 978 980 984 989').split(' ')),
    Central: new Set(('205 210 214 217 218 219 224 225 228 251 254 256 262 270 281 309 312 314 316 319 320 325 331 334 337 346 361 364 402 405 409 417 430 447 448 464 469 479 501 504 507 515 531 534 539 557 563 573 580 601 605 608 612 615 618 620 629 630 636 641 651 659 660 662 682 701 708 712 713 715 726 731 737 763 769 773 779 785 806 815 816 817 830 832 847 850 870 872 901 903 913 918 920 931 936 938 940 945 952 956 972 975 979 985').split(' ')),
    Mountain: new Set(('303 307 385 406 432 435 480 505 520 575 602 623 720 915 928 970 983').split(' ')),
    Pacific: new Set(('206 209 213 253 279 310 323 341 350 360 369 408 415 424 425 442 503 509 510 530 541 559 562 564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831 858 909 916 925 949 951 971').split(' '))
  };
  return Object.entries(timezoneAreaCodes).find(([, codes]) => codes.has(areaCode))?.[0] || 'Unknown';
}

function formatActivity(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'No activity'; }
function titleCase(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function formatStatus(value) { return value.split('_').map(titleCase).join(' '); }

function showToast(message, type = 'success') {
  const toast = document.getElementById('actionToast');
  document.getElementById('toastMessage').textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3500);
}
