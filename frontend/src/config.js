const hostname = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;

export const API_BASE = `http://${hostname || '127.0.0.1'}:8000`;
export const APP_URL = `http://${window.location.hostname || 'localhost'}:3000`;

export const REGISTRATION_URL = `${APP_URL}/signup`;
export const LOGIN_URL = `${APP_URL}/login`;
