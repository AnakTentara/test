const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { openaiShakaru, getLocalClient } = require('./geminiRotator');
const { SYSTEM_PROMPT } = require('./persona');
const { chatMemories, haikaruMemories, saveSingleHaikaruMemory, saveSingleShakaruMemory, addAiSentMessage } = require('./dbHandler');
const { generateVoice, hasPhysicalAction } = require('./voiceHandler');
const { incrementVN, getPersonaForChat } = require('./agentHandler');
const { scrubThoughts } = require('./utils');
const { getConfig } = require('./configManager');
const { classifyComplexity, startThinkingAnimation } = require('./thinkingRouter');

// Dependency injection untuk sockSaran dari index.js
let sockSaranGlobal = null;
function setSockSaran(sock) {
    sockSaranGlobal = sock;
}

// Fitur untuk mengirim pesan panjang berpotong-potong
async function sendLongMessage(sock, chatId, text, quotedMsg) {
    const maxLength = 3000;
    if (text.length <= maxLength) {
        const sent = await sock.sendMessage(chatId, { text }, { quoted: quotedMsg });
        if (sent?.key?.id) addAiSentMessage(sent.key.id);
        return;
    }

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = "";

    for (const sentence of sentences) {
        if ((currentChunk.length + sentence.length) > maxLength) {
            const sent1 = await sock.sendMessage(chatId, { text: currentChunk.trim() });
            if (sent1?.key?.id) addAiSentMessage(sent1.key.id);
            await new Promise(resolve => setTimeout(resolve, 800));
            currentChunk = sentence;
        } else {
            currentChunk += " " + sentence;
        }
    }
    
    if (currentChunk.trim()) {
        const sent2 = await sock.sendMessage(chatId, { text: currentChunk.trim() });
        if (sent2?.key?.id) addAiSentMessage(sent2.key.id);
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
            model: getConfig().models?.shakaru || getConfig().models?.default || "gemini-3.1-flash-lite-preview",
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
            model: getConfig().models?.shakaru || getConfig().models?.default || "gemini-3.1-flash-lite-preview",
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
async function processShakaruChat(sock, chatId, textMessage, imageObj, msg, memoryFileName) {
    let historyObj = chatMemories.get(chatId) || { id: chatId, fileName: memoryFileName, summary: "", messages: [] };

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

    // LOGIC VOICE NOTE: Jika acell cuma ngetik teks murni tanpa aksi fisik
    const shouldVoiceNote = !hasPhysicalAction(textMessage) && !imageObj && textMessage.length > 0;
    if (shouldVoiceNote) {
        contextForAI.push({ 
            role: "system", 
            content: "[SISTEM: User HANYA BERDIALOG (tidak ada garis miring aksi fisik). KAMU WAJIB MEMBALAS HANYA DENGAN SATU ATAU DUA KALIMAT DIALOG MURNI! DILARANG KERAS MENGGUNAKAN SIMBOL MATA BINTANG (*) ATAU GARIS MIRING (_) ATAU DESKRIPSI FISIK APAPUN! Jawabanmu ini akan diconvert secara mentah menjadi AUDIO LISAN.]" 
        });
    }

    console.log(`[${new Date().toLocaleTimeString()}] Shakaru sedang berpikir... ${imageObj ? '(Dengan Gambar) ' : ''}${shouldVoiceNote ? '(Voice Mode)' : ''}`);
    await sock.sendPresenceUpdate('composing', chatId);

    try {
        const completion = await openaiShakaru.chat.completions.create({
            model: getConfig().models?.shakaru || getConfig().models?.default || "gemini-3.1-flash-lite-preview",
            messages: contextForAI,
            temperature: 0.8,
            max_tokens: 2000,
        });

        const rawAnswer = completion.choices[0].message.content;
        
        // Log RAW (Full termasuk Thought) ke console
        console.log(`\n============== SHAKARU AI RAW RESPONSE ==============`);
        console.log(rawAnswer);
        console.log(`======================================================\n`);

        const answer = scrubThoughts(rawAnswer);

        historyObj.messages.push({ role: "assistant", content: answer });
        chatMemories.set(chatId, historyObj);
        saveSingleShakaruMemory(chatId);

        console.log(`\n================== SHAKARU MEMBALAS ==================`);
        console.log(answer);
        console.log(`=====================================================\n`);

        if (shouldVoiceNote && !hasPhysicalAction(answer)) {
            // KIRIM SEBAGAI VOICE NOTE (PTT)
            try {
                await sock.sendPresenceUpdate('recording', chatId);
                console.log(`[🎤 VOICE NOTE] Sedang merender audio Shakaru...`);
                const audioBuffer = await generateVoice(answer);
                
                console.log(`[🎤 VOICE NOTE] Mengirim OGG/OPUS ke WhatsApp...`);
                const sentPtt = await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
                if (sentPtt?.key?.id) addAiSentMessage(sentPtt.key.id);
                incrementVN();
                console.log(`[🎤 VOICE NOTE] Terkirim Sukses!`);
            } catch (err) {
                console.error('[🎤 VOICE NOTE] Gagal kirim VN, fallback ke teks:', err);
                await sendLongMessage(sock, chatId, answer, msg);
            }
        } else {
            // KIRIM TEXT BIASA
            await sendLongMessage(sock, chatId, answer, msg);
        }

        await sock.sendPresenceUpdate('paused', chatId);

        generateAndSendSuggestions(chatId, historyObj);

    } catch (error) {
        console.error('\n❌ Gagal menghubungi Shakaru AI:', error.message);
        await sock.sendPresenceUpdate('paused', chatId);
    }
}

/**
 * ============================================================
 * DEEP THINKING SYSTEM: Dual-Model Router (26B → 31B)
 * ============================================================
 */

/**
 * Handle proses merespons chat Publik (Haikaru)
 * Dengan routing otomatis ke Deep Thinking (31B) untuk pertanyaan kompleks.
 */
async function processHaikaruChat(sock, chatId, textMessage, imageObj, msg, memoryFileName) {
    console.log(`\n[${new Date().toLocaleTimeString()}] [HAIKARU] Pesan Publik (${chatId}): ${textMessage} ${imageObj ? '[IMAGE]' : ''}`);

    let hHistory = haikaruMemories.get(chatId) || { id: chatId, fileName: memoryFileName, messages: [] };
    
    // Jangan push imageBase64 ke permanent history agar memory.json tidak bengkak GB-an.
    hHistory.messages.push({ role: "user", content: textMessage || "[Mengirim Gambar]" });

    if (hHistory.messages.length > 15) {
        hHistory.messages = hHistory.messages.slice(-15);
    }

    const persona = getPersonaForChat(chatId);
    const contextForAI = [
        { role: "system", content: persona }
    ];

    for (let i = 0; i < hHistory.messages.length - 1; i++) {
        contextForAI.push(hHistory.messages[i]);
    }
    


    // ============================================================
    // DEEP THINKING ROUTER
    // ============================================================
    const thinkingModel = getConfig().models?.thinking;
    const hasThinkingModel = !!thinkingModel;
    
    // Hanya classify jika ada thinking model yang dikonfigurasi DAN bukan gambar saja
    const isComplex = hasThinkingModel && textMessage && textMessage.length > 5
        ? await classifyComplexity(textMessage)
        : false;

    if (isComplex) {
        // ===== MODE DEEP THINKING (31B) =====
        console.log(`[🧠 DEEP THINK] Routing ke model thinking: ${thinkingModel}`);
        
        let thinkingAnim = null;
        let timeoutTimer = null;
        
        try {
            // Mulai animasi berfikir
            thinkingAnim = await startThinkingAnimation(sock, chatId, msg);
            
            // Injeksi instruksi spesifik COMPLEX sebagai suffix di akhir system prompt
            const _complexInstruct = `\n\n[ATURAN OUTPUT MUTLAK]\nKamu dalam mode DEEP THINKING. Silakan tuliskan pemikiran internalmu.\nNAMUN, Pesan WhatsApp final yang akan dikirim ke user WAJIB kamu bungkus di dalam tag XML <WhatsAppMessage>.\nContoh:\n<WhatsAppMessage>Halo kawan! Ada yang bisa gue bantu?</WhatsAppMessage>\n\nJANGAN BERHENTI SEBELUM MENGELUARKAN TAG TERSEBUT.`;

            // Siapkan context khusus deep thinking
            const deepContextForAI = [
                { role: "system", content: persona + _complexInstruct }
            ];
            
            // Rebuild context array untuk deepContext
            for (let i = 0; i < hHistory.messages.length - 1; i++) {
                deepContextForAI.push(JSON.parse(JSON.stringify(hHistory.messages[i])));
            }
            deepContextForAI.push(JSON.parse(JSON.stringify(buildVisionMessage(lastMsgHaikaru.role, lastMsgHaikaru.content, imageObj))));

            const localClient = getLocalClient();

            // Race: AI response vs timeout 15 menit
            const TIMEOUT_MS = 15 * 60 * 1000;
            
            const aiPromise = localClient.chat.completions.create({
                model: thinkingModel,
                messages: deepContextForAI,
                temperature: 0.7,
                max_tokens: 2000,
            });

            const timeoutPromise = new Promise((_, reject) => {
                timeoutTimer = setTimeout(() => {
                    reject(new Error('THINKING_TIMEOUT'));
                }, TIMEOUT_MS);
            });

            const completion = await Promise.race([aiPromise, timeoutPromise]);
            clearTimeout(timeoutTimer);

            const rawAnswer = completion.choices[0].message.content;

            // Log RAW (Full termasuk Thought) ke console
            console.log(`\n============== DEEP THINKING RAW RESPONSE ==============`);
            console.log(rawAnswer);
            console.log(`=========================================================\n`);

            const answer = scrubThoughts(rawAnswer);

            // Stop animasi (sukses)
            thinkingAnim.stop(true);

            // Simpan ke history & kirim jawaban
            hHistory.messages.push({ role: "assistant", content: answer });
            haikaruMemories.set(chatId, hHistory);
            saveSingleHaikaruMemory(chatId);

            // Delay kecil biar pesan "Selesai berfikir" terlihat dulu
            await new Promise(r => setTimeout(r, 500));
            await sendLongMessage(sock, chatId, answer, msg);
            await sock.sendPresenceUpdate('paused', chatId);

        } catch (error) {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            
            if (error.message === 'THINKING_TIMEOUT') {
                console.error('[🧠 DEEP THINK] Timeout 15 menit!');
                if (thinkingAnim) thinkingAnim.stop(false);
            } else {
                console.error('[🧠 DEEP THINK] Error:', error.message);
                if (thinkingAnim) thinkingAnim.stop(false);
                // Fallback: coba pakai 26B biasa
                console.log('[🧠 DEEP THINK] Fallback ke model biasa...');
                try {
                    // Fallback juga harus tetap mematuhi context simple karena dia failed kompleks
                    const fallbackContext = [
                        { role: "system", content: persona }
                    ];
                    for (let i = 0; i < hHistory.messages.length - 1; i++) {
                        fallbackContext.push(JSON.parse(JSON.stringify(hHistory.messages[i])));
                    }
                    fallbackContext.push(JSON.parse(JSON.stringify(buildVisionMessage(lastMsgHaikaru.role, lastMsgHaikaru.content, imageObj))));

                    const _fbMsg = fallbackContext[fallbackContext.length - 1];
                    const _fbInstruct = `\n\n[SYSTEM DIRECTIVE]\nThis is a SIMPLE conversation. DO NOT output your thought process. DO NOT use bullet points or planning. IMMEDIATELY output your final response wrapped in <WhatsAppMessage> tags.`;
                    if (_fbMsg && _fbMsg.role === 'user') {
                        if (typeof _fbMsg.content === 'string') {
                            _fbMsg.content += _fbInstruct;
                        } else if (Array.isArray(_fbMsg.content)) {
                            _fbMsg.content.push({ type: 'text', text: _fbInstruct });
                        }
                    }

                    const localClient = getLocalClient();
                    const fallback = await localClient.chat.completions.create({
                        model: getConfig().models?.haikaru || 'gemma-4-26b-a4b-it',
                        messages: fallbackContext,
                        temperature: 0.9,
                        max_tokens: 800,
                    });
                    const fbAnswer = scrubThoughts(fallback.choices[0].message.content);
                    hHistory.messages.push({ role: "assistant", content: fbAnswer });
                    haikaruMemories.set(chatId, hHistory);
                    saveSingleHaikaruMemory(chatId);
                    await sendLongMessage(sock, chatId, fbAnswer, msg);
                } catch (fbErr) {
                    console.error('[🧠 FALLBACK] Gagal total:', fbErr.message);
                }
            }
            await sock.sendPresenceUpdate('paused', chatId);
        }

    } else {
        // ===== MODE BIASA (26B) =====
        await sock.sendPresenceUpdate('composing', chatId);
        
        try {
            const _simpInstruct = `\n\n[ATURAN OUTPUT MUTLAK]\nKamu dalam mode SIMPLE. Segera berikan jawabanmu tanpa proses berpikir panjang.\nJawaban tersebut WAJIB dibungkus di dalam tag XML <WhatsAppMessage>.\nContoh:\n<WhatsAppMessage>Halo! Ada apa nih?</WhatsAppMessage>`;
            const simpleContextForAI = [
                { role: "system", content: persona + _simpInstruct }
            ];
            for (let i = 0; i < hHistory.messages.length - 1; i++) {
                simpleContextForAI.push(JSON.parse(JSON.stringify(hHistory.messages[i])));
            }
            simpleContextForAI.push(JSON.parse(JSON.stringify(buildVisionMessage(lastMsgHaikaru.role, lastMsgHaikaru.content, imageObj))));

            const localClient = getLocalClient();
            const completion = await localClient.chat.completions.create({
                model: getConfig().models?.haikaru || getConfig().models?.default || "gemma-4-26b-a4b-it",
                messages: simpleContextForAI,
                temperature: 0.9,
                max_tokens: 800,
            });

            const rawAnswer = completion.choices[0].message.content;

            // Log RAW (Full termasuk Thought) ke console
            console.log(`\n============== HAIKARU AI RAW RESPONSE ==============`);
            console.log(rawAnswer);
            console.log(`======================================================\n`);

            const answer = scrubThoughts(rawAnswer);

            hHistory.messages.push({ role: "assistant", content: answer });
            haikaruMemories.set(chatId, hHistory);
            saveSingleHaikaruMemory(chatId);

            await sendLongMessage(sock, chatId, answer, msg);
            await sock.sendPresenceUpdate('paused', chatId);

        } catch (error) {
            console.error('\n❌ Gagal menghubungi Haikaru AI:', error.message);
            await sock.sendPresenceUpdate('paused', chatId);
        }
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
            model: getConfig().models?.shakaru || getConfig().models?.default || "gemini-3.1-flash-lite-preview",
            messages: contextForAI,
            temperature: 0.8,
            max_tokens: 2000,
        });

        const rawAnswer = completion.choices[0].message.content;
        const answer = scrubThoughts(rawAnswer);

        historyObj.messages.push({ role: "assistant", content: answer });
        chatMemories.set(chatId, historyObj);
        saveSingleShakaruMemory(chatId);

        await sendLongMessage(sock, chatId, answer, msg);
        await sock.sendPresenceUpdate('paused', chatId);
        generateAndSendSuggestions(chatId, historyObj);
    } catch (error) {
        console.error('❌ Gagal continue:', error.message);
    }
}

