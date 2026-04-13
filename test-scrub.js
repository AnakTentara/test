const { scrubThoughts } = require('./handlers/utils');

let passed = 0;
let failed = 0;

function test(name, input, expected) {
    const result = scrubThoughts(input);
    const ok = result === expected;
    if (ok) {
        console.log(`✅ ${name}`);
        passed++;
    } else {
        console.log(`❌ ${name}`);
        console.log(`   EXPECTED: ${JSON.stringify(expected).substring(0, 120)}`);
        console.log(`   GOT:      ${JSON.stringify(result).substring(0, 120)}`);
        failed++;
    }
}

// ===== TEST 1: Full CoT bocor dengan quoted answer (Samsung link case) =====
test('Samsung link - quoted answer after drafts',
    `*   User: Haikal (Owner).
    *   Content: A link to an article about Samsung rollable phone 2026.
    *   Context: Haikal is the creator of Haikaru.
    *   Tone required: Haikaru (Gaul, santai, humoris).
    *   Subject: Samsung rollable phone in 2026.
    *   Acknowledge the link.
    *   React to the tech news.
    *   Keep it natural, like a friend chatting on WhatsApp.
    *   Use *bold* for emphasis (single asterisk).
    *   No bullet points, no analysis, just a chat message.
    *   *Draft 1*: Wah, Samsung bakal bikin HP rollable ya di 2026? Keren banget sih.
    *   *Draft 2 (More Haikaru style)*: Wih, gila sih! *Samsung rollable phone*? Keren parah 🤩.
    *   "Wih, gila! *Samsung rollable phone*? 🔥 Keren banget sih kalau beneran rilis 2026 nanti. Bayangin aja layarnya bisa ditarik gitu, makin puas deh buat scrolling atau nonton 🤩. Gokil emang Samsung! ✨"
    *   Single asterisk for bold? Yes (*Samsung rollable phone*).
    *   No markdown \`**\`? Yes.
    *   No preamble? Yes.
    *   Natural WhatsApp style? Yes.
    *   Emoji usage? Yes.`,
    `Wih, gila! *Samsung rollable phone*? 🔥 Keren banget sih kalau beneran rilis 2026 nanti. Bayangin aja layarnya bisa ditarik gitu, makin puas deh buat scrolling atau nonton 🤩. Gokil emang Samsung! ✨`
);

// ===== TEST 2: "yang lebih rinci" case - multiple drafts with self-correction =====
test('Multiple drafts with self-correction',
    `*   User (Haikal, the owner) says: "yang lebih rinci coba" (try more detailed).
    *   Context: This is a follow-up request.
    *   Name: Haikaru.
    *   I should ask what he wants me to detail.
    *Let's go with:*
    "Waduh, detail yang mana nih? 😭 Lo belum sebutin topiknya, jadi gue bingung mau ngerinci apa. Coba *spill* dikit, entar gue jabarin sampe ke akar-akarnya! 😎🔥"
    *   Bold: *spill*
    *   No markdown \`**\`.
    *   Emojis: 😭, 😎, 🔥.
    *   Tone: Casual/Gaul.
    *Wait*, let me check if there was any hidden instruction. No.
    *Let's provide a response that acknowledges I need the topic.*
    "Waduh, detail yang mana nih? 😭 Gue belum tau lo lagi bahas apa. Coba *spill* topiknya, nanti gue jabarin sampe ke akar-akarnya biar lo puas! 😎🔥"
    *Wait*, I should make it even more "Haikaru".
    "Detail yang mana dulu nih? 😭 Gue belum tau lo lagi bahas apa. Coba *spill* dikit topiknya, entar gue gaspol rinciannya sampe tuntas! 😎✨"
    *Checking constraint*: "JANGAN menulis analisis, JANGAN menulis draft, LANGSUNG TULIS JAWABAN CHAT SAJA".
    Okay, ready.
    *One more thing*: The user is the owner. I should be extra friendly.
    "Waduh, detail yang mana nih? 😭 Gue belum tau lo lagi bahas apa. Coba *spill* dikit topiknya, entar gue jabarin sampe ke akar-akarnya biar lo puas! 😎🔥"`,
    `Waduh, detail yang mana nih? 😭 Gue belum tau lo lagi bahas apa. Coba *spill* dikit topiknya, entar gue jabarin sampe ke akar-akarnya biar lo puas! 😎🔥`
);

