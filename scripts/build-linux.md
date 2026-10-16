# Building DeckLab on Linux

These commands are for Ubuntu or Debian. Open a terminal and paste each block in
turn. Other distributions need the same things under different package names;
Tauri's [prerequisites page](https://v2.tauri.app/start/prerequisites/#linux)
lists them.

**Untested.** Nobody has run these steps on Linux yet. If something goes wrong,
check drag-and-drop between the pool, deck and piles first: Linux uses a
different web engine (WebKitGTK), and drag-and-drop has historically been less
reliable in it.

**1. System libraries, the compiler, and git.** It will ask for your password.

```bash
sudo apt update
sudo apt install git build-essential curl wget file libwebkit2gtk-4.1-dev \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**2. Node.** Install version 20 or newer by following the instructions at
[nodejs.org](https://nodejs.org/en/download). The `nodejs` package from `apt` is
usually too old.

**3. Rust.** Install it by following the instructions at
[rustup.rs](https://rustup.rs).

Close the terminal and open a new one before going on.

**4. Download and build DeckLab.** The first build compiles a lot of Rust and
takes several minutes.

```bash
git clone https://github.com/kyletreleaven/decklab.git
cd decklab
npm ci
npx tauri build --no-bundle
```

**5. Run it.**

```bash
./src-tauri/target/release/decklab
```

To update later, go back to the `decklab` folder, run `git pull`, and repeat
step 4 from `npm ci`.
