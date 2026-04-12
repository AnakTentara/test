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
                    content: `Kamu adalah classifier pertanyaan. Tugasmu HANYA menentukan apakah pesan user membutuhkan analisis mendalam atau tidak.

Jawab HANYA dengan satu kata: SIMPLE atau COMPLEX.

SIMPLE: sapaan, obrolan santai, pertanyaan singkat, gossip, curhat, lelucon, minta rekomendasi sederhana.
COMPLEX: pertanyaan teknis/coding, analisis data, penjelasan konsep ilmiah, matematika, debugging, perbandingan mendalam, essay, soal ujian, pertanyaan yang butuh reasoning panjang.

Contoh SIMPLE: "halo", "apa kabar", "kamu siapa", "rekomendasiin lagu dong", "lucu banget :v"
Contoh COMPLEX: "jelaskan cara kerja transformer neural network", "buatkan kode python sorting", "analisis perbedaan TCP dan UDP", "kenapa langit berwarna biru secara fisika"`
                },
                { role: 'user', content: textMessage }
            ],
            temperature: 0.1,
            max_tokens: 10,
        });

        const result = (completion.choices[0].message.content || '').trim().toUpperCase();
        console.log(`[🧠 CLASSIFIER] "${textMessage.substring(0, 40)}..." → ${result}`);
        return result.includes('COMPLEX');
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
 * Mulai animasi "Berfikir" di WhatsApp dengan edit pesan setiap detik.
 * @returns {{ stop: Function, getKey: Function }} controller untuk menghentikan animasi
 */
async function startThinkingAnimation(sock, chatId, quotedMsg) {
    const dots = ['.', '..', '...'];
    let elapsed = 0;

    // Kirim pesan awal
    const sent = await sock.sendMessage(chatId, { text: `⏳ Berfikir. (0s)` }, { quoted: quotedMsg });
    const messageKey = sent.key;

    // Nyalakan typing indicator
    await sock.sendPresenceUpdate('composing', chatId);

    // Interval: edit pesan setiap detik
    const interval = setInterval(async () => {
        elapsed++;
        const dot = dots[elapsed % 3];
        const timeStr = formatDuration(elapsed);
        try {
            await sock.sendMessage(chatId, {
                text: `⏳ Berfikir${dot} (${timeStr})`,
                edit: messageKey
            });
            // Refresh typing indicator
            await sock.sendPresenceUpdate('composing', chatId);
        } catch (e) {
            // Ignore edit errors (message might be too old)
        }
    }, 1000);

    return {
        stop: (success = true) => {
            clearInterval(interval);
            const timeStr = formatDuration(elapsed);
            // Edit pesan final
            const finalText = success
                ? `✅ Selesai berfikir (${timeStr})`
                : `❌ Gagal berfikir (timeout ${timeStr})`;
            sock.sendMessage(chatId, { text: finalText, edit: messageKey }).catch(() => {});
        },
        getElapsed: () => elapsed,
        getKey: () => messageKey
    };
}

module.exports = {
    classifyComplexity,
    startThinkingAnimation
};
