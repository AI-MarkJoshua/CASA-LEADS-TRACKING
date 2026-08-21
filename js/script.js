const supabaseClient = supabase.createClient(
  window.CASA_CONFIG.supabaseUrl,
  window.CASA_CONFIG.supabasePublishableKey
);

const form = document.getElementById('loginForm');
const password = document.getElementById('password');
const toggle = document.getElementById('togglePassword');
const notice = document.getElementById('notice');
const loginButton = form.querySelector('.login-button');

if (window.CASA_CONFIG.supabaseUrl.includes('YOUR_PROJECT_ID')) {
  notice.textContent = 'Add your Supabase URL and publishable key in js/config.js.';
  loginButton.disabled = true;
} else {
  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) window.location.replace('dashboard.html');
  });
}

toggle.addEventListener('click', () => {
  const isHidden = password.type === 'password';
  password.type = isHidden ? 'text' : 'password';
  toggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  notice.style.color = '#b42318';

  if (!form.checkValidity()) {
    notice.textContent = 'Please enter a valid email and password.';
    form.reportValidity();
    return;
  }

  const email = document.getElementById('email').value.trim();
  const passwordValue = password.value;
  loginButton.disabled = true;
  loginButton.textContent = 'Signing in...';
  notice.textContent = '';

  const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password: passwordValue
  });

  if (error) {
    notice.textContent = 'Unable to sign in. Check your credentials.';
    loginButton.disabled = false;
    loginButton.textContent = 'Sign in to dashboard';
    return;
  }

  notice.style.color = '#287a52';
  notice.textContent = 'Login successful. Redirecting...';

  window.location.replace('dashboard.html');
});

document.querySelector('.forgot').addEventListener('click', async (event) => {
  event.preventDefault();
  const email = document.getElementById('email').value.trim();
  if (!email) {
    notice.style.color = '#b42318';
    notice.textContent = 'Enter your email address first.';
    return;
  }
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
  notice.style.color = error ? '#b42318' : '#287a52';
  notice.textContent = error ? 'Unable to send the reset email.' : 'Password reset instructions were sent.';
});
