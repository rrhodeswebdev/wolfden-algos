## 0.2.0 (2026-04-19)

### Features

* add download scripts and GitHub Actions workflow for Windows build ([3577b40](https://github.com/rrhodeswebdev/wolfden-algos/commit/3577b40e1bfca1186144ed2c9f83e871f178da89))
* add error badges and expandable error list to algo instance cards ([7f222f7](https://github.com/rrhodeswebdev/wolfden-algos/commit/7f222f76a47f1eff633eb79da488501d00a7282a))
* add installing deps status to algo start flow ([f4e827d](https://github.com/rrhodeswebdev/wolfden-algos/commit/f4e827d92b529ca3cd7ed4683aa9c8c45f32acec))
* add log() function to wolf_types for algo log panel ([85b129a](https://github.com/rrhodeswebdev/wolfden-algos/commit/85b129ad8502e081f01ad79a228dedab58c2fe81))
* add LogPanel component with event stream, filters, and health indicators ([2c4223b](https://github.com/rrhodeswebdev/wolfden-algos/commit/2c4223b5b529b5169c6fc7b7f8c04f5b469a5a84))
* add periodic algo-health event emitter for connection monitoring ([0dfb848](https://github.com/rrhodeswebdev/wolfden-algos/commit/0dfb848d4a7fccc3c13bd49be2bb90ece222c60a))
* add pip dependencies editor to algo editor UI ([d3ced99](https://github.com/rrhodeswebdev/wolfden-algos/commit/d3ced99caec4d1fe2190a5978eeb6f19dbcba7ad))
* add sha2 dep and venv_manager module for Python venv lifecycle ([2d7f876](https://github.com/rrhodeswebdev/wolfden-algos/commit/2d7f8760737f3d40eaedc1ca4bb54f4e0182107a))
* add structured error reporting to algo runner via ZMQ ([e4efd70](https://github.com/rrhodeswebdev/wolfden-algos/commit/e4efd70f431a9c763966955dcb208ed0c9d89de7))
* add useAlgoErrors hook with auto-stop logic ([bf44908](https://github.com/rrhodeswebdev/wolfden-algos/commit/bf4490853af0535beddf65ece02f943c4e1bca76))
* add useAlgoHealth hook for connection health monitoring ([4a02bde](https://github.com/rrhodeswebdev/wolfden-algos/commit/4a02bdefab19ae0a9868b380dd820bd4a4119be0))
* add useAlgoLogs hook for real-time log event consumption ([44b4e08](https://github.com/rrhodeswebdev/wolfden-algos/commit/44b4e08be8cdebf5b248f2fa7afda3f45dbfa633))
* add VenvSetupModal and integrate venv health check into App startup ([a682a42](https://github.com/rrhodeswebdev/wolfden-algos/commit/a682a426ed0122e59bdf5c7e671bfed3f4e0f2d3))
* capture algo stderr and emit process errors to frontend ([0761dd8](https://github.com/rrhodeswebdev/wolfden-algos/commit/0761dd882e9f0b42a9c61e9309730f94242e861c))
* capture algo stdout and emit algo-log events ([d86d820](https://github.com/rrhodeswebdev/wolfden-algos/commit/d86d82070ed9f990f1ed4d8ba4efd576d9dd62a4))
* configure Windows NSIS installer with bundled resources ([29ac71f](https://github.com/rrhodeswebdev/wolfden-algos/commit/29ac71f65a46f885e81b75c91bd2f32188514428))
* emit algo-log events from ZMQ hub for orders, fills, heartbeats, errors ([5fbb670](https://github.com/rrhodeswebdev/wolfden-algos/commit/5fbb670f10a26a58fcdcbe911768ab1acc0db6e8))
* emit algo-log FILL events from WebSocket server for live fills ([5171dbf](https://github.com/rrhodeswebdev/wolfden-algos/commit/5171dbf6d344b480ed39de3a50c53e9cffa11179))
* integrate LogPanel into AlgosView with auto-selection of first running algo ([40edcb3](https://github.com/rrhodeswebdev/wolfden-algos/commit/40edcb367efa18f3313469961760a9f55269adec))
* route algo_error ZMQ messages to frontend via Tauri events ([a2ff950](https://github.com/rrhodeswebdev/wolfden-algos/commit/a2ff950c1d405391fd118b9a5fb92102d56955c2))
* support embedded standalone Python for Windows builds ([b64c865](https://github.com/rrhodeswebdev/wolfden-algos/commit/b64c865dd70311a4b588d7c73c81fabf39a403a7))
* wire algo error state into App and pass to AlgosView ([ef85d1f](https://github.com/rrhodeswebdev/wolfden-algos/commit/ef85d1fae9638a9443819d25c3b73a2a77caab61))
* wire useAlgoLogs and useAlgoHealth hooks into App and pass to AlgosView ([ee33fd5](https://github.com/rrhodeswebdev/wolfden-algos/commit/ee33fd5c27d082c0712aac5c2bf52df4a535b1b4))
* wire VenvManager into Tauri state and use venv Python for algo processes ([2f9143a](https://github.com/rrhodeswebdev/wolfden-algos/commit/2f9143aa9f3365116ef992c2febbfdba4b522f6a))

### Bug Fixes

* bundle wolfden-algo skill with installer ([#7](https://github.com/rrhodeswebdev/wolfden-algos/issues/7)) ([4c33c62](https://github.com/rrhodeswebdev/wolfden-algos/commit/4c33c62b45a4980adc9738b92c31eaeaad09dc64))
* comprehensive code review fixes across Rust, Python, and React ([8e149fd](https://github.com/rrhodeswebdev/wolfden-algos/commit/8e149fd88848cee4caf97627f6b77570bbe53483))
* find and spawn Claude Code CLI correctly on Windows ([#5](https://github.com/rrhodeswebdev/wolfden-algos/issues/5)) ([f554bea](https://github.com/rrhodeswebdev/wolfden-algos/commit/f554bead25c863211445b34291ec18a26683f756))
* install bundled wolfden-algo skill into project root ([#8](https://github.com/rrhodeswebdev/wolfden-algos/issues/8)) ([ad05fe7](https://github.com/rrhodeswebdev/wolfden-algos/commit/ad05fe792cc35410fa44320a83d81897f33f439e))
* make send_error safe and DRY init error path ([6cda917](https://github.com/rrhodeswebdev/wolfden-algos/commit/6cda917e72fcb603992a4d72c731455536e95a84))
* prevent duplicate auto-stop calls and add toast notification ([6533b48](https://github.com/rrhodeswebdev/wolfden-algos/commit/6533b489914aa3e2ec900cdde8f66429bb978791))
* prevent duplicate error events and stdout pipe deadlock ([7a8dc08](https://github.com/rrhodeswebdev/wolfden-algos/commit/7a8dc08fb65656218f834640bfc14b16de240f61))
* re-bundle embedded Python in Windows NSIS installer ([#4](https://github.com/rrhodeswebdev/wolfden-algos/issues/4)) ([27e29e7](https://github.com/rrhodeswebdev/wolfden-algos/commit/27e29e70d76eee19f07a6e663e2c96bbe3a2b5e5)), closes [#3](https://github.com/rrhodeswebdev/wolfden-algos/issues/3)
* self-host Monaco editor so the installed app can render it ([#6](https://github.com/rrhodeswebdev/wolfden-algos/issues/6)) ([09ca858](https://github.com/rrhodeswebdev/wolfden-algos/commit/09ca85897956f26a2014ae35272567d5143e7bac))
* show LogPanel immediately and add POSITION log events ([4674225](https://github.com/rrhodeswebdev/wolfden-algos/commit/46742251981e9a65fba11f7196431cb1e91ab885))
* strip Windows extended-length prefix from project root ([#9](https://github.com/rrhodeswebdev/wolfden-algos/issues/9)) ([8c9709c](https://github.com/rrhodeswebdev/wolfden-algos/commit/8c9709c874914639f56478ec88a1d50d71324008))
* use instance_id for error cleanup in handleStartAlgo ([553bcb2](https://github.com/rrhodeswebdev/wolfden-algos/commit/553bcb2cc208579d5817102c8ac7a9f06e7cec10))

### Performance Improvements

* optimize algo indicators, fix CVD bug, remove demo seeding ([c7d0b1b](https://github.com/rrhodeswebdev/wolfden-algos/commit/c7d0b1bfa219400077f10e15ecc64f74944a7771))
* optimize algo indicators, fix CVD bug, remove demo seeding ([#2](https://github.com/rrhodeswebdev/wolfden-algos/issues/2)) ([79384bf](https://github.com/rrhodeswebdev/wolfden-algos/commit/79384bffb35208f70ca156988ed703d2396f5db6))
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are generated from [Conventional Commits](https://www.conventionalcommits.org/)
by `npm run release`.
