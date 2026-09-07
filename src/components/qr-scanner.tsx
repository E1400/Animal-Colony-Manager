"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Camera scan for cage-card QR codes.
 *
 * ZXing rather than the built-in BarcodeDetector: the target device is iOS
 * Safari, which does not implement BarcodeDetector at all. The library is
 * loaded lazily on first use so the 200KB decoder is not in the bundle for
 * everyone who merely opens the app.
 *
 * The camera only starts on an explicit tap. iOS requires a user gesture, and
 * a page that grabs the camera on load is hostile anyway.
 */
export function QrScanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  // Release the camera when the component goes away — a lingering stream
  // leaves the phone's camera light on and drains the battery.
  useEffect(() => () => stopRef.current?.(), []);

  function goToCode(raw: string) {
    stopRef.current?.();
    setScanning(false);

    // Cards encode a full URL, but a bare code typed by hand should work too.
    let code = raw.trim();
    try {
      const url = new URL(code);
      const match = url.pathname.match(/\/cages\/([^/]+)/);
      if (match) code = decodeURIComponent(match[1]);
    } catch {
      // Not a URL — treat the whole string as the cage code.
    }

    if (!code) {
      setError("That code was empty.");
      return;
    }
    router.push(`/cages/${encodeURIComponent(code)}`);
  }

  async function start() {
    setError(null);

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError(
        "The camera needs a secure connection. Open this page over HTTPS, or use the manual entry below.",
      );
      return;
    }

    setScanning(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();

      const controls = await reader.decodeFromVideoDevice(
        // undefined lets the browser pick; on phones that is the rear camera.
        undefined,
        videoRef.current!,
        (result, _err, ctrl) => {
          if (result) {
            ctrl.stop();
            goToCode(result.getText());
          }
        },
      );
      stopRef.current = () => controls.stop();
    } catch (e) {
      setScanning(false);
      const name = e instanceof Error ? e.name : "";
      if (name === "NotAllowedError") {
        setError(
          "Camera permission was denied. Enable it in your browser settings, or type the cage code below.",
        );
      } else if (name === "NotFoundError") {
        setError("No camera found on this device. Type the cage code below.");
      } else {
        setError("Could not start the camera. Type the cage code below.");
      }
    }
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-muted">
        {/* muted + playsInline are both required for autoplay on iOS. */}
        <video
          ref={videoRef}
          className={`aspect-square w-full object-cover ${scanning ? "" : "hidden"}`}
          muted
          playsInline
        />
        {!scanning ? (
          <div className="flex aspect-square w-full items-center justify-center p-6 text-center text-muted">
            Point the camera at the QR code on a cage card.
          </div>
        ) : null}
      </div>

      {!scanning ? (
        <button
          type="button"
          onClick={start}
          className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl bg-accent px-4 text-lg font-semibold text-accent-contrast"
        >
          Start camera
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            stopRef.current?.();
            setScanning(false);
          }}
          className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl border border-border px-4 text-lg font-semibold"
        >
          Stop
        </button>
      )}

      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-warn/15 px-4 py-3 text-warn">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          goToCode(manual);
        }}
        className="mt-5"
      >
        <label htmlFor="manual-code" className="block text-sm text-muted">
          Or type the cage code
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="manual-code"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="CG-1000"
            autoComplete="off"
            className="min-h-14 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 font-mono text-lg placeholder:font-sans placeholder:text-muted"
          />
          <button
            type="submit"
            className="min-h-14 rounded-xl border border-border px-5 font-semibold"
          >
            Open
          </button>
        </div>
      </form>
    </div>
  );
}
