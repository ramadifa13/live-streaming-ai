const fs = require('fs');
const file = 'd:/work/live-streaming-ai/frontend/src/app/dashboard/page.tsx';
let data = fs.readFileSync(file, 'utf8');

const startIdx = data.indexOf('  // Text-To-Speech Synthesis helper with Dynamic Acoustic & Voice Modulation');
const endIdx = data.indexOf('  const handleGenerateAvatarVideo = async (scriptText?: string) => {');

if (startIdx !== -1 && endIdx !== -1) {
  const newCode = `  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Text-To-Speech Synthesis helper using Edge TTS Backend Stream
  const speakText = async (
    text: string,
    opts?: { voice?: string; lang?: string; tone?: string; avatar?: string }
  ) => {
    if (!isSoundOn) {
      setIsAvatarSpeaking(true);
      setTimeout(() => setIsAvatarSpeaking(false), 3500);
      return;
    }

    const curVoice = opts?.voice || selectedVoice;
    const curLang = opts?.lang || selectedLang;
    const curTone = opts?.tone || selectedTone;
    const curAvatar = opts?.avatar || selectedAvatar.name;

    // Stop current playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
    }

    setIsAvatarSpeaking(true);

    try {
      const res = await fetch("/api/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: curVoice,
          avatarName: curAvatar,
          speed: curTone === "Energetic" ? 1.15 : curTone === "Professional" ? 0.94 : 1.0,
          pitch: curVoice.includes("Pria") ? 0.72 : curTone === "Energetic" ? 1.25 : 1.05,
        }),
      });

      if (!res.ok) throw new Error("TTS Request failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      audio.onended = () => {
        setIsAvatarSpeaking(false);
        URL.revokeObjectURL(url);
      };
      
      audio.onerror = () => {
        setIsAvatarSpeaking(false);
        URL.revokeObjectURL(url);
      };

      await audio.play();
    } catch (err) {
      console.error("Audio streaming error:", err);
      setTimeout(() => setIsAvatarSpeaking(false), 3500);
    }
  };

`;
  data = data.substring(0, startIdx) + newCode + data.substring(endIdx);
  fs.writeFileSync(file, data);
  console.log('Replaced speakText');
} else {
  console.log('Could not find boundaries for speakText');
}

// Now replace handlePlayAudioPreview
const startIdx2 = data.indexOf('  const handlePlayAudioPreview = (');
const endIdx2 = data.indexOf('  const checkSystemReadiness = async () => {');

if (startIdx2 !== -1 && endIdx2 !== -1) {
  const newCode2 = `  const handlePlayAudioPreview = async (
    voice: string = selectedVoice,
    lang: string = selectedLang,
    tone: string = selectedTone,
    speed: number = speechSpeed
  ) => {
    // If currently playing, stop it
    if (isPlayingAudio) {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      }
      setIsPlayingAudio(false);
      setIsAvatarSpeaking(false);
      return;
    }

    // Generate dynamic preview text based on tone, avatar, and active product
    let previewText = "";
    const prodName = activeFeaturedProduct?.name && activeFeaturedProduct.name !== "Memuat Produk..."
      ? activeFeaturedProduct.name
      : "Produk";

    switch (tone) {
      case "Persuasif":
        previewText = \`Halo semuanya! Selamat datang di live streaming kita hari ini. Kenalin, \${prodName} ini formulanya super ringan dan lagi ada promo potongan harga khusus live!\`;
        break;
      case "Energetic":
        previewText = \`Hai guys yang baru gabung! Jangan sampai kelewatan ya, \${prodName} lagi diskon gila-gilaan, yuk langsung checkout di keranjang kuning sekarang!\`;
        break;
      case "FOMO":
        previewText = \`Perhatian kakak-kakak! Stok \${prodName} tinggal 15 botol lagi! Voucher diskon cuma berlaku 5 menit ini aja, buruan amankan sebelum kehabisan!\`;
        break;
      case "Professional":
        previewText = \`Selamat datang. \${prodName} diformulasikan dengan standar klinis dan teruji BPOM untuk memberikan hasil terbaik dan aman bagi Anda.\`;
        break;
      case "Casual":
      default:
        previewText = \`Halo bestie! Asik banget kalian udah mampir. Buat yang mau tanya-tanya tentang \${prodName}, langsung ketik di kolom komentar ya!\`;
        break;
    }

    setAudioPreviewText(previewText);
    setIsPlayingAudio(true);
    setIsAvatarSpeaking(true);

    try {
      const res = await fetch("/api/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: previewText,
          voice,
          speed,
        }),
      });

      if (!res.ok) throw new Error("TTS Request failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      audio.onended = () => {
        setIsPlayingAudio(false);
        setIsAvatarSpeaking(false);
        URL.revokeObjectURL(url);
      };
      
      audio.onerror = () => {
        setIsPlayingAudio(false);
        setIsAvatarSpeaking(false);
        URL.revokeObjectURL(url);
      };

      await audio.play();
    } catch (err) {
      console.error("Audio preview failed:", err);
      // Fallback
      setTimeout(() => {
        setIsPlayingAudio(false);
        setIsAvatarSpeaking(false);
      }, 5000);
    }
  };

`;
  
  // also remove audioUtteranceRef 
  const audioUtteranceLine = '  const audioUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);\n';
  data = data.replace(audioUtteranceLine, '');
  
  data = data.substring(0, startIdx2) + newCode2 + data.substring(endIdx2);
  fs.writeFileSync(file, data);
  console.log('Replaced handlePlayAudioPreview');
} else {
  console.log('Could not find boundaries for handlePlayAudioPreview');
}
