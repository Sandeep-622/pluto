"use client";

import { useEffect, useRef } from "react";
import { googleClientId } from "@/lib/auth";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
          disableAutoSelect?: () => void;
        };
      };
    };
  }
}

const gsiScriptSrc = "https://accounts.google.com/gsi/client";

function readClientId(): { clientId?: string; configError?: string } {
  try {
    return { clientId: googleClientId() };
  } catch (error) {
    return { configError: error instanceof Error ? error.message : "Google sign-in is not configured." };
  }
}

export function GoogleSignInButton({
  disabled = false,
  onCredential,
  onError
}: {
  disabled?: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  const { clientId, configError } = readClientId();

  useEffect(() => {
    onCredentialRef.current = onCredential;
    onErrorRef.current = onError;
  }, [onCredential, onError]);

  useEffect(() => {
    if (!clientId) return;

    let cancelled = false;
    const renderGoogleButton = () => {
      if (cancelled || !buttonRef.current) return;
      const gsi = window.google?.accounts?.id;
      if (!gsi) return;
      buttonRef.current.innerHTML = "";
      gsi.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response.credential) onCredentialRef.current(response.credential);
          else onErrorRef.current("Google sign-in did not return a credential. Please try again.");
        }
      });
      gsi.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        shape: "rectangular",
        text: "signin_with",
        width: 240
      });
    };

    if (window.google?.accounts?.id) {
      renderGoogleButton();
      return () => { cancelled = true; };
    }

    let script = document.querySelector<HTMLScriptElement>(`script[src="${gsiScriptSrc}"]`);
    const handleLoad = () => renderGoogleButton();
    const handleError = () => {
      if (!cancelled) onErrorRef.current("Could not load Google sign-in. Check your network connection or content blocker.");
    };
    if (!script) {
      script = document.createElement("script");
      script.src = gsiScriptSrc;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);
    return () => {
      cancelled = true;
      script?.removeEventListener("load", handleLoad);
      script?.removeEventListener("error", handleError);
    };
  }, [clientId]);

  if (configError) return <p className="auth-error-inline" role="alert">{configError}</p>;
  return <div className={`google-signin-wrap ${disabled ? "disabled" : ""}`} ref={buttonRef} />;
}
