import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());

// Gemini API Route
app.post("/api/generate", async (req, res) => {
  try {
    const { text, systemPrompt, langName, customQA } = req.body;

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server." });
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const knowledgeBaseContext = customQA && customQA.trim() 
      ? `\n\nUSE THE FOLLOWING KNOWLEDGE BASE / Q&A FOR REFERENCE IF RELEVANT:\n${customQA}`
      : "";

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: text,
      config: {
        systemInstruction: `${systemPrompt}${knowledgeBaseContext}\n\nThe user's preferred language is ${langName}.`,
      },
    });

    if (!response || !response.text) {
      return res.status(500).json({ error: "Model failed to generate a response." });
    }

    return res.json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini Server Error:", error);
    return res.status(500).json({ 
      error: error.message || "An internal server error occurred",
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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
