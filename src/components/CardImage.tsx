import { useEffect, useState } from "react";
import { ensureCached, imageUrl, type ImageSize } from "../lib/images";
import type { Card } from "../lib/types";

/**
 * Shows the remote image immediately, then swaps to the locally cached copy
 * once Rust has it on disk. The swap is invisible (same bytes) but means the
 * next render — and the next launch, offline — comes from the local file.
 */
export function CardImage({
  card,
  size = "small",
  className,
}: {
  card: Card;
  size?: ImageSize;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(() => imageUrl(card, size));

  useEffect(() => {
    let active = true;
    setSrc(imageUrl(card, size));

    ensureCached(card, size).then((local) => {
      if (active && local) setSrc(local);
    });

    return () => {
      active = false;
    };
  }, [card.id, size]);

  if (!src) {
    return <div className="placeholder">{card.name}</div>;
  }

  return <img className={className} src={src} alt={card.name} loading="lazy" />;
}
