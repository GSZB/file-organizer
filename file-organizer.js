#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { parseArgs } from 'util';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';
import { formatDate, formatError, formatSize, getAgeInDays, plural, printProgress } from './lib/utils.js';

const LINE = '━'.repeat(40);
const TOP_TYPES = 10;
const MAX_WARNINGS = 10;
const CLEANUP_PREVIEW = 10;

const USAGE = `Usage: node file-organizer.js <command> <directory> [options]

Commands:
  scan <directory>                           Show statistics about files in the directory
  duplicates <directory>                     Find files with identical content (SHA-256)
  organize <directory> --output <target>     Copy files into category folders
  cleanup <directory> --older-than <days>    Show files older than N days (dry run)
  cleanup <directory> --older-than <days> --confirm
                                             Delete files older than N days

Options:
  -o, --output <path>      Target directory for "organize"
  --older-than <days>      Age threshold in days for "cleanup"
  --confirm                Really delete files in "cleanup"
  -h, --help               Show this help`;

function fail(message) {
  console.error(`❌ Error: ${message}`);
  process.exit(1);
}

function printWarnings(warnings) {
  if (warnings.length === 0) return;

  console.log(`\n⚠️  Skipped ${plural(warnings.length, 'item')}:`);
  warnings.slice(0, MAX_WARNINGS).forEach((warning) => console.log(`  ${warning}`));
  if (warnings.length > MAX_WARNINGS) {
    console.log(`  ... (${warnings.length - MAX_WARNINGS} more)`);
  }
}

// npm runs scripts from the project root, INIT_CWD keeps the directory the command was called from
function resolvePath(input) {
  return path.resolve(process.env.INIT_CWD || process.cwd(), input);
}

async function resolveDirectory(input) {
  if (!input) fail(`Directory is not specified.\n\n${USAGE}`);

  const directory = resolvePath(input);
  try {
    const stats = await fs.stat(directory);
    if (!stats.isDirectory()) fail(`Not a directory: ${directory}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail(`Directory not found: ${directory}`);
    } else if (error.code === 'EACCES') {
      fail(`Permission denied: ${directory}`);
    } else {
      console.error(`❌ ${formatError(error, directory)}`);
      process.exit(1);
    }
  }
  return directory;
}

// ---------- scan ----------

function printScanResults(stats) {
  console.log(`\n📊 Scan Results:\n${LINE}`);
  console.log(`Total files: ${stats.totalFiles}`);
  console.log(`Total size: ${formatSize(stats.totalSize)}`);

  if (stats.totalFiles === 0) return;

  const types = [...stats.byType.entries()].sort((a, b) => b[1].totalSize - a[1].totalSize);
  const shown = types.slice(0, TOP_TYPES);
  const rest = types.slice(TOP_TYPES);
  if (rest.length > 0) {
    shown.push([
      '(other)',
      rest.reduce(
        (sum, [, type]) => ({ count: sum.count + type.count, totalSize: sum.totalSize + type.totalSize }),
        { count: 0, totalSize: 0 },
      ),
    ]);
  }

  const typeWidth = Math.max(...shown.map(([extension]) => extension.length));
  console.log('\nBy File Type:');
  for (const [extension, { count, totalSize }] of shown) {
    console.log(`  ${extension.padEnd(typeWidth)}  ${String(count).padStart(5)} files  ${formatSize(totalSize).padStart(10)}`);
  }

  console.log('\nFile Age:');
  console.log(`  Last 7 days:    ${String(stats.age.last7Days).padStart(5)} files`);
  console.log(`  Last 30 days:   ${String(stats.age.last30Days).padStart(5)} files`);
  console.log(`  Older than 90:  ${String(stats.age.olderThan90Days).padStart(5)} files`);

  const nameWidth = Math.max(...stats.largestFiles.map((file) => file.relativePath.length));
  console.log('\nLargest files:');
  stats.largestFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file.relativePath.padEnd(nameWidth)}  ${formatSize(file.size).padStart(10)}`);
  });

  const { oldestFile } = stats;
  const daysOld = Math.floor(getAgeInDays(oldestFile.mtime));
  console.log(`\nOldest file: ${oldestFile.relativePath} (modified ${daysOld} days ago)`);
}

