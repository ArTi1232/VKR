const socketIo = require('socket.io');

class SocketManager {
    constructor(server) {
        this.io = socketIo(server, {
            cors: {
                origin: process.env.NODE_ENV === 'production' 
                    ? process.env.APP_URL 
                    : "http://localhost:3001",
                methods: ["GET", "POST"],
                credentials: true
            },
            pingTimeout: 60000,
            pingInterval: 25000
        });
        
        this.users = new Map(); // userId -> socketId
        
        this.init();
    }
    
    init() {
        this.io.on('connection', (socket) => {
            console.log('🔌 Новое подключение Socket.io:', socket.id);
            
            // Аутентификация пользователя
            socket.on('authenticate', (userId) => {
                this.users.set(userId, socket.id);
                console.log(`👤 Пользователь ${userId} аутентифицирован через socket`);
                
                // Сохраняем userId в socket для последующего использования
                socket.userId = userId;
                
                // Отправляем список онлайн пользователей
                this.updateOnlineUsers();
            });
            
            // Отключение
            socket.on('disconnect', () => {
                console.log(`🔌 Отключение: ${socket.id}`);
                
                // Удаляем пользователя из списка онлайн
                if (socket.userId) {
                    this.users.delete(socket.userId);
                    console.log(`👤 Пользователь ${socket.userId} отключился`);
                }
                
                this.updateOnlineUsers();
            });
            
            // Присоединение к комнате заявки
            socket.on('join-request', (requestId) => {
                socket.join(`request-${requestId}`);
                console.log(`📋 Socket ${socket.id} присоединился к заявке ${requestId}`);
            });
            
            // Покидание комнаты заявки
            socket.on('leave-request', (requestId) => {
                socket.leave(`request-${requestId}`);
                console.log(`📋 Socket ${socket.id} покинул заявку ${requestId}`);
            });
            
            // Обработка ошибок
            socket.on('error', (error) => {
                console.error('❌ Ошибка Socket.io:', error);
            });
        });
    }
    
    // Отправка уведомления о новой заявке
    notifyNewRequest(request, createdBy) {
        const notification = {
            type: 'new_request',
            request: request,
            createdBy: createdBy,
            timestamp: new Date().toISOString()
        };
        
        // Отправляем всем операторам и админам
        this.io.emit('notification', notification);
        console.log('📢 Отправлено уведомление о новой заявке');
    }
    
    // Отправка уведомления об изменении статуса
    notifyStatusChange(requestId, oldStatus, newStatus, changedBy) {
        const notification = {
            type: 'status_change',
            requestId: requestId,
            oldStatus: oldStatus,
            newStatus: newStatus,
            changedBy: changedBy,
            timestamp: new Date().toISOString()
        };
        
        // Отправляем в комнату конкретной заявки
        this.io.to(`request-${requestId}`).emit('notification', notification);
        console.log(`📢 Отправлено уведомление об изменении статуса заявки ${requestId}`);
    }
    
    // Отправка уведомления о новом комментарии
    notifyNewComment(requestId, comment, commenter) {
        const notification = {
            type: 'new_comment',
            requestId: requestId,
            comment: comment,
            commenter: commenter,
            timestamp: new Date().toISOString()
        };
        
        // Отправляем в комнату конкретной заявки
        this.io.to(`request-${requestId}`).emit('notification', notification);
        console.log(`📢 Отправлено уведомление о новом комментарии к заявке ${requestId}`);
    }
    
    // Отправка уведомления о назначении заявки
    notifyAssignment(requestId, assignedTo) {
        const notification = {
            type: 'assignment',
            requestId: requestId,
            assignedTo: assignedTo,
            timestamp: new Date().toISOString()
        };
        
        // Отправляем конкретному пользователю если он онлайн
        const userSocketId = this.users.get(assignedTo.id);
        if (userSocketId) {
            this.io.to(userSocketId).emit('notification', notification);
            console.log(`📢 Отправлено уведомление о назначении заявки пользователю ${assignedTo.username}`);
        }
    }
    
    // Уведомление о новом файле
    notifyNewAttachment(requestId, attachment, uploadedBy) {
        const notification = {
            type: 'new_attachment',
            requestId: requestId,
            attachment: attachment,
            uploadedBy: uploadedBy,
            timestamp: new Date().toISOString()
        };
        
        // Отправляем в комнату конкретной заявки
        this.io.to(`request-${requestId}`).emit('notification', notification);
        console.log(`📎 Уведомление о новом файле для заявки ${requestId}`);
    }
    
    // Обновление списка онлайн пользователей
    updateOnlineUsers() {
        const onlineUsers = Array.from(this.users.keys());
        this.io.emit('online-users', onlineUsers);
    }
    
    // Получение количества онлайн пользователей
    getOnlineCount() {
        return this.users.size;
    }
}

module.exports = SocketManager;