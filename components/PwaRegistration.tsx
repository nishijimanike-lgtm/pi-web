"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      if (process.env.NODE_ENV !== "production" && "serviceWorker" in navigator) {
        // In development, automatically unregister any stale service workers and clear caches
        // so Turbopack's HMR chunks are never served from a stale Cache Storage.
        void navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) {
            void reg.unregister();
          }
        });
        if (typeof caches !== "undefined") {
          void caches.keys().then((keys) => {
            for (const key of keys) {
              if (key.startsWith("pi-web-")) {
                void caches.delete(key);
              }
            }
          });
        }
      }
      return;
    }

    const register = () => {
      const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
      const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}`;

      void navigator.serviceWorker.register(scriptUrl, {
        scope: "/",
        updateViaCache: "none",
      }).catch((error: unknown) => {
        console.error("Failed to register the Pi Web service worker:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
