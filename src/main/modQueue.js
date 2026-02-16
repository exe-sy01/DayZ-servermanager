const EventEmitter = require('events');

/**
 * Mod download queue manager
 */
class ModQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.isProcessing = false;
    this.currentItem = null;
    this.serverPath = null;
  }

  /**
   * Add mod to queue
   */
  addToQueue(workshopId, isCollection = false, name = null) {
    const item = {
      id: Date.now() + Math.random(), // Unique ID
      workshopId,
      isCollection,
      name: name || `Mod ${workshopId}`,
      status: 'pending', // pending, downloading, completed, failed
      progress: 0,
      error: null,
      addedAt: new Date()
    };

    this.queue.push(item);
    this.emit('queue-updated', this.getQueueStatus());
    
    // Auto-start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }

    return item.id;
  }

  /**
   * Add collection to queue (expands to individual mods)
   */
  async addCollectionToQueue(collectionId, collectionName = null) {
    try {
      const workshopManager = require('./workshopManager');
      const collection = await workshopManager.getCollectionDetails(collectionId);
      
      if (!collection.modIds || collection.modIds.length === 0) {
        throw new Error('Collection is empty or mods could not be extracted');
      }

      const collectionItem = {
        id: Date.now() + Math.random(),
        collectionId,
        isCollection: true,
        name: collectionName || collection.name || `Collection ${collectionId}`,
        modIds: collection.modIds,
        modCount: collection.modIds.length,
        status: 'pending',
        progress: 0,
        addedAt: new Date()
      };

      this.queue.push(collectionItem);
      this.emit('queue-updated', this.getQueueStatus());
      
      if (!this.isProcessing) {
        this.processQueue();
      }

      return collectionItem.id;
    } catch (error) {
      throw new Error(`Failed to add collection to queue: ${error.message}`);
    }
  }

  /**
   * Remove item from queue
   */
  removeFromQueue(itemId) {
    const index = this.queue.findIndex(item => item.id === itemId);
    if (index !== -1) {
      const item = this.queue[index];
      // Can't remove if currently downloading
      if (item.status === 'downloading') {
        throw new Error('Cannot remove item that is currently downloading');
      }
      this.queue.splice(index, 1);
      this.emit('queue-updated', this.getQueueStatus());
      return true;
    }
    return false;
  }

  /**
   * Clear completed items from queue
   */
  clearCompleted() {
    const before = this.queue.length;
    this.queue = this.queue.filter(item => 
      item.status !== 'completed' && item.status !== 'failed'
    );
    const removed = before - this.queue.length;
    if (removed > 0) {
      this.emit('queue-updated', this.getQueueStatus());
    }
    return removed;
  }

  /**
   * Clear all items from queue
   */
  clearAll() {
    if (this.isProcessing) {
      throw new Error('Cannot clear queue while processing');
    }
    this.queue = [];
    this.emit('queue-updated', this.getQueueStatus());
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      total: this.queue.length,
      pending: this.queue.filter(item => item.status === 'pending').length,
      downloading: this.queue.filter(item => item.status === 'downloading').length,
      completed: this.queue.filter(item => item.status === 'completed').length,
      failed: this.queue.filter(item => item.status === 'failed').length,
      currentItem: this.currentItem,
      isProcessing: this.isProcessing,
      queue: this.queue.map(item => ({
        id: item.id,
        workshopId: item.workshopId || item.collectionId,
        isCollection: item.isCollection,
        name: item.name,
        status: item.status,
        progress: item.progress,
        error: item.error
      }))
    };
  }

  /**
   * Set server path
   */
  setServerPath(path) {
    this.serverPath = path;
  }

  /**
   * Process queue
   */
  async processQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.find(i => i.status === 'pending');
      
      if (!item) {
        // No pending items, check if any are still downloading
        const downloading = this.queue.find(i => i.status === 'downloading');
        if (!downloading) {
          break; // All done
        }
        // Wait a bit and check again
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      this.currentItem = item;
      item.status = 'downloading';
      this.emit('queue-updated', this.getQueueStatus());
      this.emit('item-started', item);

      try {
        const workshopManager = require('./workshopManager');
        const config = require('./config');

        if (!this.serverPath) {
          throw new Error('Server path not set');
        }

        if (item.isCollection && item.modIds) {
          // Process collection
          const total = item.modIds.length;
          let successCount = 0;
          let failCount = 0;

          for (let i = 0; i < item.modIds.length; i++) {
            const modId = item.modIds[i];
            item.progress = Math.round(((i + 1) / total) * 100);
            this.emit('queue-updated', this.getQueueStatus());
            this.emit('item-progress', { item, progress: item.progress });

            try {
              const result = await workshopManager.downloadMod(modId, this.serverPath, (progress) => {
                // Calculate overall progress for collection
                const modProgress = progress.progress || 0;
                const overallProgress = Math.round((i / total) * 100 + (modProgress / total));
                item.progress = overallProgress;
                this.emit('item-progress', { item, progress: item.progress });
              });

              if (result.success) {
                successCount++;
                // Add to config
                try {
                  const modDetails = await workshopManager.getModDetails(modId);
                  if (modDetails && modDetails.name) {
                    await config.addMod(modId, modDetails.name);
                  } else {
                    await config.addMod(modId, `Mod ${modId}`);
                  }
                } catch (error) {
                  console.warn(`Could not get details for mod ${modId}:`, error);
                  await config.addMod(modId, `Mod ${modId}`);
                }
              } else {
                failCount++;
              }
            } catch (error) {
              console.error(`Error downloading mod ${modId}:`, error);
              failCount++;
            }
          }

          item.progress = 100;
          if (failCount === 0) {
            item.status = 'completed';
          } else {
            item.status = failCount === total ? 'failed' : 'completed';
            item.error = `${successCount} succeeded, ${failCount} failed`;
          }
        } else {
          // Process single mod
          const result = await workshopManager.downloadMod(item.workshopId, this.serverPath, (progress) => {
            item.progress = progress.progress || 0;
            this.emit('item-progress', { item, progress: item.progress });
          });

          if (result.success) {
            item.progress = 100;
            item.status = 'completed';
            
            // Add to config
            try {
              const modDetails = await workshopManager.getModDetails(item.workshopId);
              if (modDetails && modDetails.name) {
                await config.addMod(item.workshopId, modDetails.name);
              } else {
                await config.addMod(item.workshopId, `Mod ${item.workshopId}`);
              }
            } catch (error) {
              console.warn(`Could not get details for mod ${item.workshopId}:`, error);
              await config.addMod(item.workshopId, `Mod ${item.workshopId}`);
            }
          } else {
            item.status = 'failed';
            item.error = result.error || 'Download failed';
          }
        }

        this.emit('item-completed', item);
      } catch (error) {
        item.status = 'failed';
        item.error = error.message;
        this.emit('item-failed', item);
      }

      this.currentItem = null;
      this.emit('queue-updated', this.getQueueStatus());
    }

    this.isProcessing = false;
    this.emit('queue-completed');
  }
}

module.exports = new ModQueue();

