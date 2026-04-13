const fs = require('fs');

let code = fs.readFileSync('handlers/aiChatHandler.js', 'utf8');

// 1. Ganti export
code = code.replace(
    /const \{ openaiShakaru, getLocalClient \} = require\('\.\/geminiRotator'\);/g,
    "const { generateContentRotator } = require('./geminiRotator');"
);

// 2. Ganti push role assistant -> model (GENAI Format)
code = code.replace(/\{ role: "assistant", content: (.*?) \}/g, "{ role: 'model', parts: [{ text: $1 }] }");
code = code.replace(/\{ role: 'assistant', content: (.*?) \}/g, "{ role: 'model', parts: [{ text: $1 }] }");

// 3. Ganti push role user -> user (GENAI Format)
code = code.replace(/\{ role: "user", content: (.*?) \}/g, "{ role: 'user', parts: [{ text: $1 }] }");
code = code.replace(/\{ role: 'user', content: (.*?) \}/g, "{ role: 'user', parts: [{ text: $1 }] }");

fs.writeFileSync('handlers/aiChatHandler_step1.js', code);
console.log("Refactoring part 1 Done");
