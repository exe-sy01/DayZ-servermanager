/**
 * Notification center UI
 */
class NotificationPanel {
    constructor() {
        this.trigger = document.getElementById('notification-trigger');
        this.panel = document.getElementById('notification-panel');
        this.list = document.getElementById('notification-list');
        this.countEl = document.getElementById('notification-count');
        this.clearBtn = document.getElementById('notification-clear');
        this.init();
    }

    init() {
        if (!this.trigger || !this.panel) return;

        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        document.addEventListener('click', (e) => {
            if (!this.panel.contains(e.target) && !this.trigger.contains(e.target)) {
                this.panel.style.display = 'none';
            }
        });

        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', async () => {
                if (window.electronAPI?.notificationsClear) {
                    await window.electronAPI.notificationsClear();
                }
                this.load();
            });
        }

        if (window.electronAPI?.onNotification) {
            window.electronAPI.onNotification(() => this.load());
        }

        this.load();
    }

    toggle() {
        const visible = this.panel.style.display !== 'none';
        this.panel.style.display = visible ? 'none' : 'block';
        if (!visible) this.load();
    }

    async load() {
        if (!window.electronAPI?.notificationsGet) return;
        try {
            const notifications = await window.electronAPI.notificationsGet();
            this.render(notifications || []);
        } catch (e) {
            this.render([]);
        }
    }

    render(notifications) {
        const unread = notifications.filter(n => !n.read);
        if (this.countEl) {
            this.countEl.textContent = unread.length;
            this.countEl.style.display = unread.length > 0 ? 'block' : 'none';
        }

        if (!this.list) return;

        if (notifications.length === 0) {
            this.list.innerHTML = '<div class="notification-empty">No notifications</div>';
            return;
        }

        const icons = {
            player_join: '&#128101;',
            player_leave: ' ',
            mod_update: '&#128296;',
            server_update: '&#128260;'
        };

        this.list.innerHTML = notifications.slice(0, 20).map(n => `
            <div class="notification-item ${n.read ? 'read' : ''}" data-id="${n.id}">
                <span class="notification-item-icon">${icons[n.type] || '&#128276;'}</span>
                <div class="notification-item-content">
                    <div class="notification-item-title">${this.escape(n.title)}</div>
                    <div class="notification-item-message">${this.escape(n.message)}</div>
                    <div class="notification-item-time">${this.formatTime(n.timestamp)}</div>
                </div>
            </div>
        `).join('');

        this.list.querySelectorAll('.notification-item').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.id;
                if (window.electronAPI?.notificationsMarkRead) {
                    window.electronAPI.notificationsMarkRead(id);
                }
                el.classList.add('read');
                const unread = this.list.querySelectorAll('.notification-item:not(.read)').length;
                if (this.countEl) {
                    this.countEl.textContent = unread;
                    this.countEl.style.display = unread > 0 ? 'block' : 'none';
                }
            });
        });
    }

    escape(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    formatTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return d.toLocaleDateString();
    }
}
