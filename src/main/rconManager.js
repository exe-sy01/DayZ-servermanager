const dgram = require('dgram');
const crypto = require('crypto');

/**
 * DayZ RCON Manager
 * DayZ uses UDP-based RCON protocol
 */
class RCONManager {
  constructor() {
    this.socket = null;
    this.host = '127.0.0.1';
    this.port = 2302;
    this.password = '';
    this.isConnected = false;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
  }

  /**
   * Connect to RCON server
   */
  async connect(host, port, password) {
    return new Promise((resolve, reject) => {
      try {
        this.host = host || '127.0.0.1';
        this.port = port || 2302;
        this.password = password || '';

        if (this.isConnected) {
          this.disconnect();
        }

        // Create UDP socket
        this.socket = dgram.createSocket('udp4');

        // Handle incoming messages
        this.socket.on('message', (msg, rinfo) => {
          this.handleMessage(msg);
        });

        this.socket.on('error', (error) => {
          console.error('RCON socket error:', error);
          this.isConnected = false;
          if (this.pendingRequests.size > 0) {
            // Reject all pending requests
            for (const [id, { reject }] of this.pendingRequests.entries()) {
              reject(new Error('RCON connection error'));
            }
            this.pendingRequests.clear();
          }
        });

        this.socket.on('close', () => {
          this.isConnected = false;
          console.log('RCON socket closed');
        });

        // Bind socket
        this.socket.bind(() => {
          // Send authentication
          this.authenticate()
            .then(() => {
              this.isConnected = true;
              this.reconnectAttempts = 0;
              resolve({ success: true });
            })
            .catch((error) => {
              this.disconnect();
              reject(error);
            });
        });
      } catch (error) {
        reject(new Error(`Failed to connect to RCON: ${error.message}`));
      }
    });
  }

  /**
   * Authenticate with RCON server
   */
  async authenticate() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('RCON authentication timeout'));
      }, 5000);

      const requestId = this.getNextRequestId();
      
      // DayZ RCON authentication format: "BE" + password
      const authMessage = `BE${this.password}`;
      const buffer = Buffer.from(authMessage, 'utf-8');

      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeout);
          // Check if authentication was successful
          if (response && response.includes('OK')) {
            resolve();
          } else {
            reject(new Error('RCON authentication failed'));
          }
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      // Send authentication
      this.sendMessage(buffer, requestId);
    });
  }

  /**
   * Send command to RCON server
   */
  async sendCommand(command) {
    if (!this.isConnected || !this.socket) {
      throw new Error('Not connected to RCON server');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('RCON command timeout'));
      }, 10000);

      const requestId = this.getNextRequestId();
      const commandBuffer = Buffer.from(command, 'utf-8');

      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      this.sendMessage(commandBuffer, requestId);
    });
  }

  /**
   * Send message via UDP
   */
  sendMessage(buffer, requestId) {
    try {
      // DayZ RCON uses simple UDP packets
      // Format: [requestId (4 bytes)] + [message]
      const idBuffer = Buffer.allocUnsafe(4);
      idBuffer.writeUInt32BE(requestId, 0);
      const packet = Buffer.concat([idBuffer, buffer]);

      this.socket.send(packet, this.port, this.host, (error) => {
        if (error) {
          console.error('Error sending RCON packet:', error);
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            this.pendingRequests.delete(requestId);
            pending.reject(error);
          }
        }
      });
    } catch (error) {
      console.error('Error sending RCON message:', error);
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        this.pendingRequests.delete(requestId);
        pending.reject(error);
      }
    }
  }

  /**
   * Handle incoming UDP message
   */
  handleMessage(msg) {
    try {
      if (msg.length < 4) {
        return; // Invalid packet
      }

      const requestId = msg.readUInt32BE(0);
      const response = msg.slice(4).toString('utf-8').trim();

      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        this.pendingRequests.delete(requestId);
        pending.resolve(response);
      } else {
        // Unsolicited message (server broadcast, etc.)
        console.log('Unsolicited RCON message:', response);
      }
    } catch (error) {
      console.error('Error handling RCON message:', error);
    }
  }

  /**
   * Get next request ID
   */
  getNextRequestId() {
    this.requestId = (this.requestId + 1) % 0xFFFFFFFF;
    return this.requestId;
  }

  /**
   * Disconnect from RCON server
   */
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
    this.pendingRequests.clear();
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      host: this.host,
      port: this.port,
      hasPassword: !!this.password
    };
  }

  /**
   * Execute basic RCON commands
   */
  async kickPlayer(playerName) {
    return await this.sendCommand(`#kick ${playerName}`);
  }

  async banPlayer(playerName) {
    return await this.sendCommand(`#ban ${playerName}`);
  }

  async sayMessage(message) {
    return await this.sendCommand(`#say ${message}`);
  }

  async getPlayers() {
    const response = await this.sendCommand('#players');
    return this.parsePlayersList(response);
  }

  async shutdown() {
    return await this.sendCommand('#shutdown');
  }

  async restart() {
    return await this.sendCommand('#restart');
  }

  /**
   * Parse players list from RCON response
   */
  parsePlayersList(response) {
    const players = [];
    if (!response) return players;

    // DayZ players list format varies, try to parse common formats
    const lines = response.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('Players:')) {
        continue;
      }

      // Try to match player entries
      // Format examples:
      // "PlayerName (ID: 1234567890)"
      // "ID: 1234567890, PlayerName"
      const idMatch = trimmed.match(/ID:\s*(\d+)/);
      const nameMatch = trimmed.match(/([^(]+)/);

      if (idMatch || nameMatch) {
        players.push({
          name: nameMatch ? nameMatch[1].trim() : trimmed,
          id: idMatch ? idMatch[1] : null,
          raw: trimmed
        });
      }
    }

    return players;
  }
}

module.exports = new RCONManager();

