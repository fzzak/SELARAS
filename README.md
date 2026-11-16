# SELARAS Layer Explorer

**SELARAS** (Spatially-Linked Ecological Layer Analysis and Rendering System) by **DIMIDIATUS**
(Dillon Hutama and Faiz Abdullah) shows the seafloor, water column, currents and biology of one ocean
location in a linked 3D view. It runs entirely in the browser: `index.html` is the whole app.

## Use it
Open the site link, or download `index.html` and double-click it (it also works offline).
The app opens with Null Island, an invented test location. It is not real data.

## Load your own location
Click **Load a location** and choose the folder for one location. The app checks it against the format first.
Files are read in your browser and are not uploaded. A loaded location is remembered in that browser only.

## Keep restricted data out of this repository
Anyone with the address can open this site. Load restricted survey data from your own computer instead.

## Rebuild after changing the code
```
python3 source/tools/build.py --site . --only null_island_test
```
The logo files are in `source/brand`.

## What is in this repository
- `index.html`: the whole app, served by GitHub Pages.
- `source/src`: the app code (JavaScript, CSS, page template).
- `source/brand`: the DIMIDIATUS logo files.
- `source/datasets/null_island_test`: the synthetic example location built into the page.
- `source/tools`: `build.py` rebuilds `index.html`; `make_null_island.py` regenerates the example location.
