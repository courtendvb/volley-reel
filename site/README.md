# Product site

A static page in two languages: `index.html` (English) and `ja.html` (Japanese), with a switch in the nav.
Both share `site.css` and `site.js` (the court layer tabs). Open either file in a browser; nothing to build.

## Images

- `img/`: screenshots shared by both pages (court layers, data slides) and the English UI screens.
- `img/ja/`: the same screens taken with the app in Japanese (`VR_LANG=ja`). Data slides keep their English labels in either language, so they are shared.
- Video screens show Croatia vs Denmark (2022-05-28) as recorded; the DVW was copied with the team codes changed to CRO and DNK.
- `media/hero-en.mp4` and `media/hero-ja.mp4` are the app's own MP4 export of one clip (set 3, 06-07, #10 attack; IN 4232.0 s, OUT 4240.0 s), re-encoded smaller without sound. The scoreboard, caption and the attacker's heatmap (表示 tab: Attack, Heatmap on, Landings off) come from the scout files; the headline, circle and note are clip objects. So the heatmap reads as a season rather than one match, the project also holds two made-up matches (2022-05-21 and 2022-05-25) made by `source/make_hero_fakes.py`: copies of the real DVW in which every CRO attack becomes a #10 X6 with a made-up landing, paired with the same video. The page's footer says so. `img/hero.jpg` and `img/ja/hero.jpg` are frames at 5.0 s, and `img/plain.jpg` is the same moment (4237.0 s) cut straight from the source video.
- Report, analysis and slide screens use made-up data from `source/make_demo_dvw.py`, with match video made from the AI stills `source/still-*.jpg` (`source/make_video.sh`).

## Taking screenshots again

The court tab shots are frames of the source video, paused at a chosen time rather than at a scout time (those are to the second): landings and cones at 873.25 s (S1 09-09, #7 attack X5), flight and zones at 457.5 s (S1 01-02, #11 attack V6), serve paths at 1011.0 s (S1 12-09, #11 serve). Shoot them with only the real match in the project, so the made-up hero matches stay out of the heatmaps.

`source/shoot-2026-11/` holds the scripts. Start the built app with its own library and profile so your own settings stay untouched:

```bash
VR_LANG=en VR_LIBRARY=<scratch>/lib npx electron . --remote-debugging-port=9333 --user-data-dir=<scratch>/userdata
```

Add `--inspect=<port>` to export without the save dialog: replace `dialog.showSaveDialog` in the main process with one that returns a fixed path, then press Export in the app. Then drive it from that folder: `node cdp.mjs js "<js>"`, `node cdp.mjs shot shots/<name>.png`, and `shoot.sh <name> '<row regex>' '<setup js>' <seconds after the key play>` to pause on a play and crop the video frame. `crop.py` crops the video area out of a full-window shot.

The other files in `source/` (`make_dvw.py`, `add_annotations.py`, `set_corners.py`, `crop_frames.py`, `cdp.mjs`, `lib.js`) are from the first version of the page.
