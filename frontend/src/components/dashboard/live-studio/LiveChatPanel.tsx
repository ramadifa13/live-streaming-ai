"use client";

import React, { useRef, useEffect, useState } from "react";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { ChatMessage } from "@/app/dashboard/types";
import { liveSessionService } from "@/services/liveSessionService";

export const LiveChatPanel: React.FC = () => {
  const chatMessages = useLiveSessionStore((state) => state.chatMessages);
  const inputChat = useLiveSessionStore((state) => state.inputChat);
  const setInputChat = useLiveSessionStore((state) => state.setInputChat);
  const isAiAutoReplyOn = useLiveSessionStore((state) => state.isAiAutoReplyOn);
  const setIsAiAutoReplyOn = useLiveSessionStore((state) => state.setIsAiAutoReplyOn);
  const addChatMessage = useLiveSessionStore((state) => state.addChatMessage);
  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);
  const liveSessionPhase = useLiveSessionStore((state) => state.liveSessionPhase);
  const currentLiveSessionId = useLiveSessionStore(
    (state) => state.currentLiveSessionId,
  );

  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const selectedTone = useAiHostStore((state) => state.selectedTone);
  const selectedVoice = useAiHostStore((state) => state.selectedVoice);
  const selectedLang = useAiHostStore((state) => state.selectedLang);
  const speechSpeed = useAiHostStore((state) => state.speechSpeed);
  const speakText = useAiHostStore((state) => state.speakText);

  const showToast = useDashboardUIStore((state) => state.showToast);
  const [isSending, setIsSending] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isLive = isLiveActive && liveSessionPhase === "live";

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputChat.trim() || isSending) return;

    const text = inputChat.trim();
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      sender: isLive ? "Tester (live inject)" : "Anda (uji prelive)",
      isAi: false,
      avatarColor: "bg-blue-500",
      text,
      time: now,
    };

    addChatMessage(userMsg);
    setInputChat("");

    if (!isAiAutoReplyOn) return;

    setIsSending(true);
    try {
      const result = await liveSessionService.sendTestComment({
        comment: text,
        sessionId: currentLiveSessionId,
        sender: "Tester",
        avatarName: selectedAvatar.name,
        tone: selectedTone,
        voice: selectedVoice || selectedAvatar.voice || "namira",
      });

      if (result.mode === "live") {
        addChatMessage({
          id: String(Date.now() + 1),
          sender: "Sistem",
          isAi: true,
          avatarColor: "bg-emerald-700",
          text:
            result.note ||
            "Komentar masuk antrian AI Host live — balasan akan tayang di stream.",
          time: now,
        });
        showToast("Komentar dikirim ke pipeline live");
        return;
      }

      const replyText = result.speech || "(AI tidak merespons)";
      addChatMessage({
        id: String(Date.now() + 1),
        sender: `AI Host (${selectedAvatar.name}) · uji`,
        isAi: true,
        avatarColor: "bg-[#4148e2]",
        text: replyText,
        time: now,
      });

      // Prelive/step 4: VoxCPM2 — voice_id / lang / speed sama seperti Step 2.
      await speakText(replyText, {
        avatar: selectedAvatar.name,
        tone: selectedTone,
        voice: selectedVoice,
        lang: selectedLang,
        speed: speechSpeed,
      }).catch(() => {});
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal uji komentar");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-[#232c42] bg-[#111827]/80 p-3 h-full">
      <div className="mb-2 flex items-center justify-between border-b border-[#232c42] pb-2">
        <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
          <span>Live Chat</span>
          <span className="text-[9px] font-normal text-slate-500">
            {isLive ? "· live inject" : "· uji prelive"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            setIsAiAutoReplyOn(!isAiAutoReplyOn);
            showToast(`Auto-Reply: ${!isAiAutoReplyOn ? "ON" : "OFF"}`);
          }}
          className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold transition border cursor-pointer ${
            isAiAutoReplyOn
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : "bg-slate-800 text-slate-400 border-slate-700"
          }`}
        >
          Auto-Reply: {isAiAutoReplyOn ? "ON" : "OFF"}
        </button>
      </div>

      <div
        ref={chatContainerRef}
        className="flex-1 space-y-2 overflow-y-auto pr-1 max-h-[250px] md:max-h-none scrollbar-thin scrollbar-thumb-slate-700"
      >
        {chatMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-slate-500 text-[11px]">
            <span>
              {isLive
                ? "Komentar platform & uji inject muncul di sini"
                : "Belum ada chat uji"}
            </span>
            <span className="text-[10px] text-slate-600 mt-0.5">
              {isLive
                ? "Ketik untuk inject komentar ke AI Host live"
                : "Prelive: uji respons LLM + VoxCPM2 TTS"}
            </span>
          </div>
        ) : (
          chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-xl p-2 border transition ${
                msg.isAi
                  ? "bg-blue-950/40 border-blue-500/30 text-blue-100 ml-1"
                  : "bg-[#161f30] border-[#232c42]/60 text-slate-200 mr-1"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5 text-[10px]">
                <span
                  className={`font-bold truncate max-w-[120px] ${
                    msg.isAi ? "text-blue-300" : "text-amber-300"
                  }`}
                >
                  {msg.sender}
                </span>
                <span className="text-[9px] text-slate-500 font-mono">
                  {msg.time}
                </span>
              </div>
              <p className="text-[11px] leading-snug break-words">{msg.text}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSendChat} className="mt-2.5 relative">
        <input
          type="text"
          placeholder={
            isLive
              ? "Inject komentar ke live AI Host..."
              : "Ketik komentar uji prelive..."
          }
          value={inputChat}
          onChange={(e) => setInputChat(e.target.value)}
          disabled={isSending}
          className="w-full rounded-xl bg-[#0b101e] py-2 pl-3 pr-9 text-xs text-slate-200 placeholder-slate-500 outline-none border border-[#232c42] focus:border-blue-500 transition shadow-inner disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isSending}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition text-xs active:scale-95 cursor-pointer disabled:opacity-60"
          title="Kirim Komentar"
        >
          {isSending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Send className="w-3 h-3" />
          )}
        </button>
      </form>
    </div>
  );
};
