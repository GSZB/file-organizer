import fs from 'fs/promises';
import path from 'path';

export const LARGE_FILE_SIZE = 10 * 1024 * 1024;

const MS_IN_DAY = 1000 * 60 * 60 * 24;

const ERROR_MESSAGES = {
  ENOENT: 'File or directory not found',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Expected a file but got a directory',
  EEXIST: 'File already exists',
  ENOSPC: 'No space left on device',
  EMFILE: 'Too many open files',
  EBUSY: 'File is busy or locked',
  EROFS: 'Read-only file system',
  ENAMETOOLONG: 'File name is too long',
};

export function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

export function formatDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function getAgeInDays(mtime) {
  return (Date.now() - mtime.getTime()) / MS_IN_DAY;
}

export function drawProgressBar(current, total, width = 20) {
  const percentage = total > 0 ? current / total : 1;
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

// In a terminal the bar is redrawn on the same line,
// when the output is redirected to a file only the final state is printed
export function printProgress(label, current, total, suffix = '') {
  const line = `${label} ${drawProgressBar(current, total)}${suffix ? ` ${suffix}` : ''}`;

  if (process.stdout.isTTY) {
    process.stdout.write(`\r${line}`);
    if (current === total) process.stdout.write('\n');
  } else if (current === total) {
    console.log(line);
  }
}

export function formatError(error, target = error.path) {
  const message = ERROR_MESSAGES[error.code];
  return message ? `Error: ${message}: ${target}` : `Unexpected error: ${error.message}`;
}

// Recursively collects paths of all regular files (symlinks are skipped).
// If a subdirectory can't be read it is reported through onError and skipped,
// an error on the root directory is thrown to the caller.
export async function collectFiles(root, { exclude = [], onError } = {}) {
  const files = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === root) throw error;
      onError?.(error, directory);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!exclude.includes(fullPath)) await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files;
}
