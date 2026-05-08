(function () {
  const trigger = document.getElementById('earnTrigger');
  const panel   = document.getElementById('earnPanel');
  const close   = document.getElementById('earnClose');
  const aiPanel = document.getElementById('aiPanel');
  const aiTrigger = document.getElementById('aiTrigger');

  if (!trigger || !panel) return;

  function openEarn() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    // close AI panel if open
    if (aiPanel && !aiPanel.hidden) {
      aiPanel.hidden = true;
      aiTrigger && aiTrigger.setAttribute('aria-expanded', 'false');
    }
  }

  function closeEarn() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', function () {
    panel.hidden ? openEarn() : closeEarn();
  });

  close && close.addEventListener('click', closeEarn);

  document.addEventListener('click', function (e) {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== trigger) {
      closeEarn();
    }
  });
})();
