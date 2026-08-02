#!/usr/bin/env python3
"""Convert a Moxfield binder dump into a list DeckLab can import.

The dump is the JSON array produced by the browser-console snippet documented
in docs/importing-moxfield.md. Every entry carries the printing Moxfield has on
record, so the output pins set code and collector number rather than leaving
DeckLab to guess a printing from the card name.

Examples
--------
    python3 scripts/moxfield_binder_to_csv.py data/moxfield-binder.json -o binder.csv
    python3 scripts/moxfield_binder_to_csv.py data/moxfield-binder.json --format text
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from typing import Any, Iterable

# Moxfield condition codes -> the short codes DeckLab stores.
CONDITIONS = {
    "mint": "M",
    "nearMint": "NM",
    "lightlyPlayed": "LP",
    "moderatelyPlayed": "MP",
    "heavilyPlayed": "HP",
    "damaged": "DMG",
}

# Moxfield finish codes -> DeckLab finishes.
FINISHES = {
    "nonFoil": "nonfoil",
    "foil": "foil",
    "etched": "etched",
    "glossy": "foil",
}

CSV_HEADER = ["Count", "Name", "Edition", "Collector Number", "Foil", "Condition"]


class ConversionError(Exception):
    """Raised when the input file is not a binder dump we recognise."""


def binder_entries(parsed: Any) -> list[dict]:
    """Accept either the raw array or the wrapper object it came from.

    The console snippet saves a bare list, but a hand-edited run may keep the
    API envelope, so handle both rather than failing on a trivial difference.
    """
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        for key in ("data", "results", "items"):
            value = parsed.get(key)
            if isinstance(value, list):
                return value
    raise ConversionError("could not find an array of binder entries in that file")


def convert(
    parsed: Any,
    *,
    game: str = "paper",
    skip_proxies: bool = False,
) -> tuple[list[dict], dict[str, int]]:
    """Return (rows, skipped-counts) for a parsed binder dump."""
    rows: list[dict] = []
    skipped = {"wrong_game": 0, "proxy": 0, "no_card": 0}

    for entry in binder_entries(parsed):
        if not isinstance(entry, dict):
            skipped["no_card"] += 1
            continue

        card = entry.get("card") or {}
        name = card.get("name")
        if not name:
            skipped["no_card"] += 1
            continue

        entry_game = entry.get("game")
        if game != "all" and entry_game and entry_game != game:
            skipped["wrong_game"] += 1
            continue

        if skip_proxies and entry.get("isProxy"):
            skipped["proxy"] += 1
            continue

        # `finish` carries the finer distinction (etched vs ordinary foil);
        # isFoil is the fallback when no finish is recorded.
        finish = FINISHES.get(entry.get("finish") or "")
        if finish is None:
            finish = "foil" if entry.get("isFoil") else "nonfoil"

        try:
            quantity = int(entry.get("quantity") or 1)
        except (TypeError, ValueError):
            quantity = 1
        quantity = max(quantity, 1)

        rows.append(
            {
                "quantity": quantity,
                "name": name,
                "set": (card.get("set") or "").upper(),
                "number": card.get("cn") or "",
                "finish": finish,
                "condition": CONDITIONS.get(entry.get("condition") or "", "NM"),
                "scryfall_id": card.get("scryfall_id") or "",
                "language": (entry.get("language") or {}).get("code") or "",
            }
        )

    return rows, skipped


def render_csv(rows: Iterable[dict]) -> str:
    """Emit the CSV shape DeckLab's importer already understands."""
    buffer = io.StringIO()
    # QUOTE_MINIMAL matches what collection trackers produce, and DeckLab's
    # CSV reader handles quoted fields and doubled quotes.
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_HEADER)
    for row in rows:
        writer.writerow(
            [
                row["quantity"],
                row["name"],
                row["set"],
                row["number"],
                "" if row["finish"] == "nonfoil" else row["finish"],
                row["condition"],
            ]
        )
    return buffer.getvalue().rstrip("\n")


def render_text(rows: Iterable[dict]) -> str:
    """Emit Arena-style text, e.g. `2 Sol Ring (C21) 263 *F*`."""
    lines = []
    for row in rows:
        line = f"{row['quantity']} {row['name']}"
        if row["set"]:
            line += f" ({row['set']})"
            if row["number"]:
                line += f" {row['number']}"
        if row["finish"] != "nonfoil":
            line += " *F*"
        lines.append(line)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convert a Moxfield binder dump into a DeckLab-importable list.",
    )
    parser.add_argument("input", help="JSON dump produced by the console snippet")
    parser.add_argument(
        "--format",
        choices=("csv", "text"),
        default="csv",
        help="output shape (default: csv)",
    )
    parser.add_argument(
        "--game",
        default="paper",
        help='keep only this game, or "all" (default: paper)',
    )
    parser.add_argument(
        "--skip-proxies",
        action="store_true",
        help="drop entries flagged as proxies",
    )
    parser.add_argument(
        "-o",
        "--out",
        help="write to this file instead of stdout",
    )
    args = parser.parse_args(argv)

    try:
        with open(args.input, encoding="utf-8") as handle:
            parsed = json.load(handle)
    except OSError as error:
        print(f"error: could not read {args.input}: {error}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as error:
        print(f"error: {args.input} is not valid JSON: {error}", file=sys.stderr)
        return 1

    try:
        rows, skipped = convert(
            parsed, game=args.game, skip_proxies=args.skip_proxies
        )
    except ConversionError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    text = (render_csv if args.format == "csv" else render_text)(rows)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
    else:
        sys.stdout.write(text + "\n")

    # Diagnostics go to stderr so `> binder.csv` stays clean.
    unique = {r["scryfall_id"] or f"{r['set']}|{r['number']}" for r in rows}
    notes = [
        f"{len(rows)} entries",
        f"{sum(r['quantity'] for r in rows)} cards",
        f"{len(unique)} unique printings",
    ]
    notes += [f"skipped {count} ({reason})" for reason, count in skipped.items() if count]
    print(" · ".join(notes), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
