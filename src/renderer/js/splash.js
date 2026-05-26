(function () {
  const splash = document.getElementById('splash-screen');
  const msg = document.getElementById('splash-message');
  if (!splash) return;

  const stages = [
    'Initializing systems',
    'Loading config',
    'Scanning workshop',
    'Ready'
  ];
  let i = 0;
  const tick = setInterval(() => {
    i++;
    if (i >= stages.length) {
      clearInterval(tick);
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 700);
      return;
    }
    if (msg) msg.textContent = stages[i];
  }, 450);
})();
