const dashboardClient = supabase.createClient(
  window.CASA_CONFIG.supabaseUrl,
  window.CASA_CONFIG.supabasePublishableKey
);
let currentUserRole = null;
let currentUserEmail = null;
let loadedLeads = [];
let selectedLeadId = null;
let currentPage = 1;
let toastTimer = null;
let pendingSingleLead = null;
let pendingImportLeads = [];
let pendingLeadMove = null;
const selectedLeadIds = new Set();
let currentPageLeads = [];
let pendingStatusChange = null;
const leadStatuses = ['new', 'qualified', 'unqualified', 'voicemail', 'contacted', 'call_no_answer'];

async function requireSession() {
  const { data, error } = await dashboardClient.auth.getSession();
  if (error || !data.session) {
    window.location.replace('index.html');
    return;
  }
  document.getElementById('userEmail').textContent = data.session.user.email;
  currentUserEmail = data.session.user.email;

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
    document.getElementById('emptyLeadsCell').colSpan = 9;
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

const addLeadChoiceModal = document.getElementById('addLeadChoiceModal');
const moveLeadsModal = document.getElementById('moveLeadsModal');
const reassignSelectedModal = document.getElementById('reassignSelectedModal');
const singleLeadModal = document.getElementById('singleLeadModal');
const confirmSingleLeadModal = document.getElementById('confirmSingleLeadModal');
const importModal = document.getElementById('importModal');
document.getElementById('openImportButton').addEventListener('click', async () => {
  addLeadChoiceModal.hidden = false;
  await loadSalesOwners();
});
document.getElementById('openMoveLeadsButton').addEventListener('click', async () => {
  moveLeadsModal.hidden = false;
  document.getElementById('moveConfirmation').hidden = true;
  document.getElementById('moveLeadsForm').hidden = false;
  document.getElementById('moveLeadsMessage').textContent = '';
  await loadSalesOwners();
  await refreshMoveLeadAvailability();
});
document.getElementById('closeMoveLeads').addEventListener('click', closeMoveLeadsModal);
moveLeadsModal.addEventListener('click', (event) => { if (event.target === moveLeadsModal) closeMoveLeadsModal(); });
function closeMoveLeadsModal() { moveLeadsModal.hidden = true; document.getElementById('moveLeadsMessage').textContent = ''; }
document.getElementById('reassignSelectedButton').addEventListener('click', async () => {
  if (!selectedLeadIds.size) return;
  reassignSelectedModal.hidden = false;
  document.getElementById('reassignSelectedIntro').textContent =
    `Choose destination owners for ${selectedLeadIds.size} selected lead${selectedLeadIds.size === 1 ? '' : 's'}.`;
  document.getElementById('reassignSelectedMessage').textContent = '';
  await loadSalesOwners();
});
document.getElementById('closeReassignSelected').addEventListener('click', closeReassignSelectedModal);
reassignSelectedModal.addEventListener('click', (event) => { if (event.target === reassignSelectedModal) closeReassignSelectedModal(); });
function closeReassignSelectedModal() { reassignSelectedModal.hidden = true; document.getElementById('reassignSelectedMessage').textContent = ''; }

document.getElementById('confirmSelectedReassignment').addEventListener('click', async () => {
  const targetOwners = [...document.querySelectorAll('#selectedLeadOwners input:checked')].map((input) => input.value);
  const message = document.getElementById('reassignSelectedMessage');
  if (!targetOwners.length) {
    message.className = 'form-message error';
    message.textContent = 'Select at least one destination sales owner.';
    return;
  }
  const button = document.getElementById('confirmSelectedReassignment');
  button.disabled = true;
  button.textContent = 'Reassigning...';
  const { data, error } = await dashboardClient.rpc('reassign_selected_leads', {
    lead_ids: [...selectedLeadIds],
    target_owners: targetOwners
  });
  if (error) {
    message.className = 'form-message error';
    message.textContent = error.message || 'The selected leads could not be reassigned.';
    showToast('Selected leads could not be reassigned.', 'error');
  } else {
    closeReassignSelectedModal();
    clearLeadSelection();
    await loadLeads();
    showToast(`${data} selected lead${data === 1 ? '' : 's'} successfully reassigned.`);
  }
  button.disabled = false;
  button.textContent = 'Confirm reassignment';
});
document.getElementById('closeAddLeadChoice').addEventListener('click', () => { addLeadChoiceModal.hidden = true; });
addLeadChoiceModal.addEventListener('click', (event) => { if (event.target === addLeadChoiceModal) addLeadChoiceModal.hidden = true; });
document.getElementById('chooseSingleLead').addEventListener('click', () => {
  addLeadChoiceModal.hidden = true;
  singleLeadModal.hidden = false;
});
document.getElementById('chooseMultipleLeads').addEventListener('click', () => {
  addLeadChoiceModal.hidden = true;
  importModal.hidden = false;
});
document.getElementById('closeSingleLead').addEventListener('click', closeSingleLeadModal);
singleLeadModal.addEventListener('click', (event) => { if (event.target === singleLeadModal) closeSingleLeadModal(); });
function closeSingleLeadModal() { singleLeadModal.hidden = true; document.getElementById('singleLeadMessage').textContent = ''; }
document.getElementById('closeConfirmSingleLead').addEventListener('click', returnToSingleLeadForm);
document.getElementById('backToSingleLead').addEventListener('click', returnToSingleLeadForm);
confirmSingleLeadModal.addEventListener('click', (event) => { if (event.target === confirmSingleLeadModal) returnToSingleLeadForm(); });
function returnToSingleLeadForm() { confirmSingleLeadModal.hidden = true; singleLeadModal.hidden = false; }
document.getElementById('closeImportButton').addEventListener('click', closeImportModal);
importModal.addEventListener('click', (event) => { if (event.target === importModal) closeImportModal(); });
function closeImportModal() {
  importModal.hidden = true;
  pendingImportLeads = [];
  document.getElementById('forceImportButton').hidden = true;
  document.getElementById('importMessage').textContent = '';
}

async function loadSalesOwners() {
  const ownerList = document.getElementById('leadOwners');
  const moveOwnerList = document.getElementById('moveToOwners');
  const selectedOwnerList = document.getElementById('selectedLeadOwners');
  const moveFromOwner = document.getElementById('moveFromOwner');
  const selectedImportOwners = new Set([...ownerList.querySelectorAll('input:checked')].map((input) => input.value));
  const singleOwnerSelect = document.getElementById('singleLeadOwner');
  const ownerFilter = document.getElementById('ownerFilter');
  const selectedOwner = ownerFilter.value;
  const message = document.getElementById('importMessage');
  singleOwnerSelect.disabled = true;
  ownerList.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'Loading sales owners...' }));
  moveOwnerList.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'Loading sales owners...' }));
  selectedOwnerList.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'Loading sales owners...' }));
  moveFromOwner.replaceChildren(new Option('Select current sales owner', ''));
  singleOwnerSelect.replaceChildren(new Option('Loading sales owners...', ''));

  const { data, error } = await dashboardClient
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'sales')
    .eq('is_active', true)
    .order('full_name');

  singleOwnerSelect.replaceChildren(new Option('Select a sales owner', ''));
  if (error) {
    console.error('Unable to load sales owners:', error);
    ownerList.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'Unable to load sales owners' }));
    moveOwnerList.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'Unable to load sales owners' }));
    selectedOwnerList.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'Unable to load sales owners' }));
    singleOwnerSelect.replaceChildren(new Option('Unable to load sales owners', ''));
    message.className = 'form-message error';
    message.textContent = 'Sales owners could not be loaded. Check that the latest Supabase migrations were applied.';
  } else if (!data?.length) {
    ownerList.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'No active sales accounts found' }));
    moveOwnerList.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'No active sales accounts found' }));
    selectedOwnerList.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'No active sales accounts found' }));
    singleOwnerSelect.replaceChildren(new Option('No active sales accounts found', ''));
    message.className = 'form-message error';
    message.textContent = 'Create an active Sales account before importing leads.';
  } else {
    ownerList.replaceChildren();
    moveOwnerList.replaceChildren();
    selectedOwnerList.replaceChildren();
    ownerFilter.replaceChildren(new Option('All sales owners', 'all'));
    data.forEach((owner) => {
      const ownerName = owner.full_name || 'Sales user';
      const label = document.createElement('label'); label.className = 'owner-check';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'leadOwners'; checkbox.value = owner.id;
      checkbox.checked = selectedImportOwners.has(owner.id);
      label.append(checkbox, document.createTextNode(ownerName)); ownerList.appendChild(label);
      const moveLabel = document.createElement('label'); moveLabel.className = 'owner-check';
      const moveCheckbox = document.createElement('input'); moveCheckbox.type = 'checkbox'; moveCheckbox.value = owner.id;
      moveLabel.append(moveCheckbox, document.createTextNode(ownerName)); moveOwnerList.appendChild(moveLabel);
      const selectedLabel = document.createElement('label'); selectedLabel.className = 'owner-check';
      const selectedCheckbox = document.createElement('input'); selectedCheckbox.type = 'checkbox'; selectedCheckbox.value = owner.id;
      selectedLabel.append(selectedCheckbox, document.createTextNode(ownerName)); selectedOwnerList.appendChild(selectedLabel);
      moveFromOwner.add(new Option(ownerName, owner.id));
      singleOwnerSelect.add(new Option(ownerName, owner.id));
      ownerFilter.add(new Option(ownerName, owner.id));
    });
    if ([...ownerFilter.options].some((option) => option.value === selectedOwner)) ownerFilter.value = selectedOwner;
    message.textContent = '';
  }
  singleOwnerSelect.disabled = false;
}

