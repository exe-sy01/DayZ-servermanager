const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');
const readLastLines = require('read-last-lines');

/**
 * Log file management and tailing
 */
class LogViewer {
  constructor() {
    this.watchers = new Map();
    this.filePositions = new Map();
  }

  /**
   * Find log files in server directory
   */
  async findLogFiles(serverPath) {
    try {
      const logFiles = [];
      const profilesPath = path.join(serverPath, 'profiles');

      if (!await fs.pathExists(profilesPath)) {
        console.warn('Profiles directory does not exist:', profilesPath);
        return logFiles;
      }

      const profiles = await fs.readdir(profilesPath);
      
      for (const profile of profiles) {
        const profilePath = path.join(profilesPath, profile);
        let stats;
        try {
          stats = await fs.stat(profilePath);
        } catch (error) {
          console.warn(`Error reading profile ${profile}:`, error);
          continue;
        }
        
        if (stats.isDirectory()) {
          const logsPath = path.join(profilePath, 'logs');
          
          if (await fs.pathExists(logsPath)) {
            let logEntries;
            try {
              logEntries = await fs.readdir(logsPath);
            } catch (error) {
              console.warn(`Error reading logs directory for profile ${profile}:`, error);
              continue;
            }
            
            for (const entry of logEntries) {
              const entryPath = path.join(logsPath, entry);
              let entryStats;
              try {
                entryStats = await fs.stat(entryPath);
              } catch (error) {
                console.warn(`Error reading log file ${entry}:`, error);
                continue;
              }
              
              // DayZ log file extensions: .log, .txt, .ADM, .RPT
              const isLogFile = entryStats.isFile() && (
                entry.endsWith('.log') || 
                entry.endsWith('.txt') || 
                entry.endsWith('.ADM') || 
                entry.endsWith('.RPT') ||
                entry.endsWith('.adm') ||
                entry.endsWith('.rpt')
              );
              
              if (isLogFile) {
                logFiles.push({
                  path: entryPath,
                  name: entry,
                  profile: profile,
                  size: entryStats.size,
                  modified: entryStats.mtime
                });
              }
            }
          }
        }
      }

      // Sort by modified date (newest first)
      logFiles.sort((a, b) => b.modified - a.modified);

      return logFiles;
    } catch (error) {
      console.error('Error finding log files:', error);
      return [];
    }
  }

  /**
   * Read last N lines from log file
   */
  async readLogFile(logPath, lines = 100) {
    try {
      if (!await fs.pathExists(logPath)) {
        return { success: false, error: 'Log file does not exist' };
      }

      const content = await readLastLines.read(logPath, lines);
      const logEntries = this.parseLogEntries(content);

      return {
        success: true,
        entries: logEntries,
        totalLines: content.split('\n').length
      };
    } catch (error) {
      throw new Error(`Failed to read log file: ${error.message}`);
    }
  }

  /**
   * Parse log entries from content
   */
  parseLogEntries(content) {
    const lines = content.split('\n').filter(line => line.trim());
    return lines.map(line => this.parseLogEntry(line));
  }

