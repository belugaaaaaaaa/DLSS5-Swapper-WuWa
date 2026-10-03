# Public-source preparation checks

The public source is a later packaging revision of the historical local integration. These checks qualify source/build behavior, not an actual game session.

- Source-only Swapper tests: 293 total, 291 passed, zero failures, two skips for an absent optional community-server sibling. This includes the 13 dedicated installer IPC tests. See `swapper/BUILD.md` for the reproducible command and scope.
- The public GPU fixture packaging was re-executed: 19 CPU reference tests and 33 physical RTX 5070 GPU checks passed. Frozen shader source remains byte-identical to the measured source. Original historical measurements and their binary hashes are preserved, separately from packaging hashes.
- The dependency fetch was exercised from an empty directory. Every declared checkout reached its exact pinned commit with zero tracked changes.
- Public native ON/OFF and production F8 builds passed. Actual source tests passed 69 history assertions, 80 control/policy assertions, four executable-path cases and 54 C transport assertions, plus mixed-toolchain ABI/SEH and compatibility checks. A concurrent state test accepted 137,519 reads with zero torn snapshots. See `build/PUBLIC_VALIDATION.json` for source preservation and test scope.
- The public Swapper source was built into a new portable with Electron 33.4.11 and electron-builder 25.1.8. The final executable was independently extracted: all 13 archived installer IPC tests passed, the five application modules matched, and the complete staged payload/overlay inventory and hashes matched. ASAR license/notice bytes matched too. This local QA executable is not distributed. Its SHA-256 is `19cced325d9c7b19cca738ace440a366b68078004b950a3bd9de28f6b3574824`; it contains a local test target, so it is not an end-user release.
- All public text was checked for developer-specific paths, common credential patterns and missing local documentation links. Generated binaries, model/runtime DLLs, game files, personal deployment receipts and local build-path metadata are excluded.
- Historical result JSON and frozen native/F8 source retain their original bytes through exact Git attributes. Both publication manifests must match a clean checkout before publication.

Native, overlay and Swapper build/test instructions are under `build/README.md`, `overlay/README.md` and `swapper/BUILD.md`. Further test reports should identify the exact source revision and conditions.

No actual Wuthering Waves scene, model inference, full-frame benchmark, image-quality comparison, power/temperature measurement or fan test was run as part of this publication. The existing local installation was not changed. Component success must not be represented as game acceptance.
