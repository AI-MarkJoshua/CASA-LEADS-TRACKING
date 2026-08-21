const dashboardClient = supabase.createClient(
  window.CASA_CONFIG.supabaseUrl,
  window.CASA_CONFIG.supabasePublishableKey
);
let currentUserRole = null;

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
    document.getElementById('emptyLeadsCell').colSpan = 7;
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
  }

  if (!error) event.target.reset();
  button.disabled = false;
  button.textContent = 'Create account';
});

const importModal = document.getElementById('importModal');
document.getElementById('openImportButton').addEventListener('click', () => { importModal.hidden = false; });
document.getElementById('closeImportButton').addEventListener('click', closeImportModal);
importModal.addEventListener('click', (event) => { if (event.target === importModal) closeImportModal(); });
function closeImportModal() { importModal.hidden = true; document.getElementById('importMessage').textContent = ''; }

async function loadSalesOwners() {
  const { data } = await dashboardClient.from('profiles').select('id, full_name').eq('role', 'sales').eq('is_active', true).order('full_name');
  const select = document.getElementById('leadOwner');
  (data || []).forEach((owner) => select.add(new Option(owner.full_name || 'Sales user', owner.id)));
}

async function loadLeads() {
  const { data, error } = await dashboardClient
    .from('leads')
    .select('id, lead_name, interest, email, phone, timezone, status, status_updated_at, owner:profiles!leads_owner_id_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (error) { console.error('Unable to load leads:', error); return; }
  renderLeads(data || []);
}

function renderLeads(leads) {
  const body = document.getElementById('leadsTableBody');
  body.replaceChildren();
  if (!leads.length) {
    const row = document.createElement('tr'); row.className = 'empty-row';
    const cell = document.createElement('td'); cell.colSpan = currentUserRole === 'supervisor' ? 7 : 6;
    cell.innerHTML = '<span>◎</span><strong>No leads yet</strong><small>Your assigned leads will appear here.</small>';
    row.appendChild(cell); body.appendChild(row); return;
  }
  leads.forEach((lead) => {
    const row = document.createElement('tr');
    [lead.lead_name, lead.interest, lead.email, lead.phone, lead.timezone].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value || '—'; row.appendChild(cell);
    });
    const activity = document.createElement('td');
    const status = document.createElement('select'); status.className = `status-select status-${lead.status}`;
    ['new', 'contacted', 'qualified', 'unqualified'].forEach((value) => status.add(new Option(titleCase(value), value)));
    status.value = lead.status;
    const date = document.createElement('small'); date.className = 'activity-date'; date.textContent = formatActivity(lead.status_updated_at);
    status.addEventListener('change', () => updateLeadStatus(lead.id, status, date));
    activity.append(status, date); row.appendChild(activity);
    if (currentUserRole === 'supervisor') { const owner = document.createElement('td'); owner.textContent = lead.owner?.full_name || 'Unassigned'; row.appendChild(owner); }
    body.appendChild(row);
  });
}

async function updateLeadStatus(id, select, dateLabel) {
  select.disabled = true;
  const changedAt = new Date().toISOString();
  const { error } = await dashboardClient.from('leads').update({ status: select.value, status_updated_at: changedAt }).eq('id', id);
  if (error) { alert('Status could not be updated.'); await loadLeads(); return; }
  select.className = `status-select status-${select.value}`;
  dateLabel.textContent = formatActivity(changedAt);
  select.disabled = false;
}

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
    event.target.reset(); await loadLeads();
  } catch (error) { message.className = 'form-message error'; message.textContent = error.message || 'The file could not be imported.'; }
  button.disabled = false; button.textContent = 'Import leads';
});

function normalizeLeadRow(row) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().trim().replaceAll(' ', '_'), String(value).trim()]));
  return { lead_name: normalized.lead_name || normalized.name, interest: normalized.interest, email: normalized.email, phone: normalized.phone, timezone: detectTimezone(normalized.phone), status: 'new' };
}

function detectTimezone(phone = '') {
  const digits = phone.replace(/[^\d+]/g, '');
  const zones = [['+971', 'Asia/Dubai'], ['+63', 'Asia/Manila'], ['63', 'Asia/Manila'], ['09', 'Asia/Manila'], ['+44', 'Europe/London'], ['+61', 'Australia/Sydney'], ['+81', 'Asia/Tokyo'], ['+82', 'Asia/Seoul'], ['+65', 'Asia/Singapore'], ['+1', 'America/New_York']];
  return zones.find(([prefix]) => digits.startsWith(prefix))?.[1] || 'Unknown';
}

function formatActivity(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'No activity'; }
function titleCase(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
