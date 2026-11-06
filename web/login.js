(() => {
  'use strict';
  const password = document.getElementById('password');
  const confirmation = document.getElementById('confirmation');
  const fields = [...document.querySelectorAll('input[data-password]')];
  const toggle = document.getElementById('password-visibility');
  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
    const visible = password.type === 'password';
    fields.forEach(field => { field.type = visible ? 'text' : 'password'; });
    toggle.textContent = visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe';
    toggle.setAttribute('aria-pressed', String(visible));
    });
  }
  function validate() {
    const counter = document.getElementById('password-count');
    const length = Array.from(password.value).length;
    if (counter) {
      counter.textContent = length + ' caractères · 6 minimum, espaces compris.';
      password.setCustomValidity(length < 6 ? 'Utilise au moins 6 caractères, espaces compris.' : '');
    }
    if (confirmation) confirmation.setCustomValidity(confirmation.value !== password.value ? 'Les deux mots de passe doivent être identiques.' : '');
  }
  fields.forEach(field => field.addEventListener('input', validate));
})();
