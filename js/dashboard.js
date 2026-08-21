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
  if (profile.role === 'supervisor') {
    document.getElementById('userManagement').hidden = false;
  }
  document.getElementById('loadingMessage').hidden = true;
  document.querySelector('.dashboard').hidden = false;
}

document.getElementById('logoutButton').addEventListener('click', async () => {
  await dashboardClient.auth.signOut();
  window.location.replace('index.html');
});

dashboardClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') window.location.replace('index.html');
});

requireSession();

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
