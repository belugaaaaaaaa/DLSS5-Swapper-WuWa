# DLSS 5 Swapper WuWa source fork

This installer helps the community work toward lower neural-rendering GPU overhead with image quality players enjoy. It provides the WuWa installation, settings preservation and recovery flow for the shared native/F8 work. Players can start with [the player guide](../docs/PLAYERS.zh-CN.md); developers can contribute through [CONTRIBUTING.md](../CONTRIBUTING.md).

This is a Windows/DX12 source integration for the explicitly selected Wuthering Waves installation. The installed local build has [user acceptance and NR execution evidence](../docs/USER_VALIDATION.zh-CN.md). Controlled performance and visual comparisons across configurations remain open community work. The public repository contains source only, without NVIDIA DLLs/models, a universal portable installer, compiled plugins, game files or personal deployment receipts.

See [BUILD.md](BUILD.md) for local native/F8 builds, original official payload import, packaging and actual archived IPC verification. See [SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md) and [SOURCE_PROVENANCE.json](SOURCE_PROVENANCE.json) for origins and reference hashes. The existing Swapper MIT license and third-party notices are preserved.

This fork adds an original-file-preserving WuWa Native/DX12 installer, a native F8 control panel, trusted managed-component migration, seeded-only defaults and plugin-only uninstall/reinstall settings preservation. The public application name and ID are distinct from upstream to isolate user data.

The inherited general-purpose application and UI come from [upstream v2.2.7](https://github.com/rakanki911/DLSS5-Swapper/tree/v2.2.7). Its [original README](https://github.com/rakanki911/DLSS5-Swapper/blob/v2.2.7/README.md) describes upstream features; those broader compatibility claims are not validation claims for this fork. Only the dedicated WuWa source/installer checks documented here were revalidated.
