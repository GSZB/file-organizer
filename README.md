# File Organizer CLI

CLI-застосунок на Node.js для наведення порядку в директоріях (наприклад, у `Downloads`):

- **scan** — рекурсивне сканування директорії та детальна статистика (кількість, розміри, типи, вік файлів);
- **duplicates** — пошук файлів з однаковим вмістом за SHA-256 хешем;
- **organize** — копіювання файлів у папки за категоріями (Documents, Images, Archives, Code, Videos, Other);
- **cleanup** — пошук і видалення файлів, старших за вказану кількість днів (з режимом dry run).

Зовнішніх залежностей немає — використовуються лише вбудовані модулі Node.js
(`fs`, `path`, `crypto`, `events`, `stream`, `util`).

## Вимоги

- Node.js **20** або новіший

## Встановлення

```bash
git clone https://github.com/GSZB/file-organizer.git
cd file-organizer
npm install
```

`npm install` нічого не завантажує (залежностей немає), але перевіряє, що `package.json` коректний.

## Використання

```bash
node file-organizer.js <command> <directory> [options]
```

Або через npm scripts — аргументи передаються після `--`:

```bash
npm run scan -- ~/Downloads
```

Довідка:

```bash
node file-organizer.js --help
```

### scan — статистика директорії

```bash
node file-organizer.js scan ~/Downloads
npm run scan -- ~/Downloads
```

Приклад виведення:

```
📂 Scanning: /Users/student/Downloads
Processing... ████████████████████ 247/247 files

📊 Scan Results:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total files: 247
Total size: 1.20 GB

By File Type:
  .pdf         89 files    456.0 MB
  .zip         23 files    234.0 MB
  .png         67 files    187.0 MB
  ...

File Age:
  Last 7 days:       45 files
  Last 30 days:      89 files
  Older than 90:     56 files

Largest files:
  1. video_lecture.mp4    450.0 MB
  2. archive_backup.zip   156.0 MB
  3. presentation.pptx     89.0 MB

Oldest file: old_report.pdf (modified 365 days ago)
```

Типи сортуються за сумарним розміром; показуються 10 найбільших, решта об'єднується в `(other)`.
Файли без розширення потрапляють у групу `(no ext)`.

### duplicates — пошук дублікатів

```bash
node file-organizer.js duplicates ~/Downloads
npm run duplicates -- ~/Downloads
```

Приклад виведення:

```
🔍 Searching for duplicates in: /Users/student/Downloads
Files found: 247 (31 with matching sizes will be hashed)
Calculating hashes... ████████████████████ 31/31 files

Found 2 duplicate groups (7.9 MB wasted):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Group 1 (3 copies, 3.2 MB each):
  SHA-256: a3f2e1b8c4d5...

  📄 /Users/student/Downloads/lecture.pdf
  📄 /Users/student/Downloads/lecture(1).pdf
  📄 /Users/student/Downloads/backup/lecture_copy.pdf

  Wasted space: 6.4 MB

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Group 2 (2 copies, 1.5 MB each):
  ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💾 Total wasted space: 7.9 MB
```

Як це працює:

1. Файли групуються за розміром — файли різного розміру не можуть мати однаковий вміст,
   тому хеш рахується тільки для тих, у кого розмір збігається з іншим файлом. Порожні файли пропускаються.
2. SHA-256 рахується через `crypto.createHash('sha256')` і `fs.createReadStream()` —
   файл читається частинами (chunks), тому навіть великі файли не завантажуються в пам'ять повністю.
3. Результати групуються в `Map<hash, Array<filePath>>`, показуються групи, де шляхів більше одного.
4. Витрачене місце = розмір файлу × (кількість копій − 1).

### organize — сортування по категоріях

```bash
node file-organizer.js organize ~/Downloads --output ~/Organized
npm run organize -- ~/Downloads --output ~/Organized
```

Приклад виведення:

```
📦 Organizing: /Users/student/Downloads
Target: /Users/student/Organized

Creating folders...
  ✓ Documents/
  ✓ Images/
  ✓ Archives/
  ✓ Code/
  ✓ Videos/
  ✓ Other/

Copying files... ████████████████████ 247/247

✅ Organization complete!

Summary:
  Documents:   134 files → Organized/Documents/
  Images:       67 files → Organized/Images/
  Archives:     23 files → Organized/Archives/
  Code:         12 files → Organized/Code/
  Videos:        8 files → Organized/Videos/
  Other:         3 files → Organized/Other/

Total copied: 247 files (1.20 GB)
Renamed because of name conflicts: 5
Large files (≥ 10 MB) copied with streams: 9
```

Категорії:

| Категорія | Розширення                                                 |
| --------- | ---------------------------------------------------------- |
| Documents | `.pdf` `.docx` `.doc` `.txt` `.md` `.xlsx` `.pptx`         |
| Images    | `.png` `.jpg` `.jpeg` `.gif` `.svg` `.webp` `.bmp`         |
| Archives  | `.zip` `.rar` `.tar` `.gz` `.7z`                           |
| Code      | `.js` `.py` `.java` `.cpp` `.html` `.css` `.json`          |
| Videos    | `.mp4` `.avi` `.mkv` `.mov` `.webm`                        |
| Other     | усе інше                                                   |

Особливості:

- оригінальні файли **не змінюються і не видаляються** — тільки копіюються;
- перед копіюванням створюються всі папки категорій (`fs.mkdir(path, { recursive: true })`);
- файли менше 10 MB копіюються через `fs.copyFile()`, файли від 10 MB — через streams
  (`pipeline(createReadStream, createWriteStream)`);
