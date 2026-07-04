# ANDES IFU slit design playground

Interactive tool to explore the fibre routing between the 61-spaxel IFU hexagon
(S + rings S4..S1) and the 75-slot YJH pseudo-slit, and to design a removable
spaxel mask that makes every second slit position dark.

Baseline layout from E-AND-SW-SPE-09-00-002 v1.2, Fig. 2:
`C D S D [6x(D S4)] D [12xS3] D [18xS2] D [24xS1] D C`
(61 fibres + 12 dark + 2 calibration slots). The 12 dark positions are
re-assignable like the fibres; only the calibration slots at the ends are fixed.

Plain HTML/CSS/JS, no dependencies, no build step.

Live version: https://ivh.github.io/andes-ifu-fibers/

## Run locally

Open `index.html` in a browser, or:

    python3 -m http.server

## Deploy

Push this directory to a GitHub repository and enable GitHub Pages
(Settings > Pages > deploy from branch).
