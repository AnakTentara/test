/**
 * Membersihkan respon AI dari blok pemikiran (Chain of Thought / CoT)
 * dan memperbaiki format agar sesuai dengan standar WhatsApp.
 * 
 * Mendukung model-model "thinking" seperti Gemma-4, DeepSeek, dsb.
 */
function scrubThoughts(text) {
    if (!text) return text;
    let cleaned = text;

    // Prioritas 1: Coba ekstrak wajib dari <WhatsAppMessage>
    const matchMatch = cleaned.match(/<WhatsAppMessage>([\s\S]*?)<\/WhatsAppMessage>/i);
    if (matchMatch && matchMatch[1]) {
        return cleanWhatsAppFormat(matchMatch[1].trim());
    }

    // Prioritas 2: Split berdasarkan marker === FINAL ANSWER === (untuk kompabilitas lama)
    const finalAnswerMarker = '=== FINAL ANSWER ===';
    const markerIdx = cleaned.lastIndexOf(finalAnswerMarker);
    if (markerIdx !== -1) {
        cleaned = cleaned.substring(markerIdx + finalAnswerMarker.length).trim();
        return cleanWhatsAppFormat(cleaned);
    }

    // Prioritas 3: Hapus manual tag <thought>
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();

    // Prioritas 4: Jika Model masih membandel pakai bullet point CoT tanpa tag XML
    const lines = cleaned.split('\n');
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);
    const thinkingLines = nonEmptyLines.filter(l => /^\s*\*\s{2,}/.test(l));

    const isThinkingResponse = thinkingLines.length > 3 && (thinkingLines.length / nonEmptyLines.length) > 0.3;

    if (isThinkingResponse) {
        // Coba cari kutipan text (sering model menulis respon finalnya dalam tanda kutip di dalam bullet poin akhir)
        const quoteMatch = cleaned.match(/"([^"]+)"\s*(?:\n|$)/);
        if (quoteMatch && quoteMatch[1] && quoteMatch[1].length > 10) {
            cleaned = quoteMatch[1];
        } else {
            // Hitu sisa-sisa label thinking 
            cleaned = cleaned.replace(/^\s*\*\s*(Self-Correction|Refinement|Draft \d+|Check|Constraint|Bold|No markdown|Tone|Identity|Status|Plan|Context|Persona|User|Response|Output|Answer|Final Polish|Final Version|Result|Option \d+|Style|Greeting|Relationship|Input|Creator info|Start |Explain |Mention |Compare |Use )[^*]*?\*?\s*$/gim, '');
            // Buang semua baris yang masih diawali asterisk + spasi banyak
            const newLines = cleaned.split('\n').filter(l => !/^\s*\*\s{2,}/.test(l));
            if (newLines.length > 0) {
                cleaned = newLines.join('\n');
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

module.exports = { scrubThoughts };
