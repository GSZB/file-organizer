import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import { collectFiles } from './utils.js';

export function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    this.emit('search-start', { directory });

    const files = await collectFiles(directory, {
      onError: (error, dirPath) => this.emit('file-error', { path: dirPath, error }),
    });

    // Files with different sizes can't have the same content,
    // so only files whose size matches at least one other file are hashed
    const bySize = new Map();
    for (const filePath of files) {
      try {
        const { size } = await fsp.stat(filePath);
        if (size === 0) continue;

        if (!bySize.has(size)) bySize.set(size, []);
        bySize.get(size).push(filePath);
      } catch (error) {
        this.emit('file-error', { path: filePath, error });
      }
    }

    const candidates = [];
    for (const [size, paths] of bySize) {
      if (paths.length > 1) {
        paths.forEach((filePath) => candidates.push({ path: filePath, size }));
      }
    }

    this.emit('hashing-start', { totalFiles: files.length, toHash: candidates.length });

    const byHash = new Map(); // hash -> Array<filePath>
    const sizes = new Map(); // hash -> size of one copy

    for (const [index, file] of candidates.entries()) {
      const progress = { processed: index + 1, total: candidates.length };

      try {
        const hash = await calculateHash(file.path);
        if (!byHash.has(hash)) byHash.set(hash, []);
        byHash.get(hash).push(file.path);
        sizes.set(hash, file.size);
        this.emit('file-processed', { path: file.path, hash, ...progress });
      } catch (error) {
        this.emit('file-error', { path: file.path, error });
        this.emit('file-processed', { path: file.path, hash: null, ...progress });
      }
    }

    const groups = [];
    for (const [hash, filePaths] of byHash) {
      if (filePaths.length > 1) {
        const size = sizes.get(hash);
        groups.push({ hash, size, paths: filePaths, wasted: size * (filePaths.length - 1) });
      }
    }
    groups.sort((a, b) => b.wasted - a.wasted);

    const result = {
      directory,
      groups,
      totalWasted: groups.reduce((sum, group) => sum + group.wasted, 0),
    };

    this.emit('duplicates-found', result);
    return result;
  }
}
