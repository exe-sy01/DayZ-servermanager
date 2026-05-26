const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');
const PathUtils = require('../utils/paths');

/**
 * Application configuration management
 */
class Config {
  constructor() {
    this.configPath = path.join(PathUtils.getUserDataPath(), 'config.json');
    this.defaultConfig = {
      serverPath: '',
      steamcmdPath: PathUtils.getSteamCMDPath(),
      mods: [],
      preferences: {
        autoUpdate: false,
        checkUpdatesOnStart: true,
        logLevel: 'info'
      },
      steamCredentials: {
        username: '',
        password: ''
      },
      rcon: {
        enabled: false,
        host: '127.0.0.1',
        port: 2302,
        password: ''
      },
      steamApi: {
        enabled: false,
        apiKey: ''
      },
      launchConfig: {
        serverName: 'DayZ Server',
        port: 2302,
        cpuCount: 0,                // 0 = let DayZ decide
        configFile: 'serverDZ.cfg', // relative to server path
        profileName: 'default',
        bePath: '',                 // optional -BEpath= override
        flags: {
          doLogs: true,
          adminLog: true,
          netLog: true,
          freezeCheck: true,
          filePatching: false
        },
        extraParams: '',
        autoRestartIntervalSec: 0   // 0 = disabled
      }
    };
    this.config = null;
  }

  /**
   * Load configuration from file
   */
  async load() {
    try {
      if (await fs.pathExists(this.configPath)) {
        const data = await fs.readJson(this.configPath);
        this.config = { ...this.defaultConfig, ...data };
        if (this.config.steamCredentials && 'useCredentials' in this.config.steamCredentials) {
          delete this.config.steamCredentials.useCredentials;
          await this.save();
        }
        
        // Migration: Assign loadOrder to mods that don't have it
        if (this.config.mods && this.config.mods.length > 0) {
          let needsSave = false;
          const modsWithOrder = this.config.mods.filter(m => m.loadOrder !== undefined);
          const modsWithoutOrder = this.config.mods.filter(m => m.loadOrder === undefined);
          
          if (modsWithoutOrder.length > 0) {
            // Sort by added date (oldest first) for migration
            modsWithoutOrder.sort((a, b) => {
              const dateA = a.added ? new Date(a.added).getTime() : 0;
              const dateB = b.added ? new Date(b.added).getTime() : 0;
              return dateA - dateB;
            });
            
            // Assign loadOrder starting from max existing order + 1, or 1 if no orders exist
            const maxOrder = modsWithOrder.length > 0 
              ? Math.max(...modsWithOrder.map(m => m.loadOrder || 0))
              : 0;
            
            modsWithoutOrder.forEach((mod, index) => {
              mod.loadOrder = maxOrder + index + 1;
              needsSave = true;
            });
          }
          
          // Ensure all mods have valid loadOrder (renumber if needed)
          const allMods = [...this.config.mods];
          allMods.sort((a, b) => {
            const orderA = a.loadOrder || 999999;
            const orderB = b.loadOrder || 999999;
            if (orderA !== orderB) return orderA - orderB;
            // If same order, sort by added date
            const dateA = a.added ? new Date(a.added).getTime() : 0;
            const dateB = b.added ? new Date(b.added).getTime() : 0;
            return dateA - dateB;
          });
          
          // Renumber to ensure sequential 1-indexed order
          let hasGaps = false;
          allMods.forEach((mod, index) => {
            const expectedOrder = index + 1;
            if (mod.loadOrder !== expectedOrder) {
              mod.loadOrder = expectedOrder;
              hasGaps = true;
            }
          });
          
          if (hasGaps) {
            needsSave = true;
          }
          
          if (needsSave) {
            await this.save();
          }
        }
      } else {
        this.config = { ...this.defaultConfig };
        await this.save();
      }
      return this.config;
    } catch (error) {
      console.error('Error loading config:', error);
      this.config = { ...this.defaultConfig };
      return this.config;
    }
  }

  /**
   * Save configuration to file
   */
  async save() {
    try {
      await fs.ensureDir(path.dirname(this.configPath));
      await fs.writeJson(this.configPath, this.config, { spaces: 2 });
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      return false;
    }
  }

  /**
   * Get configuration value (synchronous).
   * Config must be loaded first via load(). Throws if not loaded.
   */
  get(key) {
    if (!this.config) {
      throw new Error('Config not loaded. Ensure load() has been awaited.');
    }
    return key ? this.config[key] : this.config;
  }

  /**
   * Set configuration value
   */
  async set(key, value) {
    if (!this.config) {
      await this.load();
    }
    this.config[key] = value;
    return await this.save();
  }

