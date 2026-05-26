(function () {
  const api = window.electronAPI;
  if (!api) return;

  const modal = document.getElementById('server-crash-modal');
  if (!modal) return;

  const summaryEl = document.getElementById('server-crash-summary');
  const argvEl = document.getElementById('server-crash-argv');
  const stderrEl = document.getElementById('server-crash-stderr');
  const stdoutEl = document.getElementById('server-crash-stdout');
  const closeBtn = document.getElementById('close-server-crash');
  const okBtn = document.getElementById('server-crash-ok');
  const copyBtn = document.getElementById('server-crash-copy');

  let lastInfo = null;

  function open(info) {
    lastInfo = info || {};
    const lifetime = ((info?.lifetimeMs || 0) / 1000).toFixed(1);
    summaryEl.textContent =
      `Process exited with code ${info?.code ?? '?'}${info?.signal ? ' (' + info.signal + ')' : ''} ` +
      `after ${lifetime}s. This usually means a bad command-line flag, missing mod folder, or invalid serverDZ.cfg.`;
    argvEl.textContent = (info?.argv || []).join(' ') || '(none)';
    stderrEl.textContent = info?.stderrTail || '(no stderr output)';
    stdoutEl.textContent = info?.stdoutTail || '(no stdout output)';
    modal.classList.add('active');
  }

  function close() { modal.classList.remove('active'); }

  closeBtn.addEventListener('click', close);
  okBtn.addEventListener('click', close);
  copyBtn.addEventListener('click', () => {
    const text =
      `Exit: code=${lastInfo?.code} signal=${lastInfo?.signal} lifetime=${lastInfo?.lifetimeMs}ms\n\n` +
      `Argv:\n${(lastInfo?.argv || []).join(' ')}\n\n` +
      `Stderr:\n${lastInfo?.stderrTail || ''}\n\n` +
      `Stdout:\n${lastInfo?.stdoutTail || ''}\n`;
    try {
      navigator.clipboard.writeText(text);
      if (window.app) window.app.showSuccess('Diagnostics copied to clipboard');
    } catch (_) {}
  });

  api.onServerCrashed((info) => open(info));
})();