document.getElementById('moveFromOwner').addEventListener('change', (event) => {
  document.querySelectorAll('#moveToOwners input').forEach((checkbox) => {
    checkbox.disabled = checkbox.value === event.target.value;
    if (checkbox.disabled) checkbox.checked = false;
    checkbox.parentElement.hidden = checkbox.disabled;
  });
  refreshMoveLeadAvailability();
});
document.getElementById('moveLeadStatus').addEventListener('change', refreshMoveLeadAvailability);

async function getMoveLeadCount() {
  const sourceOwner = document.getElementById('moveFromOwner').value;
  const status = document.getElementById('moveLeadStatus').value;
  if (!sourceOwner) return 0;
  let query = dashboardClient.from('leads').select('id', { count: 'exact', head: true }).eq('owner_id', sourceOwner);
  if (status !== 'all') query = query.eq('status', status);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function refreshMoveLeadAvailability() {
  const sourceOwner = document.getElementById('moveFromOwner').value;
  const status = document.getElementById('moveLeadStatus').value;
  const availability = document.getElementById('moveLeadAvailability');
  const quantity = document.getElementById('moveLeadQuantity');
  quantity.value = '';
  quantity.disabled = true;
  if (!sourceOwner) {
    availability.textContent = 'Select a sales owner to see available leads.';
    return;
  }
  availability.textContent = 'Checking available leads...';
  try {
    const count = await getMoveLeadCount();
    const statusName = status === 'all' ? '' : `${formatStatus(status)} `;
    availability.textContent = `${count} ${statusName}lead${count === 1 ? '' : 's'} available.`;
    if (count) {
      quantity.disabled = false;
      quantity.max = String(count);
      quantity.value = String(count);
      quantity.placeholder = `Maximum ${count}`;
    }
  } catch (error) {
    console.error('Unable to count available leads:', error);
    availability.textContent = 'Available leads could not be counted.';
  }
}

document.getElementById('moveLeadsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const sourceSelect = document.getElementById('moveFromOwner');
  const statusSelect = document.getElementById('moveLeadStatus');
  const quantity = Number(document.getElementById('moveLeadQuantity').value);
  const targetInputs = [...document.querySelectorAll('#moveToOwners input:checked')];
  const message = document.getElementById('moveLeadsMessage');
  message.textContent = '';
  if (!sourceSelect.value || !targetInputs.length) {
    message.className = 'form-message error';
    message.textContent = 'Select a current owner and at least one different destination owner.';
    return;
  }
  let count;
  try {
    count = await getMoveLeadCount();
  } catch (error) {
    message.className = 'form-message error';
    message.textContent = 'Unable to review the leads for this owner.';
    return;
  }
  if (!count) {
    showToast('This sales owner has no leads to move.', 'warning');
    return;
  }
  if (!quantity || quantity < 1 || quantity > count) {
    message.className = 'form-message error';
    message.textContent = `Enter a quantity from 1 to ${count}.`;
    return;
  }
  pendingLeadMove = {
    sourceOwner: sourceSelect.value,
    targetOwners: targetInputs.map((input) => input.value),
    status: statusSelect.value === 'all' ? null : statusSelect.value,
    quantity
  };
  const sourceName = sourceSelect.selectedOptions[0].textContent;
  const targetNames = targetInputs.map((input) => input.parentElement.textContent.trim()).join(', ');
  document.getElementById('moveConfirmationText').textContent =
    `Move ${quantity} ${pendingLeadMove.status ? formatStatus(pendingLeadMove.status) + ' ' : ''}lead${quantity === 1 ? '' : 's'} from ${sourceName} to ${targetNames}? Leads will be distributed evenly.`;
  event.target.hidden = true;
  document.getElementById('moveConfirmation').hidden = false;
});

