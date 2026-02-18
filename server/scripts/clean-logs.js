import fs from 'fs';
import path from 'path';

const serverDir = path.resolve(new URL(import.meta.url).pathname, '..');
const targetDir = path.resolve(serverDir);

function removeLogs(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) continue;
    if (/\.out\.log$/.test(entry.name) || /\.err\.log$/.test(entry.name)) {
      try {
        fs.unlinkSync(fullPath);
        console.log('Removed log file:', fullPath);
      } catch (err) {
        console.warn('Failed to remove', fullPath, err.message);
      }
    }
  }
}

// Run in current folder (server)
removeLogs(targetDir);
console.log('Log cleanup complete');
