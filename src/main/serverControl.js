const { spawn, exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const config = require('./config');

/**
 * Server process control and monitoring
 *
 * Emits:
 *   'crashed' { code, signal, lifetimeMs, stderrTail, stdoutTail, argv }
 */
class ServerControl extends EventEmitter {
  constructor() {
    super();
    this.serverProcess = null;
    this.serverPath = null;
    this.isRunning = false;
    this.monitoringInterval = null;
    this.scheduledRestarts = [];
    this.autoRestartTimer = null;
    this.lastStartArgs = null; // remember for auto-restart
  }

  /**
   * Build the argv that goes to DayZServer_x64.exe from the persisted
   * launchConfig plus any renderer-supplied parameters (typically the mod string).
   *
   * Dedup rule: anything we set ourselves (config/port/profiles/BEpath/cpuCount
   * + the five known flags) wins over duplicates coming from either
   * lc.extraParams or the renderer's extraParameters array.
   */
  buildLaunchParams(profileName, extraParameters = []) {
    const lc = config.getLaunchConfig();
    const args = [];

    args.push(`-config=${lc.configFile || 'serverDZ.cfg'}`);
    args.push(`-port=${lc.port || 2302}`);
    args.push(`-profiles=${profileName || lc.profileName || 'default'}`);
    if (lc.bePath) args.push(`-BEpath=${lc.bePath}`);
    if (lc.cpuCount && lc.cpuCount > 0) args.push(`-cpuCount=${lc.cpuCount}`);

    const flags = lc.flags || {};
    if (flags.doLogs) args.push('-dologs');
    if (flags.adminLog) args.push('-adminlog');
    if (flags.netLog) args.push('-netlog');
    if (flags.freezeCheck) args.push('-freezecheck');
    if (flags.filePatching) args.push('-filePatching');

    const keysOwned = ['-config=', '-port=', '-profiles=', '-BEpath=', '-cpuCount='];
    const flagsOwned = new Set(['-dologs', '-adminlog', '-netlog', '-freezecheck', '-filePatching']);
    const isDuplicate = (p) => {
      if (!p) return true;
      if (keysOwned.some(k => p.startsWith(k))) return true;
      if (flagsOwned.has(p)) return true;
      return false;
    };

    // Free-form extra params from the persisted config — same dedup applies.
    if (lc.extraParams && lc.extraParams.trim()) {
      const tokens = lc.extraParams.match(/"[^"]+"|\S+/g) || [];
      for (const t of tokens) {
        const cleaned = t.replace(/^"|"$/g, '');
        if (!cleaned.trim() || isDuplicate(cleaned)) continue;
        args.push(cleaned);
      }
    }

    // Renderer-supplied params (mod string and any one-shot additions).
    for (const raw of (extraParameters || [])) {
      if (!raw || !String(raw).trim()) continue;
      const p = String(raw);
      if (isDuplicate(p)) continue;
      args.push(p);
    }

    return args;
  }

  /**
   * Start the DayZ server
   */
  async startServer(serverPath, profileName = 'default', parameters = []) {
    if (this.isRunning) {
      throw new Error('Server is already running');
    }

    // Additional check to prevent race conditions
    if (this.serverProcess && this.serverProcess.pid) {
      throw new Error('Server process already exists');
    }

    try {
      // Validate server path exists
      if (!await fs.pathExists(serverPath)) {
        throw new Error(`Server path does not exist: ${serverPath}`);
      }

      // Ensure profiles directory and default profile exist
      const profilesPath = path.join(serverPath, 'profiles');
      const profilePath = path.join(profilesPath, profileName);
      
      await fs.ensureDir(profilePath);
      console.log(`Ensured profile directory exists: ${profilePath}`);

      // Find server executable
      const serverExe = this.getServerExecutable(serverPath);
      console.log('Looking for server executable at:', serverExe);
      
      if (!await fs.pathExists(serverExe)) {
        // List files in server directory for debugging
        const files = await fs.readdir(serverPath);
        const exeFiles = files.filter(f => f.endsWith('.exe') || f.includes('DayZ'));
        console.error('Server executable not found. Available files:', exeFiles);
        throw new Error(`Server executable not found at: ${serverExe}`);
      }

      // Build command from persisted launchConfig + renderer-supplied params (typically the mod string)
      const allParams = this.buildLaunchParams(profileName, parameters);
      this.lastStartArgs = { serverPath, profileName, parameters };
      this.lastArgv = [serverExe, ...allParams];
      this.lastStdoutTail = '';
      this.lastStderrTail = '';
      const startedAt = Date.now();
      this.lastStartedAt = startedAt;

      console.log('[server] Spawning:', serverExe);
      console.log('[server] Args:', JSON.stringify(allParams, null, 2));

      // Belt-and-braces: kill any orphaned DayZServer_x64.exe that might be
      // squatting on the port from a prior detached-spawn that lost its handle.
      if (process.platform === 'win32') {
        await new Promise((resolve) => {
          exec('tasklist /FI "IMAGENAME eq DayZServer_x64.exe" /FO CSV /NH', (err, stdout) => {
            if (err || !stdout || !stdout.includes('DayZServer_x64.exe')) return resolve();
            console.log('[server] Found orphaned DayZServer_x64.exe — killing it before start');
            exec('taskkill /IM DayZServer_x64.exe /F /T', () => setTimeout(resolve, 1500));
          });
        });
      }

      // Spawn as a real child (NOT detached). The previous detached + windowsHide
      // + piped-stdio combo on Windows could desync pipes and orphan the process
      // on Electron exit, leaving DayZServer_x64.exe holding the port. As a child,
      // pipes are reliable, we capture stderr/stdout for diagnostics, and the
      // server lifecycle is bound to the manager.
      const spawnOpts = {
        cwd: serverPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
      };

      let processError = null;
      this.serverProcess = spawn(serverExe, allParams, spawnOpts);

      // Set up error handler immediately
      this.serverProcess.on('error', (error) => {
        console.error('Server process spawn error:', error);
        processError = error;
        this.isRunning = false;
        if (this.serverProcess) {
          this.serverProcess = null;
        }
      });

      // Wait a moment to check if process started successfully
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check for spawn errors
      if (processError) {
        throw new Error(`Failed to spawn server process: ${processError.message}`);
      }

      // Check if process is still running and has a PID
      if (!this.serverProcess) {
        throw new Error('Server process is null after spawn');
      }

      if (this.serverProcess.killed) {
        throw new Error('Server process was killed immediately after start');
      }

      if (!this.serverProcess.pid) {
        throw new Error('Server process did not start (no PID assigned)');
      }

      this.serverPath = serverPath;
      this.isRunning = true;

      // Handle process events (set up after confirming process started)
      const TAIL_CAP = 4000;
      const tailAppend = (current, text) => {
        const combined = current + text;
        return combined.length > TAIL_CAP ? combined.slice(-TAIL_CAP) : combined;
      };

      this.serverProcess.stdout.on('data', (data) => {
        const text = data.toString();
        this.lastStdoutTail = tailAppend(this.lastStdoutTail, text);
        console.log(`Server stdout: ${text}`);
      });

      this.serverProcess.stderr.on('data', (data) => {
        const text = data.toString();
        this.lastStderrTail = tailAppend(this.lastStderrTail, text);
        console.error(`Server stderr: ${text}`);
      });

      this.serverProcess.on('close', (code, signal) => {
        const lifetimeMs = Date.now() - startedAt;
        console.log(`[server] exited code=${code} signal=${signal} lifetime=${lifetimeMs}ms`);
        const wasRunning = this.isRunning;
        this.isRunning = false;
        this.serverProcess = null;

        // Cancel any pending auto-restart since the process is already gone
        if (this.autoRestartTimer) { clearTimeout(this.autoRestartTimer); this.autoRestartTimer = null; }

        // Emit a 'crashed' event for the UI when the server dies right after start
        if (wasRunning && lifetimeMs < 15000) {
          const stderrTail = (this.lastStderrTail || '').trim();
          const stdoutTail = (this.lastStdoutTail || '').trim();
          const argv = this.lastArgv || [];
          this.emit && this.emit('crashed', {
            code, signal, lifetimeMs, stderrTail, stdoutTail, argv
          });
          // Fallback: also write to electron console
          console.error('[server] EARLY EXIT — likely bad CLI arg or missing dependency');
          console.error('  argv:', argv.join(' '));
          if (stderrTail) console.error('  stderr (tail):\n' + stderrTail);
          if (stdoutTail) console.error('  stdout (tail):\n' + stdoutTail);
        }
      });

      // Start monitoring
      this.startMonitoring();

      // Auto-restart interval (replaces the timeout/taskkill loop in start.bat)
      this._scheduleAutoRestart();

      return {
        success: true,
        pid: this.serverProcess.pid,
        message: 'Server started successfully'
      };
    } catch (error) {
      this.isRunning = false;
      if (this.serverProcess) {
        try {
          this.serverProcess.kill();
        } catch (e) {
          // Ignore kill errors
        }
        this.serverProcess = null;
      }
      throw new Error(`Failed to start server: ${error.message}`);
    }
  }

  _scheduleAutoRestart() {
    if (this.autoRestartTimer) {
      clearTimeout(this.autoRestartTimer);
      this.autoRestartTimer = null;
    }
    const lc = config.getLaunchConfig();
    const sec = parseInt(lc.autoRestartIntervalSec, 10) || 0;
    if (sec <= 0 || !this.lastStartArgs) return;

    this.autoRestartTimer = setTimeout(async () => {
      this.autoRestartTimer = null;
      if (!this.isRunning) return;
      try {
        const args = this.lastStartArgs;
        console.log(`[auto-restart] interval ${sec}s elapsed, restarting server`);
        await this.stopServer();
        // Brief gap so the OS releases ports/handles
        await new Promise(r => setTimeout(r, 5000));
        await this.startServer(args.serverPath, args.profileName, args.parameters);
      } catch (err) {
        console.error('[auto-restart] failed:', err);
      }
    }, sec * 1000);
  }

  /**
   * Stop the server
   */
  async stopServer() {
    if (!this.isRunning || !this.serverProcess) {
      throw new Error('Server is not running');
    }

    if (this.autoRestartTimer) {
      clearTimeout(this.autoRestartTimer);
      this.autoRestartTimer = null;
    }

    const pid = this.serverProcess.pid;
    this.stopMonitoring();
    this.isRunning = false;
    this.serverProcess = null;

    try {
      if (process.platform === 'win32') {
        await new Promise((resolve) => {
          exec(`taskkill /PID ${pid} /T /F`, (error) => {
            if (error) {
              console.error('Error stopping server:', error);
            }
            resolve();
          });
        });
      } else {
        try {
          process.kill(pid, 'SIGTERM');
        } catch (e) {
          // Process may already be gone
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
        try {
          process.kill(pid, 0); // Check if process exists (throws if not)
          process.kill(pid, 'SIGKILL');
        } catch (e) {
          // Process already gone
        }
      }

      return { success: true, message: 'Server stopped successfully' };
    } catch (error) {
      throw new Error(`Failed to stop server: ${error.message}`);
    }
  }

  /**
   * Restart the server
   */
  async restartServer(serverPath, profileName, parameters, countdownSeconds = 0) {
    if (countdownSeconds > 0) {
      // Restart with countdown
      return await this.restartWithCountdown(serverPath, profileName, parameters, countdownSeconds);
    }

    // Immediate restart
    if (this.isRunning) {
      await this.stopServer();
      // Wait a bit for process to fully stop
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return await this.startServer(serverPath, profileName, parameters);
  }

  /**
   * Restart with countdown
   */
  async restartWithCountdown(serverPath, profileName, parameters, countdownSeconds) {
    // This will be handled by the UI showing countdown
    // The actual restart happens after countdown
    return {
      success: true,
      countdown: countdownSeconds,
      message: `Server will restart in ${countdownSeconds} seconds`
    };
  }

  /**
   * Get server status
   */
  getServerStatus() {
    return {
      isRunning: this.isRunning,
      pid: this.serverProcess ? this.serverProcess.pid : null
    };
  }

  /**
   * Get server process stats (CPU, RAM)
   */
  async getProcessStats() {
    if (!this.isRunning || !this.serverProcess) {
      return {
        cpu: 0,
        memory: 0,
        memoryMB: 0
      };
    }

    try {
      const pid = this.serverProcess.pid;
      
      if (process.platform === 'win32') {
        // Windows: Use wmic
        return new Promise((resolve) => {
          exec(`wmic process where processid=${pid} get WorkingSetSize,PercentProcessorTime /format:list`, (error, stdout) => {
            if (error) {
              resolve({ cpu: 0, memory: 0, memoryMB: 0 });
              return;
            }

            const lines = stdout.split('\n');
            let memory = 0;
            let cpu = 0;

            for (const line of lines) {
              if (line.startsWith('WorkingSetSize=')) {
                memory = parseInt(line.split('=')[1]) || 0;
              }
              if (line.startsWith('PercentProcessorTime=')) {
                cpu = parseFloat(line.split('=')[1]) || 0;
              }
            }

            resolve({
              cpu: cpu / 100, // Convert to percentage
              memory: memory,
              memoryMB: Math.round(memory / 1024 / 1024)
            });
          });
        });
      } else {
        // Linux/Mac: Use ps
        return new Promise((resolve) => {
          exec(`ps -p ${pid} -o %cpu,rss --no-headers`, (error, stdout) => {
            if (error) {
              resolve({ cpu: 0, memory: 0, memoryMB: 0 });
              return;
            }

            const parts = stdout.trim().split(/\s+/);
            const cpu = parseFloat(parts[0]) || 0;
            const memoryKB = parseInt(parts[1]) || 0;

            resolve({
              cpu: cpu,
              memory: memoryKB * 1024,
              memoryMB: Math.round(memoryKB / 1024)
            });
          });
        });
      }
    } catch (error) {
      console.error('Error getting process stats:', error);
      return { cpu: 0, memory: 0, memoryMB: 0 };
    }
  }

  /**
   * Get player count from server logs
   */
  async getPlayerCount(serverPath, profileName = 'default') {
    try {
      const logPath = path.join(serverPath, 'profiles', profileName, 'logs', 'server_console.log');
      
      if (!await fs.pathExists(logPath)) {
        return { count: 0, max: 0, players: [] };
      }

      // Read last 100 lines of log
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.split('\n').slice(-100);

      // Look for player count patterns
      let playerCount = 0;
      let maxPlayers = 0;

      for (const line of lines) {
        // Look for patterns like "Players: 5/60" or similar
        const match = line.match(/Players?[:\s]+(\d+)\/?(\d+)?/i);
        if (match) {
          playerCount = parseInt(match[1]) || 0;
          maxPlayers = parseInt(match[2]) || 0;
        }
      }

      return {
        count: playerCount,
        max: maxPlayers,
        players: [] // Could parse player names from logs if needed
      };
    } catch (error) {
      console.error('Error getting player count:', error);
      return { count: 0, max: 0, players: [] };
    }
  }

  /**
   * Start monitoring server stats
   */
  startMonitoring() {
    if (this.monitoringInterval) {
      return;
    }

    this.monitoringInterval = setInterval(async () => {
      if (this.isRunning) {
        // Monitoring will be handled via IPC events
      }
    }, 2000); // Update every 2 seconds
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Get server executable path
   */
  getServerExecutable(serverPath) {
    if (process.platform === 'win32') {
      return path.join(serverPath, 'DayZServer_x64.exe');
    } else {
      return path.join(serverPath, 'DayZServer');
    }
  }

  /**
   * Schedule a restart
   * @param {string|Date} time - ISO string or Date
   * @param {string} repeat - 'once' | 'daily' | 'weekly'
   */
  scheduleRestart(time, serverPath, profileName, parameters, repeat = 'once') {
    const restart = {
      id: Date.now().toString(),
      time: time,
      serverPath,
      profileName,
      parameters,
      repeat: repeat || 'once',
      executed: false
    };

    this.scheduledRestarts.push(restart);
    return restart;
  }

  /**
   * Cancel scheduled restart
   */
  cancelScheduledRestart(id) {
    this.scheduledRestarts = this.scheduledRestarts.filter(r => r.id !== id);
  }

  /**
   * Get scheduled restarts
   */
  getScheduledRestarts() {
    return this.scheduledRestarts.filter(r => !r.executed);
  }

  /**
   * Check and execute scheduled restarts
   */
  async checkScheduledRestarts() {
    const now = new Date();
    
    for (const restart of this.scheduledRestarts) {
      if (restart.executed) continue;
      const restartTime = new Date(restart.time);
      if (restartTime > now) continue;

      if (this.isRunning) {
        await this.restartServer(restart.serverPath, restart.profileName, restart.parameters);
      }

      if (restart.repeat === 'daily') {
        restart.time = new Date(restartTime.getTime() + 24 * 60 * 60 * 1000).toISOString();
      } else if (restart.repeat === 'weekly') {
        restart.time = new Date(restartTime.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      } else {
        restart.executed = true;
      }
    }
  }
}

module.exports = new ServerControl();

