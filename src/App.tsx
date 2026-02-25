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
  BookOpen
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

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript, interimTranscript]);

  useEffect(() => {
    // Initialize Gemini
    if (import.meta.env.VITE_GEMINI_API_KEY``) {
      aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
      setTranscript('');
      setInterimTranscript('');
      setAiResponse('');
      setFeedback(null);
      setError(null);
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
    <div className="min-h-screen bg-[#F8F9FA] font-sans text-slate-900 selection:bg-indigo-100">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-lg border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-indigo-200 shadow-lg">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">Interview Pilot</h1>
            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Pro Assistant</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsHistoryOpen(true)}
            className="p-2.5 rounded-xl hover:bg-slate-100 text-slate-500 transition-all flex items-center gap-2"
            title="History"
          >
            <HistoryIcon className="w-5 h-5" />
            <span className="text-sm font-medium hidden sm:inline">History</span>
          </button>
          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`p-2.5 rounded-xl transition-all ${isSettingsOpen ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-slate-100 text-slate-500'}`}
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
              <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xl shadow-slate-200/50 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-indigo-600" />
                          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Language</h2>
                        </div>
                      </div>
                      <select 
                        value={recognitionLang}
                        onChange={(e) => setRecognitionLang(e.target.value)}
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium"
                      >
                        {LANGUAGES.map(lang => (
                          <option key={lang.code} value={lang.code}>{lang.name}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-400 italic">
                        AI will respond in this language by default.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-indigo-600" />
                          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">System Context</h2>
                        </div>
                        <button 
                          onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-700"
                        >
                          Reset
                        </button>
                      </div>
                      <textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        placeholder="e.g., I'm interviewing for a Senior Frontend Role. Focus on React and performance optimization."
                        className="w-full min-h-[100px] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm leading-relaxed"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-indigo-600" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Custom Knowledge Base / Q&A</h2>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="cursor-pointer text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
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
                          className="text-xs font-bold text-slate-400 hover:text-red-500"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      <textarea
                        value={customQA}
                        onChange={(e) => setCustomQA(e.target.value)}
                        placeholder="Paste your prepared Q&A, cheat sheet, or company facts here. The AI will use this to provide more accurate answers."
                        className="w-full min-h-[260px] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm leading-relaxed"
                      />
                      {!customQA && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-50">
                          <div className="text-center space-y-2">
                            <FileText className="w-8 h-8 mx-auto text-slate-300" />
                            <p className="text-xs text-slate-400">Your private interview cheat sheet</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 italic leading-relaxed">
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
            <h3 className="text-2xl font-bold text-slate-800">
              {isHearing ? (isMuted ? 'Paused' : 'Listening...') : 'Ready to Assist'}
            </h3>
            <p className="text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
              {isHearing 
                ? 'Click to stop and get AI talking points immediately.' 
                : 'Tap the microphone when the interviewer starts their question.'}
            </p>
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Transcript Area */}
          <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm flex flex-col min-h-[400px] transition-all hover:shadow-md">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Live Transcript</span>
              </div>
              <div className="flex items-center gap-2">
                {(transcript || interimTranscript) && (
                  <button 
                    onClick={clearAll} 
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    title="Clear"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            
            <div 
              ref={transcriptContainerRef}
              className="flex-1 overflow-y-auto text-slate-700 space-y-4 pr-2 custom-scrollbar"
            >
              {transcript && <p className="leading-relaxed text-lg font-medium">{transcript}</p>}
              {interimTranscript && (
                <p className="text-indigo-400 italic leading-relaxed text-lg font-medium animate-pulse">
                  {interimTranscript}
                </p>
              )}
              {!transcript && !interimTranscript && (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 text-center space-y-4">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                    <Mic className="w-8 h-8 opacity-20" />
                  </div>
                  <p className="text-sm font-medium">Your transcription will appear here in real-time.</p>
                </div>
              )}
            </div>
          </div>

          {/* AI Response Area */}
          <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm flex flex-col min-h-[400px] relative overflow-hidden transition-all hover:shadow-md">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">AI Talking Points</span>
              </div>
              {aiResponse && (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setAiResponse('')}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    title="Clear AI Response"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => copyToClipboard(aiResponse)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-100 transition-all"
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
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-[0.2em]">Synthesizing Answer</p>
                </div>
              ) : aiResponse ? (
                <div className="space-y-6">
                  <div className="prose prose-slate prose-indigo max-w-none">
                    <Markdown>{aiResponse}</Markdown>
                  </div>
                  
                  {/* Feedback Mechanism */}
                  <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Was this helpful?</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleFeedback('positive')}
                        className={`p-2 rounded-lg transition-all ${
                          feedback === 'positive' 
                            ? 'bg-emerald-100 text-emerald-600' 
                            : 'hover:bg-slate-100 text-slate-400'
                        }`}
                        title="Helpful"
                      >
                        <ThumbsUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleFeedback('negative')}
                        className={`p-2 rounded-lg transition-all ${
                          feedback === 'negative' 
                            ? 'bg-red-100 text-red-600' 
                            : 'hover:bg-slate-100 text-slate-400'
                        }`}
                        title="Not helpful"
                      >
                        <ThumbsDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 text-center space-y-4">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                    <Sparkles className="w-8 h-8 opacity-20" />
                  </div>
                  <p className="text-sm font-medium">AI suggestions will be generated once you stop recording.</p>
                </div>
              )}
            </div>

            {/* Subtle Gradient Bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" />
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
              className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <HistoryIcon className="w-5 h-5 text-indigo-600" />
                  <h2 className="text-lg font-bold">Interview History</h2>
                </div>
                <button onClick={() => setIsHistoryOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                {sessions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center space-y-4">
                    <HistoryIcon className="w-12 h-12 opacity-10" />
                    <p className="text-sm">No saved sessions yet.</p>
                  </div>
                ) : (
                  sessions.map((session) => (
                    <div key={session.id} className="group bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3 transition-all hover:border-indigo-200 hover:shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {new Date(session.timestamp).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button 
                            onClick={() => copyToClipboard(session.aiResponse)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600"
                            title="Copy AI Response"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => deleteSession(session.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-600 line-clamp-2 italic">"{session.transcript}"</p>
                        <div className="h-px bg-slate-200/50 w-full" />
                        <div className="text-xs text-slate-500 line-clamp-3 prose prose-xs">
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
      <footer className="max-w-5xl mx-auto px-6 py-12 flex flex-col sm:flex-row items-center justify-between gap-6 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isHearing ? (isMuted ? 'bg-orange-500' : 'bg-red-500 animate-pulse') : 'bg-slate-300'}`} />
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
          background: #E2E8F0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #CBD5E1;
        }
      `}</style>
    </div>
  );
}
