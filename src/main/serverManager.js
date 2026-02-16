const fs = require('fs-extra');
const path = require('path');
const steamcmd = require('./steamcmd');

/**
 * Server file operations
 */
class ServerManager {
  /**
   * Install DayZ server files
   */
  async installServer(installPath, branch = 'public', onProgress = null) {
    try {
      await fs.ensureDir(installPath);
      
      // Check if SteamCMD is installed
      if (!await steamcmd.isInstalled()) {
        throw new Error('SteamCMD is not installed. Please download it first.');
      }

      // Download/update server files
      await steamcmd.updateServerFiles(installPath, branch, onProgress);
      
      // Validate installation
      const isValid = await this.validateInstallation(installPath);
      if (!isValid) {
        throw new Error('Server installation validation failed');
      }

      return { success: true, path: installPath };
    } catch (error) {
      throw new Error(`Failed to install server: ${error.message}`);
    }
  }

  /**
   * Update existing server installation
   */
  async updateServer(installPath, onProgress = null) {
    try {
      if (!await fs.pathExists(installPath)) {
        throw new Error('Server installation path does not exist');
      }

      if (!await steamcmd.isInstalled()) {
        throw new Error('SteamCMD is not installed. Please download it first.');
      }

      await steamcmd.updateServerFiles(installPath, 'public', onProgress);
      
      return { success: true, path: installPath };
    } catch (error) {
      throw new Error(`Failed to update server: ${error.message}`);
    }
  }

  /**
   * Get server version
   */
  async getServerVersion(installPath) {
    try {
      const versionFile = path.join(installPath, 'steamapps', 'appmanifest_223350.acf');
      
      if (!await fs.pathExists(versionFile)) {
        return null;
      }

      const content = await fs.readFile(versionFile, 'utf-8');
      const buildIdMatch = content.match(/"buildid"\s+"(\d+)"/);
      const versionMatch = content.match(/"version"\s+"([^"]+)"/);

      return {
        buildId: buildIdMatch ? buildIdMatch[1] : null,
        version: versionMatch ? versionMatch[1] : null
      };
    } catch (error) {
      console.error('Error reading server version:', error);
      return null;
    }
  }

  /**
   * Validate server installation
   */
  async validateInstallation(installPath) {
    try {
      // Check for essential files
      const essentialFiles = [
        'DayZServer_x64.exe',
        'steamapps'
      ];

      for (const file of essentialFiles) {
        const filePath = path.join(installPath, file);
        if (!await fs.pathExists(filePath)) {
          return false;
        }
      }

      // Check for server executable
      const exePath = path.join(installPath, 'DayZServer_x64.exe');
      if (process.platform !== 'win32') {
        // Linux/Mac might have different executable name
        const altExe = path.join(installPath, 'DayZServer');
        if (!await fs.pathExists(exePath) && !await fs.pathExists(altExe)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error validating installation:', error);
      return false;
    }
  }

  /**
   * Get server profile path
   */
  getServerProfilePath(installPath, profileName = 'default') {
    return path.join(installPath, 'profiles', profileName);
  }

  /**
   * List available server profiles
   */
  async listProfiles(installPath) {
    try {
      const profilesPath = path.join(installPath, 'profiles');
      if (!await fs.pathExists(profilesPath)) {
        return [];
      }

      const entries = await fs.readdir(profilesPath);
      const profiles = [];

      for (const entry of entries) {
        const entryPath = path.join(profilesPath, entry);
        const stats = await fs.stat(entryPath);
        if (stats.isDirectory()) {
          profiles.push(entry);
        }
      }

      return profiles;
    } catch (error) {
      console.error('Error listing profiles:', error);
      return [];
    }
  }
}

module.exports = new ServerManager();