// ===== TEST 3: Fotosintesis case - multi-line quoted answer =====
test('Fotosintesis - multi-line quoted block',
    `*   User (Haikal): "jelaskan fotosintesis coba. mau ngerjain tugas nih"
    *   This is a biology question.
    *   Haikaru style: casual, helpful, emojis.
    *   *Draft 1*: Fotosintesis itu proses tumbuhan bikin makanan.
    *   *Applying Haikaru Style:*
    "Woles, gue bantuin biar tugas lo cepet kelar! 😎
    Jadi, *fotosintesis* itu proses tumbuhan bikin makanannya sendiri pake bantuan cahaya matahari. Bahan utamanya tiga: *cahaya matahari*, *air (H2O)*, sama *karbondioksida (CO2)*.
    Proses ini kejadiannya di bagian daun yang ada *klorofil*-nya. Hasil akhirnya berupa *glukosa* sama *oksigen (O2)*.
    Semangat ngerjainnya, moga nilai lo mantap! 🔥"
    *   No markdown \`**\`? Check.
    *   Use \`*\` for bold? Check.
    *   Casual/Gaul? Check.
    *   To the point? Check.`,
    `Woles, gue bantuin biar tugas lo cepet kelar! 😎
Jadi, *fotosintesis* itu proses tumbuhan bikin makanannya sendiri pake bantuan cahaya matahari. Bahan utamanya tiga: *cahaya matahari*, *air (H2O)*, sama *karbondioksida (CO2)*.
Proses ini kejadiannya di bagian daun yang ada *klorofil*-nya. Hasil akhirnya berupa *glukosa* sama *oksigen (O2)*.
Semangat ngerjainnya, moga nilai lo mantap! 🔥`
);

// ===== TEST 4: Haloo greeting - simple case with options =====
test('Greeting with options',
    `*   User: Haikal (Owner).
    *   Message: "haloo" (Greeting/Check-in).
    *   Name: Haikaru.
    *   Since the owner is saying "haloo", I should respond with a friendly greeting.
    *   *Option 1:* Halo juga bos! Ada apa nih tiba-tiba nyapa? 😎
    *   *Option 2:* Halo Haikal! *Wih* ada apa nih boss besar? 😂👋
    *   Use *teks* for bold.
    *   No \`**\`.
    *Self-Correction*: The owner's message is just a "haloo". I'll keep it chill.
    "Haloo juga bos! 😎 Tumben amat nyapa, ada apa nih? Mau ngobrol santai atau ada tugas buat *gue*? 😂✨"`,
    `Haloo juga bos! 😎 Tumben amat nyapa, ada apa nih? Mau ngobrol santai atau ada tugas buat *gue*? 😂✨`
);

// ===== TEST 5: Native Gemma 4 Thinking Tokens (26B style) =====
test('Native Gemma thinking tokens',
    `<|channel>thought
Thinking Process:
1. User menyapa "halloww"
2. Ini sapaan casual, jawab santai
<channel|>Hallowww juga bos! 🤙 Jam segini masih begadang? Ntar cepet tua lho 😭<turn|>`,
    `Hallowww juga bos! 🤙 Jam segini masih begadang? Ntar cepet tua lho 😭`
);

// ===== TEST 6: XML tags (backward compat) =====
test('XML WhatsAppMessage tags',
    `<thought>User menyapa, balas santai</thought><WhatsAppMessage>Halo kawan!</WhatsAppMessage>`,
    `Halo kawan!`
);

// ===== TEST 7: Clean response (pass-through) =====
test('Clean response pass-through',
    `Hallowww juga bos! 🤙`,
    `Hallowww juga bos! 🤙`
);

// ===== TEST 8: Truncated Gemma thinking =====
test('Truncated Gemma thinking',
    `<|channel>thought
Ini thinking yang terpotong karena max_tokens...`,
    ``
);

// ===== TEST 9: Gemma 31B style tokens =====
test('Gemma 31B style tokens',
    `<|think|>Hmm user menyapa, harus balas santai<channel|>Heyy! Ada apa nih malam-malam?`,
    `Heyy! Ada apa nih malam-malam?`
);

// ===== SUMMARY =====
console.log(`\n====== RESULTS: ${passed} passed, ${failed} failed ======`);
if (failed > 0) process.exit(1);
