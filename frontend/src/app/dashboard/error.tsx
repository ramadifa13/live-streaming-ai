"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#060a14] text-white p-4 font-sans flex items-center justify-center">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/30 mx-auto">
          <AlertTriangle className="w-8 h-8 text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Terjadi Kesalahan</h1>
          <p className="text-slate-400">
            Gagal memuat dashboard. Silakan coba lagi atau hubungi support.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 text-sm font-bold text-white hover:brightness-110 shadow-lg shadow-blue-600/30 transition active:scale-95 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Coba Lagi</span>
          </button>
          <Link
            href="/"
            className="flex items-center justify-center gap-2 rounded-xl border border-[#232c42] bg-[#111827] px-5 py-3 text-sm font-bold text-slate-200 hover:border-blue-500 hover:text-white transition active:scale-95 shadow-sm cursor-pointer"
          >
            <Home className="w-4 h-4" />
            <span>Kembali ke Beranda</span>
          </Link>
        </div>
        {error.digest && (
          <details className="text-left text-[10px] text-slate-500">
            <summary className="cursor-pointer mb-1">Detail Error</summary>
            <pre className="bg-[#0c1221] p-2 rounded text-slate-400 overflow-auto max-h-32">
              {error.message}
              {error.digest && ` (${error.digest})`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}