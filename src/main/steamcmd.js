const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const EventEmitter = require('events');
const PathUtils = require('../utils/paths');
const config = require('./config');

/**
 * SteamCMD wrapper and management
 *
 * Emits:
 *   'console' { stream: 'stdout'|'stderr'|'system', text, label }
 */
class SteamCMD extends EventEmitter {
  constructor() {
    super();
    this.steamcmdPath = PathUtils.getSteamCMDPath();
    this.steamcmdExec = PathUtils.getSteamCMDExecutable();
    this.isDownloading = false;
    this.currentChild = null;
    this.currentLabel = null;
    this.idleTimeoutMs = 15 * 60 * 1000; // 15 min of total silence -> kill
    this.idleTimer = null;
    this._steamGuardResolver = null;
  }

  /**
   * Wraps executeCommand and, if Steam Guard is required, asks the UI for the
   * code via a 'steam-guard-required' event, then re-spawns SteamCMD with
   * +set_steam_guard_code prepended.
   */
  async executeCommandWithGuard(args, options = {}) {
    try {
      return await this.executeCommand(args, options);
    } catch (err) {
      if (!err || !err.steamGuardRequired) throw err;
      const code = await this._requestSteamGuardCode();
      if (!code) throw new Error('Steam Guard code is required but was not provided');
      const newArgs = ['+set_steam_guard_code', code, ...args];
      const newOptions = { ...options, label: (options.label || 'steamcmd') + ' (with Steam Guard)' };
      return await this.executeCommand(newArgs, newOptions);
    }
  }

