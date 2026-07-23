import axios from 'axios';

// Automatically clear any legacy, old subdomains, Netlify, or temporary API URLs stored in client storage
const sanitizeStoredApiUrl = () => {
  if (typeof window === 'undefined') return;
  try {
    const stored = localStorage.getItem("custom_api_url");
    if (stored) {
      const lower = stored.toLowerCase().trim();
      if (
        lower.includes('netlify') || 
        lower.includes('agentkaruppu') || 
        lower.includes('onrender.com') ||
        lower.includes('thenexrevo.com') && !lower.includes('api.thenexrevo.com')
      ) {
        console.log("[Config] Automatically purged legacy custom_api_url from localStorage:", stored);
        localStorage.removeItem("custom_api_url");
      }
    }
  } catch (e) {
    console.warn("[Config] Could not inspect localStorage during startup:", e);
  }
};

// Run startup cleanup immediately
sanitizeStoredApiUrl();

export const PRIMARY_BACKEND_URL = "https://api.thenexrevo.com";
export const PRIMARY_FRONTEND_URL = "https://www.thenexrevo.com";

export const getApiUrl = (): string => {
  if (typeof window !== 'undefined') {
    // 1. User-configured Custom Backend Endpoint from LocalStorage
    const customUrl = localStorage.getItem("custom_api_url");
    if (customUrl && customUrl.trim()) {
      return customUrl.trim().replace(/\/$/, '');
    }

    const metaEnv = (import.meta as any).env || {};
    // 2. Explicit Environment Variable (VITE_API_BASE_URL, VITE_API_BASE, VITE_API_URL, API_BASE_URL, BACKEND_URL)
    const envUrl = metaEnv.VITE_API_BASE_URL || metaEnv.VITE_API_BASE || metaEnv.VITE_API_URL || metaEnv.API_BASE_URL || metaEnv.BACKEND_URL || metaEnv.NEXT_PUBLIC_API_URL || metaEnv.REACT_APP_API_URL;
    if (envUrl && envUrl.trim()) {
      return envUrl.trim().replace(/\/$/, '');
    }

    // 3. Localhost development hostname check
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8000";
    }

    // 4. Production API Base URL (https://api.thenexrevo.com)
    return PRIMARY_BACKEND_URL;
  }

  return PRIMARY_BACKEND_URL;
};

export const setCustomApiUrl = (newUrl: string) => {
  if (typeof window !== 'undefined') {
    if (newUrl && newUrl.trim()) {
      let formatted = newUrl.trim().replace(/\/$/, '');
      if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
        formatted = `https://${formatted}`;
      }
      localStorage.setItem("custom_api_url", formatted);
    } else {
      localStorage.removeItem("custom_api_url");
    }
    window.location.reload();
  }
};

export const isFrontendUrl = (url: string): boolean => {
  if (!url) return false;
  const normalized = url.toLowerCase().trim();
  if (normalized === 'https://www.thenexrevo.com' || normalized === 'https://thenexrevo.com') {
    return true;
  }
  return false;
};

export const validateBackendHealth = async (targetUrl: string): Promise<{ valid: boolean; message?: string; error?: string }> => {
  let target = targetUrl.trim().replace(/\/$/, '');
  if (target && !target.startsWith('http://') && !target.startsWith('https://')) {
    target = `https://${target}`;
  }

  try {
    const res = await axios.get(`${target}/health`, {
      timeout: 7000,
      headers: { Accept: 'application/json' }
    });

    if (res.data && (res.data.status === "healthy" || res.data.version)) {
      return {
        valid: true,
        message: "✅ Connected to backend server."
      };
    }

    return {
      valid: true,
      message: "✅ Connection test succeeded."
    };
  } catch (e: any) {
    return {
      valid: false,
      error: `❌ Backend server unavailable (${e.message || 'Server Unreachable'}).`
    };
  }
};

export const API_URL = getApiUrl();
export const API_BASE = API_URL;
export const WS_URL = API_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
export const APP_URL = typeof window !== 'undefined' ? window.location.origin : PRIMARY_FRONTEND_URL;
export const REGISTRATION_URL = `${APP_URL}/signup`;
export const LOGIN_URL = `${APP_URL}/login`;




