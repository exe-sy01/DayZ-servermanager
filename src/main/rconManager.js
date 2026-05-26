const dgram = require('dgram');

/**
 * CRC32 lookup table for BattlEye RCON protocol
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * DayZ RCON Manager - BattlEye RCON Protocol v2
 * DayZ uses BattlEye RCON over UDP on the game port (or RConPort if set in BEServer config).
 * Protocol spec: https://www.battleye.com/downloads/BERConProtocol.txt
 */
class RCONManager {
  constructor() {
    this.socket = null;
    this.host = '127.0.0.1';
    this.port = 2302;
    this.password = '';
    this.isConnected = false;
    this.commandSequence = 0;
    this.serverMessageSequence = 0;
    this.pendingCommands = new Map();
    this.keepaliveInterval = null;
    this.KEEPALIVE_MS = 40000; // Send keepalive every 40s (protocol requires < 45s)
  }

  /**
   * Build BattlEye packet: 'B'|'E'|CRC32(payload)|0xFF|payload
   */
  buildPacket(payload) {
    const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const crc = crc32(payloadBuf);
    const header = Buffer.allocUnsafe(7);
    header[0] = 0x42; // 'B'
    header[1] = 0x45; // 'E'
    header.writeUInt32LE(crc, 2);
    header[6] = 0xFF;
    return Buffer.concat([header, payloadBuf]);
  }

  /**
   * Parse BattlEye packet, verify CRC, return payload or null
   */
  parsePacket(msg) {
    if (msg.length < 8) return null;
    if (msg[0] !== 0x42 || msg[1] !== 0x45 || msg[6] !== 0xFF) return null;

    const payload = msg.slice(7);
    const receivedCrc = msg.readUInt32LE(2);
    const computedCrc = crc32(payload);
    if (receivedCrc !== computedCrc) return null;

    return payload;
  }

  /**
   * Connect to RCON server
   */
  async connect(host, port, password) {
    return new Promise((resolve, reject) => {
      try {
        this.host = host || '127.0.0.1';
        this.port = parseInt(port, 10) || 2302;
        this.password = (password || '').toString();

        if (this.isConnected) {
          this.disconnect();
        }

        this.socket = dgram.createSocket('udp4');

        this.socket.on('message', (msg) => {
          this.handleMessage(msg);
        });

        this.socket.on('error', (error) => {
          console.error('RCON socket error:', error);
          this.isConnected = false;
          this.stopKeepalive();
          for (const [, { reject: rej }] of this.pendingCommands.entries()) {
            rej(new Error('RCON connection error'));
          }
          this.pendingCommands.clear();
        });

        this.socket.on('close', () => {
          this.isConnected = false;
          this.stopKeepalive();
          console.log('RCON socket closed');
        });

        this.socket.bind(() => {
          this.authenticate()
            .then(() => {
              this.isConnected = true;
              this.startKeepalive();
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
   * BattlEye login: payload = 0x00 | password (ASCII, no null)
   */
  async authenticate() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete('login');
        reject(new Error('RCON authentication timeout'));
      }, 5000);

      const payload = Buffer.allocUnsafe(1 + this.password.length);
      payload[0] = 0x00;
      Buffer.from(this.password, 'ascii').copy(payload, 1);

      this.pendingCommands.set('login', {
        resolve: (payload) => {
          clearTimeout(timeout);
          if (payload.length >= 2 && payload[0] === 0x00 && payload[1] === 0x01) {
            resolve();
          } else {
            reject(new Error('RCON authentication failed'));
          }
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });

      this.sendRaw(payload);
    });
  }

  /**
   * Send raw packet (no response expected for keepalive)
   */
  sendRaw(payload) {
    if (!this.socket) return;
    const packet = this.buildPacket(payload);
    this.socket.send(packet, 0, packet.length, this.port, this.host, (err) => {
      if (err) console.error('RCON send error:', err);
    });
  }

  /**
   * Start keepalive timer (empty command packet every 40s)
   */
  startKeepalive() {
    this.stopKeepalive();
    this.keepaliveInterval = setInterval(() => {
      if (!this.isConnected || !this.socket) return;
      const seq = this.commandSequence % 256;
      this.commandSequence++;
      const payload = Buffer.from([0x01, seq]); // Empty command
      this.sendRaw(payload);
    }, this.KEEPALIVE_MS);
  }

  stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  /**
   * Send command - BattlEye format: 0x01 | sequence | command (ASCII)
   */
  async sendCommand(command) {
    if (!this.isConnected || !this.socket) {
      throw new Error('Not connected to RCON server');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(seq);
        reject(new Error('RCON command timeout'));
      }, 10000);

      const seq = this.commandSequence % 256;
      this.commandSequence++;

      const cmdBuf = Buffer.from(String(command), 'ascii');
      const payload = Buffer.allocUnsafe(2 + cmdBuf.length);
      payload[0] = 0x01;
      payload[1] = seq;
      cmdBuf.copy(payload, 2);

      this.pendingCommands.set(seq, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response || '');
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });

      this.sendRaw(payload);
    });
  }

  /**
   * Handle incoming BattlEye packet
   */
  handleMessage(msg) {
    const payload = this.parsePacket(msg);
    if (!payload || payload.length < 1) return;

    const type = payload[0];

    if (type === 0x00) {
      // Login response
      const pending = this.pendingCommands.get('login');
      if (pending) {
        this.pendingCommands.delete('login');
        pending.resolve(payload);
      }
    } else if (type === 0x01) {
      // Command response: 0x01 | seq | [multi-packet header] | response
      if (payload.length < 2) return;
      const seq = payload[1];

      // Multi-packet header (optional): 0x00 | total | index
      let response = '';
      let offset = 2;
      if (payload.length >= 4 && payload[2] === 0x00) {
        offset = 4; // Skip multi-packet header for now
      }
      if (offset < payload.length) {
        response = payload.slice(offset).toString('utf-8').trim();
      }

      const pending = this.pendingCommands.get(seq);
      if (pending) {
        this.pendingCommands.delete(seq);
        pending.resolve(response);
      }
    } else if (type === 0x02) {
      // Server message - must acknowledge
      if (payload.length >= 2) {
        const seq = payload[1];
        this.serverMessageSequence = seq;
        const ack = Buffer.from([0x02, seq]);
        this.sendRaw(ack);
        const message = payload.length > 2 ? payload.slice(2).toString('utf-8') : '';
        if (message) console.log('RCON server message:', message);
      }
    }
  }

  disconnect() {
    this.stopKeepalive();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
    this.pendingCommands.clear();
  }

  getStatus() {
    return {
      connected: this.isConnected,
      host: this.host,
      port: this.port,
      hasPassword: !!this.password
    };
  }

  async kickPlayer(playerName) {
    return await this.sendCommand(`kick ${playerName}`);
  }

  async banPlayer(playerName) {
    return await this.sendCommand(`ban ${playerName}`);
  }

  async sayMessage(message) {
    return await this.sendCommand(`say ${message}`);
  }

  async getPlayers() {
    const response = await this.sendCommand('players');
    return this.parsePlayersList(response);
  }

  async shutdown() {
    return await this.sendCommand('shutdown');
  }

  async restart() {
    return await this.sendCommand('restart');
  }

  parsePlayersList(response) {
    const players = [];
    if (!response) return players;

    const lines = response.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.toLowerCase().startsWith('players:')) {
        continue;
      }

      const idMatch = trimmed.match(/ID:\s*(\d+)/i);
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
