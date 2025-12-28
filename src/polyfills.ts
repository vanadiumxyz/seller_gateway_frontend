import { Buffer } from "buffer";

declare global {
  interface Window {
    Buffer: typeof Buffer;
  }
}

// Make Buffer globally available for libraries like eth-crypto
window.Buffer = Buffer;