async function runScan(directory) {
  const scanner = new Scanner();
  const warnings = [];

  scanner.on('scan-start', (data) => console.log(`📂 Scanning: ${data.directory}`));

  scanner.on('file-found', (data) => printProgress('Processing...', data.processed, data.total, 'files'));

  scanner.on('scan-error', (data) => {
    warnings.push(formatError(data.error, data.path));
    if (data.total) printProgress('Processing...', data.processed, data.total, 'files');
  });

  scanner.on('scan-complete', (stats) => {
    printWarnings(warnings);
    printScanResults(stats);
  });

  await scanner.scan(directory);
}

// ---------- duplicates ----------

function printDuplicates({ groups, totalWasted }) {
  if (groups.length === 0) {
    console.log('\n✅ No duplicates found.');
    return;
  }

  console.log(`\nFound ${plural(groups.length, 'duplicate group')} (${formatSize(totalWasted)} wasted):\n`);

  groups.forEach((group, index) => {
    console.log(LINE);
    console.log(`Group ${index + 1} (${group.paths.length} copies, ${formatSize(group.size)} each):`);
    console.log(`  SHA-256: ${group.hash.slice(0, 12)}...\n`);
    group.paths.forEach((filePath) => console.log(`  📄 ${filePath}`));
    console.log(`\n  Wasted space: ${formatSize(group.wasted)}\n`);
  });

  console.log(LINE);
  console.log(`💾 Total wasted space: ${formatSize(totalWasted)}`);
}

async function runDuplicates(directory) {
  const finder = new DuplicateFinder();
  const warnings = [];

  finder.on('search-start', (data) => console.log(`🔍 Searching for duplicates in: ${data.directory}`));

  finder.on('hashing-start', (data) => {
    console.log(`Files found: ${data.totalFiles} (${data.toHash} with matching sizes will be hashed)`);
  });

  finder.on('file-processed', (data) => printProgress('Calculating hashes...', data.processed, data.total, 'files'));

  finder.on('file-error', (data) => warnings.push(formatError(data.error, data.path)));

  finder.on('duplicates-found', (result) => {
    printWarnings(warnings);
    printDuplicates(result);
  });

  await finder.find(directory);
}

// ---------- organize ----------

function printOrganizeSummary(summary) {
  if (summary.failed > 0) {
    console.log('\n⚠️  Organization finished with errors.\n');
    process.exitCode = 1;
  } else {
    console.log('\n✅ Organization complete!\n');
  }

  const targetName = path.basename(summary.target);
  const width = Math.max(...Object.keys(summary.categories).map((category) => category.length)) + 1;

  console.log('Summary:');
  for (const [category, count] of Object.entries(summary.categories)) {
    console.log(`  ${`${category}:`.padEnd(width)} ${String(count).padStart(5)} files → ${targetName}/${category}/`);
  }

  console.log(`\nTotal copied: ${plural(summary.copied, 'file')} (${formatSize(summary.totalSize)})`);
  if (summary.renamed > 0) console.log(`Renamed because of name conflicts: ${summary.renamed}`);
  if (summary.streamed > 0) console.log(`Large files (≥ 10 MB) copied with streams: ${summary.streamed}`);
  if (summary.failed > 0) console.log(`Failed to copy: ${summary.failed}`);
}

async function runOrganize(source, output) {
  if (!output) fail(`Option --output <target> is required for "organize".\n\n${USAGE}`);

  const target = resolvePath(output);
  if (target === source) fail('Target directory must be different from the source directory.');

  const organizer = new Organizer();
  const warnings = [];
  let copyingStarted = false;

  const startCopying = () => {
    if (!copyingStarted) {
      copyingStarted = true;
      console.log();
    }
  };

  organizer.on('organize-start', (data) => {
    console.log(`📦 Organizing: ${data.source}`);
    console.log(`Target: ${data.target}\n`);
    console.log('Creating folders...');
  });

  organizer.on('folder-created', (data) => console.log(`  ✓ ${data.category}/`));

  organizer.on('copy-start', startCopying);

  organizer.on('copy-complete', (data) => printProgress('Copying files...', data.processed, data.total));

  organizer.on('copy-error', (data) => {
    warnings.push(formatError(data.error, data.source));
    if (data.total) {
      startCopying();
      printProgress('Copying files...', data.processed, data.total);
    }
  });

  organizer.on('organize-complete', (summary) => {
    printWarnings(warnings);
    printOrganizeSummary(summary);
  });

  await organizer.organize(source, target);
}

