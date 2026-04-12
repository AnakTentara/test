/**
 * Membersihkan respon AI dari blok pemikiran (Chain of Thought / CoT)
 * dan memperbaiki format agar sesuai dengan standar WhatsApp.
 * 
 * Mendukung model-model "thinking" seperti Gemma-4, DeepSeek, dsb.
 */
function scrubThoughts(text) {
    if (!text) return text;
    let cleaned = text;

    // Prioritas 1: Ekstraksi Blok <WhatsAppMessage> yang paling akhir (paling andal)
    const startTag = '<WhatsAppMessage>';
    const endTag = '</WhatsAppMessage>';
    const lastStartIdx = cleaned.lastIndexOf(startTag);
    const lastEndIdx = cleaned.lastIndexOf(endTag);

    if (lastStartIdx !== -1) {
        let extracted = '';
        if (lastEndIdx !== -1 && lastEndIdx > lastStartIdx) {
            // Kasus normal: ada pasangan tag lengkap
            extracted = cleaned.substring(lastStartIdx + startTag.length, lastEndIdx).trim();
        } else {
            // Kasus toleran: tag penutup hilang atau terpotong, ambil sisa pesan
            extracted = cleaned.substring(lastStartIdx + startTag.length).trim();
        }
        // Bersihkan jika ada sisa-sisa backtick atau tag penutup yang rusak di ujung
        extracted = extracted.replace(/<\/WhatsAppMessage>?/gi, '').replace(/```+$/g, '').replace(/`+$/g, '').trim();
        if (extracted.length > 0) return cleanWhatsAppFormat(extracted);
    }

    // Prioritas 2: Pemisah Final Answer 
    const finalAnswerMatch = /^(?:=== FINAL ANSWER ===|FINAL ANSWER:)\s*([\s\S]*?)(?:===|$)/im.exec(cleaned);
    if (finalAnswerMatch && finalAnswerMatch[1].trim() !== '') {
        cleaned = finalAnswerMatch[1].trim();
        return cleanWhatsAppFormat(cleaned);
    }

    // Prioritas 3: Hapus manual tag <thought>
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();

    // Prioritas 4: Jika Model masih membandel pakai bullet point CoT tanpa tag XML
    const lines = cleaned.split('\n');
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);
    // Deteksi baris yang diawali dengan asterisk (bullet point)
    const thinkingLines = nonEmptyLines.filter(l => /^\s*\*/.test(l));

    // Jika lebih dari 30% baris adalah bullet point, kemungkinan ini adalah CoT bocor
    const isThinkingResponse = thinkingLines.length > 2 && (thinkingLines.length / nonEmptyLines.length) > 0.3;

    if (isThinkingResponse) {
        // Daftar marker penutup pikiran (Gemma/Gemma-4 style)
        const textMarkers = [
            '*Response:*', 'Response:',
            '*Final Polish:*', 'Final Polish:',
            '*Final Version:*', 'Final Version:', 
            '*Draft:*', 'Draft:',
            '*Final Answer:*', 'Final Answer:'
        ];

        let extracted = null;
        for (const marker of textMarkers) {
            const idx = cleaned.lastIndexOf(marker);
            if (idx !== -1) {
                extracted = cleaned.substring(idx + marker.length).trim();
                // Buang jika ada bullet point asterisk sisa di awal baris hasil ekstrak
                extracted = extracted.replace(/^\s*\*\s*/gim, '');
                break;
            }
        }

        if (extracted && extracted.length > 5) {
            cleaned = extracted;
        } else {
            // Coba cari baris terakhir yang BUKAN dimulai dengan asterisk (seringkali ini jawaban aslinya)
            const reverseLines = [...lines].reverse();
            const lastNormalLineIdx = reverseLines.findIndex(l => l.trim().length > 0 && !/^\s*\*/.test(l));
            
            if (lastNormalLineIdx !== -1) {
                 // Ambil kumpulan baris normal dari bawah sampai ketemu block asterisk lagi
                 let resultLines = [];
                 for(let i=lastNormalLineIdx; i<reverseLines.length; i++) {
                     if (/^\s*\*/.test(reverseLines[i])) break;
                     resultLines.unshift(reverseLines[i]);
                 }
                 if (resultLines.length > 0) cleaned = resultLines.join('\n').trim();
            } else {
                 // Fallback terakhir: buang semua baris yang terindikasi label pemikiran
                 cleaned = cleaned.split('\n')
                    .filter(l => !/^\s*\*\s*\(?[A-Z][A-Za-z\s-]*\)?\s*:/.test(l))
                    .join('\n').trim();
            }
        }
    }

    return cleanWhatsAppFormat(cleaned);
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
async function sendLongMessage(sock, chatId, text, quotedMsg) {
    const { addAiSentMessage } = require('./dbHandler');
    const maxLength = 1160;

    if (text.length <= maxLength) {
        const sent = await sock.sendMessage(chatId, { text }, quotedMsg ? { quoted: quotedMsg } : undefined);
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
        const sent = await sock.sendMessage(chatId, { text: chunk }, isFirst && quotedMsg ? { quoted: quotedMsg } : undefined);
        if (sent?.key?.id) addAiSentMessage(sent.key.id);
        sents.push(sent);
        if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 600)); // Delay sblm lanjut ngirim pecahan
        }
    }
    return sents;
}

module.exports = { scrubThoughts, sendLongMessage };
