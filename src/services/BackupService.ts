// ================================================
// BACKUP SERVICE — Automatic data persistence
// ================================================

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/Logger';

export interface BackupData {
  timestamp: string;
  calibration: object;
  ensemble: object;
  trades: any[];
}

export class BackupService {
  private backupDir: string;
  private readonly MAX_BACKUPS = 20; // Keep last 20 backups
  private lastBackupTime: number = 0;
  private readonly MIN_BACKUP_INTERVAL_MS = 3600000; // 1 hour minimum between backups

  constructor(backupDir: string = path.join(process.cwd(), 'data', 'backups')) {
    this.backupDir = backupDir;
    this.ensureBackupDir();
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      logger.info('Backup', `📁 Backup directory created: ${this.backupDir}`);
    }
  }

  /**
   * Create a backup of all learning data
   * Called periodically or manually via API
   */
  async createBackup(calibration: object, ensemble: object, trades: any[]): Promise<boolean> {
    try {
      const now = Date.now();

      // Rate limit: don't backup too frequently unless forced
      if (now - this.lastBackupTime < this.MIN_BACKUP_INTERVAL_MS) {
        return false;
      }

      const timestamp = new Date().toISOString();
      const backup: BackupData = {
        timestamp,
        calibration,
        ensemble,
        trades,
      };

      const backupName = `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.json`;
      const backupPath = path.join(this.backupDir, backupName);

      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
      this.lastBackupTime = now;

      logger.info('Backup', `✅ Backup created: ${backupName}`);

      // Cleanup old backups
      this.cleanupOldBackups();

      return true;
    } catch (err) {
      logger.error('Backup', 'Failed to create backup', err);
      return false;
    }
  }

  /**
   * Get list of all backups with metadata
   */
  getBackupList(): Array<{ name: string; timestamp: string; path: string; size: number }> {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .sort()
        .reverse();

      return files.map(name => {
        const fullPath = path.join(this.backupDir, name);
        const stat = fs.statSync(fullPath);
        const timestamp = this.parseTimestampFromFilename(name);

        return {
          name,
          timestamp,
          path: fullPath,
          size: stat.size,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Restore data from a backup
   */
  restoreBackup(backupName: string): BackupData | null {
    try {
      const backupPath = path.join(this.backupDir, backupName);

      // Security: prevent path traversal
      if (!backupPath.startsWith(this.backupDir)) {
        logger.warn('Backup', `🚫 Attempted path traversal in restore: ${backupName}`);
        return null;
      }

      if (!fs.existsSync(backupPath)) {
        logger.warn('Backup', `⚠️ Backup not found: ${backupName}`);
        return null;
      }

      const content = fs.readFileSync(backupPath, 'utf-8');
      const backup: BackupData = JSON.parse(content);

      logger.info('Backup', `🔄 Backup restored: ${backupName}`);
      return backup;
    } catch (err) {
      logger.error('Backup', `Failed to restore backup: ${backupName}`, err);
      return null;
    }
  }

  /**
   * Delete a specific backup
   */
  deleteBackup(backupName: string): boolean {
    try {
      const backupPath = path.join(this.backupDir, backupName);

      // Security: prevent path traversal
      if (!backupPath.startsWith(this.backupDir)) {
        logger.warn('Backup', `🚫 Attempted path traversal in delete: ${backupName}`);
        return false;
      }

      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        logger.info('Backup', `🗑️ Backup deleted: ${backupName}`);
        return true;
      }

      return false;
    } catch (err) {
      logger.error('Backup', `Failed to delete backup: ${backupName}`, err);
      return false;
    }
  }

  /**
   * Clean up old backups, keeping only the most recent MAX_BACKUPS
   */
  private cleanupOldBackups(): void {
    try {
      const backups = this.getBackupList();

      if (backups.length > this.MAX_BACKUPS) {
        const toDelete = backups.slice(this.MAX_BACKUPS);

        toDelete.forEach(backup => {
          fs.unlinkSync(backup.path);
          logger.debug('Backup', `Cleaned up old backup: ${backup.name}`);
        });

        logger.info('Backup', `🧹 Cleaned up ${toDelete.length} old backups`);
      }
    } catch (err) {
      logger.warn('Backup', 'Failed to cleanup old backups', err);
    }
  }

  private parseTimestampFromFilename(filename: string): string {
    // backup-2026-04-22T12-30-45 => 2026-04-22T12:30:45
    const match = filename.match(/backup-(.+?)\.json$/);
    if (!match) return '';
    const iso = match[1].replace(/-(?=[0-9]{2}(?:[^-]|$))/g, ':');
    return iso.substring(0, 19); // ISO format without ms
  }
}
