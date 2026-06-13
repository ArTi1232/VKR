const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

class Database {
    constructor() {
        this.db = new sqlite3.Database(path.join(__dirname, 'requests.db'), (err) => {
            if (err) console.error('Ошибка подключения к БД:', err);
            else {
                console.log('✅ Подключен к SQLite');
                this.initDatabase();
            }
        });
    }

    async initDatabase() {
        try {
            await this.runQuery('PRAGMA foreign_keys = ON');

            await this.runQuery(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    email TEXT UNIQUE,
                    role TEXT DEFAULT 'admin',
                    full_name TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_active INTEGER DEFAULT 1
                )
            `);

            await this.runQuery(`
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
                    FOREIGN KEY (created_by) REFERENCES users(id)
                )
            `);

            await this.runQuery(`
                CREATE TABLE IF NOT EXISTS comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    comment_text TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `);

            await this.runQuery(`
                CREATE TABLE IF NOT EXISTS status_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id INTEGER NOT NULL,
                    old_status TEXT,
                    new_status TEXT,
                    changed_by INTEGER,
                    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
                    FOREIGN KEY (changed_by) REFERENCES users(id)
                )
            `);

            await this.runQuery(`
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
                )
            `);

            const admin = await this.getAdminUser();
            if (!admin) {
                const hashedPassword = await bcrypt.hash('admin123', 10);
                await this.runQuery(
                    `INSERT INTO users (username, password, email, role, full_name, is_active)
                     VALUES (?, ?, ?, 'admin', ?, 1)`,
                    ['admin', hashedPassword, process.env.ADMIN_EMAIL || 'admin@system.local', 'Администратор']
                );
                console.log('✅ Создан администратор по умолчанию: admin / admin123');
            }

            console.log('✅ Все таблицы созданы');
        } catch (error) {
            console.error('Ошибка инициализации БД:', error);
        }
    }

    runQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    async getAdminUser() {
        const sql = `SELECT id, username, email, role, full_name FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1`;
        return new Promise((resolve, reject) => {
            this.db.get(sql, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async verifyPassword(username, password) {
        const sql = `SELECT * FROM users WHERE username = ? AND is_active = 1`;
        return new Promise((resolve, reject) => {
            this.db.get(sql, [username], async (err, user) => {
                if (err) reject(err);
                if (!user) resolve(false);
                else resolve(await bcrypt.compare(password, user.password));
            });
        });
    }

    // === ЗАЯВКИ ===
    async createRequest(data) {
        const sql = `INSERT INTO requests 
                    (client_name, phone, email, request_text, category, priority, created_by) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`;
        return new Promise((resolve, reject) => {
            this.db.run(sql, [
                data.client_name,
                data.phone,
                data.email || null,
                data.request_text,
                data.category || 'общая',
                data.priority || 'средний',
                data.created_by
            ], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, ...data });
            });
        });
    }

    async getRequestById(id) {
        const sql = `SELECT r.*, u.username as created_by_name, u.full_name as created_by_fullname
                    FROM requests r
                    LEFT JOIN users u ON r.created_by = u.id
                    WHERE r.id = ?`;
        return new Promise((resolve, reject) => {
            this.db.get(sql, [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getAllRequests(filters = {}) {
        let sql = `SELECT r.*, u.username as created_by_name, u.full_name as created_by_fullname
                   FROM requests r
                   LEFT JOIN users u ON r.created_by = u.id
                   WHERE 1=1`;
        const params = [];

        // Фильтр по статусу (включительно)
        if (filters.status) {
            sql += ' AND r.status = ?';
            params.push(filters.status);
        }
        // Фильтр исключения статуса
        if (filters.exclude_status) {
            sql += ' AND r.status != ?';
            params.push(filters.exclude_status);
        }
        if (filters.priority) {
            sql += ' AND r.priority = ?';
            params.push(filters.priority);
        }
        if (filters.category) {
            sql += ' AND r.category = ?';
            params.push(filters.category);
        }
        if (filters.search) {
            sql += ` AND (r.client_name LIKE ? OR r.request_text LIKE ? OR r.phone LIKE ? OR r.email LIKE ?)`;
            const searchTerm = `%${filters.search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        if (filters.start_date) {
            sql += ' AND DATE(r.created_at) >= ?';
            params.push(filters.start_date);
        }
        if (filters.end_date) {
            sql += ' AND DATE(r.created_at) <= ?';
            params.push(filters.end_date);
        }

        sql += ' ORDER BY r.created_at DESC';

        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async updateRequestStatus(id, status, userId) {
        return new Promise((resolve, reject) => {
            const db = this.db;
            db.run('BEGIN TRANSACTION');

            db.get('SELECT status FROM requests WHERE id = ?', [id], (err, row) => {
                if (err) {
                    db.run('ROLLBACK');
                    return reject(err);
                }
                const oldStatus = row.status;

                const updateSql = `UPDATE requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
                db.run(updateSql, [status, id], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return reject(err);
                    }

                    const historySql = `INSERT INTO status_history (request_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)`;
                    db.run(historySql, [id, oldStatus, status, userId], function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return reject(err);
                        }
                        db.run('COMMIT', (err) => {
                            if (err) reject(err);
                            else resolve({ changes: this.changes, oldStatus, newStatus: status });
                        });
                    });
                });
            });
        });
    }

    async updateRequest(id, data) {
        const updates = [];
        const params = [];

        if (data.client_name) { updates.push('client_name = ?'); params.push(data.client_name); }
        if (data.phone) { updates.push('phone = ?'); params.push(data.phone); }
        if (data.email !== undefined) { updates.push('email = ?'); params.push(data.email); }
        if (data.request_text) { updates.push('request_text = ?'); params.push(data.request_text); }
        if (data.category) { updates.push('category = ?'); params.push(data.category); }
        if (data.priority) { updates.push('priority = ?'); params.push(data.priority); }
        if (data.status) { updates.push('status = ?'); params.push(data.status); }

        if (updates.length === 0) throw new Error('Нет данных для обновления');

        updates.push('updated_at = CURRENT_TIMESTAMP');
        const sql = `UPDATE requests SET ${updates.join(', ')} WHERE id = ?`;
        params.push(id);

        const willChangeStatus = data.status !== undefined;
        const db = this.db;

        return new Promise((resolve, reject) => {
            if (willChangeStatus) {
                db.get('SELECT status FROM requests WHERE id = ?', [id], (err, row) => {
                    if (err) return reject(err);
                    const oldStatus = row.status;

                    db.run(sql, params, function(err) {
                        if (err) return reject(err);

                        if (oldStatus !== data.status && data.changed_by) {
                            const historySql = `INSERT INTO status_history (request_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)`;
                            db.run(historySql, [id, oldStatus, data.status, data.changed_by], function(err) {
                                if (err) console.error('Ошибка записи истории статуса:', err);
                                resolve({ changes: this.changes });
                            });
                        } else {
                            resolve({ changes: this.changes });
                        }
                    });
                });
            } else {
                db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                });
            }
        });
    }

    async deleteRequest(id) {
        const sql = `DELETE FROM requests WHERE id = ?`;
        return new Promise((resolve, reject) => {
            this.db.run(sql, [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    // === КОММЕНТАРИИ ===
    async createComment(data) {
        const sql = `INSERT INTO comments (request_id, user_id, comment_text) VALUES (?, ?, ?)`;
        return new Promise((resolve, reject) => {
            this.db.run(sql, [data.request_id, data.user_id, data.comment_text], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, ...data, created_at: new Date().toISOString() });
            });
        });
    }

    async getCommentsByRequestId(requestId) {
        const sql = `SELECT c.*, u.username, u.full_name 
                     FROM comments c
                     JOIN users u ON c.user_id = u.id
                     WHERE c.request_id = ?
                     ORDER BY c.created_at ASC`;
        return new Promise((resolve, reject) => {
            this.db.all(sql, [requestId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // === СТАТИСТИКА ===
    async getDashboardStats() {
        const sql = `
            SELECT 
                COUNT(*) as total_requests,
                SUM(CASE WHEN status = 'новая' THEN 1 ELSE 0 END) as new_requests,
                SUM(CASE WHEN status = 'в обработке' THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN status = 'выполнена' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'отклонена' THEN 1 ELSE 0 END) as rejected,
                SUM(CASE WHEN priority = 'высокий' THEN 1 ELSE 0 END) as high_priority
            FROM requests
            WHERE status != 'архив'   -- статистика без учёта архива
        `;
        return new Promise((resolve, reject) => {
            this.db.get(sql, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // === ВЛОЖЕНИЯ ===
    async addAttachment(data) {
        const sql = `INSERT INTO attachments 
                    (request_id, filename, original_name, filepath, filetype, filesize, uploaded_by) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`;
        return new Promise((resolve, reject) => {
            this.db.run(sql, [
                data.request_id,
                data.filename,
                data.original_name,
                data.filepath,
                data.filetype,
                data.filesize,
                data.uploaded_by
            ], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, ...data });
            });
        });
    }

    async getAttachmentsByRequestId(requestId) {
        const sql = `SELECT * FROM attachments WHERE request_id = ? ORDER BY uploaded_at DESC`;
        return new Promise((resolve, reject) => {
            this.db.all(sql, [requestId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getAttachmentById(id) {
        const sql = `SELECT * FROM attachments WHERE id = ?`;
        return new Promise((resolve, reject) => {
            this.db.get(sql, [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async deleteAttachment(id) {
        const sql = `DELETE FROM attachments WHERE id = ?`;
        return new Promise((resolve, reject) => {
            this.db.run(sql, [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    }

    close() {
        this.db.close((err) => {
            if (err) console.error('Ошибка закрытия БД:', err);
            else console.log('Соединение с БД закрыто');
        });
    }
}

module.exports = new Database();