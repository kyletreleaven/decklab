import { useEffect, useState } from "react";
import { ensureCached, imageUrl, type Face, type ImageSize } from "../lib/images";
import type { Card } from "../lib/types";

/**
 * Shows the locally cached image, and the card's name until it is on disk.
 * Never the remote image: the download goes through the channel to Scryfall
 * (`ensureCached`), and the webview never fetches from Scryfall itself.
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
