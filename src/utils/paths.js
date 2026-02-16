const path = require('path');
const { app } = require('electron');

/**
 * Cross-platform path utilities
 */
class PathUtils {
  /**
   * Get the user data directory for the application
   */
  static getUserDataPath() {
    return app.getPath('userData');
  }

  /**
   * Get SteamCMD installation path
   */
  static getSteamCMDPath() {
    return path.join(this.getUserDataPath(), 'steamcmd');
  }

  /**
   * Get SteamCMD executable path based on platform
   */
  static getSteamCMDExecutable() {
    const platform = process.platform;
    const steamcmdPath = this.getSteamCMDPath();
    
    if (platform === 'win32') {
      return path.join(steamcmdPath, 'steamcmd.exe');
    } else {
      return path.join(steamcmdPath, 'steamcmd.sh');
    }
  }

  /**
   * Normalize path for cross-platform compatibility
   */
  static normalizePath(filePath) {
    return path.normalize(filePath);
  }

  /**
   * Join paths with proper normalization
   */
  static join(...paths) {
    return path.join(...paths);
  }

  /**
   * Get directory name from path
   */
  static dirname(filePath) {
    return path.dirname(filePath);
  }

  /**
   * Get base name from path
   */
  static basename(filePath, ext) {
    return path.basename(filePath, ext);
  }

  /**
   * Check if path is absolute
   */
  static isAbsolute(filePath) {
    return path.isAbsolute(filePath);
  }
}

module.exports = PathUtils;

