# v0.2.4 验证记录

- 51 项 Node/DOM 自动检查通过（原有 45 项及新增 6 项）。覆盖设置验证、重启保存、运行中改速不暂停、网页重设速度、新视频替换、原版脚本与依赖真实执行、停用复位、作用域与首页操作。
- Linux Electron 45 headless 本地 fixture 测试通过：使用真实 sandbox/contextIsolation 课程 preload；协议拦截返回本地 HTML，不访问学校。确认主页面与同源 iframe 的 HTMLMediaElement 实际速率为预设；检查主世界脚本加载、倒数参数换算、孤立世界读取真实倍速、复位 1 倍及首页保存按钮调用。
- 测试启动器因容器限制传入 --no-sandbox；发布版 BrowserWindow 仍保持 sandbox:true、contextIsolation:true、nodeIntegration:false，未加入 --no-sandbox。
- Windows x64 NSIS 安装包和 macOS arm64 应用交叉构建。未在 Windows/macOS 实际启动；未验证真实课程、学时认可、扫码、AI 调用、Windows DPAPI/macOS 钥匙串或升级后的授权行为。
- Mac 由 rcodesign 0.29.0 ad-hoc 签名，并独立检查 Mach-O 代码页、签名元数据与封存资源哈希。静态校验不等于苹果 codesign、Gatekeeper 或实机验收；无 Developer ID 签名及苹果公证。
- 原版脚本和依赖保留元数据及许可，固定文件哈希见 src/vendor/manifest.json；包内无用户配置、Cookie 或 API 密钥。
