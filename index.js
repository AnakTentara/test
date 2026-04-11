require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const { loadMemories, loadHaikaruMemories } = require('./handlers/dbHandler');
const { setSockSaran } = require('./handlers/aiChatHandler');
const { handleIncomingMessage } = require('./handlers/messageRouting');

// Matikan log bailey yang berlebihan
const logger = pino({ level: 'silent' });

let sockSaranCache = null;

async function createBot(sessionName, isShakaru) {
    const { state, saveCreds } = await useMultiFileAuthState(sessionName);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: state,
        generateHighQualityLinkPreview: true,
    });

    if (!isShakaru) {
        sockSaranCache = sock;
        setSockSaran(sock);
    }

    sock.ev.on('creds.update', saveCreds);

    const botName = isShakaru ? 'Shakaru (Utama)' : 'Sistem Saran';

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`\n======================================================`);
            console.log(`[BUTUH TINDAKAN!] Scan QR Code untuk ${botName}:`);
            qrcode.generate(qr, { small: true });
            console.log(`======================================================\n`);
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`❌ Koneksi ${botName} terputus. ${shouldReconnect ? 'Mencoba reconnect...' : 'Harap scan ulang QR.'}`);
            if (shouldReconnect) {
                createBot(sessionName, isShakaru);
            }
        } else if (connection === 'open') {
            if (isShakaru) {
                loadMemories();
                loadHaikaruMemories();
            }
            console.log(`✅ Berhasil terautentikasi: ${botName}`);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        
        // Oper seluruh logika pesan ke messageRouting modular
        await handleIncomingMessage(sock, msg, isShakaru);
    });

    return sock;
}

// Inisialisasi Bertahap (Dual-Client)
async function startDualBots() {
    console.log('🔄 Memulai Bot Shakaru (Roleplay Utama)...');
    await createBot('baileys_auth_info', true);

    setTimeout(() => {
        console.log('\n🔄 Memulai Bot Asisten Saran (Pemberi Pilihan AI)...');
        createBot('baileys_auth_info_saran', false);
    }, 7000);
}

startDualBots();
