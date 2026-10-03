# DLSS 5 Swapper WuWa source fork

Experimental Windows/DX12 source integration for the explicitly selected Wuthering Waves installation. This repository publishes source only; it contains no NVIDIA DLLs/models, portable installer, compiled plug-ins, game files or personal deployment receipts. In-game performance and visual quality remain unqualified.

See [BUILD.md](BUILD.md) for local native/F8 builds, original official payload import, packaging and actual archived IPC verification. See [SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md) and [SOURCE_PROVENANCE.json](SOURCE_PROVENANCE.json) for origins and reference hashes. The existing Swapper MIT license and third-party notices are preserved.

This fork adds an original-file-preserving WuWa Native/DX12 installer, a native F8 control panel, trusted managed-component migration, seeded-only defaults and plugin-only uninstall/reinstall settings preservation. The public application name and ID are distinct from upstream to isolate user data.

The inherited general-purpose application and UI come from [upstream v2.2.7](https://github.com/rakanki911/DLSS5-Swapper/tree/v2.2.7). Its [original README](https://github.com/rakanki911/DLSS5-Swapper/blob/v2.2.7/README.md) describes upstream features; those broader compatibility claims are not validation claims for this fork. Only the dedicated WuWa source/installer checks documented here were revalidated.
