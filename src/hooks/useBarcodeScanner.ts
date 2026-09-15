import { useEffect, useRef } from 'react';

export interface UseBarcodeScannerOptions {
  onScan?: (barcode: string) => void;
  onBarcodeScanned?: (barcode: string) => void;
  minLength?: number;
  timeOut?: number; // Maximum delay (ms) between keypresses from hardware barcode scanner
  enabled?: boolean;
}

/**
 * Checks whether the event target or active element is a text input field, textarea,
 * select dropdown, or contenteditable element.
 */
export const isUserTyping = (target: EventTarget | null): boolean => {
  const activeElement = typeof document !== 'undefined' ? document.activeElement : null;

  const checkElement = (el: Element | null): boolean => {
    if (!el || !(el instanceof HTMLElement)) return false;
    const tagName = el.tagName;
    const role = el.getAttribute('role');
    return (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT' ||
      el.isContentEditable ||
      role === 'textbox' ||
      role === 'searchbox' ||
      role === 'combobox'
    );
  };

  return checkElement(activeElement) || checkElement(target as Element);
};

/**
 * Helper to strip injected barcode characters from active input field
 */
function cleanInjectedBarcodeFromActiveInput(scannedCode: string) {
  try {
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    if (activeEl && (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement)) {
      const val = activeEl.value;
      if (val.endsWith(scannedCode)) {
        activeEl.value = val.slice(0, -scannedCode.length);
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        activeEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (val === scannedCode) {
        activeEl.value = '';
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        activeEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  } catch (_) { }
}

/**
 * Global Hardware Barcode Scanner Hook
 * 
 * CRITICAL SAFETY & PERFORMANCE RULES:
 * 1. Rapid-keystroke interval detection (< 35ms) intercepts hardware scanners even if focused in text input.
 * 2. Human typing (> 45ms) is 100% untouched and passes through naturally.
 * 3. Prevents corruption of active input fields and ensures scanned barcode reaches cart.
 */
export function useGlobalBarcodeScanner(onBarcodeScanned: (barcode: string) => void) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(Date.now());
  const rapidInputBufferRef = useRef<{ key: string; time: number }[]>([]);
  const onBarcodeScannedRef = useRef(onBarcodeScanned);

  useEffect(() => {
    onBarcodeScannedRef.current = onBarcodeScanned;
  }, [onBarcodeScanned]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable ||
        target?.getAttribute?.('role') === 'textbox' ||
        target?.getAttribute?.('role') === 'searchbox' ||
        target?.getAttribute?.('role') === 'combobox' ||
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT' ||
        (document.activeElement as HTMLElement)?.isContentEditable ||
        document.activeElement?.getAttribute?.('role') === 'textbox' ||
        isUserTyping(e.target);

      // 1. Hardware Scanner Buffer Protection for focused input fields (OPS-03)
      if (isInputField) {
        const now = Date.now();
        const last = rapidInputBufferRef.current[rapidInputBufferRef.current.length - 1];
        const interval = last ? now - last.time : 0;

        if (e.key === 'Enter') {
          const chars = rapidInputBufferRef.current.filter(k => k.key !== 'Enter').map(k => k.key).join('').trim();
          const fastCount = rapidInputBufferRef.current.length;
          rapidInputBufferRef.current = [];

          // If a burst of >= 5 characters arrived at hardware scanner speed (<35ms average)
          if (chars.length >= 5 && fastCount >= 5) {
            e.preventDefault();
            e.stopPropagation();
            cleanInjectedBarcodeFromActiveInput(chars);
            onBarcodeScannedRef.current(chars);
            return;
          }
          return;
        }

        if (e.key.length === 1) {
          // If interval between consecutive keys exceeds 45ms, reset (normal human typing)
          if (last && interval > 45) {
            rapidInputBufferRef.current = [{ key: e.key, time: now }];
          } else {
            rapidInputBufferRef.current.push({ key: e.key, time: now });
          }
        }
        return;
      }

      // Ignore modifier/functional keys
      if (
        e.key === 'Shift' ||
        e.key === 'Control' ||
        e.key === 'Alt' ||
        e.key === 'Meta' ||
        e.key === 'CapsLock' ||
        e.key === 'Tab' ||
        e.key === 'Escape'
      ) {
        return;
      }

      const currentTime = Date.now();
      const char = e.key;

      // Barcode scanners type rapidly (< 35ms between characters)
      if (currentTime - lastKeyTimeRef.current > 50) {
        bufferRef.current = '';
      }
      lastKeyTimeRef.current = currentTime;

      if (char === 'Enter') {
        const barcode = bufferRef.current.trim();
        if (barcode.length >= 3) {
          e.preventDefault();
          onBarcodeScannedRef.current(barcode);
        }
        bufferRef.current = '';
      } else if (char.length === 1) {
        bufferRef.current += char;
      }
    };

    // Use passive: false to allow preventing default on rapid scanner burst
    window.addEventListener('keydown', handleKeyDown, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}

/**
 * Compatible useBarcodeScanner hook supporting both object options and callback signatures
 */
export function useBarcodeScanner(
  optionsOrCallback: UseBarcodeScannerOptions | ((barcode: string) => void)
) {
  const options: UseBarcodeScannerOptions =
    typeof optionsOrCallback === 'function'
      ? { onScan: optionsOrCallback }
      : optionsOrCallback;

  const callback = options.onScan || options.onBarcodeScanned || (() => {});
  const minLength = options.minLength ?? 2;
  const timeOut = options.timeOut ?? 50;
  const enabled = options.enabled ?? true;

  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const rapidInputBufferRef = useRef<{ key: string; time: number }[]>([]);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable ||
        target?.getAttribute?.('role') === 'textbox' ||
        target?.getAttribute?.('role') === 'searchbox' ||
        target?.getAttribute?.('role') === 'combobox' ||
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT' ||
        (document.activeElement as HTMLElement)?.isContentEditable ||
        isUserTyping(e.target);

      if (isInputField) {
        const now = Date.now();
        const last = rapidInputBufferRef.current[rapidInputBufferRef.current.length - 1];
        const interval = last ? now - last.time : 0;

        if (e.key === 'Enter') {
          const chars = rapidInputBufferRef.current.filter(k => k.key !== 'Enter').map(k => k.key).join('').trim();
          const fastCount = rapidInputBufferRef.current.length;
          rapidInputBufferRef.current = [];

          if (chars.length >= Math.max(5, minLength) && fastCount >= 5) {
            e.preventDefault();
            e.stopPropagation();
            cleanInjectedBarcodeFromActiveInput(chars);
            callbackRef.current(chars);
            return;
          }
          return;
        }

        if (e.key.length === 1) {
          if (last && interval > 45) {
            rapidInputBufferRef.current = [{ key: e.key, time: now }];
          } else {
            rapidInputBufferRef.current.push({ key: e.key, time: now });
          }
        }
        return;
      }

      // Ignore navigation, functional, and modifier keys
      if (
        e.key === 'Shift' ||
        e.key === 'Control' ||
        e.key === 'Alt' ||
        e.key === 'Meta' ||
        e.key === 'CapsLock' ||
        e.key === 'Tab' ||
        e.key === 'Escape' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'PageUp' ||
        e.key === 'PageDown' ||
        e.key === 'Home' ||
        e.key === 'End'
      ) {
        return;
      }

      const currentTime = Date.now();

      // Clear buffer if time between keypresses exceeds timeout threshold
      if (currentTime - lastKeyTimeRef.current > timeOut) {
        bufferRef.current = '';
      }
      lastKeyTimeRef.current = currentTime;

      if (e.key === 'Enter') {
        const scannedCode = bufferRef.current.trim();
        if (scannedCode.length >= minLength) {
          e.preventDefault();
          callbackRef.current(scannedCode);
        }
        bufferRef.current = '';
        return;
      }

      // Accumulate single character keys
      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }

      // Auto-clear buffer if scanner pauses
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = setTimeout(() => {
        bufferRef.current = '';
      }, timeOut * 4);
    };

    window.addEventListener('keydown', handleGlobalKeyDown, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    };
  }, [minLength, timeOut, enabled]);
}

export default useBarcodeScanner;
