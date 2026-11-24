import type { GoogleAIApi } from './index'

declare global {
  interface Window {
    googleAI: GoogleAIApi
  }
}
