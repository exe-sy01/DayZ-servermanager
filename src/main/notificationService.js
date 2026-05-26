const EventEmitter = require('events');
const { app, Notification } = require('electron');

/**
 * Notification service - manages in-app notifications and desktop notifications
 */
class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.notifications = [];
    this.maxNotifications = 100;
  }

  add(type, title, message, data = {}) {
    const notification = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      type,
      title,
      message,
      data,
      timestamp: new Date().toISOString(),
      read: false
    };
    this.notifications.unshift(notification);
    if (this.notifications.length > this.maxNotifications) {
      this.notifications.pop();
    }
    this.emit('notification', notification);

    if (app.isReady() && Notification.isSupported()) {
      try {
        const n = new Notification({
          title: title,
          body: message,
          silent: true
        });
        n.show();
      } catch (e) {
        // Ignore desktop notification errors
      }
    }

    return notification;
  }

  addPlayerJoin(playerName) {
    return this.add('player_join', 'Player Joined', `${playerName} joined the server`, { playerName });
  }

  addPlayerLeave(playerName) {
    return this.add('player_leave', 'Player Left', `${playerName} left the server`, { playerName });
  }

  addModUpdate(modName) {
    return this.add('mod_update', 'Mod Update', `${modName} has an update available`, { modName });
  }

  addServerUpdate(version) {
    return this.add('server_update', 'Server Update', `DayZ server update available: ${version}`, { version });
  }

  getNotifications() {
    return [...this.notifications];
  }

  markRead(id) {
    const n = this.notifications.find(n => n.id === id);
    if (n) n.read = true;
  }

  markAllRead() {
    this.notifications.forEach(n => n.read = true);
  }

  clear() {
    this.notifications = [];
    this.emit('cleared');
  }
}

module.exports = new NotificationService();
