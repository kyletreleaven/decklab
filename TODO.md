1. Deck Builder (the baseline)

This has to feel at least as good as Arena.

Visual card grid
Fast keyboard search
Click/double-click to add cards
Drag between mainboard and sideboard
Multiple views (grid, list, curve)
Rich filtering (colors, types, mana value, keywords, legality, etc.)
Deck folders/tags
Autosave
Undo/redo
Multiple deck tabs

Nothing revolutionary here—it just needs to be pleasant.

2. Collection Management

This is where most desktop apps become painful.

Multiple collections
Paper Collection
Arena Collection
Cube
Cards Loaned Out
Wishlist

A deck can be evaluated against any collection.

Smart ownership

Instead of

Lightning Bolt x4

show

Owned
─────
2x Alpha
1x Secret Lair
4x M11

Playable:
7 copies

and let the user decide whether printings matter.

Missing cards
Deck Complete

✓ 91 owned
✗ 9 missing

Estimated cost
TCGPlayer: $42
Card Kingdom: $51
Imports

This should be painless.

Arena exports
MTGO exports
Moxfield
Archidekt
tournament decklists
clipboard
CSV

Ideally, "paste anything vaguely deck-shaped."

3. Deck Database

One local library.

Favorites

Commander
Modern
Pioneer
Legacy

Brews
Competitive
Archived

Each deck has

notes
tags
history
statistics
playtest notes
4. Version Control ⭐

This is one of the features I think existing tools really underinvest in.

Rakdos Lizards

main
├── RCQ
├── Store Championship
├── vs Control
└── Foundations update

Then you can compare two versions.

+2 Fatal Push
-2 Cut Down

Average MV
2.13 → 2.05

Black sources
17 → 18

Opening hand consistency
+3.2%

Basically Git for decks.

5. Statistics ⭐⭐⭐

This is where I'd spend most of my effort.

Mana
mana curve
colored source counts
untapped sources
pips by color
land/spell ratio
MDFCs
fetch interactions
Opening hand
Chance of

1 land
2 lands
3 lands
4 lands

Turn 1 black source

Turn 2 RR

Three lands by turn three

Five mana by turn five
Draw probabilities

Instead of a separate hypergeometric calculator:

Click on any card.

Lightning Bolt

Opening hand
39%

By turn 3
63%

By turn 5
79%
Combo analysis

If a combo needs

A
B
C

show

Turn 4 combo
41%

Turn 5
63%

Turn 6
81%
Archetype profile

Something visual.

Aggression      ████████░░
Removal         ██████░░░░
Card Advantage  ████░░░░░░
Ramp            ██░░░░░░░░
Interaction     ███████░░░
Consistency     █████████░

This could even be computed automatically.

Mana base diagnostics

Imagine warnings like an IDE.

⚠ Only 73% chance
of casting UU on turn two.

Suggested:
+2 Islands
-1 Utility land
6. Card Intelligence

Click any card.

See

Oracle text
rulings
legality
printings
owned copies
price history
decks containing it
common replacements
common pairings
7. Discovery

This is where online data comes in.

For any card:

Appears in

37% of Dimir Midrange

Average copies
3.8

Often paired with

Go for the Throat
Cut Down
Kaito

For a deck:

Similar decks

87%
83%
79%
8. Suggestions

Not AI necessarily.

Statistical.

Your deck

1.6 white sources

Average competitive deck

2.9 white sources

or

91% of decks
playing

Card A

also play

Card B
9. Playtesting

Built in.

draw seven
mulligan
goldfish
play turns
undo
reshuffle
Monte Carlo thousands of games in the background
10. Polish

Small things that make a desktop app feel premium:

Command palette (⌘K / ⌘⇧P)
Global search
Split panes
Keyboard-first navigation
Dark mode
Instant search
Offline-first
Local SQLite database
Plugin support
Fast enough that everything feels instantaneous