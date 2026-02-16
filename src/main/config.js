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
        password: '',
        useCredentials: false
      },
      rcon: {
        enabled: false,
        host: '127.0.0.1',
        port: 2302,
        password: ''
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
   * Get configuration value
   */
  get(key) {
    if (!this.config) {
      this.load();
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
   * Add mod to list
   */
  async addMod(workshopId, name) {
    if (!this.config) {
      await this.load();
    }
    const mods = this.config.mods || [];
    if (!mods.find(m => m.workshopId === workshopId)) {
      // Assign loadOrder based on current mod count + 1
      const maxLoadOrder = mods.length > 0 
        ? Math.max(...mods.map(m => m.loadOrder || 0), 0)
        : 0;
      mods.push({ 
        workshopId, 
        name, 
        added: new Date().toISOString(),
        loadOrder: maxLoadOrder + 1
      });
      this.config.mods = mods;
      return await this.save();
    }
    return false;
  }

  /**
   * Remove mod from list
   */
  async removeMod(workshopId) {
    if (!this.config) {
      await this.load();
    }
    const mods = (this.config.mods || []).filter(m => m.workshopId !== workshopId);
    
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
   * Get mods list
   */
  getMods() {
    return this.get('mods') || [];
  }

  /**
   * Set Steam credentials
   */
  async setSteamCredentials(username, password, useCredentials = true) {
    if (!this.config) {
      await this.load();
    }
    this.config.steamCredentials = {
      username: username || '',
      password: password || '',
      useCredentials: useCredentials
    };
    return await this.save();
  }

  /**
   * Get Steam credentials
   */
  getSteamCredentials() {
    return this.get('steamCredentials') || { username: '', password: '', useCredentials: false };
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
   * Set mod load order
   */
  async setModLoadOrder(workshopId, loadOrder) {
    if (!this.config) {
      await this.load();
    }
    
    const mods = this.config.mods || [];
    const mod = mods.find(m => String(m.workshopId) === String(workshopId));
    if (!mod) {
      return false;
    }
    
    const oldOrder = mod.loadOrder || mods.length;
    const newOrder = Math.max(1, Math.min(loadOrder, mods.length));
    
    if (oldOrder === newOrder) {
      return true; // No change needed
    }
    
    // Shift other mods
    if (newOrder < oldOrder) {
      // Moving up: shift mods between newOrder and oldOrder down by 1
      mods.forEach(m => {
        if (String(m.workshopId) !== String(workshopId) && m.loadOrder >= newOrder && m.loadOrder < oldOrder) {
          m.loadOrder = (m.loadOrder || 0) + 1;
        }
      });
    } else {
      // Moving down: shift mods between oldOrder and newOrder up by 1
      mods.forEach(m => {
        if (String(m.workshopId) !== String(workshopId) && m.loadOrder > oldOrder && m.loadOrder <= newOrder) {
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
   * Reorder mods based on array of workshop IDs
   */
  async reorderMods(modOrderArray) {
    if (!this.config) {
      await this.load();
    }
    
    const mods = this.config.mods || [];
    
    // Validate that all mods in order array exist
    const validMods = modOrderArray.filter(id => mods.find(m => String(m.workshopId) === String(id)));
    
    if (validMods.length !== mods.length) {
      // Some mods are missing, add them at the end
      mods.forEach(mod => {
        if (!validMods.some(id => String(id) === String(mod.workshopId))) {
          validMods.push(mod.workshopId);
        }
      });
    }
    
    // Assign new load orders
    validMods.forEach((workshopId, index) => {
      const mod = mods.find(m => String(m.workshopId) === String(workshopId));
      if (mod) {
        mod.loadOrder = index + 1;
      }
    });
    
    this.config.mods = mods;
    return await this.save();
  }

  /**
   * Get mods sorted by load order
   */
  getModsOrdered() {
    if (!this.config) {
      this.load();
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

