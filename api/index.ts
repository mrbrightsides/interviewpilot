import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Gemini API Route
app.post("/api/generate", async (req, res) => {
  const { text, systemPrompt, langName, customQA } = req.body;

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Gemini API key is missing on the server." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const knowledgeBaseContext = customQA && customQA.trim() 
      ? `\n\nUSE THE FOLLOWING KNOWLEDGE BASE / Q&A FOR REFERENCE IF RELEVANT:\n${customQA}`
      : "";

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: text,
      config: {
        systemInstruction: `${systemPrompt}${knowledgeBaseContext}\n\nThe user's preferred language is ${langName}.`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      },
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini Server Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate AI response" });
  }
});

// For local development
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  async function setupDev() {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    const PORT = 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
  setupDev();
}

export default app;
