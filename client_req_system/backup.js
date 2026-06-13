const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const db = require('./database');

class BackupManager {
    constructor() {
        this.backupDir = path.join(__dirname, 'backups');
        
        // Создаем папку для бэкапов если ее нет
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
            console.log('✅ Создана папка для бэкапов:', this.backupDir);
        }
    }
    
    async createBackup() {
        return new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString()
                .replace(/[:.]/g, '-')
                .replace('T', '_')
                .substring(0, 19);
            const backupFileName = `backup-${timestamp}.db`;
            const backupPath = path.join(this.backupDir, backupFileName);
            
            const dbPath = path.join(__dirname, 'requests.db');
            
            // Проверяем существование основной БД
            if (!fs.existsSync(dbPath)) {
                return reject(new Error('Основная база данных не найдена'));
            }
            
            // Копируем базу данных
            fs.copyFile(dbPath, backupPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`✅ Создан бэкап: ${backupFileName}`);
                    
                    // Очищаем старые бэкапы (оставляем последние 30)
                    this.cleanupOldBackups();
                    
                    resolve({
                        filename: backupFileName,
                        path: backupPath,
                        size: fs.statSync(backupPath).size,
                        created_at: new Date().toISOString()
                    });
                }
            });
        });
    }
    
    async createExportBackup() {
        return new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString()
                .replace(/[:.]/g, '-')
                .replace('T', '_')
                .substring(0, 19);
            const backupFileName = `export-${timestamp}.sql`;
            const backupPath = path.join(this.backupDir, backupFileName);
            
            const dbPath = path.join(__dirname, 'requests.db');
            
            // Проверяем существование основной БД
            if (!fs.existsSync(dbPath)) {
                return reject(new Error('Основная база данных не найдена'));
            }
            
            // Создаем SQL дамп базы данных
            const command = `sqlite3 ${dbPath} .dump > "${backupPath}"`;
            
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    // Если sqlite3 не установлен, используем альтернативный метод
                    if (error.code === 'ENOENT') {
                        this.createSimpleExport(backupPath)
                            .then(backup => resolve(backup))
                            .catch(err => reject(err));
                    } else {
                        reject(error);
                    }
                } else if (stderr) {
                    console.warn('Предупреждение при создании SQL дампа:', stderr);
                    resolve({
                        filename: backupFileName,
                        path: backupPath,
                        size: fs.existsSync(backupPath) ? fs.statSync(backupPath).size : 0,
                        created_at: new Date().toISOString()
                    });
                } else {
                    console.log(`✅ Создан SQL экспорт: ${backupFileName}`);
                    resolve({
                        filename: backupFileName,
                        path: backupPath,
                        size: fs.statSync(backupPath).size,
                        created_at: new Date().toISOString()
                    });
                }
            });
        });
    }
    
    async createSimpleExport(backupPath) {
        return new Promise((resolve, reject) => {
            try {
                // Простой экспорт структуры (без данных)
                const structure = `
-- SQL Export создан ${new Date().toISOString()}
-- База данных: Система заявок клиентов

PRAGMA foreign_keys = OFF;

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'operator',
    full_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
);

-- Таблица заявок
CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    request_text TEXT NOT NULL,
    category TEXT DEFAULT 'общая',
    priority TEXT DEFAULT 'средний',
    status TEXT DEFAULT 'новая',
    assigned_to INTEGER,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Таблица комментариев
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    comment_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Таблица для истории изменений статусов
CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    old_status TEXT,
    new_status TEXT,
    changed_by INTEGER,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id)
);

-- Таблица для вложений
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    filepath TEXT NOT NULL,
    filetype TEXT NOT NULL,
    filesize INTEGER NOT NULL,
    uploaded_by INTEGER NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

PRAGMA foreign_keys = ON;
`;

                fs.writeFileSync(backupPath, structure);
                
                const backupFileName = path.basename(backupPath);
                console.log(`✅ Создан простой SQL экспорт структуры: ${backupFileName}`);
                
                resolve({
                    filename: backupFileName,
                    path: backupPath,
                    size: fs.statSync(backupPath).size,
                    created_at: new Date().toISOString()
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    
    async restoreBackup(backupFilename) {
        return new Promise((resolve, reject) => {
            const backupPath = path.join(this.backupDir, backupFilename);
            
            if (!fs.existsSync(backupPath)) {
                return reject(new Error('Файл бэкапа не найден'));
            }
            
            // Проверяем расширение файла
            const ext = path.extname(backupFilename);
            const dbPath = path.join(__dirname, 'requests.db');
            
            if (ext === '.db') {
                // Простое копирование файла БД
                try {
                    // Закрываем текущее соединение с БД
                    db.close();
                    
                    // Делаем копию текущей БД на случай ошибки
                    const backupCurrent = path.join(__dirname, `requests_backup_${Date.now()}.db`);
                    if (fs.existsSync(dbPath)) {
                        fs.copyFileSync(dbPath, backupCurrent);
                        console.log('✅ Создана резервная копия текущей БД');
                    }
                    
                    // Копируем бэкап на место основной базы
                    fs.copyFileSync(backupPath, dbPath);
                    
                    console.log(`✅ Восстановлен бэкап: ${backupFilename}`);
                    
                    // Удаляем временную резервную копию через 5 минут
                    setTimeout(() => {
                        if (fs.existsSync(backupCurrent)) {
                            fs.unlinkSync(backupCurrent);
                        }
                    }, 5 * 60 * 1000);
                    
                    resolve({
                        filename: backupFilename,
                        restored_at: new Date().toISOString(),
                        backup_created: backupCurrent
                    });
                } catch (error) {
                    reject(error);
                }
            } else if (ext === '.sql') {
                // Восстановление из SQL файла требует перезапуска приложения
                console.log('⚠️ Для восстановления из SQL файла требуется перезапуск приложения');
                resolve({
                    filename: backupFilename,
                    restored_at: new Date().toISOString(),
                    requires_restart: true
                });
            } else {
                reject(new Error('Неподдерживаемый формат файла бэкапа'));
            }
        });
    }
    
    async getBackupList() {
        return new Promise((resolve, reject) => {
            fs.readdir(this.backupDir, (err, files) => {
                if (err) {
                    reject(err);
                } else {
                    const backups = files
                        .filter(file => file.endsWith('.db') || file.endsWith('.sql'))
                        .map(file => {
                            try {
                                const filePath = path.join(this.backupDir, file);
                                const stats = fs.statSync(filePath);
                                return {
                                    filename: file,
                                    path: filePath,
                                    size: stats.size,
                                    created_at: stats.birthtime.toISOString(),
                                    type: file.endsWith('.sql') ? 'sql' : 'db',
                                    readable_size: this.formatFileSize(stats.size)
                                };
                            } catch (error) {
                                console.error(`Ошибка чтения файла ${file}:`, error);
                                return null;
                            }
                        })
                        .filter(backup => backup !== null)
                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    
                    resolve(backups);
                }
            });
        });
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    async cleanupOldBackups(maxBackups = 30) {
        try {
            const backups = await this.getBackupList();
            
            if (backups.length > maxBackups) {
                const toDelete = backups.slice(maxBackups);
                
                for (const backup of toDelete) {
                    try {
                        fs.unlinkSync(backup.path);
                        console.log(`🗑️ Удален старый бэкап: ${backup.filename}`);
                    } catch (error) {
                        console.error(`Ошибка удаления бэкапа ${backup.filename}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка очистки старых бэкапов:', error);
        }
    }
    
    async deleteBackup(backupFilename) {
        return new Promise((resolve, reject) => {
            const backupPath = path.join(this.backupDir, backupFilename);
            
            if (!fs.existsSync(backupPath)) {
                return reject(new Error('Файл бэкапа не найден'));
            }
            
            fs.unlink(backupPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`Удален бэкап: ${backupFilename}`);
                    resolve({ success: true });
                }
            });
        });
    }
}

module.exports = new BackupManager();