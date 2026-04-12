/**
 * Membersihkan respon AI dari blok pemikiran (Chain of Thought / CoT)
 * dan memperbaiki format agar sesuai dengan standar WhatsApp.
 * 
 * STRATEGI: "Biarkan model mikir, kita yang bersihkan."
 * Model Gemma-4 tidak punya pemisah thinking bawaan, jadi scrubber ini
 * harus bisa menangani SEMUA kemungkinan format output.
 */
function scrubThoughts(text) {
    if (!text) return text;
    let cleaned = text;

    // ============================================================
    // LAYER 1: Ekstraksi tag eksplisit (paling andal jika ada)
    // ============================================================

    // Pre-processing: Hapus mention tag yang dibungkus backtick (model suka nulis `<thought>` dan `<WhatsAppMessage>` sebagai referensi format)
    cleaned = cleaned.replace(/`<\/?(?:thought|WhatsAppMessage)>`/gi, '[TAG_REF]');

    // 1A: Tag <WhatsAppMessage> (Claude-style yang kita inject)
    const startTag = '<WhatsAppMessage>';
    const endTag = '</WhatsAppMessage>';
    const lastStartIdx = cleaned.lastIndexOf(startTag);
    const lastEndIdx = cleaned.lastIndexOf(endTag);

    if (lastStartIdx !== -1) {
        let extracted = '';
        if (lastEndIdx !== -1 && lastEndIdx > lastStartIdx) {
            extracted = cleaned.substring(lastStartIdx + startTag.length, lastEndIdx).trim();
        } else {
            extracted = cleaned.substring(lastStartIdx + startTag.length).trim();
        }
        extracted = extracted.replace(/<\/WhatsAppMessage>?/gi, '').replace(/```+$/g, '').replace(/`+$/g, '').trim();
        // Validasi: pastikan hasil ekstraksi adalah jawaban nyata, bukan sisa CoT pendek
        if (extracted.length > 10 && !looksLikeThinking(extracted)) {
            return cleanWhatsAppFormat(extracted);
        }
    }

    // 1B: Pemisah "=== FINAL ANSWER ===" 
    const finalAnswerMatch = /^(?:=== FINAL ANSWER ===|FINAL ANSWER:)\s*([\s\S]*?)(?:===|$)/im.exec(cleaned);
    if (finalAnswerMatch && finalAnswerMatch[1].trim() !== '') {
        return cleanWhatsAppFormat(finalAnswerMatch[1].trim());
    }

    // 1C: Hapus blok <thought>...</thought> yang sempurna
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
    // Juga hapus <thought> yang terbuka tanpa penutup (truncated) — hanya di awal baris
    cleaned = cleaned.replace(/^\s*<thought>[\s\S]*/gim, '').trim();

    // Jika setelah pembersihan tag masih ada isi, cek dulu apakah bersih
    if (cleaned.length > 0 && !looksLikeThinking(cleaned)) {
        return cleanWhatsAppFormat(cleaned);
    }

    // ============================================================
    // LAYER 2: Heuristic Bullet-Point CoT Detection
    // Mendeteksi pola "mikir keras" khas Gemma-4:
    //   *   User: ...
    //   *   Message: ...
    //   *   Draft: ...
    // ============================================================

    if (looksLikeThinking(cleaned)) {
        const extracted = extractAnswerFromThinking(cleaned);
        if (extracted && extracted.length > 3) {
            return cleanWhatsAppFormat(extracted);
        }
    }

    return cleanWhatsAppFormat(cleaned);
}

/**
 * Deteksi apakah sebuah teks kemungkinan besar adalah CoT bocor.
 */
