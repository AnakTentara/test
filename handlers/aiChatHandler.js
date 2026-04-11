const { openaiShakaru, getLocalClient } = require('./geminiRotator');
const { SYSTEM_PROMPT, HAIKARU_PERSONA } = require('./persona');
const { chatMemories, haikaruMemories, saveHaikaruMemories, saveMemories } = require('./dbHandler');

// Dependency injection untuk sockSaran dari index.js
let sockSaranGlobal = null;
function setSockSaran(sock) {
    sockSaranGlobal = sock;
}

// Fitur untuk mengirim pesan panjang berpotong-potong
async function sendLongMessage(sock, chatId, text, quotedMsg) {
    const maxLength = 3000;
    if (text.length <= maxLength) {
        await sock.sendMessage(chatId, { text }, { quoted: quotedMsg });
        return;
    }

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = "";

    for (const sentence of sentences) {
        if ((currentChunk.length + sentence.length) > maxLength) {
            await sock.sendMessage(chatId, { text: currentChunk.trim() });
            await new Promise(resolve => setTimeout(resolve, 800));
            currentChunk = sentence;
        } else {
            currentChunk += " " + sentence;
        }
    }
    
    if (currentChunk.trim()) {
        await sock.sendMessage(chatId, { text: currentChunk.trim() });
    }
}

/**
 * Summarize history Shakaru jika melebihi panjang 50
 */
async function summarizeHistory(chatId, historyObj) {
    if (historyObj.messages.length <= 50) return historyObj;

    console.log(`\n[SUMMARIZE] Merangkum pesan lama untuk ${chatId}...`);
    const toSummarize = historyObj.messages.slice(0, 15);
    const remainder = historyObj.messages.slice(15);

    const contextText = toSummarize.map(m => `${m.role}: ${m.content}`).join('\n');
    let prevSummary = historyObj.summary ? `Ringkasan sebelumnya: ${historyObj.summary}\n` : "";

    const promptSummarize = `Tugasmu adalah merangkum cerita roleplay masa lalu secara PENTING, SINGKAT dan FOKUS PADA HUBUNGAN Shakaru & Acell.
${prevSummary}
Pesan lama yang harus dirangkum:
${contextText}

BERIKAN MURNI HASIL RINGKASAN NYA SAJA. Jangan ada kata pembuka. Ingat poin-poin penting kemesraan/konflik mereka!`;

    try {
        const completion = await openaiShakaru.chat.completions.create({
            model: "gemini-3.1-flash-lite-preview",
            messages: [{ role: "user", content: promptSummarize }],
            temperature: 0.5,
            max_tokens: 500,
        });

        historyObj.summary = completion.choices[0].message.content;
        historyObj.messages = remainder;
        console.log(`[SUMMARIZE] Rangkuman baru selesai: ${historyObj.summary}`);
    } catch (error) {
        console.error('[SUMMARIZE ERROR]', error.message);
    }

    return historyObj;
}

/**
 * Handler generate dan send 3 opsi balasan Acell
 */
