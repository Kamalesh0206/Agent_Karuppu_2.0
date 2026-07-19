const getApiUrl = () => {
  const metaEnv = (import.meta as any).env || {};

  // 1. Explicit Vite Environment Variable
  if (metaEnv.VITE_API_URL || metaEnv.VITE_API_BASE) {
    const rawUrl = metaEnv.VITE_API_URL || metaEnv.VITE_API_BASE;
    return rawUrl.replace(/\/$/, '');
  }

  // 2. Localhost development hostname check
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8000";
    }

    // 3. Production hostname check (Never return http://localhost for non-localhost hostnames!)
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    if (hostname.includes('netlify.app') || hostname.includes('agentkaruppu')) {
      return `${protocol}//agentkaruppu-api.onrender.com`;
    }

    return `${protocol}//${hostname}:8000`;
  }

  return "http://localhost:8000";
};

export const API_URL = getApiUrl();
export const WS_URL = API_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
