(function () {
  const api = window.electronAPI;
  if (!api) return;

  const els = {
    serverName: document.getElementById('lc-server-name'),
    port: document.getElementById('lc-port'),
    cpu: document.getElementById('lc-cpu-count'),
    configFile: document.getElementById('lc-config-file'),
    configRefresh: document.getElementById('lc-config-refresh'),
    profile: document.getElementById('server-profile-select'),
    bePath: document.getElementById('lc-be-path'),
    restartHours: document.getElementById('lc-restart-hours'),
    flags: {
      doLogs: document.getElementById('lc-flag-doLogs'),
      adminLog: document.getElementById('lc-flag-adminLog'),
      netLog: document.getElementById('lc-flag-netLog'),
      freezeCheck: document.getElementById('lc-flag-freezeCheck'),
      filePatching: document.getElementById('lc-flag-filePatching')
    },
    extra: document.getElementById('server-parameters'),
    preview: document.getElementById('lc-preview'),
    saveBtn: document.getElementById('launch-config-save')
  };

  if (!els.preview) return; // panel not in this build

  function gather() {
    return {
      serverName: (els.serverName.value || '').trim() || 'DayZ Server',
      port: parseInt(els.port.value, 10) || 2302,
      cpuCount: parseInt(els.cpu.value, 10) || 0,
      configFile: (els.configFile.value || 'serverDZ.cfg').trim(),
      profileName: (els.profile.value || 'default').trim(),
      bePath: (els.bePath.value || '').trim(),
      flags: {
        doLogs: els.flags.doLogs.checked,
        adminLog: els.flags.adminLog.checked,
        netLog: els.flags.netLog.checked,
        freezeCheck: els.flags.freezeCheck.checked,
        filePatching: els.flags.filePatching.checked
      },
      extraParams: (els.extra.value || '').trim(),
      autoRestartIntervalSec: Math.max(0, parseFloat(els.restartHours.value || '0')) * 3600
    };
  }

  function apply(lc) {
    if (!lc) return;
    els.serverName.value = lc.serverName || 'DayZ Server';
    els.port.value = lc.port || 2302;
    els.cpu.value = lc.cpuCount || 0;
    els.bePath.value = lc.bePath || '';
    const hours = (lc.autoRestartIntervalSec || 0) / 3600;
    els.restartHours.value = hours === 0 ? 0 : (Math.round(hours * 10) / 10);
    const f = lc.flags || {};
    els.flags.doLogs.checked = !!f.doLogs;
    els.flags.adminLog.checked = !!f.adminLog;
    els.flags.netLog.checked = !!f.netLog;
    els.flags.freezeCheck.checked = !!f.freezeCheck;
    els.flags.filePatching.checked = !!f.filePatching;
    els.extra.value = lc.extraParams || '';
    // Ensure the saved config file shows up in the dropdown even if scan hasn't run
    ensureOption(els.configFile, lc.configFile || 'serverDZ.cfg');
    els.configFile.value = lc.configFile || 'serverDZ.cfg';
    ensureOption(els.profile, lc.profileName || 'default');
    els.profile.value = lc.profileName || 'default';
  }

  function ensureOption(select, value) {
    if (!select || !value) return;
    if (![...select.options].some(o => o.value === value)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    }
  }

  function escapeArg(a) {
    if (/\s|"/.test(a)) return `"${a.replace(/"/g, '\\"')}"`;
    return a;
  }

  async function refreshConfigFiles() {
    try {
      const serverPath = await api.configGetServerPath();
      if (!serverPath) return;
      const res = await api.configListServerConfigs(serverPath);
      if (!res || !res.success) return;
      const current = els.configFile.value || 'serverDZ.cfg';
      const files = (res.files || []).map(f => f.relativePath || f.name || f);
      // Always include the default
      const set = new Set(['serverDZ.cfg', ...files, current].filter(Boolean));
      els.configFile.innerHTML = '';
      for (const name of set) {
        const o = document.createElement('option');
        o.value = name;
        o.textContent = name;
        els.configFile.appendChild(o);
      }
      els.configFile.value = current;
    } catch (err) {
      console.warn('listServerConfigs failed:', err);
    }
  }

  async function buildModString() {
    try {
      const res = await api.configGetModsOrdered();
      if (!res || !res.success) return '';
      const installPath = await api.configGetServerPath();
      let installedNames = new Set();
      try {
        const installed = await api.workshopListInstalled(installPath);
        if (Array.isArray(installed)) {
          installed.forEach(m => m.modName && installedNames.add(m.modName));
        }
      } catch (_) {}
      const names = (res.mods || [])
        .map(m => m.modName ? m.modName.replace(/^@+/, '') : null)
        .filter(Boolean);
      if (names.length === 0) return '';
      return `-mod=${names.map(n => '@' + n).join(';')}`;
    } catch (_) {
      return '';
    }
  }

  async function updatePreview() {
    const lc = gather();
    const args = [];
    args.push(`-config=${lc.configFile}`);
    args.push(`-port=${lc.port}`);
    args.push(`-profiles=${lc.profileName}`);
    if (lc.bePath) args.push(`-BEpath=${lc.bePath}`);
    if (lc.cpuCount > 0) args.push(`-cpuCount=${lc.cpuCount}`);
    if (lc.flags.doLogs) args.push('-dologs');
    if (lc.flags.adminLog) args.push('-adminlog');
    if (lc.flags.netLog) args.push('-netlog');
    if (lc.flags.freezeCheck) args.push('-freezecheck');
    if (lc.flags.filePatching) args.push('-filePatching');
    if (lc.extraParams) {
      const tokens = lc.extraParams.match(/"[^"]+"|\S+/g) || [];
      tokens.forEach(t => args.push(t.replace(/^"|"$/g, '')));
    }
    const mods = await buildModString();
    if (mods) args.push(mods);

    els.preview.textContent =
      `# ${lc.serverName}\n` +
      `DayZServer_x64.exe ${args.map(escapeArg).join(' ')}` +
      (lc.autoRestartIntervalSec > 0
        ? `\n# auto-restart every ${(lc.autoRestartIntervalSec / 3600).toFixed(1)} h`
        : '');
  }

  let savePending = false;
  async function save({ silent = false } = {}) {
    if (savePending) return;
    savePending = true;
    try {
      const lc = gather();
      const res = await api.configSetLaunchConfig(lc);
      if (res && res.success) {
        if (res.hostnameWarning && window.app) {
          window.app.showError(`Hostname not updated: ${res.hostnameWarning}`);
        } else if (!silent && window.app) {
          window.app.showSuccess(res.hostnameApplied
            ? 'Saved — hostname updated in .cfg'
            : 'Launch configuration saved');
        }
      } else if (window.app) {
        window.app.showError(res?.error || 'Failed to save');
      }
    } finally {
      savePending = false;
    }
  }

  async function syncHostnameFromCfg() {
    try {
      const target = els.configFile.value || 'serverDZ.cfg';
      const res = await api.configGetServerHostname(target);
      if (res && res.success && typeof res.hostname === 'string') {
        // .cfg is authoritative; reflect it in the form
        els.serverName.value = res.hostname;
        updatePreview();
      }
    } catch (_) {}
  }

  // Wire events
  const changeEls = [
    els.serverName, els.port, els.cpu, els.configFile, els.profile,
    els.bePath, els.restartHours, els.extra,
    ...Object.values(els.flags)
  ];
  changeEls.forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => { updatePreview(); save({ silent: true }); });
    el.addEventListener('input', updatePreview);
  });
  els.saveBtn?.addEventListener('click', () => save());
  els.configRefresh?.addEventListener('click', async () => { await refreshConfigFiles(); await syncHostnameFromCfg(); updatePreview(); });
  els.configFile?.addEventListener('change', () => { syncHostnameFromCfg(); });

  // Initial load
  (async function init() {
    try {
      const lc = await api.configGetLaunchConfig();
      apply(lc);
      await refreshConfigFiles();
      await syncHostnameFromCfg(); // .cfg is the source of truth for server name
      await updatePreview();
    } catch (err) {
      console.warn('launchConfig init failed:', err);
    }
  })();

  // Expose for other modules
  window.launchConfig = { reload: async () => apply(await api.configGetLaunchConfig()), updatePreview };
})();
