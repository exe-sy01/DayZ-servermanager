/**
 * Sidebar progress bar manager
 */
class SidebarProgress {
    constructor() {
        // Progress bar is now in top bar, but ID remains the same
        this.progressElement = document.getElementById('sidebar-progress');
        this.progressFill = document.getElementById('sidebar-progress-fill');
        this.progressText = document.getElementById('sidebar-progress-text');
        this.progressTitle = document.getElementById('sidebar-progress-title');
        this.progressClose = document.getElementById('sidebar-progress-close');
        this.progressQueueInfo = document.getElementById('progress-queue-info');
        this.progressQueueText = document.getElementById('progress-queue-text');
        
        this.currentProgress = 0;
        this.isVisible = false;
        this.queueStatus = null;
        
        this.init();
    }

    init() {
        if (this.progressClose) {
            this.progressClose.addEventListener('click', () => {
                this.hide();
            });
        }

        // Listen for queue updates
        if (window.electronAPI) {
            window.electronAPI.onModQueueUpdate((status) => {
                this.queueStatus = status;
                this.updateQueueInfo();
            });
        }
    }

    updateQueueInfo() {
        if (!this.progressQueueInfo || !this.progressQueueText) {
            return;
        }

        if (this.queueStatus && this.queueStatus.total > 0) {
            const pending = this.queueStatus.pending || 0;
            const downloading = this.queueStatus.downloading || 0;
            const completed = this.queueStatus.completed || 0;
            const failed = this.queueStatus.failed || 0;
            
            let queueText = `Queue: ${pending} pending`;
            if (downloading > 0) {
                queueText += `, ${downloading} downloading`;
            }
            if (completed > 0) {
                queueText += `, ${completed} completed`;
            }
            if (failed > 0) {
                queueText += `, ${failed} failed`;
            }
            
            this.progressQueueText.textContent = queueText;
            this.progressQueueInfo.style.display = 'block';
            
            // Show progress bar if there are pending or downloading items
            if (pending > 0 || downloading > 0) {
                this.show();
            }
        } else {
            this.progressQueueInfo.style.display = 'none';
        }
    }

    show() {
        if (this.progressElement && !this.isVisible) {
            this.progressElement.style.display = 'block';
            this.isVisible = true;
            // Add class to main content to adjust padding
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.classList.add('with-progress');
            }
        }
    }

    hide() {
        if (this.progressElement && this.isVisible) {
            this.progressElement.style.display = 'none';
            this.isVisible = false;
            this.currentProgress = 0;
            // Remove class from main content
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.classList.remove('with-progress');
            }
        }
    }

    updateProgress(title, data) {
        if (!this.progressElement || !this.progressFill || !this.progressText) {
            return;
        }

        // Show progress bar
        this.show();

        // Update title
        if (this.progressTitle && title) {
            this.progressTitle.textContent = title;
        }

        // Update progress percentage
        let progress = 0;
        if (data.progress !== undefined) {
            progress = Math.max(0, Math.min(100, data.progress));
        } else if (data.percent !== undefined) {
            progress = Math.max(0, Math.min(100, data.percent));
        } else if (data.current !== undefined && data.total !== undefined && data.total > 0) {
            progress = Math.max(0, Math.min(100, (data.current / data.total) * 100));
        }

        this.currentProgress = progress;

        // Update progress bar fill
        if (this.progressFill) {
            this.progressFill.style.width = `${progress}%`;
        }

        // Update progress text
        if (this.progressText) {
            if (data.message) {
                this.progressText.textContent = data.message;
            } else if (data.current !== undefined && data.total !== undefined) {
                this.progressText.textContent = `${data.current}/${data.total} (${Math.round(progress)}%)`;
            } else {
                this.progressText.textContent = `${Math.round(progress)}%`;
            }
        }

        // Update queue info if available
        this.updateQueueInfo();

        // Auto-hide when complete (only if queue is empty)
        if (progress >= 100) {
            setTimeout(() => {
                // Check if queue has pending items
                if (!this.queueStatus || this.queueStatus.pending === 0) {
                    this.hide();
                }
            }, 2000); // Hide after 2 seconds
        }
    }
}

// Initialize when DOM is ready
function initializeSidebarProgress() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof window.electronAPI !== 'undefined') {
                window.sidebarProgress = new SidebarProgress();
            }
        });
    } else {
        if (typeof window.electronAPI !== 'undefined') {
            window.sidebarProgress = new SidebarProgress();
        } else {
            // Wait for electronAPI
            const checkAPI = setInterval(() => {
                if (typeof window.electronAPI !== 'undefined') {
                    window.sidebarProgress = new SidebarProgress();
                    clearInterval(checkAPI);
                }
            }, 100);
        }
    }
}

initializeSidebarProgress();