  /**
   * Parse single log entry
   */
  parseLogEntry(line) {
    const entry = {
      raw: line,
      timestamp: null,
      level: 'Info',
      message: line
    };

    // Try to parse timestamp formats:
    // [YYYY-MM-DD HH:MM:SS] - Standard format
    // [HH:MM:SS] - Time only
    // [YYYY-MM-DD HH:MM:SS.mmm] - With milliseconds
    let timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]/);
    if (!timestampMatch) {
      timestampMatch = line.match(/\[(\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]/);
    }
    
    if (timestampMatch) {
      entry.timestamp = timestampMatch[1];
      entry.message = line.replace(timestampMatch[0], '').trim();
    }

    // Try to detect log level and DayZ-specific patterns
    const upperLine = line.toUpperCase();
    
    // Error patterns
    if (upperLine.includes('[ERROR]') || upperLine.includes('[ERR]') || 
        upperLine.includes('ERROR:') || upperLine.includes('EXCEPTION') ||
        upperLine.includes('CRASH') || upperLine.includes('FATAL')) {
      entry.level = 'Error';
    } 
    // Warning patterns
    else if (upperLine.includes('[WARNING]') || upperLine.includes('[WARN]') ||
             upperLine.includes('WARNING:') || upperLine.includes('WARN:')) {
      entry.level = 'Warning';
    } 
    // Debug patterns
    else if (upperLine.includes('[DEBUG]') || upperLine.includes('DEBUG:')) {
      entry.level = 'Debug';
    } 
    // Info patterns (including ADMIN logs)
    else if (upperLine.includes('[INFO]') || upperLine.includes('[ADMIN]') ||
             upperLine.includes('INFO:') || upperLine.includes('ADMIN:')) {
      entry.level = 'Info';
    }
    // DayZ-specific: Admin actions
    else if (upperLine.includes('ADMIN LOG') || upperLine.includes('PLAYER') && upperLine.includes('CONNECTED')) {
      entry.level = 'Info';
    }

    return entry;
  }

  /**
   * Start tailing a log file
   */
  async tailLogFile(logPath, callback) {
    if (this.watchers.has(logPath)) {
      // Already watching this file, just read new lines
      await this.readNewLines(logPath, callback);
      return;
    }

    try {
      // Get current file size to start reading from the end
      let initialPosition = 0;
      if (await fs.pathExists(logPath)) {
        const stats = await fs.stat(logPath);
        initialPosition = stats.size;
      }
      
      // Initialize file position to end of file (only read new lines)
      this.filePositions.set(logPath, initialPosition);

      // Watch file for changes
      const watcher = chokidar.watch(logPath, {
        persistent: true,
        ignoreInitial: true, // Don't read initial content, only new changes
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100
        },
        usePolling: true, // More reliable for log files
        interval: 1000,
        binaryInterval: 1000
      });

      watcher.on('change', async () => {
        await this.readNewLines(logPath, callback);
      });

      // Handle file deletion/recreation (log rotation)
      watcher.on('unlink', () => {
        console.log('Log file deleted, resetting position');
        this.filePositions.set(logPath, 0);
      });

      watcher.on('add', async () => {
        // File was recreated (log rotation)
        const stats = await fs.stat(logPath);
        this.filePositions.set(logPath, stats.size);
      });

      this.watchers.set(logPath, watcher);
    } catch (error) {
      console.error('Error starting log tail:', error);
      throw new Error(`Failed to start log tailing: ${error.message}`);
    }
  }

  /**
   * Read new lines from file
   */
  async readNewLines(logPath, callback) {
    try {
      if (!await fs.pathExists(logPath)) {
        console.warn('Log file does not exist:', logPath);
        return;
      }

    const stats = await fs.stat(logPath);
    const currentPosition = this.filePositions.get(logPath) || 0;

    // Handle file rotation (new file is smaller than last position)
    if (stats.size < currentPosition) {
      console.log('Log file rotated, resetting position');
      this.filePositions.set(logPath, 0);
      return;
    }

    if (stats.size > currentPosition) {
      return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(logPath, {
          start: currentPosition,
          encoding: 'utf-8'
        });

        let buffer = '';
        let newPosition = currentPosition;
        
        stream.on('data', (chunk) => {
          newPosition += Buffer.byteLength(chunk, 'utf-8');
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          lines.forEach(line => {
            if (line.trim()) {
              const entry = this.parseLogEntry(line);
              if (callback) {
                try {
                  callback(entry);
                } catch (error) {
                  console.error('Error in log callback:', error);
                }
              }
            }
          });
        });

        stream.on('end', () => {
          // Update position to end of file
          this.filePositions.set(logPath, stats.size);
          resolve();
        });

        stream.on('error', (error) => {
          console.error('Error reading log file:', error);
          reject(error);
        });
      });
    }
    } catch (error) {
      console.error('Error reading new lines:', error);
      // Don't throw, just log - file might be temporarily unavailable
    }
  }

  /**
   * Stop tailing a log file
   */
  stopTailing(logPath) {
    const watcher = this.watchers.get(logPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(logPath);
      this.filePositions.delete(logPath);
      return true;
    }
    return false;
  }

  /**
   * Stop all tailing
   */
  stopAllTailing() {
    for (const [logPath, watcher] of this.watchers.entries()) {
      watcher.close();
    }
    this.watchers.clear();
    this.filePositions.clear();
  }

  /**
   * Filter logs by level and search term
   */
  filterLogs(logs, level = null, search = null) {
    return logs.filter(entry => {
      if (level && entry.level !== level) {
        return false;
      }
      if (search && !entry.message.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  /**
   * Export logs to file
   */
  async exportLogs(logPath, outputPath, filter = null) {
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      let lines = content.split('\n');

      if (filter && (filter.level || filter.search)) {
        const entries = this.parseLogEntries(content);
        const filtered = this.filterLogs(entries, filter.level || null, filter.search || null);
        lines = filtered.map(entry => entry.raw);
      }

      await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
      return { success: true, path: outputPath };
    } catch (error) {
      throw new Error(`Failed to export logs: ${error.message}`);
    }
  }
}

module.exports = new LogViewer();

