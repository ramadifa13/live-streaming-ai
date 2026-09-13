const RESUME_STORAGE_KEY = "livio_resume_code";

export function readStoredResumeCode(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(RESUME_STORAGE_KEY);
  return value ? value.trim().toUpperCase() : null;
}

export function storeResumeCode(resumeCode: string | null) {
  if (typeof window === "undefined") return;
  if (!resumeCode) {
    window.localStorage.removeItem(RESUME_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(RESUME_STORAGE_KEY, resumeCode.trim().toUpperCase());
}

export function apiHeaders(extra?: HeadersInit): HeadersInit {
  const resume = readStoredResumeCode();
  return {
    ...(extra || {}),
    ...(resume ? { "x-livio-resume": resume } : {}),
  };
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    credentials: "include",
    headers: apiHeaders(init?.headers),
  });
}
