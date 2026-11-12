# 阀图

设备平面图上的阀门点位管理，支持图纸上传、缩放、标记和资料维护。

需要 Node.js 22.13 或以上版本。运行 `node server.cjs`，默认监听 19999 端口。环境变量 `HOST`、`PORT` 和 `DATA_DIR` 可配置监听地址、端口和 SQLite 数据目录。图纸、点位和阀门资料保存在数据库中。

Mac mini 通过系统 LaunchDaemon 运行，监听 `127.0.0.1:8888`，由 Cloudflare Tunnel 提供 HTTPS。数据库位于用户目录的 `Library/Application Support/ValveMap`，定时快照保存在同级 `ValveMapBackups`。

数据库是运行数据，部署时必须保留，不应从代码仓库覆盖。备份通过 SQLite 在线备份生成，并检查完整性。
