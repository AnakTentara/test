const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  apiKey: "aduhkaboaw91h9i28hoablkdl09190jelnkaknldwa90hoi2", // Proxy API Key
  baseUrl: "https://ai.aikeigroup.net"
});

async function test() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.0-flash', // Try a genai model
      contents: 'hello',
    });
    console.log("Success:", response.text);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

test();
