# Pelagic

A full-viewport Three.js ocean with a fixed, four-kilometre circular extent. There is no interface over the scene. Drag with a mouse or touch to orbit; scroll or pinch to zoom. The camera remains above the water.

## Run

Use Node.js 20.19+ or 22.12+ and a browser supporting WebGL2.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally **http://localhost:5173**. Assets are included; Blender is not needed to run the scene.

```sh
npm run build
npm run preview
```

`dist/` is the complete static production build. It defaults to a site's root; set `VITE_BASE_PATH` when building for a subdirectory. Development inspection hooks and URL overrides are removed from that build.

## Deploy to GitHub Pages

1. Push this project to a GitHub repository. Include `.github/workflows/deploy-pages.yml`, `package-lock.json`, and all files in `public/models/`; the GLBs are already built, so deployment does not require Blender.
2. In the repository's **Settings → Pages**, choose **GitHub Actions** as the source.
3. Open **Actions → Deploy ocean to GitHub Pages → Run workflow** and select the repository's default branch. Later pushes to that branch deploy automatically after the tests and build pass.

The workflow uses Node.js 24 and GitHub's Pages artifact/deployment actions. Pages supplies the build path, so scripts, styles, the favicon, manifests and models load at `https://OWNER.github.io/REPOSITORY/`, at the root of an `OWNER.github.io` repository, or on a configured custom domain. No personal access token is needed. The deployment's URL appears in the Actions run and the `github-pages` environment. See [GitHub's Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

To preview a repository path locally:

```sh
VITE_BASE_PATH=/my-repository/ npm run build
VITE_BASE_PATH=/my-repository/ npm run preview
```

Then open **http://localhost:4173/my-repository/**. Replace `my-repository` with your repository name. Run `npm run build` without the variable to return to a root-path build.

## Rebuild the vessels

The generator was executed and verified with **Blender 5.2.2 LTS**. It uses no external assets, textures, add-ons, or downloads.

```sh
npm run assets
```

Generate only one type:

```sh
blender --background --threads 2 --python scripts/build_vessels.py -- cargo
```

Thirteen metre-scale ship assets range from a 14.5 m trawler to a 333 m aircraft carrier. Ten vessels are active: a cargo ship, tanker, fishing boat, tug, yacht, ferry, carrier, bulk freighter, destroyer, and trawler; the RIB is separately controllable. A sailboat and patrol boat remain available as model-inspection assets. Each asset has detailed and simplified GLBs in `public/models/`. The carrier has a 78 m flight deck, angled landing area, markings, elevators, island, antennas, ten aircraft, crew, and deck equipment. Blender's **+Y bow / +Z up** becomes glTF/Three.js **−Z bow / +Y up**. Origins lie at the nominal waterline, approximately amidships. Dimensions, actual bounding boxes, triangle counts, and navigation-light anchors are recorded in `public/models/manifest.json`.

Hull volumes, bulwarks, fittings, and cabins are closed meshes with outward normals. The generator rejects non-manifold edges and negative signed volume before export. Painted hulls, decks, metal, and dark windows are opaque PBR materials with backface culling. Joining by material reduces draw calls. Source hull surfaces may be split between painted and antifouling materials during optimization; their combined volume remains closed.

The vessels use shaped hull sections, waterline paint, rails, fenders, lifebuoys, cargo corrugations, winch cables, crew, and vessel-specific equipment. The carrier and commercial vessels have full-scale hulls and simplified LODs for distant views. All ship and RIB assets are procedural Blender geometry with opaque, backface-culled materials; Blender verifies closed source volumes before export.

## Whales and orcas

Two humpback whales and five individually steered orcas swim through the same fixed water circle. The whales are 15 m long; the orcas are about 8 m long, with varied sizes and pod spacing. Humpbacks use slower, longer surfacing cycles; orcas are faster and more agile, with staggered individual breaths and dives. They turn away from the sea edge, bottom, and ship hulls. Blowhole mist and tail splashes are pooled effects, and tail strikes emit travelling gravity-wave packets that change the shared rendered and sampled water. Animal profiles, skin markings, and separate tail/flipper pivots are generated in `scripts/build_marine.py`.

## Pilot the orange boat

Press **P** or double-click the scene to switch between orbiting and piloting. The orange RIB starts among the nearby fleet. Controls remain invisible over the ocean.

| Control | Action |
| --- | --- |
| W / ↑ | Increase the throttle lever; hold or tap repeatedly |
| S / ↓ | Reduce throttle, then select reverse |
| A / ← and D / → | Hold to steer left/right |
| N | Set neutral and coast |
| Space | Set neutral; hold to brake |
| C | Switch between chase and helm cameras |
| R | Reset boat, velocity, throttle, and wake to the starting position |
| Esc / P | Return smoothly to the previous orbit camera |
| M | Mute or unmute ocean/weather audio in either camera mode |

The throttle stays at its selected position after releasing W/S. Seven taps reach full forward or reverse from neutral. Losing focus clears demands. On touch screens, double-tap to toggle piloting, then drag up/down for forward/reverse and sideways to steer; releasing the drag selects neutral. The canvas's accessible description exposes keyboard controls without a visible overlay.

Quiet stereo water wash, wind and rain start after the first click, touch or keyboard interaction. A subdued outboard tone follows the player's throttle and speed. Weather blends the audio continuously; M fades the master volume, and hiding the tab suspends the audio context. The sound is synthesized locally with one eight-second noise buffer and 24 fixed Web Audio nodes, without downloaded samples. Starting on interaction follows [browser Web Audio autoplay rules](https://developer.chrome.com/blog/web-audio-autoplay).

The player has forward/reverse thrust, water-relative drag, yaw inertia, and a roughly 28-knot speed limit. Distributed hull forces drive heave, pitch, and roll. Speed produces planing lift and engine trim; turning produces a roll moment. A propeller leaving the water loses thrust and steering authority, while the boat retains its momentum. The chase camera follows smoothly, while the helm stays attached to the boat and both views remain above the instantaneous sea surface. The player stays wholly inside the circle. Traffic uses ten opposing, gently curved shipping lanes and smooth cross-track yielding; the RIB has oriented hull contact protection. All moving boats disturb the shared water and leave pooled foam.

## Boat and water physics

Each monohull uses twelve hydrostatic strips distributed along the source model's tapered waterplane and raked keel. The catamaran samples its two hulls separately, with twenty-four strips. Nominal submerged volume determines displacement mass; each strip contributes buoyancy and pitch/roll moments. Hull-specific added mass, metacentric stability, radiation damping, and quadratic angular drag produce different responses for large ships, small boats, and the catamaran. These coefficients live in the reproducible Blender generator and model manifest.

Forces integrate at substeps of at most 1/120 second. Entering water dissipates downward momentum through a slamming pulse. Wet area controls drag, planing lift, and propeller immersion. Gravity continues during loss of contact; the model does not snap a departing hull to the surface. Planing and turning act through forces and moments, rather than extra visual offsets. Traffic retains its route autopilot, with speed loss from pitching and impacts.

The shared twelve-band Gerstner model also supplies analytic water-particle velocity and acceleration. Storm growth concentrates on long swells and medium waves; short crossing waves retain small amplitudes, forming rolling crests instead of pointed peaks. Fine normal detail uses filtered millimetre-scale travelling ripples with analytic slopes. There is no noisy bump layer or tiled rain-dent pattern. Seabed caustics remain subtle and bounded. Hull drag uses motion relative to this flow. Moving vessels create a bow-pressure shoulder/trough and release paired gravity-wave packets. Packets obey deep-water dispersion, travel outward from their fixed release positions, and fade over sixteen seconds. These waves displace the rendered water, change its normals, and excite nearby boats. Buoyancy excludes its own wake field to avoid counting the separate self-resistance model twice. Ninety-six packet slots and eighteen pressure sources keep the work finite.

Foam follows the stern's actual path, conforms to the displaced surface, drifts with local flow, spreads, and fades. Emission depends on immersion and water-relative speed; airborne or stationary hulls do not leave a full-power trail. Connected ocean rings concentrate mesh detail around the boat or close camera while preserving the fixed circular perimeter.

The force balance follows the mass/added-mass, restoring-force and damping approach described in [MIT's floating-structure heave and roll notes](https://ocw.mit.edu/courses/2-017j-design-of-electromechanical-robotic-systems-fall-2009/d6966a806a678be82b5061d58a6e3ad9_MIT2_017JF09_p41.pdf). Finite-hull wake direction is informed by [Rabaud and Moisy's ship-wake study](https://arxiv.org/abs/1304.2653). The implemented coefficients and packet envelopes are practical approximations for this scene, not experimentally validated naval data.

## Systems and tuning

| Module | Responsibility |
| --- | --- |
| `src/config.js` | Radius, camera limits, 900-second day, pool limits, and other settings |
| `src/ocean/waves.js` | Twelve short-crested gravity-wave bands, matching GLSL and inverse sampling |
| `src/ocean/disturbances.js` | Fixed hull-pressure sources and travelling gravity-wave packets, shared by GPU and buoyancy |
| `src/ocean/ocean.js` | Connected circular rings, submerged water edge, Snell refraction, Fresnel, glitter, haze, whitecaps, and rain ripples |
| `src/ocean/bathymetry.js` | Shared deep-water profile, a shallow outer shelf, a sandy channel, wavelength-dependent absorption, and refracted ray intersections |
| `src/ocean/seabed.js` | Sandy/rocky seabed mesh and closed substrate |
| `src/ocean/caustics.js` | Refracted sunlight projection into one bounded 512² optical texture at up to 24 Hz close up / 8 Hz in overview |
| `src/boundary.js` | Shared final-world-position cylindrical fragment clipping, custom shadow depth/distance materials, and opaque stencil cap |
| `src/vessels/assets.js` | Shared GLB prototypes, materials, LOD selection, and winding proxies |
| `src/vessels/buoyancy.js` | Distributed buoyancy, added mass, stability, damping, planing and water-entry forces |
| `src/traffic/routes.js` | Finite curved opposing-lane routes and tangents |
| `src/traffic/traffic.js` | Ten-vessel pool, projected hull-clearance yielding, navigation lights, and delayed recycling |
| `src/player/dynamics.js` | Player thrust/drag/steering, substep integration, circular limit, and oriented hull contacts |
| `src/player/controls.js` | Keyboard throttle lever, steering, pointer/touch gestures, and focus handling |
| `src/player/player-boat.js` | RIB buoyancy, pooled wake emission, camera transitions, and helm/chase views |
| `src/effects/wakes.js` | 1,536 pooled trailing foam patches and 18 bow patches, with surface following and flow drift |
| `src/effects/rain.js` | At most 4,500 camera-local rain streaks |
| `src/environment/weather.js` | Clear, partly cloudy, overcast, rain, and occasional storm progression |
| `src/environment/lighting.js` | Sun, moon, stars, sky, fog, exposure, and coordinated vessel lighting |
| `src/environment/clouds.js` | Cached volumetric cloud lighting shared by the sky, water reflections and star occlusion |
| `src/environment/audio.js` | Fixed procedural ambience graph, weather/motor blending, interaction unlock and mute |

Change `CONFIG.radius` to adjust the circular extent; one unit represents one metre. Mesh rings share vertices, avoiding patch cracks. The water surface uses 105,921 shared vertices: sparse inner angular tiers avoid redundant work, while dense outer rings match the 4,096-point wave-following volume edge. Close analytic normals and fine ripples retain their original detail. The ocean boundary stays fixed when the camera moves. Fine geometric wave detail is filtered in shading as its projected wavelength approaches a pixel. LODs retain hull silhouette, deck volumes, bridges, and characteristic equipment; a hysteresis band prevents repeated switching.

Ships are progressively cut by the same world-space cylinder as the water. Crossing vessels contribute signed front/back winding to the stencil buffer. An inscribed 4,096-segment cylinder paints an opaque cap only where the winding count is nonzero. At the default radius its chord error is below a millimetre. This also caps cabins, containers, pipes, and other solid equipment without turning ordinary materials double-sided. Fragment clipping is attached to both standard vessel materials and their shadow depth/distance materials. Wakes, navigation lights, rain, and water use the shared circle shader.

A vessel is recycled only after its complete hull is outside the circle and all of its possibly visible trailing foam and gravity-wave packets have expired or moved beyond the boundary. GPU and CPU waves share spectrum, amplitudes, direction, and simulation time; buoyancy sampling inverts horizontal Gerstner displacement rather than evaluating the wrong surface coordinate.

The scene begins in clear late-afternoon light. A day lasts 15 minutes by default. Weather holds around three minutes and blends over 100 seconds. Wave energy lags wind changes. Wind direction redistributes energy among fixed travelling bands, preserving existing crests. Spatial wave groups travel at gravity-wave group velocity, with varied amplitudes and a broad directional spread. Analytic envelope gradients and time derivatives keep rendering, normals and buoyancy consistent. Close surface shading corrects the interpolated wave parameter; projected pixel filtering stays continuous across mesh triangles. Warped fine ripples avoid a regular crossing grid. Camera-local rain, clouds in the reflected sky, visibility, sunlight, ambient light, roughness, and selective whitecaps respond together. The 4 km sea stays fixed, its bottom tapers to a shallow 30 m edge, and its wave-following water side and stratified rock substrate remain visible as a cutaway from above. The uneven seabed closes the top of this floor, and a solid base lies 168 m below the mean surface. Simulation time is clamped after stalls and suspended while the document is hidden.

Clouds occupy a procedural 1.9–3.35 km altitude layer. Front-to-back density integration, light absorption, self-shadow samples and sunlit edges produce the sky's cloud radiance. A single 1536 × 768 half-float hemisphere atlas updates at at most 5 Hz; the main view and water sample this same image. Broad connected cumulus masses have layered billows and eroded tops; storm coverage adds a continuous lower stratus deck. Stable per-texel march offsets suppress slab banding. One immutable 64³ R8 noise volume and the atlas use approximately 9.25 MiB, excluding driver overhead. Automatic quality reduction lowers the atlas to 1024 × 512 and the march from 32 to 24 steps.

Pixel ratio is capped at 1.5 and reduces automatically, down to 0.8, after sustained slow frames. The closest nearby vessel casts into a single 2,048² self-shadow map. During piloting, its bounds follow the RIB for detailed self-shadowing. Environment lighting is cached. Two bounded object captures supply vessel reflections and submerged views; conservative wave bounds and local wake height skip inverse wave calculations on dry decks and deeply submerged hulls. CPU and GPU inverse sampling use three analytic Newton steps, with millimetre GPU agreement in the retained audit. There are no postprocessing passes.

The Blender fleet now uses six fair hull families rather than one shared shape. Merchant and naval forms have fuller round bilges; planing boats have flared topsides, V bottoms, and a distinct chine. Monotone cubic waterplane curves are exported with the hydrostatic coefficients and checked against the Blender implementation. Bridges include faceted accommodation, gallery ledges, framed glazing, stairs and wings. The carrier has a fair flared upper hull, an asymmetric island, lattice radar tower, ventilated galleries, four outlined elevators, under-deck webs and a stern service gallery. Nine twin-engine fighters and a helicopter retain their silhouette in both LODs; folded wings, framed canopies, gear braces, wheel chocks and varied parking angles improve close views. A ready aircraft, raised hinged blast deflector, deck markings, subdued rubber wear, tow tractors and four supported propeller shafts complete the deck and hull detail. Fitting sizes follow vessel scale. Every individual source volume remains closed and outward-facing before material batching and GLB export.

## Verification

```sh
npm test
```

Sixty-nine tests verify hull displacement balance, restoring forces, airborne gravity, water entry, planing, steering heel, propeller ventilation, water-relative drag, analytic wave kinematics, wake dispersion/gradients, neighbouring-hull excitation, fixed storage, and all thirteen ship assets in storm waves. They also cover both animal assets and behavior, two hours of marine movement, storm energy/curvature, player controls/contacts/boundary containment, traffic clearance and recycling, inverse waves/normals, wind continuity, terrain clearance, adaptive centre/perimeter topology, conservative optical height bounds, weather and opaque GLBs/LODs.

For repeatable screenshot and acceptance checks, keep the development server running, then:

```sh
npx playwright install chromium
npm run qa
```

This optional harness writes screenshots and a report to `qa/`. Set `OCEAN_QA_CHROMIUM` to use an already installed Chromium binary instead of the Playwright download. See [QA.md](QA.md) for verified results, hardware context, images, and limitations.

Development-only URLs offer quick visual inspection without overlay controls:

- `/?pilot=1&hour=16.35` — begin in the player chase view; append `&camera=helm` for the helm
- `/?view=seabed&hour=14` — close view of refracted sand, rocks, and caustics
- `/?view=volume&hour=15` — low view of the exposed water column
- `/?view=caustics&hour=14` — inspect the optical texture only
- `/?hour=17.45` — sunset
- `/?hour=0.5` — night
- `/?view=close&weather=rain&hour=14` — close rain view
- `/?view=close&weather=storm&hour=14` — rough water
- `/?view=waterline&weather=storm&hour=15&time=137` — fixed-time low view for surface comparisons
- `/?view=close&surface=1&time=137` — isolated normals; `surface=2` omits fine ripples and `surface=3` isolates the seabed contribution
- `/?view=sky&weather=partly&hour=16.35` — upward cloud inspection
- `/?audioAudit=1` — offline rendering of the actual clear/storm/motor/muted audio graph, in `data-audio-audit`; `data-audio` records interaction unlock and mute state
- `/?view=asset&kind=tanker&angle=port&hour=14` — model inspection; angles: `starboard`, `port`, `top`, `low`, `bow`, `stern`
- `/?view=clip&kind=cargo&fraction=0.5&angle=low&hour=14` — halfway bow-to-stern clipping; angles: `starboard`, `above`, `low`, `inside`
- `/?benchmark=1&hour=16.35` — CPU draw submission and optional GPU timer-query report in `data-benchmark`
- `/?physicsAudit=1&weather=storm&hour=14` — twenty-second warm-up and actual GPU/CPU height/normal readback at pressure sources and wake packets, in `data-physics-audit`; combine with `benchmark=1` to measure active wakes
- `/?audit=1&hour=16.35` — accelerated two-hour traffic/weather/daylight audit, saved in the canvas's `data-audit` attribute

`window.__ocean` exposes development stats and inspection controls. Neither it nor the inspection module appears in the production bundle.

## Water depth and optics

The scene has a fixed, irregular seabed from 24 m shelves to roughly 160 m deep water, with a deeper channel crossing the shoals. Its CPU and GLSL depth functions match. The outer shelf reaches 30 m at the circular edge and retains clearance for the deepest hull even under conservative storm troughs. An opaque stratified rock section and bottom close the substrate below water. The water column and substrate remain visible as a cutaway in ordinary above-water views, giving the finite sea a readable floor and depth.

View rays refract with water's 1.333 index of refraction and intersect the seabed. Beer–Lambert attenuation removes red light fastest; scattering supplies the blue/green body color. Heavy weather increases extinction, making the seabed less visible. Sand, rock patches, and moving sunlight appear in shallow areas, while deep water obscures the floor naturally.

The caustic texture projects sunlight through a fine wave grid onto a local floor. Irradiance follows the ratio between source surface area and projected area; overlapping rays add light. Two rotated, incommensurate samples of a bounded 64 m optical patch are smoothly warped to obscure tiling. The patch approximates a 20 m depth and fades in deeper water. It is not an exact optical solution for every point of the 4 km scene. The water volume and refraction approach were informed by [Scottie Fox's CAUSTIC//LITE reference](https://scottiefox.github.io/caustic-volume/lite/index.html).

## Limits

Water reflects the procedural sky, cached clouds, sun, moon and captured vessel details. The warped Gerstner spectrum, pressure profiles, gravity-wave packets, and procedural foam approximate ocean dynamics; they do not solve Navier–Stokes equations, wave breaking, or shallow-water dispersion. Caustics use a local tiled light-projection approximation. Underwater views use a bounded, lower-resolution object capture with approximate refraction, absorption and scattering. The vertical water perimeter and rock substrate are visible in ordinary views; this is a finite 4 km cutaway simulation, with an exposed section at its boundary. The stencil cut uses a single subdued cross-section material, without modelling internal ship compartments. Boat equipment is recognisable procedural geometry, not a scanned asset library. The weather model is deliberately stylised and rain does not simulate spray or droplets on a lens. The cloud layer is a cached hemisphere from a fixed observer rather than a full camera-dependent atmospheric volume. Sound is procedural ambience rather than recorded ocean audio. Moon phase is fixed, and lightning is omitted.

The broad initial view makes small boats naturally small across a real-scale 4 km circle; zoom to inspect them. Hull physics uses approximate hydrostatic strips and coefficients, plus planar thrust/drag and rectangular contact envelopes; it is not a full six-degree-of-freedom naval simulator. Very rough weather can produce large motions and temporary loss of contact for small craft. The sailboat follows a traffic route; its sails do not simulate wind propulsion. Traffic uses fixed curved lanes and a deterministic clearance response, not a complete nautical routing system. Performance was measured on a desktop GPU; the laptop target is supported by bounded workloads and adaptive resolution but is not independently measured on laptop hardware.
