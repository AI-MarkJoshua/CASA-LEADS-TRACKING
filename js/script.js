const form = document.getElementById('loginForm');
const password = document.getElementById('password');
const toggle = document.getElementById('togglePassword');
const notice = document.getElementById('notice');

toggle.addEventListener('click', () => {
  const isHidden = password.type === 'password';
  password.type = isHidden ? 'text' : 'password';
  toggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.checkValidity()) {
    notice.textContent = 'Please enter a valid email and password.';
    form.reportValidity();
    return;
  }
  notice.style.color = '#287a52';
  notice.textContent = 'Login form is ready to connect to your system.';
});
