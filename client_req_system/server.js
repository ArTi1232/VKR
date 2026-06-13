require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const http = require('http');
const db = require('./database');
const mailer = require('./mailer');
const backupManager = require('./backup');
const multer = require('multer');
const fs = require('fs');

// Создаём папку для загрузок
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads', { recursive: true });
}

// Настройка multer
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024, files: 5 }
});

const app = express();
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

// WebSocket (опционально)
const SocketManager = require('./socket');
const socketManager = new SocketManager(server);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', dir: __dirname, table: 'sessions' }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

// Проверка аутентификации
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        if (req.xhr || req.headers.accept.includes('json')) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }
        return res.redirect('/login');
    }
    next();
};

// === АУТЕНТИФИКАЦИЯ ===
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const isValid = await db.verifyPassword(username, password);
        if (!isValid) return res.status(401).json({ error: 'Неверные данные' });

        const user = await db.getAdminUser();
        if (!user) return res.status(401).json({ error: 'Пользователь не найден' });

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        req.session.fullName = user.full_name;

        res.json({ success: true, message: 'Вход выполнен', user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/check', (req, res) => {
    if (req.session.userId) {
        res.json({ authenticated: true, user: { id: req.session.userId, username: req.session.username, role: req.session.role, full_name: req.session.fullName } });
    } else {
        res.json({ authenticated: false });
    }
});

