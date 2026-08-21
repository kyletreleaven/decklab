import { useEffect, useState } from "react";
import { ensureCached, imageUrl, type Face, type ImageSize } from "../lib/images";
import type { Card } from "../lib/types";

/**
 * Shows the remote image immediately, then swaps to the locally cached copy
 * once Rust has it on disk. The swap is invisible (same bytes) but means the
 * next render — and the next launch, offline — comes from the local file.
 */
export function CardImage({
  card,
  size = "small",
  face = "front",
  className,
}: {
  card: Card;
  size?: ImageSize;
  /** Which side of a double-faced card. Ignored when the card has no back. */
  face?: Face;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(() => imageUrl(card, size, face));

  useEffect(() => {
    let active = true;
    setSrc(imageUrl(card, size, face));

    ensureCached(card, size, face).then((local) => {
      if (active && local) setSrc(local);
    });

    return () => {
      active = false;
    };
  }, [card.id, size, face]);

  if (!src) {
    return <div className="placeholder">{card.name}</div>;
  }

  return <img className={className} src={src} alt={card.name} loading="lazy" />;
}
