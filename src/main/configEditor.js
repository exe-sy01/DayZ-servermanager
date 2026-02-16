const fs = require('fs-extra');
const path = require('path');

/**
 * Server config file editor
 */
class ConfigEditor {
  /**
   * List config files in server directory
   */
  async listConfigFiles(serverPath) {
    try {
      const configFiles = [];
      
      // Common config file locations
      const commonPaths = [
        path.join(serverPath, 'serverDZ.cfg'),
        path.join(serverPath, 'basic.cfg')
      ];

      // Check profiles directory
      const profilesPath = path.join(serverPath, 'profiles');
      if (await fs.pathExists(profilesPath)) {
        const profiles = await fs.readdir(profilesPath);
        for (const profile of profiles) {
          const profilePath = path.join(profilesPath, profile);
          const stats = await fs.stat(profilePath);
          if (stats.isDirectory()) {
            const serverDZ = path.join(profilePath, 'serverDZ.cfg');
            const basic = path.join(profilePath, 'basic.cfg');
            
            if (await fs.pathExists(serverDZ)) {
              configFiles.push({
                path: serverDZ,
                name: `serverDZ.cfg (${profile})`,
                type: 'cfg',
                profile: profile,
                category: 'profile'
              });
            }
            
            if (await fs.pathExists(basic)) {
              configFiles.push({
                path: basic,
                name: `basic.cfg (${profile})`,
                type: 'cfg',
                profile: profile,
                category: 'profile'
              });
            }
          }
        }
      }

      // Check common paths
      for (const configPath of commonPaths) {
        if (await fs.pathExists(configPath)) {
          const ext = path.extname(configPath).substring(1);
          configFiles.push({
            path: configPath,
            name: path.basename(configPath),
            type: ext,
            profile: null,
            category: 'server'
          });
        }
      }

      // Scan mpmissions directory for mission files
      const mpmissionsPath = path.join(serverPath, 'mpmissions');
      if (await fs.pathExists(mpmissionsPath)) {
        try {
          const missionFolders = await fs.readdir(mpmissionsPath);
          
          for (const missionFolder of missionFolders) {
            const missionPath = path.join(mpmissionsPath, missionFolder);
            const stats = await fs.stat(missionPath);
            
            if (stats.isDirectory()) {
              // Common mission file names
              const missionFiles = [
                'mission.sqm',
                'init.c',
                'types.xml',
                'cfglimits.xml',
                'env.cfg',
                'server.cfg'
              ];
              
              // Check for common mission files
              for (const fileName of missionFiles) {
                const filePath = path.join(missionPath, fileName);
                if (await fs.pathExists(filePath)) {
                  const ext = path.extname(fileName).substring(1);
                  configFiles.push({
                    path: filePath,
                    name: `${fileName} (${missionFolder})`,
                    type: ext,
                    profile: null,
                    category: 'mission',
                    mission: missionFolder
                  });
                }
              }
              
              // Also scan for any other .xml, .cfg, .c, .sqm files in the mission folder
              try {
                const missionFiles = await fs.readdir(missionPath);
                for (const file of missionFiles) {
                  const filePath = path.join(missionPath, file);
                  const fileStats = await fs.stat(filePath);
                  
                  if (fileStats.isFile()) {
                    const ext = path.extname(file).substring(1).toLowerCase();
                    // Only include editable mission files
                    if (['xml', 'cfg', 'c', 'sqm', 'txt'].includes(ext)) {
                      // Skip if already added in common files list
                      const alreadyAdded = configFiles.some(cf => cf.path === filePath);
                      if (!alreadyAdded) {
                        configFiles.push({
                          path: filePath,
                          name: `${file} (${missionFolder})`,
                          type: ext,
                          profile: null,
                          category: 'mission',
                          mission: missionFolder
                        });
                      }
                    }
                  }
                }
              } catch (error) {
                console.warn(`Error scanning mission folder ${missionFolder}:`, error);
              }
            }
          }
        } catch (error) {
          console.warn('Error scanning mpmissions directory:', error);
        }
      }

      // Sort files: server configs first, then profiles, then missions
      configFiles.sort((a, b) => {
        const categoryOrder = { 'server': 0, 'profile': 1, 'mission': 2 };
        const categoryDiff = (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99);
        if (categoryDiff !== 0) return categoryDiff;
        return a.name.localeCompare(b.name);
      });

      return configFiles;
    } catch (error) {
      console.error('Error listing config files:', error);
      return [];
    }
  }