  /**
   * Update server path
   */
  async setServerPath(serverPath) {
    return await this.set('serverPath', serverPath);
  }

  /**
   * Get server path
   */
  getServerPath() {
    return this.get('serverPath');
  }

  /**
   * Add mod to list (workshop mod)
   */
  async addMod(workshopId, name) {
    if (!this.config) {
      await this.load();
    }
    const mods = this.config.mods || [];
    if (!mods.find(m => m.workshopId === workshopId)) {
      const maxLoadOrder = mods.length > 0 ? Math.max(...mods.map(m => m.loadOrder || 0), 0) : 0;
      mods.push({ workshopId, name, added: new Date().toISOString(), loadOrder: maxLoadOrder + 1 });
      this.config.mods = mods;
      return await this.save();
    }
    return false;
  }

  /**
   * Add local mod (not from Workshop)
   */
  async addLocalMod(modName, name) {
    if (!this.config) {
      await this.load();
    }
    const mods = this.config.mods || [];
    const cleanModName = (modName || '').replace(/^@/, '').trim();
    if (!cleanModName) return false;
    if (!mods.find(m => m.isLocal && m.modName === cleanModName)) {
      const maxLoadOrder = mods.length > 0 ? Math.max(...mods.map(m => m.loadOrder || 0), 0) : 0;
      mods.push({
        isLocal: true,
        modName: cleanModName,
        name: name || cleanModName,
        added: new Date().toISOString(),
        loadOrder: maxLoadOrder + 1
      });
      this.config.mods = mods;
      return await this.save();
    }
    return false;
  }

  /**
   * Remove mod from list (workshop or local)
   */
  async removeMod(workshopId) {
    if (!this.config) {
      await this.load();
    }
    const mods = (this.config.mods || []).filter(m => String(m.workshopId) !== String(workshopId));
    
    // Renumber remaining mods to fill gaps (1-indexed sequential)
    mods.sort((a, b) => {
      const orderA = a.loadOrder || 999999;
      const orderB = b.loadOrder || 999999;
      if (orderA !== orderB) return orderA - orderB;
      const dateA = a.added ? new Date(a.added).getTime() : 0;
      const dateB = b.added ? new Date(b.added).getTime() : 0;
      return dateA - dateB;
    });
    
    mods.forEach((mod, index) => {
      mod.loadOrder = index + 1;
    });
    
    this.config.mods = mods;
    return await this.save();
  }

  /**
   * Remove local mod by modName
   */
  async removeLocalMod(modName) {
    if (!this.config) {
      await this.load();
    }
    const cleanModName = (modName || '').replace(/^@/, '').trim();
    const mods = (this.config.mods || []).filter(m => !(m.isLocal && m.modName === cleanModName));
    if (mods.length === this.config.mods.length) return false;
    mods.sort((a, b) => {
      const orderA = a.loadOrder || 999999;
      const orderB = b.loadOrder || 999999;
      if (orderA !== orderB) return orderA - orderB;
      const dateA = a.added ? new Date(a.added).getTime() : 0;
      const dateB = b.added ? new Date(b.added).getTime() : 0;
      return dateA - dateB;
    });
    mods.forEach((m, i) => { m.loadOrder = i + 1; });
    this.config.mods = mods;
    return await this.save();
  }

  /**
   * Get mods list
   */
  getMods() {
    return this.get('mods') || [];
  }

  /**
   * Set Steam credentials
   */
  async setSteamCredentials(username, password) {
    if (!this.config) {
      await this.load();
    }
    this.config.steamCredentials = {
      username: (username || '').trim(),
      password: password || ''
    };
    return await this.save();
  }

  /**
   * Get Steam credentials
   */
  getSteamCredentials() {
    const creds = this.get('steamCredentials') || { username: '', password: '' };
    return { username: creds.username || '', password: creds.password || '' };
  }

  /**
   * Set RCON configuration
   */
  async setRCONConfig(host, port, password, enabled = true) {
    if (!this.config) {
      await this.load();
    }
    this.config.rcon = {
      host: host || '127.0.0.1',
      port: port || 2302,
      password: password || '',
      enabled: enabled
    };
    return await this.save();
  }

  /**
   * Get RCON configuration
   */
  getRCONConfig() {
    return this.get('rcon') || { host: '127.0.0.1', port: 2302, password: '', enabled: false };
  }

  /**
   * Get Steam Web API configuration
   */
  getSteamApiConfig() {
    return this.get('steamApi') || { enabled: false, apiKey: '' };
  }

  /**
   * Get launch configuration (server command-line settings)
   */
  getLaunchConfig() {
    const def = this.defaultConfig.launchConfig;
    const current = this.get('launchConfig') || {};
    return {
      ...def,
      ...current,
      flags: { ...def.flags, ...(current.flags || {}) }
    };
  }

