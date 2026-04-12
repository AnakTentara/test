const { getLocalClient } = require('./geminiRotator');
const { getConfig } = require('./configManager');

/**
 * Klasifikasi apakah pertanyaan membutuhkan deep thinking.
 * Menggunakan model ringan (26B) untuk evaluasi cepat.
 * @returns {Promise<boolean>} true jika COMPLEX
 */
async function classifyComplexity(textMessage) {
    try {
        const localClient = getLocalClient();
        const completion = await localClient.chat.completions.create({
            model: getConfig().models?.haikaru || 'gemma-4-26b-a4b-it',
            messages: [
                {
                    role: 'system',
                    content: `Classify the user message into one category: SIMPLE or COMPLEX.
Rules:
- SIMPLE: Greetings, casual chat, short questions.
- COMPLEX: Technical, coding, math, deep analysis.
Output ONLY the word SIMPLE or COMPLEX.`
                },
                { role: 'user', content: textMessage }
            ],
            temperature: 0.1,
            max_tokens: 10,
        });

        const result = (completion.choices[0].message.content || '').toUpperCase();
        console.log(`[🧠 CLASSIFIER RAW] ${result.replace(/\n/g, ' ')}`);
        
        // Ekstrak kata SIMPLE atau COMPLEX yang paling terakhir muncul
        const matches = result.match(/(SIMPLE|COMPLEX)/g);
        const verdict = matches ? matches[matches.length - 1] : 'SIMPLE';
        
        console.log(`[🧠 CLASSIFIER] "${textMessage.substring(0, 40)}..." → ${verdict}`);
        return verdict === 'COMPLEX';
    } catch (err) {
        console.error('[🧠 CLASSIFIER ERROR]', err.message);
        return false; // Default ke SIMPLE jika classifier gagal
    }
}

/**
 * Format durasi detik menjadi string yang readable.
 * 5 → "5s", 75 → "1m 15s"
 */
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

/**
 * Mulai animasi "Berfikir" di WhatsApp dengan reaksi emoji setiap detik.
 * @returns {{ stop: Function }} controller untuk menghentikan animasi
 */
async function startThinkingAnimation(sock, chatId, quotedMsg) {
    const clockEmojis = ['🕛','🕧','🕐','🕜','🕑','🕝','🕒','🕞','🕓','🕟','🕔','🕠','🕕','🕡','🕖','🕢','🕗','🕣','🕘','🕤','🕙','🕥','🕚','🕦'];
    let elapsed = 0;

    if (!quotedMsg || !quotedMsg.key) {
        return { stop: () => {}, getElapsed: () => 0 };
    }

    // Nyalakan typing indicator
    await sock.sendPresenceUpdate('composing', chatId);

    // Reaksi awal
    await sock.sendMessage(chatId, { react: { text: clockEmojis[0], key: quotedMsg.key } }).catch(()=>{});

    // Interval: reaksi pesan setiap detik
    const interval = setInterval(async () => {
        elapsed++;
        const currentEmoji = clockEmojis[elapsed % clockEmojis.length];
        
        try {
            await sock.sendMessage(chatId, { react: { text: currentEmoji, key: quotedMsg.key } });
            // Refresh typing indicator tiap detik
            await sock.sendPresenceUpdate('composing', chatId);
        } catch (e) {
            // Ignore errors
        }
    }, 1000);

    return {
        stop: (success = true) => {
            clearInterval(interval);
            // Reaksi final: 👨‍🍳 jika sukses cooked, ⚠️ jika timeout/gagal
            const finalEmoji = success ? '👨‍🍳' : '⚠️';
            sock.sendMessage(chatId, { react: { text: finalEmoji, key: quotedMsg.key } }).catch(() => {});
        },
        getElapsed: () => elapsed
    };
}

module.exports = {
    classifyComplexity,
    startThinkingAnimation
};
