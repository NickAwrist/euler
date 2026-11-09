import { useMemo } from "react";
import { encode } from "uqr";
import { Modal } from "../Modal";

/** The user ID as a QR code, for the iOS app to scan. */
export function UserIdQrModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const { size, path } = useMemo(() => {
    const qr = encode(userId, { ecc: "M", border: 2 });
    const modules = qr.data.flatMap((row, y) =>
      row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])),
    );
    return { size: qr.size, path: modules.join("") };
  }, [userId]);

  return (
    <Modal
      title="User ID"
      onClose={onClose}
      maxWidthClass="max-w-[360px]"
      surfaceClassName="max-h-none grid-rows-1"
    >
      <div className="flex flex-col items-center gap-3 px-[18px] pb-[18px]">
        {/* Scanners need dark modules on a light background in every theme. */}
        <svg
          role="img"
          aria-label={`QR code for ${userId}`}
          viewBox={`0 0 ${size} ${size}`}
          shapeRendering="crispEdges"
          className="aspect-square w-full max-w-[280px] rounded-lg bg-white"
        >
          <path d={path} fill="#000" />
        </svg>
        <code className="break-all text-center font-mono text-[0.8125rem] text-muted-foreground">
          {userId}
        </code>
      </div>
    </Modal>
  );
}
