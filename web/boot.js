(function () {
  'use strict';
  var timer;
  window.JobBotReady = false;
  window.showJobBotError = function (message) {
    var box = document.getElementById('startup-error');
    var text = document.getElementById('startup-error-text');
    if (box && text) {
      text.textContent = message || 'Ferme les anciennes fenêtres de MoneyScout et relance ton lien MoneyScout depuis le dossier VERSION 8.0.0.';
      box.hidden = false;
    }
  };
  window.addEventListener('error', function () {
    if (!window.JobBotReady) window.showJobBotError('Une partie de l’interface n’a pas pu démarrer. Les offres fournies restent visibles et l’onglet Yahoo reste accessible. Clique sur Réessayer le chargement.');
  }, true);
  document.addEventListener('click', function (event) {
    if (window.JobBotReady) return;
    var node = event.target;
    while (node && node !== document) {
      var view = node.getAttribute && (node.getAttribute('data-view') || node.getAttribute('data-go'));
      if (view) {
        var panels = document.querySelectorAll('.view');
        for (var i = 0; i < panels.length; i++) panels[i].hidden = panels[i].id !== 'view-' + view;
        window.location.hash = view;
        return;
      }
      node = node.parentNode;
    }
  });
  document.addEventListener('submit', function (event) {
    if (!window.JobBotReady) {
      event.preventDefault();
      window.showJobBotError('Le chargement n’est pas terminé. Réessaie le chargement avant d’enregistrer tes réglages.');
    }
  }, true);
  timer = window.setTimeout(function () {
    if (!window.JobBotReady) window.showJobBotError('MoneyScout met trop de temps à démarrer. Reconnecte-toi depuis le fichier ton lien MoneyScout de la version 8.0.0.');
  }, 12000);
  window.addEventListener('jobbot-ready', function () { window.clearTimeout(timer); });
})();
