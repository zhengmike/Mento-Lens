# 🔍 Mento Lens

> 一键录屏截图 · 麦克风+系统音频 · 截图标注 · 时间线回溯
>
> One-click screen & audio capture for Chrome — mic + system audio, auto-screenshots, annotations, and timeline review.

---

## ✨ 功能亮点 | Features

- 🎙️ **双轨录音** — 同时捕获麦克风和系统音频，支持仅麦克风/仅系统音频/混合三种模式
- 📸 **自动截图** — 录制过程中定时自动截屏，完整记录操作上下文
- ✏️ **截图标注** — 内置标注工具，支持画笔、文字、箭头，方便标记重点
- 🕒 **时间线回溯** — 按日期分组展示历史记录，截图按时间轴排列
- 🔊 **音频回放** — 支持双轨同步播放、独立播放、倍速控制（0.5x / 1x / 1.5x / 2x）
- 🔍 **灯箱预览** — 点击截图放大查看，支持缩放和前后翻页
- 💾 **本地存储** — 基于 IndexedDB，数据完全保存在本地，无需网络
- ⌨️ **快捷键** — `Command+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows) 一键唤起

---

## 🚀 安装 | Installation

### Chrome Web Store（即将上线 | Coming Soon）

### 开发者模式 | Developer Mode

1. 克隆仓库 | Clone the repo
   ```bash
   git clone https://github.com/zhengmike/Mento-Lens.git
   ```
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择项目文件夹
5. 点击工具栏图标或按 `Cmd+Shift+M` / `Ctrl+Shift+M` 开始使用

---

## 🎯 使用场景 | Use Cases

| 场景 | Scenario |
|---|---|
| 🐛 Bug 复现记录 | Bug reproduction recording |
| 📝 用户研究访谈 | User research interviews |
| 🎓 在线课程笔记 | Online course note-taking |
| 💬 会议内容回溯 | Meeting content review |
| 🧪 可用性测试 | Usability testing |

---

## 🛠️ 技术栈 | Tech Stack

- **Manifest V3** — Chrome 最新扩展标准
- **Offscreen API** — 后台音频录制
- **Side Panel API** — 侧边栏交互界面
- **IndexedDB** — 本地数据持久化
- **Canvas API** — 截图标注绘制
- **Web Audio API** — 音频可视化

---

## 📂 项目结构 | Project Structure

```
Mento-Lens/
├── manifest.json              # 扩展配置
├── background/
│   └── service_worker.js      # 后台服务，协调录音生命周期
├── sidepanel/
│   ├── sidepanel.html         # 侧边栏主界面
│   └── sidepanel.js           # 录音控制与实时预览
├── offscreen/
│   ├── offscreen.html         # 离屏文档
│   └── offscreen.js           # 音频捕获核心逻辑
├── history/
│   ├── history.html           # 历史记录页面
│   └── history.js             # 时间线展示与音频回放
├── annotate/
│   ├── annotate.html          # 标注工具页面
│   └── annotate.js            # Canvas 绘制逻辑
├── lib/
│   └── storage.js             # IndexedDB 存储封装
└── icons/                     # 扩展图标
```

---

## 📄 许可证 | License

MIT © [zhengmike](https://github.com/zhengmike)