async function generateAndSendSuggestions(chatId, historyObj) {
    if (!sockSaranGlobal) {
        console.log('[SISTEM SARAN] Socket Saran belum terhubung. Saran dibatalkan.');
        return;
    }

    try {
        console.log(`\n[SISTEM SARAN] Sedang merumuskan 3 opsi balasan untuk Acell...`);
        const contextForAI = [
            { role: "system", content: "Kamu adalah DIREKTUR SISTEM ROLEPLAY (SISTEM SARAN). Kamu mengetahui segala Latar Belakang Shakaru dan Acell:\n\n" + SYSTEM_PROMPT }
        ];

        if (historyObj.summary) {
            contextForAI.push({ role: "system", content: `PENGINGAT KONTEKS MASA LALU: ${historyObj.summary}` });
        }

        const chatToInclude = historyObj.messages.slice(-15);
        contextForAI.push(...chatToInclude);

        const promptSaran = `Berhenti bermain peran sebagai Shakaru! Tugasmu sekarang sebagai Sistem adalah memberikan 3 opsi balasan dari sudut pandang Acell untuk merespon adegan terakhir Shakaru di atas.
SANGAT PENTING: Terapkan format ini pada setiap saranmu:
- Dialog suara wajib DITEBALKAN (*teks*)
- Narasi/aksi fisik wajib DIMIRINGKAN (_teks_)

Opsi yang dibutuhkan dan harus sangat menyatu dengan jalan cerita di atas:
1. Mode Pasrah/Submisif (Menerima perlakuan mafia posesif ini dengan luluh/takut)
2. Mode Menolak/Berontak (Melawan dominasinya secara fisik/verbal)
3. Mode Merayu Balik/Flirty (Balik menggoda/memancing hasrat liarnya lebih jauh)

BERIKAN MURNI 3 BALASAN SAJA! Pisahkan setiap opsi dengan kata kunci "[SPLIT]". Jangan tambahkan nomor urut seperti "1.", "2.".
Format mentah yang wajib dicontoh:
*Opsi 1 (Submisif):*
_mengangguk pelan_ *"iya sayang"*
[SPLIT]
*Opsi 2 (Berontak):*
_mendorong dadanya_ *"lepasin aku!"*
[SPLIT]
*Opsi 3 (Flirty):*
_memeluk lehernya_ *"kamu mau hukum aku?"*`;

        contextForAI.push({ role: "system", content: promptSaran });

        const completion = await openaiShakaru.chat.completions.create({
            model: "gemini-3.1-flash-lite-preview",
            messages: contextForAI,
            temperature: 0.8,
            max_tokens: 1500,
        });

        let suggestionsText = completion.choices[0].message.content;
        if (suggestionsText.includes('|||')) suggestionsText = suggestionsText.replace(/\|\|\|/g, '[SPLIT]');
        
        const optionsArray = suggestionsText.split('[SPLIT]').map(t => t.trim()).filter(Boolean);

        await sockSaranGlobal.sendMessage(chatId, { text: `🌸 *SARAN BALASAN (Pilih & Edit)* 🌸` });
        await new Promise(resolve => setTimeout(resolve, 1000));

        for (let i = 0; i < optionsArray.length; i++) {
            await sockSaranGlobal.sendMessage(chatId, { text: optionsArray[i] });
            if (i < optionsArray.length - 1) await new Promise(resolve => setTimeout(resolve, 800));
        }
        
        console.log(`[SISTEM SARAN] 4 Pesan berhasil dikirim ke Acell.`);
    } catch (err) {
        console.error('[SISTEM SARAN] Error membuat saran:', err.message);
    }
}

/**
 * Format message array untuk OpenAI / Gemini Vision
 */
function buildVisionMessage(role, textContent, imageObj) {
    if (imageObj) {
        return {
            role: role,
            content: [
                { type: "text", text: textContent || "Apa isi gambar ini?" },
                {
                    type: "image_url",
                    image_url: { url: `data:${imageObj.mimeType};base64,${imageObj.data}` }
                }
            ]
        };
    } else {
        return { role: role, content: textContent };
    }
}

/**
 * Handle proses merespons chat Roleplay (Shakaru)
 */
async function processShakaruChat(sock, chatId, textMessage, imageObj, msg) {
    let historyObj = chatMemories.get(chatId) || { summary: "", messages: [] };

    const currentTimestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', timeZoneName: 'short' });
    const userPromptWithContext = `[INFO WAKTU SAAT INI UNTUKMU: ${currentTimestamp}]\nAcell: ${textMessage}`;

    // Simpan history dengan info image (untuk debugging/struktur saja, tidak bisa disave json ke native memory krn base64 terlalu besar, 
    // jadi kita hanya tembak gambar itu sekali untuk prompt saat ini saja)
    historyObj.messages.push({ role: "user", content: userPromptWithContext });

    if (historyObj.messages.length > 50) {
        historyObj = await summarizeHistory(chatId, historyObj);
    }

    const contextForAI = [ { role: "system", content: SYSTEM_PROMPT } ];
    
    if (historyObj.summary) {
        contextForAI.push({ role: "system", content: `PENGINGAT KONTEKS MASA LALU: ${historyObj.summary}` });
    }
    
    // Push seluruh history lama sebagai teks
    for (let i = 0; i < historyObj.messages.length - 1; i++) {
        contextForAI.push(historyObj.messages[i]);
    }

    // Push prompt TERAKHIR (yang dibarengi gambar jika ada saat ini)
    const lastMsg = historyObj.messages[historyObj.messages.length - 1];
    contextForAI.push(buildVisionMessage(lastMsg.role, lastMsg.content, imageObj));

    console.log(`[${new Date().toLocaleTimeString()}] Shakaru sedang berpikir... ${imageObj ? '(Dengan Gambar)' : ''}`);
    await sock.sendPresenceUpdate('composing', chatId);

    try {
        const completion = await openaiShakaru.chat.completions.create({
            model: "gemini-3.1-flash-lite-preview",
            messages: contextForAI,
            temperature: 0.8,
            max_tokens: 2000,
        });

        const answer = completion.choices[0].message.content;

        historyObj.messages.push({ role: "assistant", content: answer });
        chatMemories.set(chatId, historyObj);
        saveMemories();

        console.log(`\n================== SHAKARU MEMBALAS ==================`);
        console.log(answer);
        console.log(`=====================================================\n`);

        await sendLongMessage(sock, chatId, answer, msg);
        await sock.sendPresenceUpdate('paused', chatId);

        generateAndSendSuggestions(chatId, historyObj);

    } catch (error) {
        console.error('\n❌ Gagal menghubungi Shakaru AI:', error.message);
        await sock.sendPresenceUpdate('paused', chatId);
    }
}

