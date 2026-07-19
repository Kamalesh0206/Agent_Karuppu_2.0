import axios from 'axios';

export const isFrontendUrl = (url: string): boolean => {
  if (!url) return false;
  const normalized = url.toLowerCase().trim();
  if (normalized.includes('agentkaruppu.netlify.app') || normalized.includes('netlify.app')) {
    return true;
  }
  if (typeof window !== 'undefined' && normalized.includes(window.location.host.toLowerCase())) {
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
      // Do not allow Netlify frontend URL to be saved as API URL
      if (!isFrontendUrl(formatted)) {
        return formatted;
      }
    }

    const metaEnv = (import.meta as any).env || {};
    // 2. Explicit Environment Variable (VITE_API_BASE or VITE_API_URL)
    const envUrl = metaEnv.VITE_API_BASE || metaEnv.VITE_API_URL;
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

    // 4. Default Production Target (NEVER use Netlify frontend host as backend URL!)
    return "http://localhost:8000";
  }

  return "http://localhost:8000";
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
      error: "❌ Invalid API URL: You are pointing to the Netlify Frontend URL (https://agentkaruppu.netlify.app) instead of your backend server."
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
        error: "❌ Incorrect API Server URL. You are pointing to the Netlify Frontend instead of the FastAPI backend."
      };
    }

    if (res.data && (res.data.status === "healthy" || res.data.version)) {
      return {
        valid: true,
        message: "✅ Connected to backend server."
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
        error: "❌ Invalid API URL: Target returned HTML (Frontend URL detected). Please specify your FastAPI backend URL."
      };
    }
    return {
      valid: false,
      error: `❌ Backend server unavailable (${e.message || 'Server Unreachable'}).`
    };
  }
};

export const API_URL = getApiUrl();
export const WS_URL = API_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