document.getElementById('cancelMoveLeads').addEventListener('click', () => {
  document.getElementById('moveConfirmation').hidden = true;
  document.getElementById('moveLeadsForm').hidden = false;
});

document.getElementById('confirmMoveLeads').addEventListener('click', async () => {
  if (!pendingLeadMove) return;
  const button = document.getElementById('confirmMoveLeads');
  const message = document.getElementById('moveLeadsMessage');
  button.disabled = true;
  button.textContent = 'Moving leads...';
  const { data, error } = await dashboardClient.rpc('reassign_sales_leads', {
    source_owner: pendingLeadMove.sourceOwner,
    target_owners: pendingLeadMove.targetOwners,
    source_status: pendingLeadMove.status,
    move_limit: pendingLeadMove.quantity
  });
  if (error) {
    message.className = 'form-message error';
    message.textContent = error.message || 'The leads could not be moved.';
    showToast('Leads could not be moved.', 'error');
  } else {
    closeMoveLeadsModal();
    document.getElementById('moveLeadsForm').reset();
    document.getElementById('moveLeadsForm').hidden = false;
    pendingLeadMove = null;
    await loadLeads();
    showToast(`${data} lead${data === 1 ? '' : 's'} successfully moved.`);
  }
  button.disabled = false;
  button.textContent = 'Confirm move';
});

