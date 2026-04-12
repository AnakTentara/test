// Trace debug: what does Layer 1 (WhatsAppMessage tag) extract?
const text = `*   User: Haikal (Owner).
    *   Message: "halloww"
    *   Output Format: \`<thought>\` then \`<WhatsAppMessage>\`.
    *   *Draft:* Hallowww juga bos! 🤙
    *   *Applying Bold:* *Hallowww* juga bos! 🤙
    *   Simple mode? Yes.`;

const startTag = '<WhatsAppMessage>';
const lastStartIdx = text.lastIndexOf(startTag);
console.log('WhatsAppMessage tag found at:', lastStartIdx);
if (lastStartIdx !== -1) {
    console.log('Context around it:', JSON.stringify(text.substring(lastStartIdx - 30, lastStartIdx + 50)));
}