- якщо файл з такою назвою вже існує, він не перезаписується: `file.pdf` → `file(1).pdf` → `file(2).pdf`...;
- скопійовані файли зберігають оригінальну дату модифікації;
- якщо цільова директорія знаходиться всередині вихідної, її вміст не копіюється повторно.

### cleanup — видалення старих файлів

Показати файли, старші за 90 днів, **нічого не видаляючи** (dry run):

```bash
node file-organizer.js cleanup ~/Downloads --older-than 90
npm run cleanup -- ~/Downloads --older-than 90
```

Показати список і видалити файли:

```bash
node file-organizer.js cleanup ~/Downloads --older-than 90 --confirm
npm run cleanup -- ~/Downloads --older-than 90 --confirm
```

Приклад виведення (dry run):

```
🧹 Cleanup: /Users/student/Downloads
Looking for files older than 90 days...

Found 45 files to delete:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ancient_screenshot.png
  Size: 0.8 MB
  Modified: 365 days ago (2025-11-02)

...
... (35 more files)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total: 45 files (156.0 MB)

⚠️  DRY RUN MODE: No files were deleted.
To actually delete these files, run with --confirm flag.
```

З `--confirm`:

```
⚠️  DELETING 45 files (156.0 MB). This action cannot be undone!

Deleting... ████████████████████ 45/45

✅ Cleanup complete!
Deleted: 45 files (156.0 MB freed)
```

Вік файлу визначається за датою останньої модифікації (`stats.mtime`). У списку показуються
перші 10 найстаріших файлів, загальна кількість і розмір — для всіх знайдених.

## Структура проєкту

```
file-organizer/
├── package.json
├── .gitignore
├── README.md
├── file-organizer.js     # точка входу: парсинг аргументів і виведення в консоль
└── lib/
    ├── scanner.js        # клас Scanner — команда scan
    ├── duplicates.js     # клас DuplicateFinder — команда duplicates
    ├── organizer.js      # клас Organizer — команда organize
    ├── cleanup.js        # клас Cleanup — команда cleanup
    └── utils.js          # обхід директорій, formatSize, прогрес-бар, повідомлення про помилки
```

## Архітектура

Кожна команда — окремий клас, що наслідується від `EventEmitter`. Класи відповідають тільки
за роботу з файлами та генерують події, а `file-organizer.js` підписується на них і малює
прогрес-бар та звіти. Завдяки цьому ті самі класи можна використати, наприклад, у веб-сервері.

| Клас              | Події                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Scanner`         | `scan-start`, `file-found`, `scan-error`, `scan-complete`                                                                  |
| `DuplicateFinder` | `search-start`, `hashing-start`, `file-processed`, `file-error`, `duplicates-found`                                        |
| `Organizer`       | `organize-start`, `folder-created`, `copy-start`, `copy-complete`, `copy-error`, `organize-complete`                       |
| `Cleanup`         | `cleanup-start`, `file-found`, `cleanup-error`, `search-complete`, `delete-start`, `file-deleted`, `delete-error`, `cleanup-complete` |

Події прогресу (`file-found`, `file-processed`, `copy-complete`, `file-deleted`) передають
`processed` і `total` — з них будується прогрес-бар.

Приклад використання класу окремо:

```js
import { Scanner } from './lib/scanner.js';

const scanner = new Scanner();

scanner.on('file-found', ({ processed, total }) => {
  console.log(`${processed}/${total}`);
});
scanner.on('scan-complete', (stats) => {
  console.log(`Found ${stats.totalFiles} files`);
});

await scanner.scan('/path/to/directory');
```

## Обробка помилок

Усі операції з файловою системою обгорнуті в `try...catch`. Помилки розпізнаються за `error.code`:

| Код       | Повідомлення                                 |
| --------- | -------------------------------------------- |
| `ENOENT`  | Directory not found / File or directory not found |
| `EACCES`  | Permission denied                            |
| `EPERM`   | Operation not permitted                      |
| `ENOTDIR` | Not a directory                              |
| `EEXIST`  | File already exists                          |
| `ENOSPC`  | No space left on device                      |
| `EBUSY`   | File is busy or locked                       |
| інші      | Unexpected error: `<повідомлення>`           |

- Якщо вказана директорія не існує, недоступна або це не директорія — програма виводить
  помилку і завершується з кодом `1`.
- Якщо недоступний окремий файл чи піддиректорія — вони пропускаються, а після прогрес-бару
  виводиться список пропущених елементів. Решта файлів обробляється далі.
- Некоректні аргументи (невідома команда, відсутній `--output` чи `--older-than`,
  нечислове значення днів) — повідомлення з підказкою і код виходу `1`.

```
$ node file-organizer.js scan /no/such/dir
❌ Error: Directory not found: /no/such/dir
```

## Швидка перевірка

```bash
mkdir -p demo/backup
echo "hello" > demo/a.txt
cp demo/a.txt demo/backup/a_copy.txt
cp demo/a.txt demo/backup/a.txt
head -c 15000000 /dev/urandom > demo/video.mp4
touch -t 202401010000 demo/backup/a.txt

node file-organizer.js scan demo
node file-organizer.js duplicates demo
node file-organizer.js organize demo --output demo-organized
node file-organizer.js cleanup demo --older-than 90
node file-organizer.js cleanup demo --older-than 90 --confirm
```