async function loadLeads() {
  const { data, error } = await dashboardClient
    .from('leads')
    .select('id, lead_name, interest, email, phone, timezone, status, status_updated_at, created_at, owner_id, note, owner:profiles!leads_owner_id_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (error) { console.error('Unable to load leads:', error); return; }
  loadedLeads = (data || []).map((lead) => ({ ...lead, timezone: detectTimezone(lead.phone) }));
  renderFilteredLeads();
}

document.getElementById('statusFilter').addEventListener('change', resetLeadPage);
document.getElementById('timezoneFilter').addEventListener('change', resetLeadPage);
document.getElementById('ownerFilter').addEventListener('change', resetLeadPage);
document.getElementById('leadSearch').addEventListener('input', resetLeadPage);
document.getElementById('pageSize').addEventListener('change', resetLeadPage);
document.getElementById('previousPage').addEventListener('click', () => changeLeadPage(-1));
document.getElementById('nextPage').addEventListener('click', () => changeLeadPage(1));

function resetLeadPage() {
  currentPage = 1;
  clearLeadSelection();
  renderFilteredLeads();
}

function changeLeadPage(direction) {
  currentPage += direction;
  clearLeadSelection();
  renderFilteredLeads();
  document.querySelector('.table-scroll').scrollTo({ top: 0, behavior: 'smooth' });
}

function renderFilteredLeads() {
  const selectedStatus = document.getElementById('statusFilter').value;
  const selectedTimezone = document.getElementById('timezoneFilter').value;
  const selectedOwner = document.getElementById('ownerFilter').value;
  const query = document.getElementById('leadSearch').value.trim().toLowerCase();
  const queryDigits = query.replace(/\D/g, '');
  const statusMatches = selectedStatus === 'all'
    ? loadedLeads
    : loadedLeads.filter((lead) => lead.status === selectedStatus);
  const timezoneMatches = selectedTimezone === 'all'
    ? statusMatches
    : statusMatches.filter((lead) => lead.timezone === selectedTimezone);
  const ownerMatches = selectedOwner === 'all'
    ? timezoneMatches
    : timezoneMatches.filter((lead) => lead.owner_id === selectedOwner);
  const filteredLeads = !query ? ownerMatches : ownerMatches.filter((lead) => {
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
  currentPageLeads = sortedLeads.slice(pageStart, pageStart + pageSize);
  renderLeads(currentPageLeads);
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
    const cell = document.createElement('td'); cell.colSpan = currentUserRole === 'supervisor' ? 9 : 7;
    cell.innerHTML = '<span>◎</span><strong>No leads yet</strong><small>Your assigned leads will appear here.</small>';
    row.appendChild(cell); body.appendChild(row); updateBulkSelectionBar(); return;
  }
  leads.forEach((lead) => {
    const row = document.createElement('tr');
    row.className = 'lead-row';
    row.tabIndex = 0;
    row.addEventListener('click', () => openLeadDrawer(lead));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLeadDrawer(lead); }
    });
    if (currentUserRole === 'supervisor') {
      const selectionCell = document.createElement('td'); selectionCell.className = 'selection-column';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'lead-select'; checkbox.checked = selectedLeadIds.has(lead.id);
      checkbox.setAttribute('aria-label', `Select ${lead.lead_name}`);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => {
        checkbox.checked ? selectedLeadIds.add(lead.id) : selectedLeadIds.delete(lead.id);
        updateBulkSelectionBar();
      });
      selectionCell.appendChild(checkbox); row.appendChild(selectionCell);
    }
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
    status.addEventListener('change', () => requestStatusChange(lead, status, date));
    statusCell.appendChild(status); row.appendChild(statusCell);
    const activity = document.createElement('td'); activity.appendChild(date); row.appendChild(activity);
    if (currentUserRole === 'supervisor') { const owner = document.createElement('td'); owner.textContent = lead.owner?.full_name || 'Unassigned'; row.appendChild(owner); }
    body.appendChild(row);
  });
  updateBulkSelectionBar();
}

