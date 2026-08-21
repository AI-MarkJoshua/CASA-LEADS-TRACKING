const dashboardClient = supabase.createClient(
  window.CASA_CONFIG.supabaseUrl,
  window.CASA_CONFIG.supabasePublishableKey
);

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
  const displayName = profile.full_name || data.session.user.email.split('@')[0];
  document.getElementById('sidebarRole').textContent = profile.role;
  document.getElementById('sidebarName').textContent = displayName;
  document.getElementById('userInitial').textContent = displayName.charAt(0).toUpperCase();
  document.getElementById('welcomeName').textContent = `Welcome, ${displayName}`;
  if (profile.role === 'supervisor') {
    document.querySelector('.supervisor-only').hidden = false;
    document.querySelectorAll('.owner-column').forEach((column) => { column.hidden = false; });
    document.getElementById('emptyLeadsCell').colSpan = 7;
  }
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