  _requestSteamGuardCode() {
    return new Promise((resolve, reject) => {
      this._steamGuardResolver = resolve;
      this.emit('steam-guard-required');
      // 5-minute window for user to fetch and submit the code
      setTimeout(() => {
        if (this._steamGuardResolver === resolve) {
          this._steamGuardResolver = null;
          resolve(null);
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Called by the renderer (via IPC) to deliver a Steam Guard code that was
   * requested by a pending executeCommandWithGuard() call.
   */
  provideSteamGuardCode(code) {
    if (this._steamGuardResolver) {
      this._steamGuardResolver(code || null);
      this._steamGuardResolver = null;
      return true;
    }
    return false;
  }

  cancelSteamGuardPrompt() {
    if (this._steamGuardResolver) {
      this._steamGuardResolver(null);
      this._steamGuardResolver = null;
      return true;
    }
    return false;
  }

  /**
   * Write text to the running SteamCMD's stdin. Used to send interactive
   * commands like 'set_steam_guard_code XXXXX' or 'quit'.
   */
  writeInput(text) {
    if (!this.currentChild || !this.currentChild.stdin || this.currentChild.stdin.destroyed) {
      throw new Error('No SteamCMD process is currently running');
    }
    const line = text.endsWith('\n') ? text : text + '\n';
    this.currentChild.stdin.write(line);
    // Echo to console so user sees what was sent
    this.emit('console', {
      stream: 'input',
      label: this.currentLabel || 'steamcmd',
      text: `< ${text}\n`
    });
    this._bumpIdle();
  }

  /**
   * Forcefully terminate the running SteamCMD process.
   */
  killCurrent() {
    if (this.currentChild) {
      try { this.currentChild.kill(); } catch (_) {}
    }
  }

  isRunning() {
    return !!this.currentChild;
  }

  _bumpIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.currentChild) return;
    this.idleTimer = setTimeout(() => {
      if (this.currentChild) {
        this.emit('console', {
          stream: 'system',
          label: this.currentLabel,
          text: `\n[no output for ${Math.round(this.idleTimeoutMs / 60000)} min — terminating]\n`
        });
        try { this.currentChild.kill(); } catch (_) {}
      }
    }, this.idleTimeoutMs);
  }

  _redactArgs(args) {
    const out = [...args];
    const i = out.indexOf('+login');
    if (i !== -1 && out[i + 2] && out[i + 1] !== 'anonymous') {
      out[i + 2] = '********';
    }
    return out;
  }

  _requireSteamCredentials(action = 'this operation') {
    const creds = config.getSteamCredentials();
    if (!creds || !creds.username || !creds.password) {
      throw new Error(
        `Steam credentials are required to ${action}. ` +
        `DayZ workshop downloads do not work with anonymous login. ` +
        `Add your Steam username and password in Settings.`
      );
    }
  }

  /**
   * Download SteamCMD from official source
   */
  async downloadSteamCMD(progressCallback) {
    if (this.isDownloading) {
      throw new Error('SteamCMD download already in progress');
    }

    this.isDownloading = true;
    const platform = process.platform;
    let url, filename, extractPath;

    try {
      if (platform === 'win32') {
        url = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
        filename = 'steamcmd.zip';
        extractPath = this.steamcmdPath;
      } else if (platform === 'linux') {
        url = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';
        filename = 'steamcmd_linux.tar.gz';
        extractPath = this.steamcmdPath;
      } else if (platform === 'darwin') {
        url = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz';
        filename = 'steamcmd_osx.tar.gz';
        extractPath = this.steamcmdPath;
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }

      await fs.ensureDir(this.steamcmdPath);
      const filePath = path.join(this.steamcmdPath, filename);

      // Download file
      await this.downloadFile(url, filePath, progressCallback);

      // Extract archive
      if (filename.endsWith('.zip')) {
        // For Windows, use adm-zip
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(filePath);
        zip.extractAllTo(extractPath, true);
        await fs.remove(filePath);
      } else {
        // For tar.gz, use tar
        const tar = require('tar');
        await tar.extract({
          file: filePath,
          cwd: extractPath
        });
        await fs.remove(filePath);
      }

      // Make executable on Unix systems
      if (platform !== 'win32') {
        const shPath = path.join(this.steamcmdPath, 'steamcmd.sh');
        if (await fs.pathExists(shPath)) {
          await fs.chmod(shPath, 0o755);
        }
      }

      this.isDownloading = false;
      return true;
    } catch (error) {
      this.isDownloading = false;
      throw error;
    }
  }

  /**
   * Download file with progress
   */
  downloadFile(url, filePath, progressCallback) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      
      https.get(url, (response) => {
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (progressCallback && totalSize) {
            const progress = (downloadedSize / totalSize) * 100;
            progressCallback({ progress, downloaded: downloadedSize, total: totalSize });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (error) => {
        fs.remove(filePath);
        reject(error);
      });
    });
  }

  /**
   * Check if SteamCMD is installed
   */
  async isInstalled() {
    return await fs.pathExists(this.steamcmdExec);
  }

  /**
   * Execute SteamCMD command
   */
  async executeCommand(args, options = {}) {
    const {
      onProgress = null,
      onOutput = null,
      onError = null,
      timeout = 300000 // 5 minutes default
    } = options;

    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.steamcmdExec)) {
        reject(new Error('SteamCMD not installed. Please download it first.'));
        return;
      }

      // Don't auto-prompt for passwords we can't supply. We deliberately do
      // NOT pass +@ShutdownOnFailedCommand — when login needs a Steam Guard
      // code SteamCMD drops to its `>` prompt and we want it to STAY there
      // so the user can type the code into the in-app console.
      const safetyFlags = ['+@NoPromptForPassword', '1'];
      const argsWithSafety = [...safetyFlags, ...args];

      const command = process.platform === 'win32' ? this.steamcmdExec : 'sh';
      const commandArgs = process.platform === 'win32' ? argsWithSafety : [this.steamcmdExec, ...argsWithSafety];

      const label = options.label || 'steamcmd';
      this.emit('console', { stream: 'system', label, text: `> ${command} ${this._redactArgs(commandArgs).join(' ')}\n` });

      const child = spawn(command, commandArgs, {
        cwd: this.steamcmdPath,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.currentChild = child;
      this.currentLabel = label;
      this.emit('running', { running: true, label });
      this._bumpIdle();

      let stdout = '';
      let stderr = '';
      let progressData = '';
      let steamGuardDetected = false;

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        progressData += output;
        this._bumpIdle();

        this.emit('console', { stream: 'stdout', label, text: output });

        // Detect Steam Guard prompt so UI can pop a helper / so we can mark
        // the eventual rejection as recoverable via Steam Guard code retry.
        if (/set_steam_guard_code|Account Logon Denied|Steam Guard/i.test(output)) {
          if (!steamGuardDetected) {
            steamGuardDetected = true;
            this.emit('prompt', { type: 'steam-guard', label });
          }
        }

        if (onOutput) {
          onOutput(output);
        }

        // Parse progress from SteamCMD output
        if (onProgress) {
          const progressMatch = output.match(/Update state \(0x\d+\) (\d+)% /);
          if (progressMatch) {
            onProgress({ progress: parseInt(progressMatch[1]), message: output.trim() });
          }
        }
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        this._bumpIdle();
        this.emit('console', { stream: 'stderr', label, text: output });
        if (onError) {
          onError(output);
        }
      });

      let timeoutId = null;
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill();
          reject(new Error(`SteamCMD command timed out after ${timeout}ms`));
        }, timeout);
      }

      child.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
        this.currentChild = null;
        this.currentLabel = null;
        this.emit('running', { running: false });
        this.emit('console', { stream: 'system', label, text: `\n[process exited with code ${code}]\n` });
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          // Extract error message from output
          const errorLines = stderr.split('\n').filter(line => line.trim());
          const stdoutLines = stdout.split('\n').filter(line => line.trim());
          
          // Look for common error patterns
          let errorMessage = `SteamCMD exited with code ${code}`;
          
          // Check for specific error messages
          const allOutput = (stdout + stderr).toLowerCase();
          if (allOutput.includes('login failure') || allOutput.includes('invalid password')) {
            errorMessage = 'SteamCMD login failed. This might be a temporary Steam issue.';
          } else if (allOutput.includes('network') || allOutput.includes('connection')) {
            errorMessage = 'Network error. Check your internet connection.';
          } else if (allOutput.includes('disk') || allOutput.includes('space')) {
            errorMessage = 'Disk space error. Ensure you have enough free space.';
          } else if (allOutput.includes('access denied') || allOutput.includes('permission')) {
            errorMessage = 'Permission denied. Try running as administrator or check folder permissions.';
          } else if (stderr.trim()) {
            errorMessage = `SteamCMD error: ${stderr.trim().split('\n').pop()}`;
          } else if (stdoutLines.length > 0) {
            // Get last few lines of output for context
            const lastLines = stdoutLines.slice(-3).join('; ');
            errorMessage = `SteamCMD error (code ${code}). Last output: ${lastLines}`;
          }

          if (steamGuardDetected) {
            errorMessage = 'Steam Guard code required';
          }

          const err = new Error(errorMessage);
          if (steamGuardDetected) err.steamGuardRequired = true;
          reject(err);
        }
      });

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
        this.currentChild = null;
        this.currentLabel = null;
        this.emit('running', { running: false });
        reject(error);
      });
    });
  }

  /**
   * Get login arguments - DayZ requires Steam credentials (anonymous login does not work)
   */
  getLoginArgs() {
    const credentials = config.getSteamCredentials();
    
    if (credentials.username && credentials.password) {
      return ['+login', credentials.username, credentials.password];
    }
    return ['+login', 'anonymous'];
  }

  /**
   * Update DayZ server files
   */
  async updateServerFiles(installDir, branch = 'public', onProgress = null) {
    // Ensure install directory exists and is writable
    try {
      await fs.ensureDir(installDir);
      // Test write permissions
      const testFile = path.join(installDir, '.write_test');
      await fs.writeFile(testFile, 'test');
      await fs.remove(testFile);
    } catch (error) {
      throw new Error(`Cannot write to installation directory: ${error.message}`);
    }

    // Normalize path for Windows (remove quotes, use forward slashes for SteamCMD)
    const normalizedPath = installDir.replace(/\\/g, '/').replace(/"/g, '');
    
    const loginArgs = this.getLoginArgs();
    
    // SteamCMD requires force_install_dir before logon
    const args = [
      '+force_install_dir', normalizedPath,
      ...loginArgs,
      '+app_update', '223350', branch === 'experimental' ? '-beta experimental' : '',
      'validate',
      '+quit'
    ].filter(arg => arg !== '');

    console.log('SteamCMD command:', args.join(' '));

    return await this.executeCommandWithGuard(args, {
      onProgress,
      label: `server update (${branch})`,
      onOutput: (output) => {
        console.log('SteamCMD output:', output);
      },
      onError: (error) => {
        console.error('SteamCMD error:', error);
      },
      timeout: 600000 // 10 minutes for server updates
    });
  }

  /**
   * Download workshop item
   */
  async downloadWorkshopItem(workshopId, installDir, onProgress = null) {
    this._requireSteamCredentials('download workshop mods');

    // Normalize path for Windows
    const normalizedPath = installDir.replace(/\\/g, '/').replace(/"/g, '');

    const loginArgs = this.getLoginArgs();
    
    // SteamCMD requires force_install_dir before logon
    const args = [
      '+force_install_dir', normalizedPath,
      ...loginArgs,
      '+workshop_download_item', '221100', workshopId.toString(),
      'validate',
      '+quit'
    ];

    return await this.executeCommandWithGuard(args, {
      onProgress,
      label: `workshop ${workshopId}`,
      timeout: 600000 // 10 minutes for mod downloads
    });
  }

  /**
   * Download many workshop items in a SINGLE SteamCMD process.
   * Massively faster than calling downloadWorkshopItem() in a loop because the
   * Steam login + process startup cost is paid once instead of per-mod.
   */
  async downloadWorkshopItems(workshopIds, installDir, onProgress = null) {
    const ids = (workshopIds || []).map(String).filter(Boolean);
    if (ids.length === 0) return { stdout: '', stderr: '', code: 0 };

    this._requireSteamCredentials('download workshop mods');

    const normalizedPath = installDir.replace(/\\/g, '/').replace(/"/g, '');
    const loginArgs = this.getLoginArgs();

    const args = [
      '+force_install_dir', normalizedPath,
      ...loginArgs
    ];
    for (const id of ids) {
      args.push('+workshop_download_item', '221100', id, 'validate');
    }
    args.push('+quit');

    // Per-mod progress tracking via SteamCMD's per-item lines
    let currentIdx = 0;
    const wrappedProgress = (chunk) => {
      if (!onProgress) return;
      const text = chunk.message || '';
      // SteamCMD prints "Downloaded item <id>" / "Success. Downloaded item <id>"
      const finished = text.match(/Success\. Downloaded item (\d+)/i) || text.match(/ERROR! Download item (\d+)/i);
      if (finished) {
        currentIdx++;
        const finishedId = finished[1];
        onProgress({
          current: currentIdx,
          total: ids.length,
          mod: finishedId,
          message: text.trim(),
          progress: Math.round((currentIdx / ids.length) * 100)
        });
        return;
      }
      // Forward in-item percentage if present
      if (chunk.progress != null) {
        onProgress({
          current: currentIdx + 1,
          total: ids.length,
          progress: chunk.progress,
          message: text
        });
      }
    };

    return await this.executeCommandWithGuard(args, {
      onProgress: wrappedProgress,
      label: `workshop batch (${ids.length} mods)`,
      timeout: Math.max(600000, ids.length * 180000) // 10 min minimum, +3 min per mod
    });
  }
}

module.exports = new SteamCMD();