// ---------- cleanup ----------

function parseDays(value) {
  if (value === undefined) fail(`Option --older-than <days> is required for "cleanup".\n\n${USAGE}`);

  const days = Number(value);
  if (value.trim() === '' || !Number.isFinite(days) || days < 0) {
    fail(`--older-than must be a non-negative number of days, got "${value}"`);
  }
  return days;
}

function printOldFiles({ files, totalSize }, olderThan) {
  if (files.length === 0) {
    console.log(`✅ No files older than ${plural(olderThan, 'day')} found.`);
    return;
  }

  console.log(`Found ${plural(files.length, 'file')} to delete:\n`);
  console.log(LINE);

  for (const file of files.slice(0, CLEANUP_PREVIEW)) {
    console.log(file.relativePath);
    console.log(`  Size: ${formatSize(file.size)}`);
    console.log(`  Modified: ${file.daysOld} days ago (${formatDate(file.mtime)})\n`);
  }
  if (files.length > CLEANUP_PREVIEW) {
    console.log(`... (${files.length - CLEANUP_PREVIEW} more files)`);
  }

  console.log(LINE);
  console.log(`\nTotal: ${plural(files.length, 'file')} (${formatSize(totalSize)})`);
}

async function runCleanup(directory, olderThan, confirm) {
  const cleanup = new Cleanup();
  const warnings = [];

  cleanup.on('cleanup-start', (data) => {
    console.log(`🧹 Cleanup: ${data.directory}`);
    console.log(`Looking for files older than ${plural(data.olderThan, 'day')}...\n`);
  });

  cleanup.on('cleanup-error', (data) => warnings.push(formatError(data.error, data.path)));

  cleanup.on('search-complete', (data) => {
    printOldFiles(data, olderThan);
    printWarnings(warnings);
    warnings.length = 0;
  });

  cleanup.on('delete-start', (data) => {
    console.log(`\n⚠️  DELETING ${plural(data.count, 'file')} (${formatSize(data.totalSize)}). This action cannot be undone!\n`);
  });

  cleanup.on('file-deleted', (data) => printProgress('Deleting...', data.processed, data.total));

  cleanup.on('delete-error', (data) => {
    warnings.push(formatError(data.error, data.path));
    printProgress('Deleting...', data.processed, data.total);
  });

  cleanup.on('cleanup-complete', (result) => {
    if (result.found === 0) return;

    if (result.dryRun) {
      console.log('\n⚠️  DRY RUN MODE: No files were deleted.');
      console.log('To actually delete these files, run with --confirm flag.');
      return;
    }

    printWarnings(warnings);
    console.log(result.failed > 0 ? '\n⚠️  Cleanup finished with errors.' : '\n✅ Cleanup complete!');
    console.log(`Deleted: ${plural(result.deleted, 'file')} (${formatSize(result.freed)} freed)`);
    if (result.failed > 0) {
      console.log(`Failed to delete: ${plural(result.failed, 'file')}`);
      process.exitCode = 1;
    }
  });

  await cleanup.run(directory, { olderThan, confirm });
}

// ---------- entry point ----------

async function main() {
  let args;
  try {
    args = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        output: { type: 'string', short: 'o' },
        'older-than': { type: 'string' },
        confirm: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    fail(`${error.message}\n\n${USAGE}`);
  }

  const { values, positionals } = args;
  const [command, directoryArg, ...extra] = positionals;

  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (!command) {
    console.log(USAGE);
    process.exit(1);
  }
  if (!['scan', 'duplicates', 'organize', 'cleanup'].includes(command)) {
    fail(`Unknown command "${command}".\n\n${USAGE}`);
  }
  if (extra.length > 0) fail(`Unexpected argument: ${extra[0]}`);

  const directory = await resolveDirectory(directoryArg);

  switch (command) {
    case 'scan':
      await runScan(directory);
      break;
    case 'duplicates':
      await runDuplicates(directory);
      break;
    case 'organize':
      await runOrganize(directory, values.output);
      break;
    case 'cleanup':
      await runCleanup(directory, parseDays(values['older-than']), values.confirm);
      break;
  }
}

main().catch((error) => {
  console.error(`\n❌ ${formatError(error)}`);
  process.exit(1);
});
