import { EventEmitter } from 'events';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { collectFiles, LARGE_FILE_SIZE } from './utils.js';

export const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

export function getCategory(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  for (const [category, extensions] of Object.entries(categories)) {
    if (extensions.includes(extension)) return category;
  }
  return 'Other';
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// file.pdf -> file(1).pdf -> file(2).pdf ...
export async function getAvailablePath(targetPath) {
  if (!(await fileExists(targetPath))) return targetPath;

  const { dir, name, ext } = path.parse(targetPath);
  let counter = 1;
  let candidate;

  do {
    candidate = path.join(dir, `${name}(${counter})${ext}`);
    counter++;
  } while (await fileExists(candidate));

  return candidate;
}

async function copyWithStreams(sourcePath, targetPath) {
  try {
    await pipeline(createReadStream(sourcePath), createWriteStream(targetPath, { flags: 'wx' }));
  } catch (error) {
    // don't leave a half-written file behind
    if (error.code !== 'EEXIST') await fs.rm(targetPath, { force: true }).catch(() => {});
    throw error;
  }
}

export class Organizer extends EventEmitter {
  async organize(source, target) {
    this.emit('organize-start', { source, target });

    // the target may be inside the source, its files must not be copied again
    const files = await collectFiles(source, {
      exclude: [target],
      onError: (error, dirPath) => this.emit('copy-error', { source: dirPath, error }),
    });

    for (const category of Object.keys(categories)) {
      const folderPath = path.join(target, category);
      await fs.mkdir(folderPath, { recursive: true });
      this.emit('folder-created', { category, path: folderPath });
    }

    const summary = {
      target,
      categories: Object.fromEntries(Object.keys(categories).map((category) => [category, 0])),
      copied: 0,
      totalSize: 0,
      renamed: 0,
      streamed: 0,
      failed: 0,
    };

    for (const [index, sourcePath] of files.entries()) {
      const progress = { processed: index + 1, total: files.length };
      const category = getCategory(sourcePath);

      try {
        const stats = await fs.stat(sourcePath);
        const wantedPath = path.join(target, category, path.basename(sourcePath));
        const targetPath = await getAvailablePath(wantedPath);
        const useStreams = stats.size >= LARGE_FILE_SIZE;

        this.emit('copy-start', { source: sourcePath, target: targetPath, category, size: stats.size, useStreams });

        if (useStreams) {
          await copyWithStreams(sourcePath, targetPath);
        } else {
          await fs.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
        }

        try {
          await fs.utimes(targetPath, stats.atime, stats.mtime);
        } catch {
          // keeping the original modification date is nice to have, the copy itself is already done
        }

        summary.categories[category]++;
        summary.copied++;
        summary.totalSize += stats.size;
        if (targetPath !== wantedPath) summary.renamed++;
        if (useStreams) summary.streamed++;

        this.emit('copy-complete', { source: sourcePath, target: targetPath, category, size: stats.size, ...progress });
      } catch (error) {
        summary.failed++;
        this.emit('copy-error', { source: sourcePath, error, ...progress });
      }
    }

    this.emit('organize-complete', summary);
    return summary;
  }
}