// === ЗАЯВКИ ===
app.get('/api/requests', requireAuth, async (req, res) => {
    try {
        const filters = req.query;
        const requests = await db.getAllRequests(filters);
        res.json(requests);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/requests/:id', requireAuth, async (req, res) => {
    try {
        const request = await db.getRequestById(req.params.id);
        if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
        res.json(request);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/requests', requireAuth, upload.array('files', 5), async (req, res) => {
    try {
        const { client_name, phone, email, request_text, category, priority } = req.body;
        if (!client_name || !phone || !request_text) {
            return res.status(400).json({ error: 'Заполните обязательные поля' });
        }

        const request = await db.createRequest({
            client_name, phone, email, request_text,
            category, priority,
            created_by: req.session.userId
        });

        const files = req.files || [];
        for (const file of files) {
            await db.addAttachment({
                request_id: request.id,
                filename: file.filename,
                original_name: file.originalname,
                filepath: `/uploads/${file.filename}`,
                filetype: file.mimetype,
                filesize: file.size,
                uploaded_by: req.session.userId
            });
        }

        const fullRequest = await db.getRequestById(request.id);
        res.json({ success: true, message: 'Заявка создана', request: fullRequest });
    } catch (error) {
        console.error('Ошибка создания заявки:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.patch('/api/requests/:id/status', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const validStatuses = ['новая', 'в обработке', 'выполнена', 'отклонена', 'архив'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Неверный статус' });
        }

        const request = await db.getRequestById(id);
        const oldStatus = request.status;
        const result = await db.updateRequestStatus(id, status, req.session.userId);

        if (request.email) {
            try {
                const user = { full_name: req.session.fullName, username: req.session.username };
                await mailer.sendStatusUpdateNotification(request, oldStatus, status, user);
            } catch (err) {
                console.error('Ошибка отправки email:', err);
            }
        }

        res.json({ success: true, message: 'Статус обновлён', result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.put('/api/requests/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const request = await db.getRequestById(id);
        if (!request) return res.status(404).json({ error: 'Заявка не найдена' });

        const updateData = { ...req.body, changed_by: req.session.userId };
        const result = await db.updateRequest(id, updateData);
        res.json({ success: true, message: 'Заявка обновлена', result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.delete('/api/requests/:id', requireAuth, async (req, res) => {
    try {
        const result = await db.deleteRequest(req.params.id);
        res.json({ success: true, message: 'Заявка удалена', result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// === КОММЕНТАРИИ ===
app.post('/api/comments', requireAuth, async (req, res) => {
    try {
        const { request_id, comment_text } = req.body;
        if (!request_id || !comment_text) {
            return res.status(400).json({ error: 'Заполните все поля' });
        }
        const comment = await db.createComment({
            request_id,
            user_id: req.session.userId,
            comment_text
        });
        const fullComment = {
            ...comment,
            username: req.session.username,
            full_name: req.session.fullName
        };
        const request = await db.getRequestById(request_id);
        if (request.email) {
            const commenter = { id: req.session.userId, username: req.session.username, full_name: req.session.fullName };
            await mailer.sendCommentNotification(request, comment, commenter);
        }
        res.json({ success: true, message: 'Комментарий добавлен', comment: fullComment });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/comments/:requestId', requireAuth, async (req, res) => {
    try {
        const comments = await db.getCommentsByRequestId(req.params.requestId);
        res.json(comments);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// === СТАТИСТИКА ===
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
    try {
        const stats = await db.getDashboardStats();
        res.json(stats);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// === ВЛОЖЕНИЯ ===
app.get('/api/requests/:id/attachments', requireAuth, async (req, res) => {
    try {
        const attachments = await db.getAttachmentsByRequestId(req.params.id);
        res.json(attachments);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/requests/:id/attachments', requireAuth, upload.array('files', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const files = req.files || [];
        const attachments = [];
        for (const file of files) {
            const attachment = await db.addAttachment({
                request_id: id,
                filename: file.filename,
                original_name: file.originalname,
                filepath: `/uploads/${file.filename}`,
                filetype: file.mimetype,
                filesize: file.size,
                uploaded_by: req.session.userId
            });
            attachments.push(attachment);
        }
        res.json({ success: true, attachments });
    } catch (error) {
        console.error('Ошибка загрузки файлов:', error);
        res.status(500).json({ error: 'Ошибка загрузки файлов' });
    }
});

app.delete('/api/attachments/:id', requireAuth, async (req, res) => {
    try {
        const attachment = await db.getAttachmentById(req.params.id);
        if (!attachment) return res.status(404).json({ error: 'Файл не найден' });
        if (req.session.role !== 'admin' && attachment.uploaded_by !== req.session.userId) {
            return res.status(403).json({ error: 'Нет прав' });
        }
        const filePath = path.join(__dirname, 'public', attachment.filepath);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        const result = await db.deleteAttachment(req.params.id);
        res.json({ success: true, message: 'Файл удалён', result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// === ЭКСПОРТ В CSV ===
app.get('/api/requests/export', requireAuth, async (req, res) => {
    try {
        const filters = req.query;
        const requests = await db.getAllRequests(filters);
        const headers = ['ID', 'Клиент', 'Телефон', 'Email', 'Категория', 'Приоритет', 'Статус', 'Дата создания', 'Описание'];
        const csvRows = [
            headers.join(','),
            ...requests.map(req => [
                req.id,
                `"${req.client_name}"`,
                req.phone,
                req.email || '',
                req.category,
                req.priority,
                req.status,
                new Date(req.created_at).toLocaleString(),
                `"${req.request_text.replace(/"/g, '""')}"`
            ].join(','))
        ];
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=заявки_${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csvRows.join('\n'));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка экспорта' });
    }
});

// === БЭКАПЫ ===
app.get('/api/backups', requireAuth, async (req, res) => {
    try {
        const backups = await backupManager.getBackupList();
        res.json(backups);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/backups/create', requireAuth, async (req, res) => {
    try {
        const { type = 'db' } = req.body;
        const backup = type === 'sql' ? await backupManager.createExportBackup() : await backupManager.createBackup();
        res.json({ success: true, message: 'Бэкап создан', backup });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка создания бэкапа' });
    }
});

app.post('/api/backups/restore', requireAuth, async (req, res) => {
    try {
        const { filename } = req.body;
        if (!filename) return res.status(400).json({ error: 'Укажите имя файла' });
        const result = await backupManager.restoreBackup(filename);
        res.json({ success: true, message: 'Бэкап восстановлен. Требуется перезапуск сервера.', result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка восстановления' });
    }
});

app.delete('/api/backups/:filename', requireAuth, async (req, res) => {
    try {
        const result = await backupManager.deleteBackup(req.params.filename);
        res.json({ success: true, message: 'Бэкап удалён', result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.use('/backups', requireAuth, express.static(path.join(__dirname, 'backups')));

// === HTML СТРАНИЦЫ ===
app.get('/', (req, res) => {
    if (req.session.userId) {
        res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
    } else {
        res.redirect('/login');
    }
});

app.get('/dashboard', (req, res) => {
    res.redirect('/');
});

app.get('/archive', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'archive.html'));
});

app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// 404
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'views', '404.html'));
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err.stack);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Файл слишком большой (максимум 5MB)' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Слишком много файлов (максимум 5)' });
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Автоматический бэкап
setInterval(async () => {
    try {
        await backupManager.createBackup();
        console.log('✅ Автоматический бэкап создан');
    } catch (error) {
        console.error('❌ Ошибка автоматического бэкапа:', error);
    }
}, 24 * 60 * 60 * 1000);

server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`🔐 Авторизация: http://localhost:${PORT}/login`);
    console.log(`👤 Администратор: admin / admin123`);
});