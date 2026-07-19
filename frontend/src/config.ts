const getApiUrl = () => {
  const metaEnv = (import.meta as any).env;
  if (metaEnv && metaEnv.VITE_API_URL) {
    return metaEnv.VITE_API_URL;
  }
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:8000";
  }
  // Fallback default
  return "http://localhost:8000";
};

export const API_URL = getApiUrl();
export const WS_URL = API_URL.replace(/^http/, 'ws');
