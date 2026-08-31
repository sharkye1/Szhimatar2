import { useEffect, useRef } from 'react';
import { listen, EventCallback, UnlistenFn } from '@tauri-apps/api/event';

/**
 * useTauriEvent - Safe React hook for subscribing to Tauri IPC events.
 * 
 * Prevents memory leaks and duplicate handlers by properly handling
 * the asynchronous nature of `listen()` during rapid component mount/unmount.
 * 
 * Uses a ref for `handler` to prevent unnecessary unlisten/re-listen cycles
 * while always invoking the latest closure.
 */
export function useTauriEvent<T>(
  eventName: string,
  handler: EventCallback<T>,
  deps: React.DependencyList = []
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let isMounted = true;
    let unlistenFn: UnlistenFn | null = null;

    listen<T>(eventName, (event) => {
      if (isMounted) {
        handlerRef.current(event);
      }
    })
      .then((unlisten) => {
        if (!isMounted) {
          // If component unmounted before listen promise resolved, unlisten immediately
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      })
      .catch((err) => {
        console.error(`[useTauriEvent] Failed to listen to '${eventName}':`, err);
      });

    return () => {
      isMounted = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [eventName, ...deps]);
}

export default useTauriEvent;