  /**
   * Read config file content
   */
  async readConfigFile(configPath) {
    try {
      if (!await fs.pathExists(configPath)) {
        throw new Error('Config file does not exist');
      }

      const content = await fs.readFile(configPath, 'utf-8');
      return { success: true, content, path: configPath };
    } catch (error) {
      throw new Error(`Failed to read config file: ${error.message}`);
    }
  }

  /**
   * Write config file with backup
   */
  async writeConfigFile(configPath, content) {
    try {
      // Create backup before writing
      await this.backupConfig(configPath);

      // Write new content
      await fs.writeFile(configPath, content, 'utf-8');
      
      return { success: true, path: configPath };
    } catch (error) {
      throw new Error(`Failed to write config file: ${error.message}`);
    }
  }

  /**
   * Create backup of config file
   */
  async backupConfig(configPath) {
    try {
      if (!await fs.pathExists(configPath)) {
        return null;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${configPath}.backup.${timestamp}`;
      
      await fs.copy(configPath, backupPath);
      return backupPath;
    } catch (error) {
      console.error('Error creating backup:', error);
      return null;
    }
  }

  /**
   * Validate config file syntax
   */
  validateConfig(content, fileType) {
    const errors = [];
    const warnings = [];

    try {
      if (fileType === 'xml') {
        // Basic XML validation
        const openTags = (content.match(/<[^/][^>]*>/g) || []).length;
        const closeTags = (content.match(/<\/[^>]+>/g) || []).length;
        
        if (openTags !== closeTags) {
          errors.push('Mismatched XML tags');
        }
        
        // Check for unclosed tags
        const tagStack = [];
        const tagRegex = /<\/?([^\s>]+)[^>]*>/g;
        let match;
        while ((match = tagRegex.exec(content)) !== null) {
          const tagName = match[1];
          if (match[0].startsWith('</')) {
            // Closing tag
            if (tagStack.length === 0 || tagStack[tagStack.length - 1] !== tagName) {
              warnings.push(`Unexpected closing tag: </${tagName}>`);
            } else {
              tagStack.pop();
            }
          } else if (!match[0].endsWith('/>')) {
            // Opening tag (not self-closing)
            tagStack.push(tagName);
          }
        }
        if (tagStack.length > 0) {
          warnings.push(`Unclosed tags: ${tagStack.join(', ')}`);
        }
      } else if (fileType === 'cfg' || fileType === 'c') {
        // Basic CFG/C validation - check for common syntax issues
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          // Check for unclosed strings (simplified)
          if (trimmed.includes('"') && (trimmed.match(/"/g) || []).length % 2 !== 0) {
            warnings.push(`Line ${index + 1}: Possible unclosed string`);
          }
          // Check for unclosed brackets
          const openBrackets = (trimmed.match(/\{/g) || []).length;
          const closeBrackets = (trimmed.match(/\}/g) || []).length;
          if (openBrackets !== closeBrackets) {
            warnings.push(`Line ${index + 1}: Mismatched brackets`);
          }
        });
      } else if (fileType === 'sqm') {
        // SQM files are similar to config files
        const lines = content.split('\n');
        let bracketCount = 0;
        lines.forEach((line, index) => {
          bracketCount += (line.match(/\{/g) || []).length;
          bracketCount -= (line.match(/\}/g) || []).length;
        });
        if (bracketCount !== 0) {
          errors.push('Mismatched brackets in SQM file');
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error.message],
        warnings: []
      };
    }
  }

  /**
   * Get config file type from extension
   */
  getFileType(filePath) {
    const ext = path.extname(filePath).substring(1).toLowerCase();
    // Return appropriate type for syntax highlighting
    if (ext === 'xml') return 'xml';
    if (ext === 'c') return 'c';
    if (ext === 'sqm') return 'sqm';
    return 'cfg'; // Default to cfg for .cfg and other files
  }

  /**
   * List missions in mpmissions directory
   */
  async listMissions(serverPath) {
    try {
      const missions = [];
      const mpmissionsPath = path.join(serverPath, 'mpmissions');
      
      if (!await fs.pathExists(mpmissionsPath)) {
        return missions;
      }

      const missionFolders = await fs.readdir(mpmissionsPath);
      
      for (const missionFolder of missionFolders) {
        const missionPath = path.join(mpmissionsPath, missionFolder);
        const stats = await fs.stat(missionPath);
        
        if (stats.isDirectory()) {
          missions.push({
            name: missionFolder,
            path: missionPath
          });
        }
      }

      return missions.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error('Error listing missions:', error);
      return [];
    }
  }

  /**
   * Scan CE folder for files
   */
  async scanCEFolder(serverPath, missionName, folderName) {
    try {
      const missionPath = path.join(serverPath, 'mpmissions', missionName);
      const ceFolderPath = path.join(missionPath, folderName);
      
      if (!await fs.pathExists(ceFolderPath)) {
        return { success: false, error: `CE folder "${folderName}" does not exist in mission "${missionName}"` };
      }

      const files = await fs.readdir(ceFolderPath);
      const fileList = [];

      for (const file of files) {
        const filePath = path.join(ceFolderPath, file);
        const stats = await fs.stat(filePath);
        
        if (!stats.isFile()) {
          continue;
        }

        // Extract filename with and without extension
        const fileName = path.parse(file).name;
        const fileExtension = path.extname(file);
        const fullFileName = file; // Full filename with extension
        const fileLower = fileName.toLowerCase();

        // Suggest type based on filename (but user can change it)
        let suggestedType = null;
        if (fileLower.includes('spawnabletypes')) {
          suggestedType = 'spawnabletypes';
        } else if (fileLower.includes('types')) {
          suggestedType = 'types';
        } else if (fileLower.includes('events')) {
          suggestedType = 'events';
        }

        fileList.push({
          name: fileName, // Display name without extension
          fullName: fullFileName, // Full filename with extension for XML
          path: filePath,
          suggestedType: suggestedType
        });
      }

      return {
        success: true,
        files: fileList,
        folderPath: ceFolderPath
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Read cfgeconomycore.xml
   */
  async readEconomyCore(serverPath, missionName) {
    try {
      const missionPath = path.join(serverPath, 'mpmissions', missionName);
      const economyCorePath = path.join(missionPath, 'cfgeconomycore.xml');
      
      if (!await fs.pathExists(economyCorePath)) {
        // Return empty structure if file doesn't exist
        return {
          success: true,
          content: '<?xml version="1.0" encoding="UTF-8"?>\n<economycore>\n</economycore>',
          path: economyCorePath,
          exists: false
        };
      }

      const content = await fs.readFile(economyCorePath, 'utf-8');
      return {
        success: true,
        content: content,
        path: economyCorePath,
        exists: true
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update cfgeconomycore.xml with CE folder entry
   */
  async updateEconomyCore(serverPath, missionName, folderName, files) {
    try {
      const result = await this.readEconomyCore(serverPath, missionName);
      if (!result.success) {
        return result;
      }

      let content = result.content;
      const economyCorePath = result.path;

      // Parse XML and update/add CE folder entry
      // Simple XML manipulation - find or create <ce folder="..."> entry
      const ceFolderRegex = new RegExp(
        `<ce\\s+folder=["']${folderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']>([\\s\\S]*?)</ce>`,
        'i'
      );

      // Build file entries - use fullName (with extension) for XML
      const fileEntries = [];
      for (const [type, fileList] of Object.entries(files)) {
        for (const file of fileList) {
          // Use fullName (with extension) if available, otherwise use name
          const fileName = file.fullName || file.name;
          fileEntries.push(`\t\t<file name="${this.escapeXml(fileName)}" type="${type}" />`);
        }
      }

      const ceFolderXml = `\t<ce folder="${this.escapeXml(folderName)}">\n${fileEntries.join('\n')}\n\t</ce>`;

      if (ceFolderRegex.test(content)) {
        // Replace existing CE folder entry
        content = content.replace(ceFolderRegex, ceFolderXml);
      } else {
        // Add new CE folder entry before closing </economycore>
        if (content.includes('</economycore>')) {
          content = content.replace('</economycore>', `${ceFolderXml}\n</economycore>`);
        } else {
          // If no closing tag, add it
          content += `\n${ceFolderXml}\n</economycore>`;
        }
      }

      // Ensure directory exists
      await fs.ensureDir(path.dirname(economyCorePath));
      
      // Write updated content
      await fs.writeFile(economyCorePath, content, 'utf-8');

      return { success: true, path: economyCorePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Escape XML special characters
   */
  escapeXml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = new ConfigEditor();

