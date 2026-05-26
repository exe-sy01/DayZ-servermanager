(function () {
  const MAX_LINES = 2000;

  const drawer = document.getElementById('steamcmd-drawer');
  const header = document.getElementById('steamcmd-drawer-header');
  const toggle = document.getElementById('steamcmd-drawer-toggle');
  const clearBtn = document.getElementById('steamcmd-drawer-clear');
  const killBtn = document.getElementById('steamcmd-drawer-kill');
  const output = document.getElementById('steamcmd-drawer-output');
  const labelEl = document.getElementById('steamcmd-drawer-label');
  const iconEl = drawer && drawer.querySelector('.steamcmd-drawer-icon');
  const inputRow = document.getElementById('steamcmd-drawer-input-row');
  const inputEl = document.getElementById('steamcmd-drawer-input');
  const promptEl = document.getElementById('steamcmd-drawer-prompt');

  if (!drawer || !output || !window.electronAPI) return;

  let activityTimer = null;
  let userCollapsed = false;
  let running = false;

  function setExpanded(expanded) {
    drawer.classList.toggle('collapsed', !expanded);
    if (iconEl) iconEl.textContent = expanded ? '▼' : '▶';
  }

  function setActive(active, label) {
    drawer.classList.toggle('active', !!active);
    if (labelEl) labelEl.textContent = label ? `— ${label}` : '';
  }

  function setRunning(isRunning) {
    running = isRunning;
    if (inputRow) inputRow.style.display = isRunning ? 'flex' : 'none';
    if (killBtn) killBtn.style.display = isRunning ? '' : 'none';
    if (!isRunning && promptEl) {
      promptEl.style.display = 'none';
      promptEl.innerHTML = '';
    }
  }

  function append(chunk) {
    const span = document.createElement('span');
    span.className = `line-${chunk.stream}`;
    span.textContent = chunk.text;
    output.appendChild(span);

    while (output.childNodes.length > MAX_LINES) {
      output.removeChild(output.firstChild);
    }
    output.scrollTop = output.scrollHeight;
  }

  function showSteamGuardPrompt() {
    if (!promptEl) return;
    promptEl.innerHTML = `
      <span class="prompt-icon">!</span>
      <span class="prompt-text">Steam Guard required — check your email, then type
        <code>set_steam_guard_code YOURCODE</code> below.</span>`;
    promptEl.style.display = 'flex';
    setExpanded(true);
    userCollapsed = false;
    if (inputEl) {
      inputEl.placeholder = 'set_steam_guard_code XXXXX';
      inputEl.focus();
    }
  }

  header.addEventListener('click', (e) => {
    if (e.target.closest('.steamcmd-drawer-btn')) return;
    const expanded = drawer.classList.contains('collapsed');
    setExpanded(expanded);
    userCollapsed = !expanded;
  });

  toggle.addEventListener('click', () => {
    const expanded = drawer.classList.contains('collapsed');
    setExpanded(expanded);
    userCollapsed = !expanded;
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    output.innerHTML = '';
  });

  if (killBtn) {
    killBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Force-kill the running SteamCMD process?')) return;
      try { await window.electronAPI.steamcmdKill(); } catch (_) {}
    });
  }

  if (inputRow) {
    inputRow.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = (inputEl.value || '').trim();
      if (!text) return;
      inputEl.value = '';
      try {
        const res = await window.electronAPI.steamcmdSendInput(text);
        if (res && !res.success) {
          append({ stream: 'stderr', text: `[input failed: ${res.error}]\n` });
        }
      } catch (err) {
        append({ stream: 'stderr', text: `[input failed: ${err.message}]\n` });
      }
    });
  }

  window.electronAPI.onSteamcmdConsole((chunk) => {
    append(chunk);
    setActive(true, chunk.label);

    if (!userCollapsed && drawer.classList.contains('collapsed')) {
      setExpanded(true);
    }

    if (activityTimer) clearTimeout(activityTimer);
    activityTimer = setTimeout(() => setActive(false, ''), 3000);
  });

  window.electronAPI.onSteamcmdRunning((state) => {
    setRunning(!!state.running);
    if (state.running && !userCollapsed) setExpanded(true);
  });

  window.electronAPI.onSteamcmdPrompt((info) => {
    if (info && info.type === 'steam-guard') showSteamGuardPrompt();
  });

  // Sync initial running state in case the drawer mounts after SteamCMD started
  window.electronAPI.steamcmdIsRunning().then((r) => setRunning(!!r)).catch(() => {});
})();