document.getElementById('selectPageLeads').addEventListener('change', (event) => {
  currentPageLeads.forEach((lead) => event.target.checked ? selectedLeadIds.add(lead.id) : selectedLeadIds.delete(lead.id));
  renderLeads(currentPageLeads);
});

function clearLeadSelection() {
  selectedLeadIds.clear();
  updateBulkSelectionBar();
}

function updateBulkSelectionBar() {
  const selectedOnPage = currentPageLeads.filter((lead) => selectedLeadIds.has(lead.id)).length;
  const totalOnPage = currentPageLeads.length;
  const selectAll = document.getElementById('selectPageLeads');
  selectAll.checked = totalOnPage > 0 && selectedOnPage === totalOnPage;
  selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < totalOnPage;
  document.getElementById('bulkSelectionSummary').textContent = `${selectedOnPage} of ${totalOnPage} selected`;
  document.getElementById('bulkSelectionBar').hidden = currentUserRole !== 'supervisor' || selectedOnPage === 0;
}

const statusConfirmationModal = document.getElementById('statusConfirmationModal');
document.getElementById('closeStatusConfirmation').addEventListener('click', cancelStatusChange);
document.getElementById('cancelStatusChange').addEventListener('click', cancelStatusChange);
statusConfirmationModal.addEventListener('click', (event) => { if (event.target === statusConfirmationModal) cancelStatusChange(); });

function requestStatusChange(lead, select, dateLabel) {
  if (lead.status !== 'new' && select.value === 'new') {
    select.value = lead.status;
    select.className = `status-select status-${lead.status}`;
    showToast('A lead cannot be changed back to New after activity has started.', 'error');
    return;
  }
  pendingStatusChange = { lead, select, dateLabel, previousStatus: lead.status };
  const newStatus = formatStatus(select.value);
  document.getElementById('statusConfirmationText').textContent = lead.status === 'new'
    ? `Are you sure you want to change ${lead.lead_name} to ${newStatus}? Once changed, this lead can never be set back to New.`
    : `Are you sure you want to change ${lead.lead_name} from ${formatStatus(lead.status)} to ${newStatus}?`;
  statusConfirmationModal.hidden = false;
}

function cancelStatusChange() {
  if (pendingStatusChange) {
    pendingStatusChange.select.value = pendingStatusChange.previousStatus;
    pendingStatusChange.select.className = `status-select status-${pendingStatusChange.previousStatus}`;
  }
  pendingStatusChange = null;
  statusConfirmationModal.hidden = true;
}

document.getElementById('confirmStatusChange').addEventListener('click', async () => {
  if (!pendingStatusChange) return;
  const change = pendingStatusChange;
  const button = document.getElementById('confirmStatusChange');
  button.disabled = true;
  button.textContent = 'Changing status...';
  await updateLeadStatus(change.lead.id, change.select, change.dateLabel);
  pendingStatusChange = null;
  statusConfirmationModal.hidden = true;
  button.disabled = false;
  button.textContent = 'Confirm change';
});

