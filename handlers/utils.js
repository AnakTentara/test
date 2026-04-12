/**
 * Membersihkan respon AI dari blok pemikiran (CoT) dan memperbaiki format WhatsApp.
 */
function scrubThoughts(text) {
    if (!text) return text;
    
    // 1. Hapus tag <thought>...</thought> (Case insensitive)
    let cleaned = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
    
    // 2. Hapus pola perencanaan terstruktur yang sering muncul di model CoT/Gemma
    // Menghapus blok yang diawali dengan "* User:", "* Context:", "* Plan:", dll.
    const patternsToStrip = [
        /^\*\s+User:[\s\S]*?(\n\n|\n(?!\*))/gm,
        /^\*\s+Context:[\s\S]*?(\n\n|\n(?!\*))/gm,
        /^\*\s+Persona:[\s\S]*?(\n\n|\n(?!\*))/gm,
        /^\*\s+Identity:[\s\S]*?(\n\n|\n(?!\*))/gm,
        /^\*\s+Constraint:[\s\S]*?(\n\n|\n(?!\*))/gm,
        /^\*\s+Status:[\s\S]*?(\n\n|\n(?!\*))/gm,
        /^\*\s+Tone:[\s\S]*?(\n\n|\n(?!\*))/gm,
        /^\*\s+Plan:[\s\S]*?(\n\n|\n(?!\*))/gm,
        /^\*\s+Response:[\s\S]*?(\n\n|\n(?!\*))/gm,
        /^\*\s+Refinement:[\s\S]*?(\n\n|\n(?!\*))/gm
    ];
    
    patternsToStrip.forEach(regex => {
        cleaned = cleaned.replace(regex, '');
    });

    // 3. Jika model memisahkan dengan "Final Answer:" atau sejenisnya
    const finalMarkers = ["Final Answer:", "Response:", "Output:", "Answer:"];
    for (const marker of finalMarkers) {
        if (cleaned.includes(marker)) {
            const parts = cleaned.split(marker);
            cleaned = parts[parts.length - 1];
        }
    }

    // 4. Perbaikan Format WhatsApp: Hapus spasi di awal baris sebelum tanda list agar ter-parse oleh WA
    // "  * teks" -> "* teks"
    cleaned = cleaned.replace(/^\s+(\*|-)/gm, '$1');

    return cleaned.trim();
}

module.exports = { scrubThoughts };
