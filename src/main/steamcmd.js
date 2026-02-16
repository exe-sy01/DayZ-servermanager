const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const PathUtils = require('../utils/paths');
const config = require('./config');

/**
 * SteamCMD wrapper and management
 */
class SteamCMD {
  constructor() {
    this.steamcmdPath = PathUtils.getSteamCMDPath();
    this.steamcmdExec = PathUtils.getSteamCMDExecutable();
    this.isDownloading = false;
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

      const command = process.platform === 'win32' ? this.steamcmdExec : 'sh';
      const commandArgs = process.platform === 'win32' ? args : [this.steamcmdExec, ...args];

      const child = spawn(command, commandArgs, {
        cwd: this.steamcmdPath,
        shell: false
      });

      let stdout = '';
      let stderr = '';
      let progressData = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        progressData += output;

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
        if (onError) {
          onError(output);
        }
      });

      child.on('close', (code) => {
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
          
          reject(new Error(errorMessage));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      // Timeout handling
      if (timeout > 0) {
        setTimeout(() => {
          child.kill();
          reject(new Error(`SteamCMD command timed out after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  /**
   * Get login arguments based on configured credentials
   */
  getLoginArgs() {
    const credentials = config.getSteamCredentials();
    
    if (credentials.useCredentials && credentials.username && credentials.password) {
      return ['+login', credentials.username, credentials.password];
    } else {
      return ['+login', 'anonymous'];
    }
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
    
    const args = [
      ...loginArgs,
      '+force_install_dir', normalizedPath,
      '+app_update', '223350', branch === 'experimental' ? '-beta experimental' : '',
      'validate',
      '+quit'
    ].filter(arg => arg !== '');

    console.log('SteamCMD command:', args.join(' '));

    return await this.executeCommand(args, {
      onProgress,
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
    // Normalize path for Windows
    const normalizedPath = installDir.replace(/\\/g, '/').replace(/"/g, '');
    
    const loginArgs = this.getLoginArgs();
    
    const args = [
      ...loginArgs,
      '+force_install_dir', normalizedPath,
      '+workshop_download_item', '221100', workshopId.toString(),
      'validate',
      '+quit'
    ];

    return await this.executeCommand(args, {
      onProgress,
      timeout: 600000 // 10 minutes for mod downloads
    });
  }
}

module.exports = new SteamCMD();