async function updateLeadStatus(id, select, dateLabel) {
  const lead = loadedLeads.find((item) => item.id === id);
  if (lead?.status !== 'new' && select.value === 'new') {
    select.value = lead.status;
    showToast('A lead cannot be changed back to New after activity has started.', 'error');
    return;
  }
  select.disabled = true;
  const changedAt = new Date().toISOString();
  const { error } = await dashboardClient.from('leads').update({ status: select.value, status_updated_at: changedAt }).eq('id', id);
  if (error) { showToast('Status could not be updated.', 'error'); await loadLeads(); return; }
  select.className = `status-select status-${select.value}`;
  dateLabel.textContent = formatActivity(changedAt);
  if (lead) { lead.status = select.value; lead.status_updated_at = changedAt; }
  select.disabled = false;
  renderFilteredLeads();
  showToast(`Status successfully set to ${formatStatus(select.value)}.`);
}

document.getElementById('singleLeadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const phone = document.getElementById('singleLeadPhone').value.trim();
  const ownerSelect = document.getElementById('singleLeadOwner');
  pendingSingleLead = {
    lead_name: document.getElementById('singleLeadName').value.trim(),
    email: document.getElementById('singleLeadEmail').value.trim(),
    phone,
    interest: document.getElementById('singleLeadInterest').value.trim(),
    owner_id: ownerSelect.value,
    timezone: detectTimezone(phone),
    status: 'new',
    status_updated_at: null
  };
  document.getElementById('confirmLeadName').textContent = pendingSingleLead.lead_name;
  document.getElementById('confirmLeadEmail').textContent = pendingSingleLead.email;
  document.getElementById('confirmLeadPhone').textContent = pendingSingleLead.phone || '';
  document.getElementById('confirmLeadInterest').textContent = pendingSingleLead.interest || '';
  document.getElementById('confirmLeadTimezone').textContent = pendingSingleLead.timezone;
  document.getElementById('confirmLeadOwner').textContent = ownerSelect.selectedOptions[0]?.textContent || '';
  document.getElementById('confirmSingleLeadMessage').textContent = '';
  document.getElementById('forceCreateSingleLead').hidden = true;
  singleLeadModal.hidden = true;
  confirmSingleLeadModal.hidden = false;
});

document.getElementById('confirmCreateSingleLead').addEventListener('click', () => createPendingSingleLead(false));
document.getElementById('forceCreateSingleLead').addEventListener('click', () => createPendingSingleLead(true));

async function createPendingSingleLead(force) {
  if (!pendingSingleLead) return;
  const button = document.getElementById('confirmCreateSingleLead');
  const forceButton = document.getElementById('forceCreateSingleLead');
  const message = document.getElementById('confirmSingleLeadMessage');
  button.disabled = true;
  forceButton.disabled = true;
  button.textContent = 'Creating lead...';
  message.textContent = '';
  if (!force) {
    let duplicates;
    try {
      duplicates = await findLeadDuplicates([pendingSingleLead]);
    } catch (error) {
      console.error('Unable to check for duplicate leads:', error);
      message.className = 'form-message error';
      message.textContent = 'The system could not check for duplicates. Please try again.';
      button.disabled = false;
      forceButton.disabled = false;
      button.textContent = 'Confirm and create';
      return;
    }
    if (duplicates.length) {
      const duplicateMessage = `Possible duplicate found: ${duplicates.join(', ')}. Review the information or use Force create.`;
      showToast(duplicateMessage, 'warning');
      forceButton.hidden = false;
      button.disabled = false;
      forceButton.disabled = false;
      button.textContent = 'Confirm and create';
      return;
    }
  }
  const { error } = await dashboardClient.from('leads').insert(pendingSingleLead);
  if (error) {
    message.className = 'form-message error';
    message.textContent = error.message || 'The lead could not be created.';
    showToast('Lead could not be created.', 'error');
  } else {
    document.getElementById('singleLeadForm').reset();
    confirmSingleLeadModal.hidden = true;
    singleLeadModal.hidden = true;
    pendingSingleLead = null;
    await loadLeads();
    showToast('Lead successfully created.');
  }
  button.disabled = false;
  forceButton.disabled = false;
  button.textContent = 'Confirm and create';
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
  document.getElementById('leadNoteForm').hidden = true;
  document.getElementById('openAddNoteForm').hidden = false;
  document.getElementById('noteHistory').open = false;
  document.getElementById('activityHistory').open = false;
  document.getElementById('noteMessage').textContent = '';
  leadDrawer.hidden = false;
  leadDrawerOverlay.hidden = false;
  await Promise.all([loadNoteHistory(lead), loadActivityHistory(lead)]);
}

