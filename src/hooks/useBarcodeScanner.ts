import { useEffect, useRef } from 'react';

export interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  minLength?: number;
  timeOut?: number; // Maximum delay (ms) between keypresses from hardware barcode scanner
  enabled?: boolean;
}

/**
 * Checks whether the event target or active element is a text input field, textarea,
 * select dropdown, or contenteditable element.
 */
export const isUserTyping = (target: EventTarget | null): boolean => {
  const activeElement = document.activeElement;

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
 * Custom Hook for global hardware barcode scanner listener.
 * Automatically buffers rapid keypresses and triggers `onScan` on 'Enter'.
 * 
 * CRITICAL SAFETY RULE:
 * Does NOT capture, block, or suppress keystrokes when the user is actively
 * typing inside an <input>, <textarea>, <select>, or contentEditable element.
 */
export function useBarcodeScanner({
  onScan,
  minLength = 2,
  timeOut = 50,
  enabled = true,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // If user is focused on ANY input, textarea, select, or modal editable element, DO NOTHING.
      const activeTag = document.activeElement?.tagName;
      if (
        activeTag === 'INPUT' ||
        activeTag === 'TEXTAREA' ||
        activeTag === 'SELECT' ||
        (document.activeElement as HTMLElement)?.isContentEditable ||
        isUserTyping(e.target)
      ) {
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
          onScanRef.current(scannedCode);
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

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    };
  }, [minLength, timeOut, enabled]);
}
