/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, type ChangeEvent } from "react";
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { 
  Upload, 
  Image as ImageIcon, 
  RefreshCw, 
  Download, 
  AlertCircle, 
  CheckCircle2, 
  User, 
  Camera,
  Key
} from "lucide-react";
import { cn } from "./lib/utils";

// --- Types ---
interface ImageState {
  file: File | null;
  preview: string | null;
  base64: string | null;
}

// --- Constants ---
const MODEL_NAME = "gemini-2.5-flash-image";
const PREMIUM_MODEL = "gemini-3.1-flash-image-preview";
const LOADING_MESSAGES = [
  "Đang phân tích tư thế từ Ảnh A...",
  "Đang trích xuất diện mạo từ Ảnh B...",
  "Đang thực hiện thay thế nhân vật...",
  "Đang giữ nguyên trang phục từ Ảnh B...",
  "Đang áp dụng phong cách dân gian cho bối cảnh...",
  "Đang tinh chỉnh chi tiết khuôn mặt...",
  "Sắp hoàn tất! Đang xử lý hình ảnh cuối cùng..."
];

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  // --- State ---
  const [refA, setRefA] = useState<ImageState>({ file: null, preview: null, base64: null });
  const [refB, setRefB] = useState<ImageState>({ file: null, preview: null, base64: null });
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  const [currentModel, setCurrentModel] = useState(MODEL_NAME);
  const [backgroundStyle, setBackgroundStyle] = useState<"original" | "vietnamese_folk">("original");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");

  // --- Refs ---
  const refAInput = useRef<HTMLInputElement>(null);
  const refBInput = useRef<HTMLInputElement>(null);

  // --- Effects ---
  useEffect(() => {
    checkApiKey();
  }, []);

  useEffect(() => {
    let interval: number;
    if (isGenerating) {
      interval = window.setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  // --- Helpers ---
  const checkApiKey = async () => {
    try {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(selected);
    } catch (e) {
      console.error("Error checking API key:", e);
      setHasApiKey(false);
    }
  };

  const handleOpenKeySelector = async () => {
    try {
      await window.aistudio.openSelectKey();
      setHasApiKey(true); // Assume success after opening
    } catch (e) {
      console.error("Error opening key selector:", e);
    }
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>, type: 'A' | 'B') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      const state = {
        file,
        preview: URL.createObjectURL(file),
        base64
      };
      if (type === 'A') setRefA(state);
      else setRefB(state);
    };
    reader.readAsDataURL(file);
  };

  const generateImage = async () => {
    if (!refA.base64 || !refB.base64) {
      setError("Vui lòng tải lên cả ảnh tư thế (Ref A) và ảnh nhân vật (Ref B).");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setResultImages([]);
    setSelectedResultIndex(0);
    setLoadingMessageIndex(0);

    console.log("Starting generation with model:", currentModel);

    try {
      // Use API_KEY if available (selected from dialog), fallback to GEMINI_API_KEY
      let apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      
      // Only force selector for premium model if key is missing
      if (currentModel === PREMIUM_MODEL && (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "")) {
        console.log("Premium model selected but key is missing, attempting to open selector...");
        await handleOpenKeySelector();
        // After opening, we try to get the key again (it might be injected now)
        apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      }

      // Final check for any key before proceeding
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "") {
        // If it's the free model, we don't force the dialog, but we still need a key to work.
        // However, in AI Studio, GEMINI_API_KEY should be present.
        // If it's still missing, we throw a generic error.
        if (currentModel === PREMIUM_MODEL) {
          throw new Error("Vui lòng chọn một API Key trả phí để sử dụng model 3.1.");
        }
      }

      const ai = new GoogleGenAI({ apiKey: apiKey || "" });
      
      const response = await ai.models.generateContent({
        model: currentModel,
        contents: {
          parts: [
            {
              inlineData: {
                data: refB.base64,
                mimeType: refB.file?.type || "image/png"
              }
            },
            {
              text: "IDENTITY SOURCE (IMAGE B): This image defines the person's identity. You MUST use their EXACT face, EXACT hairstyle, and EXACT clothing. This is the ONLY person who should appear in the final result."
            },
            {
              inlineData: {
                data: refA.base64,
                mimeType: refA.file?.type || "image/png"
              }
            },
            {
              text: "POSE TEMPLATE (IMAGE A): Analyze this image carefully to extract the precise pose and action of the subject."
            },
            {
              text: `TASK: Synthesize a new photorealistic image.
1. SUBJECT: The person from IDENTITY SOURCE (IMAGE B). Use their face, hair, and clothing exactly.
2. ACTION: Place the person from B into the EXACT pose, posture, and action seen in POSE TEMPLATE (IMAGE A). Replicate their body geometry, limb positions, and overall action with 100% fidelity.
3. BACKGROUND: ${backgroundStyle === "vietnamese_folk" ? "A stylized Vietnamese folk art scene with traditional motifs." : "A clean, neutral background."}
4. NO Hallucinations: Stick strictly to the exact pose and action from Image A.`
            }
          ]
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio,
            // @ts-ignore - The selected SDK version lacks this type definition
            numberOfImages: 2
          }
        }
      });

      console.log("Response received:", response);

      const newImages: string[] = [];
      const candidates = response.candidates || [];
      
      if (candidates.length > 0) {
        const parts = candidates[0].content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) {
            newImages.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
          }
        }
      }

      if (newImages.length === 0) {
        console.warn("No image in response candidates. Full response:", response);
        throw new Error(response.text || "Model không trả về ảnh. Vui lòng thử lại với ảnh khác.");
      }

      setResultImages(newImages);

    } catch (err: any) {
      console.error("Generation error details:", err);
      const errorMessage = err.message || String(err);
      
      if (errorMessage.includes("403") || errorMessage.includes("PERMISSION_DENIED")) {
        if (currentModel === PREMIUM_MODEL) {
          setHasApiKey(false);
          setError("Lỗi phân quyền (403). Model cao cấp yêu cầu API Key trả phí. Đang chuyển về model miễn phí...");
          setCurrentModel(MODEL_NAME);
        } else {
          setError("Lỗi API Key (403). Vui lòng kiểm tra lại Key trong phần Settings.");
        }
      } else {
        setError(errorMessage || "Đã xảy ra lỗi trong quá trình tạo ảnh.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadResult = () => {
    const currentImage = resultImages[selectedResultIndex];
    if (!currentImage) return;
    const link = document.createElement("a");
    link.href = currentImage;
    link.download = `character-swap-result-${selectedResultIndex + 1}.png`;
    link.click();
  };

  // --- Render ---
  return (
    <div className="min-h-screen bg-[#2a0a0a] text-neutral-100 font-sans selection:bg-red-500/30">
      {/* Folk Pattern Overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
      
      {/* Header */}
      <header className="border-b border-red-900/50 bg-[#3a0f0f]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-yellow-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/20">
              <RefreshCw className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-yellow-500">Dân Gian AI</h1>
              <div className="flex items-center gap-2">
                <p className="text-[10px] text-red-400 font-medium uppercase tracking-[0.2em]">
                  {currentModel === PREMIUM_MODEL ? "Premium Mode (3.1)" : "Standard Mode (2.5)"}
                </p>
                {currentModel === MODEL_NAME && (
                  <button 
                    onClick={() => setCurrentModel(PREMIUM_MODEL)}
                    className="text-[10px] bg-yellow-500/10 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors"
                  >
                    Upgrade
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                setRefA({ file: null, preview: null, base64: null });
                setRefB({ file: null, preview: null, base64: null });
                setResultImages([]);
                setSelectedResultIndex(0);
                setError(null);
              }}
              className="text-sm font-medium text-red-400/60 hover:text-yellow-500 transition-colors"
            >
              Reset All
            </button>
            <button 
              onClick={handleOpenKeySelector}
              className={cn(
                "p-2 rounded-xl border transition-all",
                hasApiKey ? "border-green-900/50 bg-green-950/20 text-green-500" : "border-red-900/50 bg-red-950/20 text-red-400 hover:bg-red-900/30"
              )}
              title={hasApiKey ? "API Key Active" : "Setup API Key"}
            >
              <Key className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          
          {/* Left Column: Inputs */}
          <div className="space-y-8">
            <section className="space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <Camera className="w-5 h-5 text-red-400" />
                <h2 className="text-lg font-semibold text-yellow-500/90">Reference A: Pose & Action</h2>
              </div>
              <p className="text-sm text-red-200/60 leading-relaxed">
                Tải lên ảnh mẫu để lấy **tư thế và hành động**. 
                AI sẽ chỉ sử dụng tư thế từ ảnh này.
              </p>
              
              <div 
                onClick={() => refAInput.current?.click()}
                className={cn(
                  "relative aspect-video rounded-3xl border-2 border-dashed transition-all cursor-pointer group overflow-hidden",
                  refA.preview ? "border-red-500/50" : "border-red-900/30 hover:border-red-700 hover:bg-red-900/10"
                )}
              >
                {refA.preview ? (
                  <img src={refA.preview} alt="Ref A" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-red-950/50 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6 text-red-400" />
                    </div>
                    <span className="text-sm font-medium text-red-400/60">Chọn ảnh mẫu tư thế</span>
                  </div>
                )}
                <input 
                  ref={refAInput}
                  type="file" 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'A')}
                />
              </div>
            </section>

            <section className="space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <User className="w-5 h-5 text-yellow-400" />
                <h2 className="text-lg font-semibold text-yellow-500/90">Reference B: Character & Costume</h2>
              </div>
              <p className="text-sm text-red-200/60 leading-relaxed">
                Tải lên ảnh nhân vật. **Khuôn mặt, kiểu tóc và trang phục** 
                từ ảnh này sẽ được giữ nguyên.
              </p>
              
              <div 
                onClick={() => refBInput.current?.click()}
                className={cn(
                  "relative aspect-video rounded-3xl border-2 border-dashed transition-all cursor-pointer group overflow-hidden",
                  refB.preview ? "border-yellow-500/50" : "border-red-900/30 hover:border-red-700 hover:bg-red-900/10"
                )}
              >
                {refB.preview ? (
                  <img src={refB.preview} alt="Ref B" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-red-950/50 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6 text-yellow-500/60" />
                    </div>
                    <span className="text-sm font-medium text-yellow-500/40">Chọn ảnh nhân vật & trang phục</span>
                  </div>
                )}
                <input 
                  ref={refBInput}
                  type="file" 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'B')}
                />
              </div>
            </section>

            <section className="space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="w-5 h-5 text-red-400" />
                <h2 className="text-lg font-semibold text-yellow-500/90">Background Style</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setBackgroundStyle("original")}
                  className={cn(
                    "py-3 px-4 rounded-xl border transition-all text-sm font-medium",
                    backgroundStyle === "original" 
                      ? "bg-red-600/20 border-red-600 text-red-400" 
                      : "bg-red-950/30 border-red-900/30 text-red-400/40 hover:border-red-700"
                  )}
                >
                  Original Background
                </button>
                <button
                  onClick={() => setBackgroundStyle("vietnamese_folk")}
                  className={cn(
                    "py-3 px-4 rounded-xl border transition-all text-sm font-medium",
                    backgroundStyle === "vietnamese_folk" 
                      ? "bg-yellow-600/20 border-yellow-600 text-yellow-400" 
                      : "bg-red-950/30 border-red-900/30 text-yellow-400/40 hover:border-yellow-700"
                  )}
                >
                  Vietnamese Folk Style
                </button>
              </div>
            </section>

            <section className="space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="w-5 h-5 text-red-400" />
                <h2 className="text-lg font-semibold text-yellow-500/90">Aspect Ratio</h2>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {(["9:16", "16:9", "1:1"] as const).map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => setAspectRatio(ratio)}
                    className={cn(
                      "py-3 px-4 rounded-xl border transition-all text-sm font-medium",
                      aspectRatio === ratio
                        ? "bg-red-600/20 border-red-600 text-red-400" 
                        : "bg-red-950/30 border-red-900/30 text-red-400/40 hover:border-red-700"
                    )}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </section>

            <button
              onClick={generateImage}
              disabled={isGenerating || !refA.base64 || !refB.base64}
              className={cn(
                "w-full py-5 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3 shadow-xl",
                isGenerating 
                  ? "bg-red-900/50 text-red-400/50 cursor-not-allowed" 
                  : "bg-gradient-to-r from-red-700 to-yellow-700 hover:from-red-600 hover:to-yellow-600 text-white active:scale-[0.98] shadow-red-900/40"
              )}
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-6 h-6 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <ImageIcon className="w-6 h-6" />
                  Swap Character
                </>
              )}
            </button>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-200">{error}</p>
              </motion.div>
            )}

            {resultImages.length > 0 && currentModel === MODEL_NAME && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-200/80">
                  Mẹo: Nếu kết quả chưa chính xác, hãy thử nhấn <b>Upgrade</b> để sử dụng model Pro (3.1) có khả năng hiểu lệnh phức tạp tốt hơn.
                </p>
              </div>
            )}
          </div>

          {/* Right Column: Result */}
          <div className="sticky top-32">
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-[2.5rem] p-4 min-h-[500px] flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 mb-4">
                <div className="flex flex-col">
                  <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">Result Preview</h3>
                  {resultImages.length > 1 && (
                    <p className="text-[10px] text-blue-400 font-medium">Found {resultImages.length} versions</p>
                  )}
                </div>
                {resultImages.length > 0 && (
                  <button 
                    onClick={downloadResult}
                    className="p-2 hover:bg-neutral-800 rounded-xl transition-colors text-blue-400"
                    title="Download Current Image"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="flex-1 relative rounded-[2rem] overflow-hidden bg-neutral-950 border border-neutral-800/50 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  {isGenerating ? (
                    <motion.div 
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center"
                    >
                      <div className="relative w-24 h-24 mb-8">
                        <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full" />
                        <motion.div 
                          className="absolute inset-0 border-4 border-t-blue-500 rounded-full"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        />
                      </div>
                      <motion.p 
                        key={loadingMessageIndex}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="text-lg font-medium text-white max-w-xs"
                      >
                        {LOADING_MESSAGES[loadingMessageIndex]}
                      </motion.p>
                      <p className="text-sm text-neutral-500 mt-4">This may take up to 30 seconds</p>
                    </motion.div>
                  ) : resultImages.length > 0 ? (
                    <motion.div
                      key="result"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="w-full h-full group relative"
                    >
                      <img 
                        src={resultImages[selectedResultIndex]} 
                        alt={`Result ${selectedResultIndex + 1}`} 
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                      
                      {resultImages.length > 1 && (
                        <div className="absolute inset-x-0 bottom-20 flex justify-center gap-2 px-4">
                          {resultImages.map((_, idx) => (
                            <button
                              key={idx}
                              onClick={() => setSelectedResultIndex(idx)}
                              className={cn(
                                "w-2 h-2 rounded-full transition-all",
                                selectedResultIndex === idx ? "bg-blue-500 w-6" : "bg-neutral-600 hover:bg-neutral-500"
                              )}
                            />
                          ))}
                        </div>
                      )}

                      <div className="absolute bottom-6 left-6 right-6 p-4 bg-neutral-950/80 backdrop-blur-md border border-neutral-800 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <p className="text-sm font-medium">Character swap complete!</p>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-neutral-600 gap-4">
                      <ImageIcon className="w-16 h-16 opacity-20" />
                      <p className="text-sm font-medium max-w-[200px] text-center">
                        Upload references and click generate to see the magic.
                      </p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            
            <div className="mt-8 grid grid-cols-3 gap-4">
              <div className="p-4 bg-neutral-900/30 border border-neutral-800 rounded-2xl text-center">
                <p className="text-[10px] text-neutral-500 uppercase font-bold mb-1">Aspect Ratio</p>
                <p className="text-sm font-semibold">{aspectRatio}</p>
              </div>
              <div className="p-4 bg-neutral-900/30 border border-neutral-800 rounded-2xl text-center">
                <p className="text-[10px] text-neutral-500 uppercase font-bold mb-1">Model</p>
                <p className="text-sm font-semibold">{currentModel === PREMIUM_MODEL ? "Flash 3.1" : "Flash 2.5"}</p>
              </div>
              <div className="p-4 bg-neutral-900/30 border border-neutral-800 rounded-2xl text-center">
                <p className="text-[10px] text-neutral-500 uppercase font-bold mb-1">Style</p>
                <p className="text-sm font-semibold">Photoreal</p>
              </div>
            </div>
          </div>

        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-neutral-900 mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-sm text-neutral-500">
            © 2026 Character Swap AI. All rights reserved.
          </p>
          <div className="flex gap-8">
            <a href="#" className="text-sm text-neutral-500 hover:text-white transition-colors">Documentation</a>
            <a href="#" className="text-sm text-neutral-500 hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="text-sm text-neutral-500 hover:text-white transition-colors">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
