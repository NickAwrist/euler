import { create } from "@bufbuild/protobuf";
import { useLayoutEffect, useRef, useState } from "react";
import { ImageAttachmentSchema } from "../../src/gen/euler/v1/attachments_pb";
import { AttachmentImage } from "../components/MessageItem/AttachmentImage";

function Images() {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);
  return (
    <div
      ref={scrollRef}
      data-testid="image-scroll"
      className="h-96 overflow-auto"
    >
      {Array.from({ length: 20 }, (_, index) => (
        <AttachmentImage
          // biome-ignore lint/suspicious/noArrayIndexKey: static fixture order
          key={index}
          attachment={create(ImageAttachmentSchema, {
            id: `image-${index}`,
            name: `Image ${index}`,
            mimeType: "image/png",
            size: 100,
          })}
        />
      ))}
    </div>
  );
}

export default function ImageLoadingDemo() {
  const [visible, setVisible] = useState(true);
  return (
    <main className="p-4">
      <button type="button" onClick={() => setVisible((value) => !value)}>
        Toggle images
      </button>
      {visible && <Images />}
    </main>
  );
}
