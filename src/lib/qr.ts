import QRCode from "qrcode";

/**
 * Cage-card QR, rendered to inline SVG on the server.
 *
 * SVG rather than a PNG data URI because these get printed and taped to a
 * cage at small sizes — vector stays sharp on whatever the vivarium printer
 * is, and it costs no client JavaScript.
 *
 * The payload is a URL rather than a bare cage code so that a phone's stock
 * camera app opens the cage record directly, with no app to install first.
 */
export function cageUrl(origin: string, code: string) {
  return `${origin.replace(/\/$/, "")}/cages/${encodeURIComponent(code)}`;
}

export async function qrSvg(payload: string, size = 220): Promise<string> {
  return QRCode.toString(payload, {
    type: "svg",
    margin: 0,
    width: size,
    // Cage cards get splashed, smudged and partly peeled. Q tolerates ~25%
    // damage, which is worth the extra density here.
    errorCorrectionLevel: "Q",
  });
}