async function loadActivityHistory(lead) {
  const list = document.getElementById('activityHistoryList');
  const count = document.getElementById('activityHistoryCount');
  list.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Loading...' }));
  count.textContent = '0';
  const { data, error } = await dashboardClient
    .from('lead_activity_history')
    .select('event_type, old_status, new_status, old_owner_name, new_owner_name, changed_by_name, changed_at')
    .eq('lead_id', lead.id)
    .order('changed_at', { ascending: false });
  if (selectedLeadId !== lead.id) return;
  if (error) {
    console.error('Unable to load activity history:', error);
    list.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Activity history could not be loaded.' }));
    return;
  }
  count.textContent = String(data?.length || 0);
  list.replaceChildren();
  if (!data?.length) {
    list.appendChild(Object.assign(document.createElement('p'), { textContent: 'No activity recorded.' }));
    return;
  }
  data.forEach((entry) => {
    const item = document.createElement('article');
    const description = document.createElement('p');
    description.textContent = entry.event_type === 'status_change'
      ? `Status changed from ${entry.old_status ? formatStatus(entry.old_status) : 'Unknown'} to ${entry.new_status ? formatStatus(entry.new_status) : 'Unknown'}`
      : `Lead moved from ${entry.old_owner_name || 'Unassigned'} to ${entry.new_owner_name || 'Unassigned'}`;
    const meta = document.createElement('time');
    meta.textContent = `${entry.changed_by_name || 'System user'} • ${formatActivity(entry.changed_at)}`;
    item.append(description, meta); list.appendChild(item);
  });
}

async function loadNoteHistory(lead) {
  const list = document.getElementById('noteHistoryList');
  const count = document.getElementById('noteHistoryCount');
  list.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Loading...' }));
  count.textContent = '0';
  let { data, error } = await dashboardClient
    .from('lead_notes')
    .select('note, created_by_name, created_at')
    .eq('lead_id', lead.id)
    .order('created_at', { ascending: false });
  // Keep the complete history visible while the author-name migration is pending.
  if (error) {
    const legacyResult = await dashboardClient
      .from('lead_notes')
      .select('note, created_at')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: false });
    data = legacyResult.data?.map((entry) => ({ ...entry, created_by_name: null }));
    error = legacyResult.error;
  }
  if (selectedLeadId !== lead.id) return;
  if (error) {
    console.error('Unable to load note history:', error);
    count.textContent = lead.note ? '1' : '0';
    list.replaceChildren(Object.assign(document.createElement('p'), { textContent: lead.note || 'No notes added.' }));
    return;
  }
  const notes = data?.length ? data : (lead.note ? [{ note: lead.note, created_at: null }] : []);
  count.textContent = String(notes.length);
  list.replaceChildren();
  if (!notes.length) {
    list.appendChild(Object.assign(document.createElement('p'), { textContent: 'No notes added.' }));
    return;
  }
  notes.forEach((entry) => {
    const item = document.createElement('article');
    const text = document.createElement('p'); text.textContent = entry.note;
    const date = document.createElement('time');
    const author = entry.created_by_name || 'Email unavailable';
    date.textContent = entry.created_at ? `${author} - ${formatActivity(entry.created_at)}` : author;
    item.append(text, date); list.appendChild(item);
  });
}

function closeLeadDrawer() {
  leadDrawer.hidden = true;
  leadDrawerOverlay.hidden = true;
  selectedLeadId = null;
}

document.getElementById('openAddNoteForm').addEventListener('click', () => {
  document.getElementById('openAddNoteForm').hidden = true;
  document.getElementById('leadNoteForm').hidden = false;
  document.getElementById('detailNote').focus();
});

document.getElementById('cancelAddNote').addEventListener('click', () => {
  document.getElementById('detailNote').value = '';
  document.getElementById('leadNoteForm').hidden = true;
  document.getElementById('openAddNoteForm').hidden = false;
  document.getElementById('noteMessage').textContent = '';
});

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
  const { error } = await dashboardClient.from('lead_notes').insert({
    lead_id: leadId,
    note,
    created_by_name: currentUserEmail
  });
  if (error) {
    message.className = 'form-message error';
    message.textContent = 'Notes could not be saved.';
    showToast('Note could not be added.', 'error');
  } else {
    const lead = loadedLeads.find((item) => item.id === leadId);
    if (lead) lead.note = note;
    await dashboardClient.from('leads').update({ note }).eq('id', leadId);
    document.getElementById('detailNote').value = '';
    document.getElementById('leadNoteForm').hidden = true;
    document.getElementById('openAddNoteForm').hidden = false;
    if (lead) await loadNoteHistory(lead);
    message.className = 'form-message success';
    message.textContent = 'Note added.';
    showToast('Note successfully added.');
  }
  button.disabled = false;
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !statusConfirmationModal.hidden) cancelStatusChange();
  if (event.key === 'Escape' && !leadDrawer.hidden) closeLeadDrawer();
});

