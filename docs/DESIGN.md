# Design and practical limits

The cache operates on base DLSS evaluations after SR. A fresh NR evaluation writes enhanced RGB, unenhanced reference RGB, depth and validity. A guarded reuse evaluation reprojects history and applies the current-minus-history reference correction. Pixels that fail validation return the current unenhanced DLSS result.

Admission requires the configured full executable path, DX12, the expected SR feature and single-pass behavior. It also requires a stable contract and proof that the prior recorded history work was submitted and completed. There is no CPU wait for completion. History resources and descriptor contracts remain unchanged until every associated recording and submission completes. Reuse still has a conservative completion gate; this is not an asynchronous per-recording cache design.

Two 20-byte-per-pixel GPU history buffers cost 140.625 MiB at 2560×1440 for each logical stream. Other allocations and the model are additional. The implementation may have few or no reuse hits under real scheduling. A model reset is requested at the next fresh evaluation after skipped evaluations; the resulting temporal quality has not been qualified in game.

After three misses, cache work enters a cooldown while ordinary NR continues. Completed capture/reuse timings also inform admission. These are safeguards against wasted cache work, not an optimizer for model weights, a GPU power limit or a frame-rate cap.

The native F8 panel uses a versioned C ABI, bounded commands and coherent state snapshots. Requests are acknowledged only after request matching and state readback. It reports model execution and cache activity separately from requested settings.

Public builds require an explicitly supplied target executable path. Empty configuration fails closed. Target metadata is checked during Swapper staging and installation; users must rebuild for a different installation path. Do not weaken this to basename matching.

The tests in this repository exercise components and selected resource/control paths. They do not reproduce the complete game, driver, runtime or model. Full NR execution, the expected game hook, F8 behavior in game, cache hit rate, motion artifacts, FPS and power all remain unqualified.
