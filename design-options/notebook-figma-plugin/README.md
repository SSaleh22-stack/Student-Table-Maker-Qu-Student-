# Notebook (المذكرات) Figma designs

A local Figma plugin that draws all the iPad screens of the notebook beta in Arabic (RTL), following [`mobile-app/docs/notebook-prd.md`](../../mobile-app/docs/notebook-prd.md).

## Run it

1. Open the Figma desktop app and the design file (for example "QU Student — المذكرات (Notebook) Beta").
2. Menu → Plugins → Development → **Import plugin from manifest…** and pick `manifest.json` in this folder. You only do this once.
3. Run **QU Notebook Designs** from Plugins → Development. After that, **Ctrl+Alt+P** reruns it.

Each run **deletes everything on the page named "المذكرات — iPad"** (or the file's first page, which it renames) and draws the screens again. Don't hand-edit that page: rerunning throws your edits away.

## What it draws

A cover and 23 screens:

- **01:** Home, with the Beta icon.
- **02–05:** library, course folder, new notebook and receiving a PDF.
- **06–12:** editor tools, PDF lasso, shapes and ruler, recording and playback.
- **13–17:** pages, sharing, settings, recently deleted and empty state.
- **18–21:** moving the toolbar.
- **22–23:** scientific calculator, docked and floating.

Colors and fonts come from `mobile-app/src/lib/theme.ts`, and icons from `mobile-app/src/components/Icon.tsx`.

## Edit it

Change `code.js`. Each screen is one `s…()` function, listed in the `steps` array in `main()`. Then rerun the plugin. Figma reads the file from disk on every run.