/**
 * Hanya mengembalikan teks Haikaru tanpa mengirim ke WhatsApp
 * Digunakan untuk natural language VN (teks → audio → kirim)
 */
async function processHaikaruText(chatId, textMessage) {
    let hHistory = haikaruMemories.get(chatId) || { messages: [] };
    hHistory.messages.push({ role: "user", content: textMessage });
    if (hHistory.messages.length > 15) hHistory.messages = hHistory.messages.slice(-15);

    const contextForAI = [
        { role: "system", content: getPersonaForChat(chatId) + "\n\n[PENTING: Balas dengan SATU kalimat singkat dan natural, tanpa emoji, karena jawabanmu akan dirender jadi suara Audio.]" },
        ...hHistory.messages
    ];

    const localClient = getLocalClient();
    const completion = await localClient.chat.completions.create({
        model: getConfig().models?.haikaru || getConfig().models?.default || "gemini-3.1-flash-lite-preview",
        messages: contextForAI,
        temperature: 0.9,
        max_tokens: 200,
    });

    const rawAnswer = completion.choices[0].message.content;
    const answer = scrubThoughts(rawAnswer);
    
    hHistory.messages.push({ role: "assistant", content: answer });
    haikaruMemories.set(chatId, hHistory);
    saveSingleHaikaruMemory(chatId);
    return answer;
}

module.exports = {
    setSockSaran,
    processShakaruChat,
    processHaikaruChat,
    processHaikaruText,
    forceShakaruContinue
};