document.getElementById('importLeadsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = document.getElementById('leadsFile').files[0];
  const ownerIds = [...document.querySelectorAll('#leadOwners input:checked')].map((input) => input.value);
  const button = document.getElementById('importButton');
  const message = document.getElementById('importMessage');
  const forceButton = document.getElementById('forceImportButton');
  forceButton.hidden = true;
  button.disabled = true; button.textContent = 'Importing...'; message.textContent = '';
  try {
    if (!ownerIds.length) throw new Error('Select at least one sales owner.');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    const leads = rows.map(normalizeLeadRow).filter((lead) => lead.lead_name && lead.email);
    if (!leads.length) throw new Error('No valid rows found. Check the required column names.');
    leads.forEach((lead, index) => { lead.owner_id = ownerIds[index % ownerIds.length]; });
    pendingImportLeads = leads;
    const duplicates = await findLeadDuplicates(leads);
    if (duplicates.length) {
      const duplicateMessage = `${duplicates.length} possible duplicate${duplicates.length === 1 ? '' : 's'} found: ${duplicates.slice(0, 4).join(', ')}${duplicates.length > 4 ? ', and more' : ''}. Use Force import only if intentional.`;
      showToast(duplicateMessage, 'warning');
      forceButton.hidden = false;
    } else {
      await insertPendingImportLeads();
    }
  } catch (error) {
    message.className = 'form-message error';
    message.textContent = error.message || 'The file could not be imported.';
    showToast(message.textContent, 'error');
  }
  button.disabled = false; button.textContent = 'Import leads';
});

document.getElementById('forceImportButton').addEventListener('click', insertPendingImportLeads);

async function insertPendingImportLeads() {
  if (!pendingImportLeads.length) return;
  const forceButton = document.getElementById('forceImportButton');
  const message = document.getElementById('importMessage');
  forceButton.disabled = true;
  forceButton.textContent = 'Importing...';
  const leads = pendingImportLeads;
  const { error } = await dashboardClient.from('leads').insert(leads);
  if (error) {
    message.className = 'form-message error';
    message.textContent = error.message || 'The leads could not be imported.';
    showToast('Leads could not be imported.', 'error');
  } else {
    message.className = 'form-message success';
    message.textContent = `${leads.length} lead${leads.length === 1 ? '' : 's'} imported successfully.`;
    showToast(`${leads.length} lead${leads.length === 1 ? '' : 's'} successfully created.`);
    document.getElementById('importLeadsForm').reset();
    pendingImportLeads = [];
    forceButton.hidden = true;
    await loadLeads();
  }
  forceButton.disabled = false;
  forceButton.textContent = 'Force import duplicates';
}

async function findLeadDuplicates(candidates) {
  const existingLeads = [];
  const batchSize = 1000;
  for (let from = 0; ; from += batchSize) {
    const { data, error } = await dashboardClient
      .from('leads')
      .select('lead_name, email, phone')
      .range(from, from + batchSize - 1);
    if (error) throw error;
    existingLeads.push(...(data || []));
    if (!data || data.length < batchSize) break;
  }
  const existingEmails = new Set(existingLeads.map((lead) => normalizeEmail(lead.email)).filter(Boolean));
  const existingPhones = new Set(existingLeads.map((lead) => normalizePhone(lead.phone)).filter(Boolean));
  const seenEmails = new Set();
  const seenPhones = new Set();
  const duplicates = [];
  candidates.forEach((lead) => {
    const email = normalizeEmail(lead.email);
    const phone = normalizePhone(lead.phone);
    const duplicateEmail = email && (existingEmails.has(email) || seenEmails.has(email));
    const duplicatePhone = phone && (existingPhones.has(phone) || seenPhones.has(phone));
    if (duplicateEmail || duplicatePhone) {
      const matchingFields = [duplicateEmail ? 'email' : '', duplicatePhone ? 'phone' : ''].filter(Boolean).join(' and ');
      duplicates.push(`${lead.lead_name} (${matchingFields})`);
    }
    if (email) seenEmails.add(email);
    if (phone) seenPhones.add(phone);
  });
  return duplicates;
}

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

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
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, type === 'warning' ? 6000 : 3500);
}
