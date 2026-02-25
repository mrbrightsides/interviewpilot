/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { 
  Mic, 
  MicOff, 
  Settings, 
  MessageSquare, 
  History as HistoryIcon, 
  Sparkles, 
  AlertCircle,
  Trash2,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Globe,
  Save,
  ChevronRight,
  X,
  ThumbsUp,
  ThumbsDown,
  Upload,
  FileText,
  BookOpen,
  Moon,
  Sun
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

// Types for Speech Recognition
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new (): SpeechRecognition;
    };
    AudioContext: typeof AudioContext;
    webkitAudioContext: typeof AudioContext;
  }
}

interface InterviewSession {
  id: string;
  timestamp: number;
  transcript: string;
  aiResponse: string;
  lang: string;
  feedback?: 'positive' | 'negative';
}

const LANGUAGES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
];

const DEFAULT_SYSTEM_PROMPT = "You are an expert interview assistant. I am in an online interview. Listen to the question being asked and provide a concise, professional, and high-impact answer or talking points. Keep it brief so I can read it quickly. Respond in the same language as the question unless specified otherwise.";

export default function App() {
  const [isHearing, setIsHearing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recognitionLang, setRecognitionLang] = useState('en-US');
  const [volume, setVolume] = useState(0);
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [customQA, setCustomQA] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('interview_dark_mode');
      return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const aiRef = useRef<GoogleGenAI | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Load sessions and custom QA from localStorage
  useEffect(() => {
    const savedSessions = localStorage.getItem('interview_sessions');
    if (savedSessions) {
      try {
        setSessions(JSON.parse(savedSessions));
      } catch (e) {
        console.error("Failed to parse saved sessions", e);
      }
    }

    const savedQA = localStorage.getItem('interview_custom_qa');
    if (savedQA) {
      setCustomQA(savedQA);
    }
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    localStorage.setItem('interview_sessions', JSON.stringify(sessions));
  }, [sessions]);

  // Save custom QA to localStorage
  const saveKnowledgeBase = () => {
    setSaveStatus('saving');
    localStorage.setItem('interview_custom_qa', customQA);
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  // Persist dark mode
  useEffect(() => {
    localStorage.setItem('interview_dark_mode', JSON.stringify(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript, interimTranscript]);

  useEffect(() => {
    // Initialize Gemini
    if (import.meta.env.VITE_GEMINI_API_KEY) {
      aiRef.current = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
    } else {
      setError("Gemini API key is missing. Please check your environment variables.");
    }

    // Initialize Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = recognitionLang;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (isMuted) return;

        let finalTranscript = '';
        let currentInterim = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            currentInterim += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          setTranscript(prev => prev + ' ' + finalTranscript);
        }
        setInterimTranscript(currentInterim);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        handleRecognitionError(event.error);
      };

      recognition.onend = () => {
        if (isHearing && !isMuted) {
          try {
            recognition.start();
          } catch (e) {
            console.error("Restart error", e);
          }
        }
      };

      recognitionRef.current = recognition;
    } else {
      setError("Speech recognition is not supported in this browser.");
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      stopVolumeMonitoring();
    };
  }, [recognitionLang, isMuted]);

  const handleRecognitionError = (errorCode: string) => {
    let message = "An unknown error occurred with speech recognition.";
    let recoverable = true;

    switch (errorCode) {
      case 'not-allowed':
        message = "Microphone access denied. Please enable microphone permissions in your browser settings.";
        recoverable = false;
        break;
      case 'no-speech':
        message = "No speech was detected. Please check your microphone and try again.";
        break;
      case 'network':
        message = "Network error occurred. Please check your internet connection.";
        break;
      case 'audio-capture':
        message = "No microphone was found. Ensure it's plugged in and active.";
        recoverable = false;
        break;
      case 'aborted':
        message = "Speech recognition was aborted.";
        break;
      default:
        message = `Speech recognition error: ${errorCode}`;
    }

    setError(message);
    if (!recoverable) setIsHearing(false);
  };

  const startVolumeMonitoring = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        setVolume(average);
        if (isHearing) {
          requestAnimationFrame(updateVolume);
        }
      };

      updateVolume();
    } catch (e) {
      console.error("Failed to start volume monitoring", e);
    }
  };

  const stopVolumeMonitoring = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setVolume(0);
  };

  const toggleMute = () => {
    if (!recognitionRef.current || !isHearing) return;

    const newMuted = !isMuted;
    setIsMuted(newMuted);

    if (newMuted) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Restart error", e);
      }
    }
  };

  const toggleHearing = () => {
    if (!recognitionRef.current) return;

    // Clear transcript and AI talking points whenever the mic button is pressed
    setTranscript('');
    setInterimTranscript('');
    setAiResponse('');
    setFeedback(null);
    setError(null);

    if (isHearing) {
      recognitionRef.current.stop();
      setIsHearing(false);
      setIsMuted(false); // Reset mute state for next session
      stopVolumeMonitoring();
      
      const fullText = (transcript + ' ' + interimTranscript).trim();
      if (fullText) {
        getAIHelp(fullText);
      }
    } else {
      setIsMuted(false);
      try {
        recognitionRef.current.start();
        setIsHearing(true);
        startVolumeMonitoring();
      } catch (e) {
        console.error("Start error", e);
      }
    }
  };

  const handleFeedback = (type: 'positive' | 'negative') => {
    setFeedback(type);
    // Update the most recent session with feedback
    if (sessions.length > 0) {
      const updatedSessions = [...sessions];
      updatedSessions[0] = { ...updatedSessions[0], feedback: type };
      setSessions(updatedSessions);
    }
  };

  const getAIHelp = async (text: string) => {
    if (!aiRef.current || !text.trim()) return;

    setIsLoading(true);
    setAiResponse(''); // Clear previous response for streaming
    try {
      const knowledgeBaseContext = customQA.trim() 
        ? `\n\nUSE THE FOLLOWING KNOWLEDGE BASE / Q&A FOR REFERENCE IF RELEVANT:\n${customQA}`
        : "";

      const responseStream = await aiRef.current.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: text,
        config: {
          systemInstruction: `${systemPrompt}${knowledgeBaseContext}\n\nThe user's preferred language is ${LANGUAGES.find(l => l.code === recognitionLang)?.name}.`,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        },
      });

      let fullText = "";
      for await (const chunk of responseStream) {
        const chunkText = chunk.text || "";
        fullText += chunkText;
        setAiResponse(fullText);
      }
      
      // Auto-save session after stream completes
      const newSession: InterviewSession = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        transcript: text,
        aiResponse: fullText,
        lang: recognitionLang
      };
      setSessions(prev => [newSession, ...prev]);
    } catch (err) {
      console.error("AI Error:", err);
      setError("Failed to get AI response. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const deleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const clearAll = () => {
    setTranscript('');
    setInterimTranscript('');
    setAiResponse('');
    setError(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCustomQA(prev => prev ? prev + "\n\n" + content : content);
    };
    reader.readAsText(file);
  };

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 selection:bg-indigo-100 ${isDarkMode ? 'bg-slate-950 text-slate-100 dark' : 'bg-[#F8F9FA] text-slate-900'}`}>
      {/* Header */}
      <header className={`sticky top-0 z-20 backdrop-blur-lg border-b px-6 py-4 flex items-center justify-between shadow-sm transition-colors duration-300 ${isDarkMode ? 'bg-slate-900/90 border-slate-800' : 'bg-white/90 border-slate-200'}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-indigo-200 dark:shadow-indigo-900/20 shadow-lg">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className={`text-xl font-bold tracking-tight ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>Interview Pilot</h1>
            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Pro Assistant</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-2.5 rounded-xl transition-all ${isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
            title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button 
            onClick={() => setIsHistoryOpen(true)}
            className={`p-2.5 rounded-xl transition-all flex items-center gap-2 ${isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
            title="History"
          >
            <HistoryIcon className="w-5 h-5" />
            <span className="text-sm font-medium hidden sm:inline">History</span>
          </button>
          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`p-2.5 rounded-xl transition-all ${isSettingsOpen ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : (isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500')}`}
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-8">
        {/* Error Alert */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3 text-red-700 shadow-sm"
            >
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-sm">Attention Required</p>
                <p className="text-xs opacity-90 leading-relaxed">{error}</p>
              </div>
              <button 
                onClick={() => setError(null)} 
                className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings Panel */}
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800 shadow-slate-950/50' : 'bg-white border-slate-200 shadow-slate-200/50'} border rounded-3xl p-8 shadow-xl space-y-6 transition-colors duration-300`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-indigo-600" />
                          <h2 className={`text-sm font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Language</h2>
                        </div>
                      </div>
                      <select 
                        value={recognitionLang}
                        onChange={(e) => setRecognitionLang(e.target.value)}
                        className={`w-full p-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                      >
                        {LANGUAGES.map(lang => (
                          <option key={lang.code} value={lang.code}>{lang.name}</option>
                        ))}
                      </select>
                      <p className={`text-[11px] italic ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        AI will respond in this language by default.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-indigo-600" />
                          <h2 className={`text-sm font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>System Context</h2>
                        </div>
                        <button 
                          onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                        >
                          Reset
                        </button>
                      </div>
                      <textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        placeholder="e.g., I'm interviewing for a Senior Frontend Role. Focus on React and performance optimization."
                        className={`w-full min-h-[100px] p-4 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm leading-relaxed transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-600' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-indigo-600" />
                        <h2 className={`text-sm font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Custom Knowledge Base / Q&A</h2>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="cursor-pointer text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 flex items-center gap-1">
                          <Upload className="w-3 h-3" />
                          Upload TXT
                          <input 
                            type="file" 
                            accept=".txt" 
                            className="hidden" 
                            onChange={handleFileUpload}
                          />
                        </label>
                        <button 
                          onClick={saveKnowledgeBase}
                          disabled={saveStatus !== 'idle'}
                          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                            saveStatus === 'saved' 
                              ? 'bg-emerald-500 text-white' 
                              : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
                          }`}
                        >
                          {saveStatus === 'saving' ? (
                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : saveStatus === 'saved' ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Save className="w-3 h-3" />
                          )}
                          {saveStatus === 'saved' ? 'Saved!' : 'Save'}
                        </button>
                        <button 
                          onClick={() => setCustomQA('')}
                          className={`text-xs font-bold transition-colors ${isDarkMode ? 'text-slate-600 hover:text-red-400' : 'text-slate-400 hover:text-red-500'}`}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {[
                          { label: 'Job Description', template: '### JOB DESCRIPTION\n- Role: \n- Key Requirements: \n- Tech Stack: \n' },
                          { label: 'Company Values', template: '### COMPANY VALUES\n- Mission: \n- Culture: \n' },
                          { label: 'My Projects', template: '### KEY PROJECTS\n1. Project Name: \n   - Challenge: \n   - Action: \n   - Result: \n' },
                          { label: 'STAR Method', template: '### STAR ANSWERS\n- Situation: \n- Task: \n- Action: \n- Result: \n' }
                        ].map((item) => (
                          <button
                            key={item.label}
                            onClick={() => setCustomQA(prev => prev + (prev ? '\n\n' : '') + item.template)}
                            className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                              isDarkMode 
                                ? 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-indigo-400' 
                                : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
                            }`}
                          >
                            + {item.label}
                          </button>
                        ))}
                      </div>
                      <div className="relative">
                        <textarea
                          value={customQA}
                          onChange={(e) => setCustomQA(e.target.value)}
                          placeholder="STRENGTHEN YOUR CONTEXT:&#10;- Paste the Job Description&#10;- Add Company Mission/Values&#10;- List your top 3 projects & key metrics&#10;- Common technical questions you expect&#10;- Your 'Tell me about yourself' script"
                          className={`w-full min-h-[260px] p-4 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm leading-relaxed transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-600' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                        />
                        {!customQA && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-50">
                            <div className="text-center space-y-2">
                              <FileText className={`w-8 h-8 mx-auto ${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`} />
                              <p className={`text-xs ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>Your private interview cheat sheet</p>
                            </div>
                          </div>
                        )}
                      </div>
                    <p className={`text-[11px] italic leading-relaxed ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      Tip: Paste common questions and your best answers here. The AI will prioritize this information when generating talking points.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Controls */}
        <div className="flex flex-col items-center justify-center py-12 space-y-8 relative">
          <div className="relative group">
            {/* Volume Meter Rings */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.div 
                animate={{ scale: 1 + (volume / 100) }}
                className="w-32 h-32 rounded-full border-2 border-indigo-100 opacity-20"
              />
              <motion.div 
                animate={{ scale: 1 + (volume / 50) }}
                className="w-32 h-32 rounded-full border border-indigo-50 opacity-10"
              />
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={toggleHearing}
              className={`relative z-10 w-32 h-32 rounded-full flex items-center justify-center transition-all shadow-2xl ${
                isHearing 
                  ? 'bg-red-500 text-white shadow-red-200' 
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
              }`}
            >
              {isHearing ? <MicOff className="w-12 h-12" /> : <Mic className="w-12 h-12" />}
              
              {isHearing && (
                <motion.div
                  animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-0 rounded-full bg-red-400"
                />
              )}
            </motion.button>

            {/* Mute Toggle */}
            <button
              onClick={toggleMute}
              className={`absolute -right-4 -bottom-4 p-3 rounded-full shadow-lg transition-all z-20 ${
                isMuted ? 'bg-orange-500 text-white' : 'bg-white text-slate-400 hover:text-indigo-600'
              }`}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          </div>
          
          <div className="text-center space-y-2">
            <h3 className={`text-2xl font-bold ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
              {isHearing ? (isMuted ? 'Paused' : 'Listening...') : 'Ready to Assist'}
            </h3>
            <p className={`text-sm max-w-xs mx-auto leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              {isHearing 
                ? 'Click to stop and get AI talking points immediately.' 
                : 'Tap the microphone when the interviewer starts their question.'}
            </p>
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Transcript Area */}
          <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800 shadow-slate-950/20' : 'bg-white border-slate-200 shadow-sm'} border rounded-3xl p-8 flex flex-col min-h-[400px] transition-all hover:shadow-md`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                  <MessageSquare className="w-4 h-4" />
                </div>
                <span className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Live Transcript</span>
              </div>
              <div className="flex items-center gap-2">
                {(transcript || interimTranscript) && (
                  <button 
                    onClick={clearAll} 
                    className={`p-2 rounded-lg transition-all ${isDarkMode ? 'text-slate-600 hover:text-red-400 hover:bg-red-900/20' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`}
                    title="Clear"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            
            <div 
              ref={transcriptContainerRef}
              className={`flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}
            >
              {transcript && <p className="leading-relaxed text-lg font-medium">{transcript}</p>}
              {interimTranscript && (
                <p className="text-indigo-400 italic leading-relaxed text-lg font-medium animate-pulse">
                  {interimTranscript}
                </p>
              )}
              {!transcript && !interimTranscript && (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                    <Mic className={`w-8 h-8 opacity-20 ${isDarkMode ? 'text-slate-400' : 'text-slate-300'}`} />
                  </div>
                  <p className={`text-sm font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-300'}`}>Your transcription will appear here in real-time.</p>
                </div>
              )}
            </div>
          </div>

          {/* AI Response Area */}
          <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800 shadow-slate-950/20' : 'bg-white border-slate-200 shadow-sm'} border rounded-3xl p-8 flex flex-col min-h-[400px] relative overflow-hidden transition-all hover:shadow-md`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className={`text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'text-indigo-500' : 'text-indigo-400'}`}>AI Talking Points</span>
              </div>
              {aiResponse && (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setAiResponse('')}
                    className={`p-1.5 rounded-lg transition-all ${isDarkMode ? 'text-slate-600 hover:text-red-400 hover:bg-red-900/20' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`}
                    title="Clear AI Response"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => copyToClipboard(aiResponse)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${isDarkMode ? 'bg-indigo-900/30 text-indigo-400 hover:bg-indigo-900/50' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              {isLoading ? (
                <div className="h-full flex flex-col items-center justify-center space-y-6">
                  <div className="flex gap-2">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        animate={{ y: [0, -10, 0], opacity: [0.3, 1, 0.3] }}
                        transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }}
                        className="w-3 h-3 bg-indigo-500 rounded-full"
                      />
                    ))}
                  </div>
                  <p className={`text-xs font-bold uppercase tracking-[0.2em] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Synthesizing Answer</p>
                </div>
              ) : aiResponse ? (
                <div className="space-y-6">
                  <div className={`prose max-w-none ${isDarkMode ? 'prose-invert prose-indigo' : 'prose-slate prose-indigo'}`}>
                    <Markdown>{aiResponse}</Markdown>
                  </div>
                  
                  {/* Feedback Mechanism */}
                  <div className={`pt-6 border-t flex items-center justify-between ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>Was this helpful?</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleFeedback('positive')}
                        className={`p-2 rounded-lg transition-all ${
                          feedback === 'positive' 
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' 
                            : (isDarkMode ? 'hover:bg-slate-800 text-slate-600' : 'hover:bg-slate-100 text-slate-400')
                        }`}
                        title="Helpful"
                      >
                        <ThumbsUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleFeedback('negative')}
                        className={`p-2 rounded-lg transition-all ${
                          feedback === 'negative' 
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' 
                            : (isDarkMode ? 'hover:bg-slate-800 text-slate-600' : 'hover:bg-slate-100 text-slate-400')
                        }`}
                        title="Not helpful"
                      >
                        <ThumbsDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                    <Sparkles className={`w-8 h-8 opacity-20 ${isDarkMode ? 'text-slate-400' : 'text-slate-300'}`} />
                  </div>
                  <p className={`text-sm font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-300'}`}>AI suggestions will be generated once you stop recording.</p>
                </div>
              )}
            </div>

            {/* Subtle Gradient Bottom */}
            <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t pointer-events-none ${isDarkMode ? 'from-slate-900' : 'from-white'} to-transparent`} />
          </div>
        </div>
      </main>

      {/* History Slide-over */}
      <AnimatePresence>
        {isHistoryOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHistoryOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`fixed top-0 right-0 bottom-0 w-full max-w-md z-50 shadow-2xl flex flex-col transition-colors duration-300 ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}
            >
              <div className={`p-6 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <div className="flex items-center gap-3">
                  <HistoryIcon className="w-5 h-5 text-indigo-600" />
                  <h2 className={`text-lg font-bold ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>Interview History</h2>
                </div>
                <button onClick={() => setIsHistoryOpen(false)} className={`p-2 rounded-full transition-all ${isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100'}`}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                {sessions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                    <HistoryIcon className={`w-12 h-12 opacity-10 ${isDarkMode ? 'text-slate-400' : 'text-slate-900'}`} />
                    <p className={`text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>No saved sessions yet.</p>
                  </div>
                ) : (
                  sessions.map((session) => (
                    <div key={session.id} className={`group border rounded-2xl p-5 space-y-3 transition-all hover:border-indigo-200 hover:shadow-sm ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                          {new Date(session.timestamp).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button 
                            onClick={() => copyToClipboard(session.aiResponse)}
                            className={`p-1.5 transition-colors ${isDarkMode ? 'text-slate-500 hover:text-indigo-400' : 'text-slate-400 hover:text-indigo-600'}`}
                            title="Copy AI Response"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => deleteSession(session.id)}
                            className={`p-1.5 transition-colors ${isDarkMode ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-500'}`}
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className={`text-xs font-bold line-clamp-2 italic ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>"{session.transcript}"</p>
                        <div className={`h-px w-full ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200/50'}`} />
                        <div className={`text-xs line-clamp-3 prose prose-xs ${isDarkMode ? 'text-slate-400 prose-invert' : 'text-slate-500'}`}>
                          <Markdown>{session.aiResponse}</Markdown>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Footer / Status */}
      <footer className={`max-w-5xl mx-auto px-6 py-12 flex flex-col sm:flex-row items-center justify-between gap-6 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors duration-300 ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isHearing ? (isMuted ? 'bg-orange-500' : 'bg-red-500 animate-pulse') : 'bg-slate-300 dark:bg-slate-700'}`} />
            <span>{isHearing ? (isMuted ? 'Muted' : 'Mic Active') : 'Mic Standby'}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${aiRef.current ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span>Gemini {aiRef.current ? 'Ready' : 'Offline'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Globe className="w-3 h-3" />
            <span>{LANGUAGES.find(l => l.code === recognitionLang)?.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Sparkles className="w-3 h-3 text-indigo-400" />
          <span>Interview Pilot Pro v2.0</span>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${isDarkMode ? '#334155' : '#E2E8F0'};
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${isDarkMode ? '#475569' : '#CBD5E1'};
        }
      `}</style>
    </div>
  );
}