function looksLikeThinking(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return false;

    // Hitung baris yang diawali pola bullet-point thinking
    let thinkingCount = 0;
    for (const line of lines) {
        const t = line.trim();
        if (
            /^\*\s+/.test(t) ||                    // *   bullet (trimmed)
            /^\*\s*\*[A-Za-z]/.test(t) ||          // *   *Draft:* / *   *Applying*
            /^\*\s+\(?[A-Z][a-zA-Z\s\/-]*\)?:/.test(t) || // *   User: / *   Message:
            /^\(\w+/.test(t) ||                     // (Self-correction:...)
            /^-\s+(Single asterisk|No double|Tags used|Simple mode|Draft|Applying|Constraint|Tone|Output)/i.test(t)
        ) {
            thinkingCount++;
        }
    }

    // Jika >30% baris terlihat seperti thinking, anggap CoT
    return thinkingCount >= 2 && (thinkingCount / lines.length) > 0.25;
}

/**
 * Ekstrak jawaban final dari teks yang terdeteksi sebagai CoT bocor.
 * Mencoba berbagai strategi extraksi dari yang paling reliable ke fallback.
 */
function extractAnswerFromThinking(text) {
    // === Strategi A: Cari marker yang menandai jawaban final ===
    const finalMarkers = [
        // Marker paling kuat (label "Final" / "Response" / "Polish" / "Applying")
        '*Final Text Construction:*', 'Final Text Construction:',
        '*Final Polish:*', 'Final Polish:',
        '*Final Version:*', 'Final Version:',
        '*Final Answer:*', 'Final Answer:',
        '*Final:*', 'Final:',
        '*Applying Formatting Rules:*', 'Applying Formatting Rules:',
        '*Applying Bold:*', 'Applying Bold:',
        '*Response:*', 'Response:',
    ];

    // Marker lemah (Draft — seringkali ada versi awal DAN versi final, ambil yang terakhir)
    const draftMarkers = [
        '*Draft:*', 'Draft:',
        '*Attempt 2*', '*Attempt 3*',
        '*Haikaru Persona*',
    ];

    // Gabungkan, cari dari yang terkuat dulu
    const allMarkers = [...finalMarkers, ...draftMarkers];

    for (const marker of allMarkers) {
        const idx = text.lastIndexOf(marker);
        if (idx !== -1) {
            let extracted = text.substring(idx + marker.length).trim();

            // Bersihkan: Buang baris-baris yang masih berbau checklist di bawahnya
            const cleanedLines = [];
            let hitCleanContent = false;
            for (const line of extracted.split('\n')) {
                const t = line.trim();

                // Skip baris checklist/verification di akhir
                if (hitCleanContent && isChecklistLine(t)) continue;

                // Skip baris kosong di awal sebelum konten mulai
                if (!hitCleanContent && t.length === 0) continue;

                // Baris pertama yang bukan checklist = mulai konten jawaban
                if (!hitCleanContent && !isChecklistLine(t)) {
                    hitCleanContent = true;
                }

                if (hitCleanContent) {
                    cleanedLines.push(line);
                }
            }

            // Trim trailing checklist lines
            while (cleanedLines.length > 0 && isChecklistLine(cleanedLines[cleanedLines.length - 1].trim())) {
                cleanedLines.pop();
            }

            extracted = cleanedLines.join('\n').trim();

            // Buang prefix asterisk jika seluruh teks dimulai dgn satu bullet
            if (/^\*\s+/.test(extracted) && extracted.split('\n').length <= 2) {
                extracted = extracted.replace(/^\*\s+/, '').trim();
            }

            if (extracted.length > 5) return extracted;
        }
    }

    // === Strategi B: Cari blok teks non-bullet terakhir ===
    const lines = text.split('\n');
    const reversedLines = [...lines].reverse();

    // Dari bawah, cari baris pertama yang bukan bullet/checklist dan bukan kosong
    let resultLines = [];
    let collecting = false;

    for (const line of reversedLines) {
        const t = line.trim();
        if (t.length === 0) {
            if (collecting) resultLines.unshift(line);
            continue;
        }
        if (isChecklistLine(t) || /^\*\s+\(?[A-Z]/.test(t)) {
            if (collecting) break; // Sudah selesai mengumpulkan
            continue; // Masih skipping checklist dari bawah
        }
        // Baris normal!
        collecting = true;
        resultLines.unshift(line);
    }

    if (resultLines.length > 0) {
        const result = resultLines.join('\n').trim();
        if (result.length > 5) return result;
    }

    // === Strategi C (Nuclear Fallback): Buang SEMUA baris yang terlihat seperti thinking ===
    const survivingLines = lines.filter(l => {
        const t = l.trim();
        if (t.length === 0) return true;
        if (/^\*\s+\(?[A-Z][a-zA-Z\s\/-]*\)?:/.test(t)) return false; // *   Label:
        if (/^\*\s+\*[A-Z]/.test(t)) return false;                     // *   *Bold label*
        if (/^\(\w+/.test(t)) return false;                             // (Self-correction)
        if (isChecklistLine(t)) return false;
        return true;
    });

    return survivingLines.join('\n').trim();
}

/**
 * Deteksi baris yang merupakan checklist verifikasi model
 * (contoh: "*   Single asterisk for bold? Yes.")
 */
function isChecklistLine(line) {
    const t = line.trim();
    return (
        /^\*?\s*\*?\s*(Single asterisk|No double|No `|Tags used|Simple mode|Output Format|Casual|Direct|Emoji|self-correct|check)/i.test(t) ||
        /\?\s*(Yes|No|Check)\.?\s*$/i.test(t) ||
        /^\(Self-correction/i.test(t)
    );
}

/**
 * Bersihkan format agar sesuai standar WhatsApp.
 */
function cleanWhatsAppFormat(text) {
    let cleaned = text;

    // Hapus tanda kutip pembungkus di awal/akhir jika seluruh teks dibungkus quotes
    cleaned = cleaned.replace(/^["']|["']$/g, '').trim();

    // Hapus spasi di awal baris sebelum tanda list (* atau -)
    cleaned = cleaned.replace(/^\s+(\*\s)/gm, '$1');
    cleaned = cleaned.replace(/^\s+(-\s)/gm, '$1');

    // Hapus baris kosong berlebih
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}

// Fitur untuk mengirim pesan panjang berpotong-potong (Smart Splitter untuk Limit WA 1160 chars)
async function sendLongMessage(sock, chatId, text, quotedMsg, editKey = null) {
    const { addAiSentMessage } = require('./dbHandler');
    const maxLength = 1160;

    if (text.length <= maxLength) {
        let sendOpts = { text };
        let extraOpts = {};
        
        if (editKey) sendOpts.edit = editKey;
        else if (quotedMsg) extraOpts.quoted = quotedMsg;

        const sent = await sock.sendMessage(chatId, sendOpts, Object.keys(extraOpts).length > 0 ? extraOpts : undefined);
        if (sent?.key?.id) addAiSentMessage(sent.key.id);
        return [sent];
    }

    const paragraphs = text.split(/\n\n+/);
    const chunks = [];
    let currentChunk = "";

    for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i];
        
        if (currentChunk.length + para.length + 2 <= maxLength) {
            currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + para;
        } else {
            // Jika chunk sudah ada isinya, simpan dulu
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = "";
            }
            
            // Jika SATU paragraf ini saja sudah lebih panjang dari limit
            if (para.length > maxLength) {
                let remainingPara = para;
                while (remainingPara.length > 0) {
                    if (remainingPara.length <= maxLength) {
                        currentChunk = remainingPara;
                        break;
                    }
                    
                    // Coba potong di batas spasi terdekat (max mundur 30%)
                    let splitAt = remainingPara.lastIndexOf(' ', maxLength);
                    if (splitAt === -1 || splitAt < maxLength * 0.7) {
                        splitAt = maxLength; // Paksa potong jika ga ketemu spasi rasional
                    }
                    
                    chunks.push(remainingPara.substring(0, splitAt).trim());
                    remainingPara = remainingPara.substring(splitAt).trim();
                }
            } else {
                currentChunk = para;
            }
        }
    }
    
    // Sisa chunk terakhir
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    const sents = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isFirst = i === 0;
        
        let sendOpts = { text: chunk };
        let extraOpts = {};

        if (isFirst && editKey) {
            sendOpts.edit = editKey;
        } else if (isFirst && quotedMsg) {
            extraOpts.quoted = quotedMsg;
        }

        const sent = await sock.sendMessage(chatId, sendOpts, Object.keys(extraOpts).length > 0 ? extraOpts : undefined);
        if (sent?.key?.id) addAiSentMessage(sent.key.id);
        sents.push(sent);
        if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 600)); // Delay sblm lanjut ngirim pecahan
        }
    }
    return sents;
}

module.exports = { scrubThoughts, sendLongMessage };
