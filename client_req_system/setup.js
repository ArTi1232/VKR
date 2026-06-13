const db = require('./database');
const fs = require('fs');
const path = require('path');

async function setup() {
    console.log('🚀 Настройка системы...\n');

    // Создаём папки
    const folders = ['public/uploads', 'backups', 'logs'];
    for (const folder of folders) {
        const folderPath = path.join(__dirname, folder);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            console.log(`✅ Создана папка: ${folder}`);
        }
    }

    // Копируем .env.example в .env, если его нет
    const envExample = path.join(__dirname, '.env.example');
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath) && fs.existsSync(envExample)) {
        fs.copyFileSync(envExample, envPath);
        console.log('✅ Создан файл .env (отредактируйте настройки)');
    }

    // Инициализация БД (администратор создастся автоматически в database.js)
    console.log('\n📊 Проверка базы данных...');
    const admin = await db.getAdminUser();
    if (!admin) {
        console.log('⚠️  Администратор не найден. БД будет создана при первом запуске сервера.');
    } else {
        console.log(`✅ Администратор уже существует: ${admin.username}`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('🎉 Настройка завершена!');
    console.log('='.repeat(50));
    console.log('\n🔐 Вход в систему:');
    console.log('   👑 Логин: admin');
    console.log('   🔑 Пароль: admin123');
    console.log('\n📧 Настройте SMTP в файле .env для получения уведомлений.');
    console.log('🚀 Запуск: npm start');
    console.log('🌐 Откройте: http://localhost:3001\n');

    process.exit(0);
}

setup().catch(err => {
    console.error('❌ Ошибка настройки:', err);
    process.exit(1);
});