const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const API_BASE = import.meta.env.VITE_API_BASE || (isLocal 
  ? 'http://127.0.0.1:8000' 
  : 'https://agent-karuppu-api.onrender.com');

export const APP_URL = window.location.origin;

export const REGISTRATION_URL = `${APP_URL}/signup`;
export const LOGIN_URL = `${APP_URL}/login`;
