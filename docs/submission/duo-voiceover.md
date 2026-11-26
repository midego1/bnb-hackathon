# Hero video voice-over (duo.mp4 / duo.webm)

The English voice-over of the 64 s hero video. [`web/scripts/duo-audio.sh`](../../web/scripts/duo-audio.sh) reads the
block below (start in seconds, a tab, the line), speaks each line with Piper and mixes it with the synthesized sound
effects and music bed into `duo.mp4` and `duo.webm`. The picture is not re-encoded (`-c:v copy`).

Each start sits on a moment of the recording (captions and vault from `record-duo.mjs`): 7.3 s the Honda Click is
chosen, 14.1 s *Pay*, 17.3–18.6 s the vault fills, 23.6 s pickup photos, 28.8 s return photos, 34.1 s the AI
inspector, 41.6 s the coins take the split's colours, 46.1 s the owner's Accept, 48.2–50.0 s settled and the vault
drains (the fee coin last), 56.6 s the closing caption.

```tsv
0.4	In Thailand, tourists who rent a motorbike usually leave their passport at the shop.
7.5	With KeyScrow, the renter picks a motorbike on their phone. Here, a Honda Click.
14.2	When the renter pays, the deposit and the rent go into a contract made for this one rental, on BNB Chain.
20.5	The vault fills, and the passport stays in the renter's pocket.
24.6	At pickup, the renter takes photos. Only their fingerprints go on-chain.
29.2	At return, the same photos again.
34.3	The AI inspector compares both sets, and drafts how to split the deposit, with its reasons.
41.8	The coins change colour: back to the renter, and to the owner.
46.3	The owner accepts on their phone.
48.7	One transaction pays everyone, and the KeyScrow fee is a single coin.
56.8	Neither side could move the deposit alone.
59.6	Rent the motorbike. Keep your passport. KeyScrow.
```

## Voice

- Engine: [Piper](https://github.com/rhasspy/piper) 1.8 (`pip install piper-tts`), MIT licence, offline, no keys.
- Voice: **`en_GB-cori-high`** from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/cori/high)
  (the repo is MIT). Model card: trained by Bryce Beattie on about 24 hours of LibriVox recordings, which are in the
  **public domain**. Chosen over `en_US-lessac-high` (Blizzard 2013 data under its own licence terms), `en_US-ryan-high`
  (CC BY-NC-SA 4.0) and `en_GB-alan-medium` (medium quality) because it is a high-quality, calm voice whose training
  data carries no licence restriction.
- Settings: default length and noise scales, `--sentence-silence 0.3`. Piper samples a little noise, so a re-run
  sounds the same but is not byte-identical.

## Sound

- Sound effects are synthesized with ffmpeg (`aevalsrc`), no samples: a soft tick when the step bar moves (7.3, 17.3,
  27.3, 33.4 s), coin clinks while the vault fills and drains, one brighter clink for the fee coin, a two-note chime
  at *Settled*.
- Music bed: a slow A-major sine pad, synthesized the same way, at about −28 LUFS and ducked under the voice.
- Mix: voice at −16 LUFS integrated, AAC 160 kb/s in `duo.mp4`, Opus 128 kb/s in `duo.webm`, 48 kHz stereo.
