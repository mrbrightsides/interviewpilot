# Interview Pilot Pro 🚀

**Interview Pilot Pro** is a high-performance, AI-powered assistant designed to help candidates excel during online interviews. It provides real-time transcription, instant AI-generated talking points, and a customizable knowledge base to ensure you're always prepared with the best possible answers.

## ✨ Key Features

- **Real-Time Transcription**: Uses the Web Speech API to transcribe the interviewer's questions as they happen.
- **Instant AI Talking Points**: Powered by Gemini 3 Flash, providing lightning-fast, professional responses and talking points.
- **Custom Knowledge Base**: Upload or paste your own Q&A, cheat sheets, and company research. The AI prioritizes this data to give you personalized, accurate answers.
- **Multi-Language Support**: Supports 10+ languages for both speech recognition and AI responses.
- **Interview History**: Automatically saves your sessions (transcripts and AI responses) locally for later review and learning.
- **Privacy First**: Includes a physical mute toggle that stops all audio processing, plus a visual volume meter for peace of mind.
- **Responsive Design**: A clean, modern "Pro" interface optimized for focus and speed during high-pressure interviews.

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **AI**: Google Gemini API (@google/genai)
- **Animations**: Framer Motion
- **Icons**: Lucide React
- **Speech**: Web Speech API
- **Audio**: Web Audio API (for volume monitoring)

## 🚀 Getting Started

1. **Set Up API Key**: Ensure your `GEMINI_API_KEY` is configured in your environment.
2. **Configure Context**: Open the **Settings** panel to set your interview role and upload your custom Q&A.
3. **Start Listening**: Click the microphone button when the interviewer starts speaking.
4. **Get Help**: Click the button again to stop listening and receive instant AI talking points.

## 🔒 Privacy & Security

Interview Pilot Pro processes audio locally for transcription and only sends the text transcript to the Gemini API for analysis. No audio data is ever stored or transmitted.

---
*Crafted for candidates who want to perform at their absolute best.*
