// Polyfill for File API (required by undici/cheerio in Electron)
if (typeof File === 'undefined') {
  global.File = class File {
    constructor(bits, name, options = {}) {
      this.name = name;
      this.lastModified = options.lastModified || Date.now();
      this.size = 0;
      this.type = options.type || '';
    }
  };
}

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const steamcmd = require('./steamcmd');

/**
 * Workshop mod management
 */
class WorkshopManager {
  constructor() {
    this.workshopAppId = '221100'; // DayZ App ID
    this.searchCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Search DayZ workshop mods by name
   */
  async searchMods(query, page = 1, sortBy = 'relevance') {
    const cacheKey = `${query}_${page}_${sortBy}`;
    const cached = this.searchCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // Use Steam Workshop web interface for searching
      const searchUrl = `https://steamcommunity.com/workshop/browse/?appid=${this.workshopAppId}&searchtext=${encodeURIComponent(query)}&p=${page}&numperpage=30&browsesort=${sortBy}`;
      
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.status !== 200) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = response.data;
      const $ = cheerio.load(html);
      const mods = [];

      // Parse workshop items from HTML
      $('.workshopItem').each((index, element) => {
        const $item = $(element);
        const link = $item.find('a').attr('href');
        const workshopIdMatch = link ? link.match(/filedetails\/\?id=(\d+)/) : null;
        
        if (workshopIdMatch) {
          const workshopId = workshopIdMatch[1];
          const name = $item.find('.workshopItemTitle').text().trim();
          const description = $item.find('.workshopItemDescription').text().trim();
          const thumbnail = $item.find('img').attr('src') || '';
          const subscriberText = $item.find('.workshopItemSubscriptionCount').text().trim();
          const subscriberCount = this.parseSubscriberCount(subscriberText);

          mods.push({
            workshopId,
            name,
            description: description.substring(0, 200),
            thumbnail,
            subscriberCount,
            lastUpdated: null, // Would need additional parsing
            fileSize: null,
            tags: [],
            author: null
          });
        }
      });

      const result = {
        mods,
        page,
        totalPages: this.estimateTotalPages($),
        hasMore: mods.length === 30
      };

      this.searchCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      console.error('Error searching mods:', error);
      throw new Error(`Failed to search mods: ${error.message}`);
    }
  }

  /**
   * Parse subscriber count from text
   */
  parseSubscriberCount(text) {
    if (!text) return 0;
    const match = text.match(/([\d,]+)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }
    return 0;
  }

  /**
   * Estimate total pages from HTML
   */
  estimateTotalPages($) {
    // Try to find pagination info
    const pageInfo = $('.workshopBrowsePagingInfo').text();
    const match = pageInfo.match(/(\d+)\s+results/);
    if (match) {
      const total = parseInt(match[1], 10);
      return Math.ceil(total / 30);
    }
    return 1;
  }

  /**
   * Get detailed mod information
   */
  async getModDetails(workshopId) {
    try {
      const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.status !== 200) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = response.data;
      const $ = cheerio.load(html);

      const name = $('.workshopItemTitle').text().trim();
      const description = $('.workshopItemDescription').text().trim();
      const thumbnail = $('.workshopItemPreviewImage img').attr('src') || '';
      const subscriberText = $('.numSubscriptions').text().trim();
      const subscriberCount = this.parseSubscriberCount(subscriberText);
      const author = $('.friendBlockContent a').first().text().trim();
      const tags = [];
      
      $('.appTag').each((index, element) => {
        tags.push($(element).text().trim());
      });

      return {
        workshopId,
        name,
        description,
        thumbnail,
        subscriberCount,
        author,
        tags,
        lastUpdated: null,
        fileSize: null
      };
    } catch (error) {
      console.error('Error getting mod details:', error);
      throw new Error(`Failed to get mod details: ${error.message}`);
    }
  }

  /**
   * Get popular/trending mods
   */
  async getPopularMods(page = 1) {
    return await this.searchMods('', page, 'mostsubscribed');
  }

  /**
   * Get workshop collection details and list of mods
   */
  async getCollectionDetails(collectionId) {
    try {
      const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${collectionId}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.status !== 200) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = response.data;
      const $ = cheerio.load(html);

      // Check if this is actually a collection
      const isCollection = html.includes('workshop_collection') || html.includes('Collection');
      
      if (!isCollection) {
        throw new Error('This is not a workshop collection');
      }

      const name = $('.workshopItemTitle').text().trim() || 'Untitled Collection';
      const description = $('.workshopItemDescription').text().trim() || '';
      const thumbnail = $('.workshopItemPreviewImage img').attr('src') || '';
      const subscriberText = $('.numSubscriptions').text().trim();
      const subscriberCount = this.parseSubscriberCount(subscriberText);
      const author = $('.friendBlockContent a').first().text().trim() || '';

      // Extract mod IDs from the collection
      // Collections have mods listed in the page, usually in a specific format
      const modIds = [];
      
      // Method 1: Look for workshop item links in the collection
      $('a[href*="filedetails/?id="]').each((index, element) => {
        const href = $(element).attr('href');
        if (href) {
          const match = href.match(/filedetails\/\?id=(\d+)/);
          if (match && match[1] !== collectionId) {
            // Don't include the collection ID itself
            const modId = match[1];
            if (!modIds.includes(modId)) {
              modIds.push(modId);
            }
          }
        }
      });

      // Method 2: Try to parse from JavaScript data in the page
      // Steam Workshop often embeds collection data in JavaScript
      const scriptTags = $('script').toArray();
      for (const script of scriptTags) {
        const scriptContent = $(script).html() || '';
        // Look for collection item IDs in JavaScript
        const collectionMatch = scriptContent.match(/g_rgCollectionChildren\s*=\s*\[(.*?)\]/);
        if (collectionMatch) {
          const idsMatch = collectionMatch[1].match(/\d+/g);
          if (idsMatch) {
            idsMatch.forEach(id => {
              if (id !== collectionId && !modIds.includes(id)) {
                modIds.push(id);
              }
            });
          }
        }
        
        // Alternative pattern
        const altMatch = scriptContent.match(/publishedfileid["\s]*[:=]["\s]*(\d+)/g);
        if (altMatch) {
          altMatch.forEach(match => {
            const idMatch = match.match(/(\d+)/);
            if (idMatch && idMatch[1] !== collectionId && !modIds.includes(idMatch[1])) {
              modIds.push(idMatch[1]);
            }
          });
        }
      }

      // Method 3: Use Steam Workshop API if available (requires API key, but we can try without)
      // For now, we'll rely on web scraping

      return {
        collectionId,
        name,
        description,
        thumbnail,
        subscriberCount,
        author,
        modIds: modIds.filter(id => id && id.length > 0),
        modCount: modIds.length
      };
    } catch (error) {
      console.error('Error getting collection details:', error);
      throw new Error(`Failed to get collection details: ${error.message}`);
    }
  }

  /**
   * Download all mods from a collection
   */
  async downloadCollection(collectionId, installPath, onProgress = null) {
    try {
      // Get collection details
      const collection = await this.getCollectionDetails(collectionId);
      
      if (!collection.modIds || collection.modIds.length === 0) {
        throw new Error('Collection is empty or mods could not be extracted');
      }

      const results = [];
      const total = collection.modIds.length;

      for (let i = 0; i < collection.modIds.length; i++) {
        const modId = collection.modIds[i];
        
        try {
          if (onProgress) {
            onProgress({
              current: i + 1,
              total: total,
              progress: Math.round(((i + 1) / total) * 100),
              message: `Downloading mod ${i + 1}/${total} (ID: ${modId})...`,
              workshopId: modId,
              collectionId: collectionId
            });
          }

          const result = await this.downloadMod(modId, installPath);
          results.push({
            workshopId: modId,
            success: result.success,
            error: result.error || null
          });
        } catch (error) {
          console.error(`Error downloading mod ${modId} from collection:`, error);
          results.push({
            workshopId: modId,
            success: false,
            error: error.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      return {
        success: true,
        collectionId,
        collectionName: collection.name,
        total: total,
        successCount,
        failCount,
        results
      };
    } catch (error) {
      throw new Error(`Failed to download collection: ${error.message}`);
    }
  }

  /**
   * Download workshop mod
   */
  async downloadMod(workshopId, installPath, onProgress = null) {
    try {
      if (!await steamcmd.isInstalled()) {
        throw new Error('SteamCMD is not installed. Please download it first.');
      }

      await fs.ensureDir(installPath);
      await steamcmd.downloadWorkshopItem(workshopId, installPath, onProgress);

      // Verify mod was downloaded
      const workshopModPath = path.join(installPath, 'steamapps', 'workshop', 'content', this.workshopAppId, workshopId.toString());
      if (!await fs.pathExists(workshopModPath)) {
        throw new Error('Mod download completed but files not found');
      }

      // Get mod name from mod.info or meta.cpp
      const modName = await this.getModFolderName(workshopId, installPath);
      
      // Create mod folder in server directory (as @ModName)
      const serverModPath = path.join(installPath, `@${modName}`);
      const keysPath = path.join(installPath, 'keys');
      
      // Create symlink or copy mod folder to server directory
      if (!await fs.pathExists(serverModPath)) {
        // Use symlink on Windows/Linux, copy on systems that don't support symlinks well
        try {
          if (process.platform === 'win32') {
            // Windows: Use junction or symlink
            await fs.ensureSymlink(workshopModPath, serverModPath, 'junction');
          } else {
            // Linux/Mac: Use symlink
            await fs.ensureSymlink(workshopModPath, serverModPath, 'dir');
          }
          console.log(`Created symlink: ${serverModPath} -> ${workshopModPath}`);
        } catch (symlinkError) {
          // If symlink fails, copy the directory
          console.warn('Symlink failed, copying mod directory:', symlinkError.message);
          await fs.copy(workshopModPath, serverModPath);
          console.log(`Copied mod directory: ${workshopModPath} -> ${serverModPath}`);
        }
      }

      // Copy .bikey files to keys folder
      await this.copyModKeys(workshopModPath, keysPath);

      return { success: true, path: serverModPath, workshopId, modName };
    } catch (error) {
      throw new Error(`Failed to download mod: ${error.message}`);
    }
  }

  /**
   * Update existing mod
   */
  async updateMod(workshopId, installPath, onProgress = null) {
    // Get mod name first to preserve the link
    const modName = await this.getModFolderName(workshopId, installPath);
    const serverModPath = path.join(installPath, `@${modName}`);
    
    // Remove old link/copy if it exists (will be recreated by downloadMod)
    if (await fs.pathExists(serverModPath)) {
      try {
        const stats = await fs.lstat(serverModPath);
        if (stats.isSymbolicLink() || stats.isFile()) {
          await fs.remove(serverModPath);
        } else {
          // It's a directory copy, remove it
          await fs.remove(serverModPath);
        }
      } catch (error) {
        console.warn('Error removing old mod link:', error);
        // Continue anyway - downloadMod will handle it
      }
    }
    
    // Download/update the mod (this will recreate the link and copy keys)
    return await this.downloadMod(workshopId, installPath, onProgress);
  }

  /**
   * Update all mods in list
   */
  async updateAllMods(modsList, installPath, onProgress = null) {
    const results = [];
    const total = modsList.length;

    for (let i = 0; i < modsList.length; i++) {
      const mod = modsList[i];
      try {
        if (onProgress) {
          onProgress({ 
            current: i + 1, 
            total, 
            mod: mod.name || mod.workshopId,
            message: `Updating ${mod.name || mod.workshopId}...`
          });
        }
        const result = await this.updateMod(mod.workshopId, installPath);
        results.push({ ...result, mod });
      } catch (error) {
        results.push({ 
          success: false, 
          error: error.message, 
          mod 
        });
      }
    }

    return results;
  }

  /**
   * Get mod info from installed mod
   */
  /**
   * Get mod folder name from mod.info or meta.cpp
   */
  async getModFolderName(workshopId, installPath) {
    try {
      const modPath = path.join(installPath, 'steamapps', 'workshop', 'content', this.workshopAppId, workshopId.toString());
      
      if (!await fs.pathExists(modPath)) {
        return null;
      }

      // Try to read mod.info first
      const modInfoPath = path.join(modPath, 'mod.info');
      if (await fs.pathExists(modInfoPath)) {
        const content = await fs.readFile(modInfoPath, 'utf-8');
        // Parse mod.info: look for name= or similar
        const nameMatch = content.match(/name\s*=\s*"([^"]+)"/i) || content.match(/name\s*=\s*(\S+)/i);
        if (nameMatch && nameMatch[1]) {
          // Clean the name: remove @, spaces, special chars
          let modName = nameMatch[1].replace(/@/g, '').trim();
          modName = modName.replace(/[^a-zA-Z0-9_-]/g, '');
          if (modName) {
            return modName;
          }
        }
      }

      // Try meta.cpp
      const metaPath = path.join(modPath, 'meta.cpp');
      if (await fs.pathExists(metaPath)) {
        const content = await fs.readFile(metaPath, 'utf-8');
        // Parse meta.cpp: look for name = "..." or name="..."
        const nameMatch = content.match(/name\s*=\s*"([^"]+)"/i);
        if (nameMatch && nameMatch[1]) {
          let modName = nameMatch[1].replace(/@/g, '').trim();
          modName = modName.replace(/[^a-zA-Z0-9_-]/g, '');
          if (modName) {
            return modName;
          }
        }
      }

      // Fallback: use workshop ID
      return `Mod${workshopId}`;
    } catch (error) {
      console.error('Error getting mod folder name:', error);
      return `Mod${workshopId}`;
    }
  }

  /**
   * Copy .bikey files from mod directory to keys folder
   */
  async copyModKeys(modPath, keysPath) {
    try {
      await fs.ensureDir(keysPath);
      
      // Find all .bikey files in mod directory (recursively)
      const findKeys = async (dir) => {
        const keys = [];
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              // Recursively search subdirectories
              const subKeys = await findKeys(fullPath);
              keys.push(...subKeys);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bikey')) {
              keys.push(fullPath);
            }
          }
        } catch (error) {
          // Ignore permission errors
        }
        return keys;
      };

      const keyFiles = await findKeys(modPath);
      
      // Copy each .bikey file to keys folder
      for (const keyFile of keyFiles) {
        const keyFileName = path.basename(keyFile);
        const destKeyPath = path.join(keysPath, keyFileName);
        
        // Only copy if it doesn't already exist
        if (!await fs.pathExists(destKeyPath)) {
          await fs.copy(keyFile, destKeyPath);
          console.log(`Copied key file: ${keyFile} -> ${destKeyPath}`);
        }
      }
    } catch (error) {
      console.warn('Error copying mod keys:', error);
      // Don't throw - keys are optional
    }
  }

  async getModInfo(workshopId, installPath) {
    try {
      // First check standard workshop path
      const modPath = path.join(installPath, 'steamapps', 'workshop', 'content', this.workshopAppId, workshopId.toString());
      let actualModPath = null;
      let modName = null;
      
      if (await fs.pathExists(modPath)) {
        actualModPath = modPath;
        // Get mod folder name from mod.info or meta.cpp
        modName = await this.getModFolderName(workshopId, installPath);
      } else {
        // Check if there's a @ModName folder in server directory that links to this workshop ID
        try {
          const serverDirEntries = await fs.readdir(installPath);
          for (const entry of serverDirEntries) {
            if (entry.startsWith('@') && entry.length > 1) {
              const serverModPath = path.join(installPath, entry);
              const stats = await fs.stat(serverModPath).catch(() => null);
              
              if (stats && (stats.isDirectory() || stats.isSymbolicLink())) {
                // Check if this folder contains the workshop ID
                let folderWorkshopId = null;
                
                if (stats.isSymbolicLink()) {
                  const realPath = await fs.readlink(serverModPath);
                  const workshopIdMatch = realPath.match(/[\/\\](\d+)[\/\\]?$/);
                  if (workshopIdMatch && workshopIdMatch[1] === workshopId.toString()) {
                    folderWorkshopId = workshopIdMatch[1];
                    actualModPath = realPath;
                    modName = entry.replace(/^@/, '');
                  }
                } else {
                  // Check mod.info or meta.cpp for publishedid
                  const modInfoPath = path.join(serverModPath, 'mod.info');
                  const metaPath = path.join(serverModPath, 'meta.cpp');
                  
                  if (await fs.pathExists(modInfoPath)) {
                    const content = await fs.readFile(modInfoPath, 'utf-8');
                    const idMatch = content.match(/publishedid\s*=\s*(\d+)/i);
                    if (idMatch && idMatch[1] === workshopId.toString()) {
                      folderWorkshopId = idMatch[1];
                      actualModPath = serverModPath;
                      modName = entry.replace(/^@/, '');
                    }
                  } else if (await fs.pathExists(metaPath)) {
                    const content = await fs.readFile(metaPath, 'utf-8');
                    const idMatch = content.match(/publishedid\s*=\s*(\d+)/i);
                    if (idMatch && idMatch[1] === workshopId.toString()) {
                      folderWorkshopId = idMatch[1];
                      actualModPath = serverModPath;
                      modName = entry.replace(/^@/, '');
                    }
                  }
                }
                
                if (folderWorkshopId === workshopId.toString()) {
                  break; // Found it
                }
              }
            }
          }
        } catch (error) {
          console.warn('Error checking server directory for mod:', error);
        }
      }
      
      if (!actualModPath) {
        return null;
      }

      // If we don't have modName yet, try to get it
      if (!modName) {
        modName = await this.getModFolderName(workshopId, installPath);
      }
      
      // Check if mod is linked/copied to server directory
      const serverModPath = path.join(installPath, `@${modName}`);
      const isLinked = await fs.pathExists(serverModPath);

      // Try to read mod.info or meta.cpp for mod information
      const modInfoPath = path.join(actualModPath, 'mod.info');
      const metaPath = path.join(actualModPath, 'meta.cpp');

      let modInfo = {};
      
      if (await fs.pathExists(modInfoPath)) {
        const content = await fs.readFile(modInfoPath, 'utf-8');
        // Parse mod.info format (simplified)
        modInfo = { path: actualModPath, hasInfo: true };
      } else if (await fs.pathExists(metaPath)) {
        const content = await fs.readFile(metaPath, 'utf-8');
        // Parse meta.cpp format (simplified)
        modInfo = { path: actualModPath, hasMeta: true };
      } else {
        modInfo = { path: actualModPath, installed: true };
      }

      return {
        workshopId,
        modName,
        serverModPath: isLinked ? serverModPath : null,
        ...modInfo,
        installed: true
      };
    } catch (error) {
      console.error('Error getting mod info:', error);
      return null;
    }
  }

  /**
   * List installed mods
   * Checks both the standard workshop path and @ModName folders in server directory
   */
  async listInstalledMods(installPath) {
    try {
      const mods = [];
      
      // First, check standard workshop path
      const workshopPath = path.join(installPath, 'steamapps', 'workshop', 'content', this.workshopAppId);
      
      if (await fs.pathExists(workshopPath)) {
        const entries = await fs.readdir(workshopPath);

        for (const entry of entries) {
          const modPath = path.join(workshopPath, entry);
          const stats = await fs.stat(modPath);
          
          if (stats.isDirectory() && /^\d+$/.test(entry)) {
            const modInfo = await this.getModInfo(entry, installPath);
            if (modInfo) {
              mods.push(modInfo);
            }
          }
        }
      }

      // Also check for @ModName folders in server directory (for scanned mods)
      const serverDirEntries = await fs.readdir(installPath).catch(() => []);
      for (const entry of serverDirEntries) {
        if (entry.startsWith('@') && entry.length > 1) {
          const modFolderPath = path.join(installPath, entry);
          const stats = await fs.stat(modFolderPath).catch(() => null);
          
          if (stats && (stats.isDirectory() || stats.isSymbolicLink())) {
            // Try to find the workshop ID by checking if it's a symlink
            let workshopId = null;
            let modName = entry.replace(/^@/, '');
            
            try {
              if (stats.isSymbolicLink()) {
                const realPath = await fs.readlink(modFolderPath);
                // Extract workshop ID from path like: .../workshop/content/221100/123456789
                const workshopIdMatch = realPath.match(/[\/\\](\d+)[\/\\]?$/);
                if (workshopIdMatch) {
                  workshopId = workshopIdMatch[1];
                }
              } else {
                // It's a copied directory, try to find workshop ID in mod.info or meta.cpp
                const modInfoPath = path.join(modFolderPath, 'mod.info');
                const metaPath = path.join(modFolderPath, 'meta.cpp');
                
                if (await fs.pathExists(modInfoPath)) {
                  const content = await fs.readFile(modInfoPath, 'utf-8');
                  const idMatch = content.match(/publishedid\s*=\s*(\d+)/i);
                  if (idMatch) {
                    workshopId = idMatch[1];
                  }
                } else if (await fs.pathExists(metaPath)) {
                  const content = await fs.readFile(metaPath, 'utf-8');
                  const idMatch = content.match(/publishedid\s*=\s*(\d+)/i);
                  if (idMatch) {
                    workshopId = idMatch[1];
                  }
                }
              }
              
              // If we found a workshop ID and don't already have this mod in the list
              if (workshopId && !mods.find(m => String(m.workshopId) === String(workshopId))) {
                const modInfo = await this.getModInfo(workshopId, installPath);
                if (modInfo) {
                  mods.push({
                    ...modInfo,
                    modName: modName,
                    serverModPath: modFolderPath
                  });
                } else {
                  // Create basic mod info if getModInfo fails
                  mods.push({
                    workshopId: workshopId,
                    modName: modName,
                    name: modName,
                    serverModPath: modFolderPath,
                    installed: true
                  });
                }
              }
            } catch (error) {
              console.warn(`Error processing @ModName folder ${entry}:`, error);
            }
          }
        }
      }

      return mods;
    } catch (error) {
      console.error('Error listing installed mods:', error);
      return [];
    }
  }

  /**
   * Scan a custom workshop folder path for mods
   */
  async scanWorkshopFolder(workshopFolderPath, serverPath) {
    try {
      if (!await fs.pathExists(workshopFolderPath)) {
        throw new Error('Workshop folder path does not exist');
      }

      const entries = await fs.readdir(workshopFolderPath);
      const modsFound = [];
      const errors = [];

      for (const entry of entries) {
        const modPath = path.join(workshopFolderPath, entry);
        try {
          const stats = await fs.stat(modPath);
          
          if (stats.isDirectory() && /^\d+$/.test(entry)) {
            const workshopId = entry;
            
            // Try to get mod folder name from mod.info or meta.cpp directly
            let modName = null;
            const modInfoPath = path.join(modPath, 'mod.info');
            const metaPath = path.join(modPath, 'meta.cpp');
            
            if (await fs.pathExists(modInfoPath)) {
              const content = await fs.readFile(modInfoPath, 'utf-8');
              const nameMatch = content.match(/name\s*=\s*"([^"]+)"/i) || content.match(/name\s*=\s*(\S+)/i);
              if (nameMatch && nameMatch[1]) {
                modName = nameMatch[1].replace(/@/g, '').trim();
                modName = modName.replace(/[^a-zA-Z0-9_-]/g, '');
              }
            } else if (await fs.pathExists(metaPath)) {
              const content = await fs.readFile(metaPath, 'utf-8');
              const nameMatch = content.match(/name\s*=\s*"([^"]+)"/i);
              if (nameMatch && nameMatch[1]) {
                modName = nameMatch[1].replace(/@/g, '').trim();
                modName = modName.replace(/[^a-zA-Z0-9_-]/g, '');
              }
            }
            
            // Fallback to workshop ID if no name found
            if (!modName) {
              modName = `Mod${workshopId}`;
            }
            
            // Get mod details to get the display name
            let displayName = modName;
            try {
              const modDetails = await this.getModDetails(workshopId);
              if (modDetails && modDetails.name) {
                displayName = modDetails.name;
              }
            } catch (e) {
              console.warn(`Could not get details for mod ${workshopId}:`, e);
            }

            // Add to config if not already there
            const config = require('./config');
            const configMods = config.getMods() || [];
            if (!configMods.find(m => String(m.workshopId) === String(workshopId))) {
              await config.addMod(workshopId, displayName);
            }

            // Create symlink/copy and copy keys if server path is provided
            if (serverPath) {
              const serverModPath = path.join(serverPath, `@${modName}`);
              if (!await fs.pathExists(serverModPath)) {
                try {
                  if (process.platform === 'win32') {
                    await fs.ensureSymlink(modPath, serverModPath, 'junction');
                  } else {
                    await fs.ensureSymlink(modPath, serverModPath, 'dir');
                  }
                  console.log(`Created symlink for scanned mod: ${serverModPath}`);
                } catch (symlinkError) {
                  console.warn('Symlink failed, copying mod directory:', symlinkError.message);
                  await fs.copy(modPath, serverModPath);
                  console.log(`Copied mod directory for scanned mod: ${serverModPath}`);
                }
              }

              // Copy keys
              const keysPath = path.join(serverPath, 'keys');
              await this.copyModKeys(modPath, keysPath);
            }

            modsFound.push({ workshopId, name: displayName, modName: modName });
          }
        } catch (error) {
          errors.push({ entry, error: error.message });
          console.error(`Error processing mod ${entry}:`, error);
        }
      }

      return {
        success: true,
        modsFound: modsFound.length,
        mods: modsFound,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      throw new Error(`Failed to scan workshop folder: ${error.message}`);
    }
  }
}

module.exports = new WorkshopManager();

