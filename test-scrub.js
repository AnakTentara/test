/**
 * Test scrubber terhadap output Gemma-4 yang bocor thinking-nya
 */
const { scrubThoughts } = require('./handlers/utils');

// ===== TEST 1: Output Gemma yang FULL CoT bocor (dari log asli) =====
const gemmaLeaked = `*   User: Haikal (Owner).
    *   Message: "halloww"
    *   Time: 02.36 AM (Late night/Early morning).
    *   Tone: Casual greeting.
    *   Character: Haikaru (Gaul, santai, humoris, uses emojis).
    *   Relationship: Friend/AI to Haikal.
    *   Tone: Casual ("lo/gue" or "aku/kamu"), energetic/fun.
    *   Constraint: Use *bold* (single asterisk), no markdown \`**\` or \`\` \` \`\`.
    *   Constraint: Respond to owner with riang/santai.
    *   Output Format: \`<thought>\` then \`<WhatsAppMessage>\`.
    *   Since it's 2:36 AM, Haikaru should acknowledge the late hour.
    *   Greeting back: "Halo juga bos!" or "Hallowww juga!"
    *   Add some humor about the time: "Belum tidur lo? Begadang mulu ntar sakit 😭"
    *   *Draft:* Hallowww juga bos! 🤙 Jam segini baru muncul, belum tidur lo? Begadang mulu ntar jompo lho 😭✨
    *   *Applying Bold:* *Hallowww* juga bos! 🤙 Jam segini baru muncul, belum tidur lo? Begadang mulu ntar jompo lho 😭✨
    *   Simple mode? Yes.
    *   Single asterisk for bold? Yes.
    *   No \`**\`? Yes.
    *   Tags used? Yes.`;

console.log('===== TEST 1: Full CoT bocor (no tags) =====');
console.log('INPUT: (Gemma bullet-point thinking leak)');
console.log('OUTPUT:', JSON.stringify(scrubThoughts(gemmaLeaked)));
console.log();

// ===== TEST 2: Output yang pakai <WhatsAppMessage> tag (nurut) =====
const withTags = `<thought>
User menyapa. Aku harus membalas santai.
</thought>
<WhatsAppMessage>Halo kawan! Ada yang bisa gue bantu?</WhatsAppMessage>`;

console.log('===== TEST 2: Dengan XML tags (nurut) =====');
console.log('INPUT: (properly tagged)');
console.log('OUTPUT:', JSON.stringify(scrubThoughts(withTags)));
console.log();

// ===== TEST 3: Normal response tanpa CoT sama sekali =====
const cleanResponse = `Hallowww juga bos! 🤙 Jam segini masih woke? Begadang mulu ntar cepet tua loh 😭`;

console.log('===== TEST 3: Response bersih (tanpa CoT) =====');
console.log('INPUT:', JSON.stringify(cleanResponse));
console.log('OUTPUT:', JSON.stringify(scrubThoughts(cleanResponse)));
console.log();

// ===== TEST 4: CoT dengan Final Text Construction marker =====
const withFinalMarker = `*   User: Haikal
    *   Message: Quantum computing
    *   Draft: blah blah
    *Final Text Construction:*
    Wah, langsung berat nih bahasannya! 😂 Oke, gue jelasin pake bahasa tongkrongan ya.

    Jadi gini bro, komputer biasa pake *bit*. Quantum pake *qubit*. Beda banget! 🤯
    *   Single asterisk for bold? Yes.
    *   No double? Yes.`;

console.log('===== TEST 4: Final Text Construction marker =====');
console.log('OUTPUT:', JSON.stringify(scrubThoughts(withFinalMarker)));
console.log();

// ===== TEST 5: Mixed - ada thought tag TAPI juga ada sisa CoT di luar =====
const mixedOutput = `<thought>
Ini analisis singkat
</thought>

*   Check formatting...
*   Single asterisk? Yes.

Hallowww! Masih hidup lo? 😂`;

console.log('===== TEST 5: Mixed (ada tag + sisa CoT) =====');
console.log('OUTPUT:', JSON.stringify(scrubThoughts(mixedOutput)));
console.log();

console.log('====== ALL TESTS DONE ======');
