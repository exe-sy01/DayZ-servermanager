const axios = require('axios');
const config = require('./config');
const serverManager = require('./serverManager');
const notificationService = require('./notificationService');

/**
 * Check for DayZ server updates via Steam Web API
 */
class ServerUpdateChecker {
  async checkForUpdates(serverPath) {
    try {
      const version = await serverManager.getServerVersion(serverPath);
      if (!version || !version.buildId) {
        return { success: false, error: 'Could not read server version', updateAvailable: false };
      }

      const apiConfig = config.getSteamApiConfig();
      if (!apiConfig.enabled || !apiConfig.apiKey) {
        return {
          success: true,
          updateAvailable: false,
          currentBuildId: version.buildId,
          message: 'Steam API key not configured for update checks'
        };
      }

      const url = `https://api.steampowered.com/ISteamApps/UpToDateCheck/v1/`;
      const response = await axios.get(url, {
        params: {
          appid: 223350,
          version: version.buildId,
          key: apiConfig.apiKey
        },
        timeout: 10000
      });

      const data = response.data?.response;
      if (!data) {
        return { success: false, error: 'Invalid API response', updateAvailable: false };
      }

      const updateAvailable = !data.up_to_date;
      if (updateAvailable && data.required_version) {
        notificationService.addServerUpdate(data.required_version.toString());
      }

      return {
        success: true,
        updateAvailable,
        currentBuildId: version.buildId,
        requiredBuildId: data.required_version || null,
        message: data.message || (updateAvailable ? 'Update available' : 'Up to date')
      };
    } catch (error) {
      console.error('Server update check failed:', error);
      return {
        success: false,
        error: error.message,
        updateAvailable: false
      };
    }
  }
}

module.exports = new ServerUpdateChecker();
