(() => {
  'use strict';
  const password = document.getElementById('password');
  const toggle = document.getElementById('password-visibility');
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    toggle.textContent = visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe';
    toggle.setAttribute('aria-pressed', String(visible));
  });
})();
