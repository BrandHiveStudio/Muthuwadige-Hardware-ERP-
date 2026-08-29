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
 * Global Hardware Barcode Scanner Hook
 * 
 * CRITICAL SAFETY & PERFORMANCE RULES:
 * 1. Bypasses buffering entirely when user is focused on any input/textarea/editable.
 * 2. Rapid timing detection (< 50ms buffer reset) so typing doesn't buffer.
 * 3. Passive event listener to prevent UI thread blocking.
 */
export function useGlobalBarcodeScanner(onBarcodeScanned: (barcode: string) => void) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(Date.now());
  const onBarcodeScannedRef = useRef(onBarcodeScanned);

  useEffect(() => {
    onBarcodeScannedRef.current = onBarcodeScanned;
  }, [onBarcodeScanned]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. CRITICAL: If the user is actively focused on an input or typing area, bypass barcode buffering entirely
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
        document.activeElement?.getAttribute?.('role') === 'textbox';

      if (isInputField) {
        // Let the native input handle the keypress directly without triggering global scanner overhead
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

    // Use passive event listener to prevent UI thread blocking
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
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 1. CRITICAL: If focused on any input or typing field, bypass completely
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
        return; // Allow 100% normal typing
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
