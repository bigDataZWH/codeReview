import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[API Error]', error.message);
    return Promise.reject(error);
  },
);

export default api;

export interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
  [key: string]: unknown;
}
