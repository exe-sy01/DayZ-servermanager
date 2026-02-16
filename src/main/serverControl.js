const { spawn, exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

/**
 * Server process control and monitoring
 */
class ServerControl {
  constructor() {
    this.serverProcess = null;
    this.serverPath = null;
    this.isRunning = false;
    this.monitoringInterval = null;
    this.scheduledRestarts = [];
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

      // Build command - profiles is always included as a default parameter
      const defaultParams = [
        '-config=serverDZ.cfg',
        `-profiles=${profileName}`,
        '-dologs',
        '-adminlog',
        '-netlog'
      ];

      // Filter out any duplicate -profiles parameter from additional parameters
      const filteredParams = parameters.filter(param => !param.startsWith('-profiles='));
      const allParams = [...defaultParams, ...filteredParams];
      const command = serverExe;
      const args = allParams;

      console.log('Starting server:', command, args.join(' '));

      // Start server process with error handling
      let processError = null;
      
      this.serverProcess = spawn(command, args, {
        cwd: serverPath,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });

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
      this.serverProcess.stdout.on('data', (data) => {
        console.log(`Server stdout: ${data}`);
      });

      this.serverProcess.stderr.on('data', (data) => {
        console.error(`Server stderr: ${data}`);
      });

      this.serverProcess.on('close', (code) => {
        console.log(`Server process exited with code ${code}`);
        this.isRunning = false;
        this.serverProcess = null;
      });

      // Start monitoring
      this.startMonitoring();

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

  /**
   * Stop the server
   */
  async stopServer() {
    if (!this.isRunning || !this.serverProcess) {
      throw new Error('Server is not running');
    }

    try {
      this.stopMonitoring();
      
      // Try graceful shutdown first
      if (process.platform === 'win32') {
        // Windows: Use taskkill
        exec(`taskkill /PID ${this.serverProcess.pid} /T /F`, (error) => {
          if (error) {
            console.error('Error stopping server:', error);
          }
        });
      } else {
        // Linux/Mac: Send SIGTERM then SIGKILL
        this.serverProcess.kill('SIGTERM');
        setTimeout(() => {
          if (this.serverProcess && !this.serverProcess.killed) {
            this.serverProcess.kill('SIGKILL');
          }
        }, 5000);
      }

      this.isRunning = false;
      this.serverProcess = null;

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
   */
  scheduleRestart(time, serverPath, profileName, parameters) {
    const restart = {
      id: Date.now().toString(),
      time: time,
      serverPath,
      profileName,
      parameters,
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
      if (!restart.executed && new Date(restart.time) <= now) {
        restart.executed = true;
        if (this.isRunning) {
          await this.restartServer(restart.serverPath, restart.profileName, restart.parameters);
        }
      }
    }
  }
}

module.exports = new ServerControl();