/**
 * Handle proses merespons chat Publik (Haikaru)
 */
async function processHaikaruChat(sock, chatId, textMessage, imageObj, msg) {
    console.log(`\n[${new Date().toLocaleTimeString()}] [HAIKARU] Pesan Publik (${chatId}): ${textMessage} ${imageObj ? '[IMAGE]' : ''}`);

    let hHistory = haikaruMemories.get(chatId) || { messages: [] };
    
    // Jangan push imageBase64 ke permanent history agar memory.json tidak bengkak GB-an.
    // Kita hanya menggunakannya untuk *contextForAI* yang dikirim saat ini.
    hHistory.messages.push({ role: "user", content: textMessage || "[Mengirim Gambar]" });

    if (hHistory.messages.length > 15) {
        hHistory.messages = hHistory.messages.slice(-15);
    }

    const contextForAI = [
        { role: "system", content: HAIKARU_PERSONA }
    ];

    for (let i = 0; i < hHistory.messages.length - 1; i++) {
        contextForAI.push(hHistory.messages[i]);
    }
    
    // Kirim gambar di message terakhir jika ada
    const lastMsgHaikaru = hHistory.messages[hHistory.messages.length - 1];
    contextForAI.push(buildVisionMessage(lastMsgHaikaru.role, lastMsgHaikaru.content, imageObj));

    await sock.sendPresenceUpdate('composing', chatId);

    try {
        const localClient = getLocalClient();
        const completion = await localClient.chat.completions.create({
            model: "gemini-3.1-flash-lite-preview",
            messages: contextForAI,
            temperature: 0.9,
            max_tokens: 800,
        });

        const answer = completion.choices[0].message.content;

        hHistory.messages.push({ role: "assistant", content: answer });
        haikaruMemories.set(chatId, hHistory);
        saveHaikaruMemories();

        console.log(`\n============== HAIKARU ASISTEN MEMBALAS ==============`);
        console.log(answer);
        console.log(`======================================================\n`);

        await sendLongMessage(sock, chatId, answer, msg);
        await sock.sendPresenceUpdate('paused', chatId);

    } catch (error) {
        console.error('\n❌ Gagal menghubungi Haikaru AI:', error.message);
        await sock.sendPresenceUpdate('paused', chatId);
    }
}

/**
 * Handle proses fungsi /continue (Paksa AI Lanjut) 
 */
async function forceShakaruContinue(sock, chatId, msg) {
    const historyObj = chatMemories.get(chatId);
    if (!historyObj || historyObj.messages.length === 0) {
        await sock.sendMessage(chatId, { text: '❌ Tidak ada riwayat untuk dilanjutkan. Ketik /rp.' }, { quoted: msg });
        return;
    }

    console.log(`\n[${new Date().toLocaleTimeString()}] Meminta AI untuk melanjutkan cerita...`);
    await sock.sendPresenceUpdate('composing', chatId);

    const contextForAI = [{ role: "system", content: SYSTEM_PROMPT }];
    if (historyObj.summary) {
        contextForAI.push({ role: "system", content: `PENGINGAT KONTEKS MASA LALU: ${historyObj.summary}` });
    }
    contextForAI.push(...historyObj.messages);
    contextForAI.push({ role: "user", content: '[SISTEM: Lanjutkan alur cerita terakhirmu sebagai Shakaru secara natural. Jangan mengulangi apa yang sudah dikatakan.]' });

    try {
        const completion = await openaiShakaru.chat.completions.create({
            model: "gemini-3.1-flash-lite-preview",
            messages: contextForAI,
            temperature: 0.8,
            max_tokens: 2000,
        });

        const answer = completion.choices[0].message.content;
        historyObj.messages.push({ role: "assistant", content: answer });
        chatMemories.set(chatId, historyObj);
        saveMemories();

        await sendLongMessage(sock, chatId, answer, msg);
        await sock.sendPresenceUpdate('paused', chatId);
        generateAndSendSuggestions(chatId, historyObj);
    } catch (error) {
        console.error('❌ Gagal continue:', error.message);
    }
}

module.exports = {
    setSockSaran,
    processShakaruChat,
    processHaikaruChat,
    forceShakaruContinue
};
