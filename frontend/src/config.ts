export const getApiUrl = (): string => {
  if (typeof window !== 'undefined') {
    // 1. User-configured Custom Backend Endpoint from Mobile Settings
    const customUrl = localStorage.getItem("custom_api_url");
    if (customUrl && customUrl.trim()) {
      return customUrl.trim().replace(/\/$/, '');
    }

    const metaEnv = (import.meta as any).env || {};
    // 2. Explicit Vite Environment Variable
    if (metaEnv.VITE_API_URL || metaEnv.VITE_API_BASE) {
      const rawUrl = metaEnv.VITE_API_URL || metaEnv.VITE_API_BASE;
      return rawUrl.trim().replace(/\/$/, '');
    }

    // 3. Localhost development hostname check
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8000";
    }

    // 4. Production Hostname Check (Netlify / Custom Web)
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    if (hostname.includes('netlify.app') || hostname.includes('agentkaruppu')) {
      // Use origin or standard HTTPS production target
      return `${protocol}//${hostname}`;
    }

    return `${protocol}//${hostname}:8000`;
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

export const API_URL = getApiUrl();
export const WS_URL = API_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
