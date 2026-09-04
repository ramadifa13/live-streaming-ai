export interface Product {
  id?: string;
  name: string;
  price: string | number;
  stock: number;
  tag: string;
  sku?: string;
  image?: string;
  bannerImage?: string;
  link?: string;
  description?: string;
  benefits?: string;
  usage?: string;
  faq?: string;
  targetAudience?: string;
  copywriting?: string;
  scriptBank?: Array<{
    speech: string;
    topic: string;
    mode: string;
    action?: string;
    emotion?: string;
    intent?: string;
    ctaType?: string;
  }>;
  faqPack?: Array<{
    category: string;
    triggers: string[];
    answers: string[];
  }>;
}

export interface CsvRawItem {
  name: string;
  price: number;
  stock: number;
  category: string;
  description: string;
  link: string;
  image: string;
  bannerImage?: string;
  benefits?: string;
  usage?: string;
  faq?: string;
}

export interface LiveSalesScript {
  hook?: string;
  problem?: string;
  solution?: string;
  showcase?: string;
  cta?: string;
  fullScript?: string;
  fullVoiceover?: string;
}

export interface SessionSummaryData {
  sessionId?: string;
  durationSeconds: number;
  durationFormatted: string;
  totalSeconds?: number;
  platform?: string;
  viewers?: number;
  totalViewers: number;
  peakViewers: number;
  comments?: number;
  totalComments: number;
  aiRepliesCount: number;
  clicks?: number;
  totalClicks: number;
  sales?: number;
  grossRevenue: number;
  grossRevenueFormatted: string;
  estimatedGpuCost: number;
  estimatedGpuCostFormatted: string;
  netProfit: number;
  netProfitFormatted: string;
  roiPercentage: string;
  activeProductClicks?: number;
  activeProductSold?: number;
  totalProductSold: number;
  endedAt: string;
}

export interface Avatar {
  id: string;
  name: string;
  role: string;
  type: "2D" | "3D";
  language: string;
  /** female | male — visual host only */
  gender: "female" | "male";
  /** VoxCPM2 voice_id (female catalog) */
  voice: string;
  voiceId?: string;
  sampleAudioUrl?: string;
  image: string;
  modelUrl3d?: string;
  specialty?: string;
}

export interface ChatMessage {
  id: string;
  sender: string;
  isAi: boolean;
  avatarColor: string;
  text: string;
  time: string;
}