  /**
   * Persist launch configuration (partial update, deep-merged with current)
   */
  async setLaunchConfig(partial) {
    if (!this.config) await this.load();
    const current = this.getLaunchConfig();
    const merged = {
      ...current,
      ...partial,
      flags: { ...current.flags, ...(partial?.flags || {}) }
    };
    // Coerce numeric fields
    merged.port = parseInt(merged.port, 10) || 2302;
    merged.cpuCount = parseInt(merged.cpuCount, 10) || 0;
    merged.autoRestartIntervalSec = parseInt(merged.autoRestartIntervalSec, 10) || 0;
    this.config.launchConfig = merged;
    await this.save();
    return merged;
  }

  /**
   * Set Steam Web API configuration
   */
  async setSteamApiConfig(enabled, apiKey) {
    if (!this.config) {
      await this.load();
    }
    this.config.steamApi = {
      enabled: !!enabled,
      apiKey: (apiKey || '').trim()
    };
    return await this.save();
  }

  /**
   * Set mod load order (workshopId or "local:ModName")
   */
  async setModLoadOrder(modId, loadOrder) {
    if (!this.config) {
      await this.load();
    }
    
    const mods = this.config.mods || [];
    const mod = String(modId).startsWith('local:')
      ? mods.find(m => m.isLocal && m.modName === String(modId).replace(/^local:/, ''))
      : mods.find(m => !m.isLocal && String(m.workshopId) === String(modId));
    if (!mod) return false;
    
    const isSameMod = (m) =>
      m.isLocal ? (mod.isLocal && m.modName === mod.modName) : (m.workshopId === mod.workshopId);
    
    const oldOrder = mod.loadOrder || mods.length;
    const newOrder = Math.max(1, Math.min(loadOrder, mods.length));
    
    if (oldOrder === newOrder) return true;
    
    if (newOrder < oldOrder) {
      mods.forEach(m => {
        if (!isSameMod(m) && m.loadOrder >= newOrder && m.loadOrder < oldOrder) {
          m.loadOrder = (m.loadOrder || 0) + 1;
        }
      });
    } else {
      mods.forEach(m => {
        if (!isSameMod(m) && m.loadOrder > oldOrder && m.loadOrder <= newOrder) {
          m.loadOrder = (m.loadOrder || 0) - 1;
        }
      });
    }
    
    mod.loadOrder = newOrder;
    
    // Ensure sequential ordering
    mods.sort((a, b) => {
      const orderA = a.loadOrder || 999999;
      const orderB = b.loadOrder || 999999;
      if (orderA !== orderB) return orderA - orderB;
      const dateA = a.added ? new Date(a.added).getTime() : 0;
      const dateB = b.added ? new Date(b.added).getTime() : 0;
      return dateA - dateB;
    });
    
    mods.forEach((m, index) => {
      m.loadOrder = index + 1;
    });
    
    this.config.mods = mods;
    return await this.save();
  }

  /**
   * Reorder mods based on array of identifiers (workshopId or "local:ModName")
   */
  async reorderMods(modOrderArray) {
    if (!this.config) {
      await this.load();
    }
    
    const mods = this.config.mods || [];
    
    const getModId = (mod) => mod.isLocal ? `local:${mod.modName}` : String(mod.workshopId);
    const findMod = (id) => {
      if (String(id).startsWith('local:')) {
        const modName = String(id).replace(/^local:/, '');
        return mods.find(m => m.isLocal && m.modName === modName);
      }
      return mods.find(m => !m.isLocal && String(m.workshopId) === String(id));
    };

    let validMods = modOrderArray.filter(id => findMod(id));
    mods.forEach(mod => {
      const id = getModId(mod);
      if (!validMods.includes(id)) validMods.push(id);
    });
    
    validMods.forEach((id, index) => {
      const mod = findMod(id);
      if (mod) mod.loadOrder = index + 1;
    });
    
    this.config.mods = mods;
    return await this.save();
  }

  /**
   * Get mods sorted by load order.
   * Config must be loaded first via load().
   */
  getModsOrdered() {
    if (!this.config) {
      throw new Error('Config not loaded. Ensure load() has been awaited.');
    }
    const mods = this.get('mods') || [];
    
    // Sort by loadOrder, then by added date as fallback
    return [...mods].sort((a, b) => {
      const orderA = a.loadOrder || 999999;
      const orderB = b.loadOrder || 999999;
      if (orderA !== orderB) return orderA - orderB;
      const dateA = a.added ? new Date(a.added).getTime() : 0;
      const dateB = b.added ? new Date(b.added).getTime() : 0;
      return dateA - dateB;
    });
  }
}

module.exports = new Config();

