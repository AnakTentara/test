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
    // Deteksi baris yang diawali dengan asterisk
    const thinkingLines = nonEmptyLines.filter(l => /^\s*\*/.test(l));

    const isThinkingResponse = thinkingLines.length > 3 && (thinkingLines.length / nonEmptyLines.length) > 0.3;

    if (isThinkingResponse) {
        // Coba ektrak dari marker penutup pikiran (Gemma style)
        const textMarkers = [
            '*Response:*', 'Response:',
            '*Final Polish:*', 'Final Polish:',
            '*Final Version:*', 'Final Version:', 
            '*Draft:*', 'Draft:',
        ];

        let extracted = null;
        // Cari marker dari paling tegas hingga terlemah
        for (const marker of textMarkers) {
            const idx = cleaned.lastIndexOf(marker);
            if (idx !== -1) {
                // Ambil sisa teks setelah marker
                extracted = cleaned.substring(idx + marker.length).trim();
                // Buang jika ada bullet point ekstra yang ikut ke ekstrak
                extracted = extracted.replace(/^\s*\*\s*/gim, '');
                break;
            }
        }

        if (extracted && extracted.length > 5) {
            cleaned = extracted;
        } else {
            // Coba cari kutipan text
            const quoteMatch = cleaned.match(/"([^"]+)"\s*(?:\n|$)/);
            if (quoteMatch && quoteMatch[1] && quoteMatch[1].length > 10) {
                cleaned = quoteMatch[1];
            } else {
                // Hapus baris yang terindikasi label pemikiran (misal: * Context: atau *(Self-correction:) -- Agresif
                const newLines = cleaned.split('\n').filter(l => !/^\s*\*\s*\(?[A-Z][A-Za-z\s-]*\)?\s*:/.test(l));
                if (newLines.length > 0) {
                    cleaned = newLines.join('\n');
                }
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
