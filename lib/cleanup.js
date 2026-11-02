import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { collectFiles, getAgeInDays } from './utils.js';

export class Cleanup extends EventEmitter {
  async run(directory, { olderThan, confirm = false }) {
    this.emit('cleanup-start', { directory, olderThan, confirm });

    const oldFiles = await this.findOldFiles(directory, olderThan);
    const totalSize = oldFiles.reduce((sum, file) => sum + file.size, 0);
    this.emit('search-complete', { files: oldFiles, totalSize });

    const result = { found: oldFiles.length, totalSize, deleted: 0, freed: 0, failed: 0, dryRun: !confirm };

    if (confirm && oldFiles.length > 0) {
      this.emit('delete-start', { count: oldFiles.length, totalSize });

      for (const [index, file] of oldFiles.entries()) {
        const progress = { processed: index + 1, total: oldFiles.length };

        try {
          await fs.unlink(file.path);
          result.deleted++;
          result.freed += file.size;
          this.emit('file-deleted', { ...file, ...progress });
        } catch (error) {
          result.failed++;
          this.emit('delete-error', { ...file, error, ...progress });
        }
      }
    }

    this.emit('cleanup-complete', result);
    return result;
  }

  async findOldFiles(directory, olderThan) {
    const files = await collectFiles(directory, {
      onError: (error, dirPath) => this.emit('cleanup-error', { path: dirPath, error }),
    });
    const oldFiles = [];

    for (const filePath of files) {
      try {
        const stats = await fs.stat(filePath);
        const daysOld = getAgeInDays(stats.mtime);

        if (daysOld > olderThan) {
          const fileData = {
            path: filePath,
            relativePath: path.relative(directory, filePath),
            size: stats.size,
            mtime: stats.mtime,
            daysOld: Math.floor(daysOld),
          };
          oldFiles.push(fileData);
          this.emit('file-found', fileData);
        }
      } catch (error) {
        this.emit('cleanup-error', { path: filePath, error });
      }
    }

    // the oldest files first
    return oldFiles.sort((a, b) => a.mtime - b.mtime);
  }
}
