# Source provenance

| Component | Upstream | Baseline commit |
| --- | --- | --- |
| Swapper | https://github.com/rakanki911/DLSS5-Swapper | `3b3b0efb5472df7fc806d7aff31c1d95819500c5` (v2.2.7) |
| RenoDX | https://github.com/clshortfuse/renodx | `40d764d88719ab06c8e46139b5454e7dafc8cbcc` |
| Generic NR integration | https://github.com/PEQHUB/RenoDX-DLSS5-Generic | `1b7d6787817b806a61cece6b8aa38789304c4d25` |

The public Swapper subtree starts from tracked v2.2.7 sources and the local integrated application source. Native/cache and F8 source comes from the tested local plugin sources. Public-path configuration, build parameterization and source-only payload staging were added when preparing this repository. These packaging changes are separately tested; they do not turn previous component tests into real-game validation.

Historical deployed artifacts used to identify the source under test:

| Artifact | SHA-256 |
| --- | --- |
| Native NR/cache add-on | `050ad319cdb0714f27eaaade32e99d56d18bf52efe0f1e8603001bae3b911713` |
| Native F8 add-on | `bcadba5ae77de2de8918f8abdcd34494e04883757e5356f3fad942e5a56bab6f` |
| Integrated application ASAR | `5cb38cf6052e726e36566edea1899f0d176fec2109bfc169cce75067fb06f0f4` |

Those binaries are not distributed here. A public rebuild with a different target path or compilation time is not expected to have the same hash. They establish historical provenance, not reproducible binary identity.

Dependency pins and compiler requirements are recorded under `build/`. Third-party dependencies must be obtained separately under their licenses. Local game files, runtime DLLs, model weights, original portable backups, game logs, private deployment receipts and toolchains are excluded.
