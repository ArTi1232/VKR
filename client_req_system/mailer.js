const nodemailer = require('nodemailer');
require('dotenv').config();

class Mailer {
    constructor() {
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT) || 587,
                secure: false,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
                tls: { rejectUnauthorized: false }
            });
            this.verifyConnection();
        } else {
            console.log('📧 SMTP не настроен. Email уведомления отключены.');
            this.transporter = null;
        }
    }

    async verifyConnection() {
        if (!this.transporter) return;
        try {
            await this.transporter.verify();
            console.log('✅ SMTP сервер готов');
        } catch (error) {
            console.error('❌ Ошибка SMTP:', error.message);
            this.transporter = null;
        }
    }

    async sendNewRequestNotification(request, adminUser) {
        if (!this.transporter) return false;
        try {
            const subject = `Новая заявка #${request.id}: ${request.client_name}`;
            const toEmail = process.env.ADMIN_EMAIL || adminUser.email;
            const html = `...`; // можно использовать шаблон из исходного mailer.js
            const mailOptions = {
                from: `"Система заявок" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
                to: toEmail,
                subject,
                html
            };
            await this.transporter.sendMail(mailOptions);
            console.log(`✅ Email отправлен: ${subject}`);
            return true;
        } catch (error) {
            console.error('❌ Ошибка отправки email:', error);
            return false;
        }
    }

    async sendStatusUpdateNotification(request, oldStatus, newStatus, changedBy) {
        if (!this.transporter || !request.email) return false;
        // аналогично оригиналу
    }

    async sendCommentNotification(request, comment, commenter) {
        if (!this.transporter || !request.email) return false;
        // аналогично оригиналу
    }
}

module.exports = new Mailer();