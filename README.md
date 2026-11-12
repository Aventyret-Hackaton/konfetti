# Konfetti

A 3D confetti bomb that plays music. Tap the bomb: it bursts into confetti, each
piece carrying a sound (drums, bass, piano, guitar, bell, cat scream). The pieces
rain into the upturned speaker-ears of a flat cut-out head lying on its side, swirl
down into them like a funnel, and each one plays as it is spat out of the mouth, whose
jaw slides open paper-collage style on every note.

## Run

No build step. Serve the folder over HTTP (ES modules don't load from `file://`):

    python3 -m http.server 8000

Then open http://localhost:8000, or `http://<your-ip>:8000` from a phone on the same network.

## Files

- `index.html` – page shell and legend styling
- `main.js` – three.js scene, confetti physics, cut-out head, sequencer
- `audio.js` – all sounds, synthesised with WebAudio (no samples)
- `assets/head.png` – the head picture, upright, background removed (third-party image; check rights before publishing); `main.js` lays it on its side and cuts the jaw out
- `vendor/three.module.min.js` – three.js r170

`?auto` in the URL fires the bomb on load (handy for screenshots).
