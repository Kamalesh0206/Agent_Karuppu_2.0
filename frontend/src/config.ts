import axios from 'axios';

// Automatically clear any legacy, Netlify, or deprecated API URLs stored in client storage
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
        console.log("[Config] Automatically purged deprecated custom_api_url from localStorage:", stored);
        localStorage.removeItem("custom_api_url");
      }
    }
  } catch (e) {
    console.warn("[Config] Could not inspect localStorage during startup:", e);
  }
};

// Run startup cleanup immediately
sanitizeStoredApiUrl();

export const isFrontendUrl = (url: string): boolean => {
  if (!url) return false;
  const normalized = url.toLowerCase().trim();
  if (typeof window !== 'undefined' && normalized.includes(window.location.host.toLowerCase())) {
    return true;
  }
  // Check if target matches frontend domain (without api subdomain)
  if (normalized === 'https://thenexrevo.com' || normalized === 'http://thenexrevo.com' || normalized === 'https://www.thenexrevo.com') {
    return true;
  }
  return false;
};

export const getApiUrl = (): string => {
  if (typeof window !== 'undefined') {
    // 1. User-configured Custom Backend Endpoint from LocalStorage
    const customUrl = localStorage.getItem("custom_api_url");
    if (customUrl && customUrl.trim()) {
      const formatted = customUrl.trim().replace(/\/$/, '');
      if (!isFrontendUrl(formatted)) {
        return formatted;
      }
    }

    const metaEnv = (import.meta as any).env || {};
    // 2. Explicit Environment Variable (VITE_API_BASE, VITE_API_URL, VITE_API_BASE_URL)
    const envUrl = metaEnv.VITE_API_BASE || metaEnv.VITE_API_URL || metaEnv.VITE_API_BASE_URL;
    if (envUrl && envUrl.trim()) {
      const formatted = envUrl.trim().replace(/\/$/, '');
      if (!isFrontendUrl(formatted)) {
        return formatted;
      }
    }

    // 3. Localhost development hostname check
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8000";
    }

    // 4. Primary Production API Target (https://api.thenexrevo.com)
    return "https://api.thenexrevo.com";
  }

  return "https://api.thenexrevo.com";
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

export const validateBackendHealth = async (targetUrl: string): Promise<{ valid: boolean; message?: string; error?: string }> => {
  let target = targetUrl.trim().replace(/\/$/, '');
  if (target && !target.startsWith('http://') && !target.startsWith('https://')) {
    target = `https://${target}`;
  }

  if (isFrontendUrl(target)) {
    return {
      valid: false,
      error: "❌ Invalid API URL: You are pointing to the frontend application URL instead of your FastAPI backend server (https://api.thenexrevo.com)."
    };
  }

  try {
    const res = await axios.get(`${target}/health`, {
      timeout: 7000,
      headers: { Accept: 'application/json' }
    });

    const contentType = String(res.headers['content-type'] || '').toLowerCase();
    const isHtml = contentType.includes('text/html') || (typeof res.data === 'string' && (res.data.includes('<!DOCTYPE') || res.data.includes('<html')));

    if (isHtml) {
      return {
        valid: false,
        error: "❌ Incorrect API Server URL. Target returned HTML (frontend static app detected) instead of FastAPI JSON responses."
      };
    }

    if (res.data && (res.data.status === "healthy" || res.data.version)) {
      return {
        valid: true,
        message: "✅ Connected to FastAPI backend server."
      };
    }

    return {
      valid: false,
      error: `❌ Backend returned unexpected payload: ${JSON.stringify(res.data)}`
    };
  } catch (e: any) {
    if (e.response && typeof e.response.data === 'string' && (e.response.data.includes('<!DOCTYPE') || e.response.data.includes('<html'))) {
      return {
        valid: false,
        error: "❌ Invalid API URL: Target returned HTML instead of FastAPI JSON responses."
      };
    }
    return {
      valid: false,
      error: `❌ Backend server unavailable (${e.message || 'Server Unreachable'}).`
    };
  }
};

export const API_URL = getApiUrl();
export const API_BASE = API_URL;
export const WS_URL = API_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
export const APP_URL = typeof window !== 'undefined' ? window.location.origin : "https://thenexrevo.com";
export const REGISTRATION_URL = `${APP_URL}/signup`;
export const LOGIN_URL = `${APP_URL}/login`;


