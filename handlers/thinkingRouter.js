const { generateContentRotator } = require('./geminiRotator');
const { getConfig } = require('./configManager');

/**
 * Klasifikasi apakah pertanyaan membutuhkan deep thinking.
 * Menggunakan model ringan (26B) untuk evaluasi cepat.
 * @returns {Promise<boolean>} true jika COMPLEX
 */
async function classifyComplexity(textMessage) {
    try {
        const sys = "Tugasmu adalah mengklasifikasi apakah sebuah pesan WhatsApp dari user membutuhkan 'Deep Thinking' (penalaran mendalam/analisis panjang/pemecahan masalah) atau 'Simple' (obrolan santai/perintah pendek).\n\nBalas HANYA dengan satu kata: 'COMPLEX' atau 'SIMPLE'.";
        const res = await generateContentRotator("gemini-3.1-flash-lite-preview", [{ role: 'user', parts: [{ text: textMessage }] }], { systemInstruction: { parts: [{ text: sys }] }, temperature: 0.1, maxOutputTokens: 10 });
        return res.text.trim().toUpperCase() === 'COMPLEX';
    } catch (err) { return false; }
}

async function startThinkingAnimation(sock, chatId, quotedMsg) {
    const clockEmojis = ['🕛','🕧','🕐','🕜','🕑','🕝','🕒','🕞','🕓','🕟','🕔','🕠','🕕','🕡','🕖','🕢','🕗','🕣','🕘','🕤','🕙','🕥','🕚','🕦'];
    const dots = ['.', '..', '...'];
    let elapsed = 0;

    if (!quotedMsg || !quotedMsg.key) {
        return { stop: () => {}, getElapsed: () => 0 };
    }

    // Nyalakan typing indicator
    await sock.sendPresenceUpdate('composing', chatId);

    // Kirim pesan awal
    const sent = await sock.sendMessage(chatId, { text: `⏳ Berfikir. (0s)` }, { quoted: quotedMsg }).catch(() => null);
    const messageKey = sent?.key;

    // Reaksi awal
    await sock.sendMessage(chatId, { react: { text: clockEmojis[0], key: quotedMsg.key } }).catch(()=>{});

    // Interval: reaksi dan edit pesan setiap detik
    const interval = setInterval(async () => {
        elapsed++;
        const currentEmoji = clockEmojis[elapsed % clockEmojis.length];
        const dot = dots[elapsed % 3];
        const timeStr = formatDuration(elapsed);
        
        try {
            await sock.sendMessage(chatId, { react: { text: currentEmoji, key: quotedMsg.key } });
            if (messageKey) {
                await sock.sendMessage(chatId, { text: `⏳ Berfikir${dot} (${timeStr})`, edit: messageKey });
            }
            // Refresh typing indicator tiap detik
            await sock.sendPresenceUpdate('composing', chatId);
        } catch (e) {
            // Ignore errors
        }
    }, 1000);

    return {
        stop: (success = true) => {
            clearInterval(interval);
            // Reaksi final: 👨‍🍳 jika sukses, ⚠️ jika gagal
            const finalEmoji = success ? '👨‍🍳' : '⚠️';
            sock.sendMessage(chatId, { react: { text: finalEmoji, key: quotedMsg.key } }).catch(() => {});
            
            // Edit pesan final
            if (messageKey) {
                const timeStr = formatDuration(elapsed);
                const finalText = success ? `✅ Selesai berfikir (${timeStr})` : `❌ Gagal berfikir (timeout ${timeStr})`;
                sock.sendMessage(chatId, { text: finalText, edit: messageKey }).catch(() => {});
            }
        },
        getElapsed: () => elapsed
    };
}

/**
 * Mulai animasi loading teks pendek untuk AI normal (26b / Simple AI).
 * Teks akan diedit berurutan lalu dihentikan untuk nantinya ditimpa dengan jawaban akhir.
 * @returns {{ stop: Function, getKey: Function }}
 */
async function startNormalAnimation(sock, chatId, quotedMsg) {
    const emojis = ['🧭', '⏱️', '⏲️', '⏰', '🕰️', '⏳', '⌛'];
    let elapsed = 0;

    if (!quotedMsg || !quotedMsg.key) {
        return { stop: () => {}, getKey: () => null };
    }

    await sock.sendPresenceUpdate('composing', chatId);

    // Kirim pesan awal
    const sent = await sock.sendMessage(chatId, { text: `${emojis[0]} Menghubungi AI...` }, { quoted: quotedMsg }).catch(() => null);
    const messageKey = sent?.key;

    const interval = setInterval(async () => {
        elapsed++;
        const currentEmoji = emojis[elapsed % emojis.length];

        let currentText = "Berfikir...";
        if (elapsed < 2) currentText = "Menghubungi AI...";
        else if (elapsed < 3) currentText = "Meminta Request...";
        
        try {
            if (messageKey) {
                await sock.sendMessage(chatId, { text: `${currentEmoji} ${currentText}`, edit: messageKey });
            }
            await sock.sendPresenceUpdate('composing', chatId);
        } catch (e) {}
    }, 1000);

    return {
        stop: () => clearInterval(interval),
        getKey: () => messageKey
    };
}



module.exports = {
    classifyComplexity,
    startThinkingAnimation,
    startNormalAnimation
};
