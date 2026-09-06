import { PageHeader } from "@/components/ui";
import { QrScanner } from "@/components/qr-scanner";

export const metadata = { title: "Scan a cage" };

export default function ScanPage() {
  return (
    <>
      <PageHeader
        title="Scan"
        subtitle="Point the camera at a cage card to open its record."
      />
      <QrScanner />
    </>
  );
}
