import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { collectFiles, getAgeInDays } from './utils.js';

export class Scanner extends EventEmitter {
  async scan(directory) {
    this.emit('scan-start', { directory });

    const files = await collectFiles(directory, {
      onError: (error, dirPath) => this.emit('scan-error', { path: dirPath, error }),
    });

    const statistics = {
      directory,
      totalFiles: 0,
      totalSize: 0,
      byType: new Map(),
      age: { last7Days: 0, last30Days: 0, olderThan90Days: 0 },
      largestFiles: [],
      oldestFile: null,
    };
    const scannedFiles = [];

    for (const [index, filePath] of files.entries()) {
      const progress = { processed: index + 1, total: files.length };

      try {
        const stats = await fs.stat(filePath);
        const fileData = {
          path: filePath,
          relativePath: path.relative(directory, filePath),
          extension: path.extname(filePath).toLowerCase() || '(no ext)',
          size: stats.size,
          mtime: stats.mtime,
        };

        this.addToStatistics(statistics, fileData);
        scannedFiles.push(fileData);
        this.emit('file-found', { ...fileData, ...progress });
      } catch (error) {
        this.emit('scan-error', { path: filePath, error, ...progress });
      }
    }

    statistics.largestFiles = [...scannedFiles].sort((a, b) => b.size - a.size).slice(0, 3);
    statistics.oldestFile = scannedFiles.reduce(
      (oldest, file) => (!oldest || file.mtime < oldest.mtime ? file : oldest),
      null,
    );

    this.emit('scan-complete', statistics);
    return statistics;
  }

  addToStatistics(statistics, fileData) {
    statistics.totalFiles++;
    statistics.totalSize += fileData.size;

    const type = statistics.byType.get(fileData.extension) ?? { count: 0, totalSize: 0 };
    type.count++;
    type.totalSize += fileData.size;
    statistics.byType.set(fileData.extension, type);

    const daysOld = getAgeInDays(fileData.mtime);
    if (daysOld <= 7) statistics.age.last7Days++;
    if (daysOld <= 30) statistics.age.last30Days++;
    if (daysOld > 90) statistics.age.olderThan90Days++;
  }
}
