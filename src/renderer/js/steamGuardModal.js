(function () {
  const modal = document.getElementById('steam-guard-modal');
  const input = document.getElementById('steam-guard-code-input');
  const errEl = document.getElementById('steam-guard-error');
  const submitBtn = document.getElementById('steam-guard-submit');
  const cancelBtn = document.getElementById('steam-guard-cancel');

  if (!modal || !window.electronAPI) return;

  function open() {
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    input.value = '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 30);
  }

  function close() {
    modal.classList.remove('active');
  }

  async function submit() {
    const code = (input.value || '').trim().toUpperCase();
    if (!code) {
      errEl.textContent = 'Enter the code from your email.';
      errEl.style.display = 'block';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    try {
      const delivered = await window.electronAPI.steamcmdProvideSteamGuardCode(code);
      if (delivered) {
        close();
      } else {
        errEl.textContent = 'No pending Steam Guard request — try the action again.';
        errEl.style.display = 'block';
      }
    } catch (err) {
      errEl.textContent = err.message || 'Failed to submit code.';
      errEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Code';
    }
  }

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', async () => {
    try { await window.electronAPI.steamcmdCancelSteamGuard(); } catch (_) {}
    close();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });

  window.electronAPI.onSteamcmdSteamGuardRequired(() => {
    open();
  });
})();
