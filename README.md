# 词刻 CIKE · 多语言学习端

词刻是一个本地优先的多语言词汇与阅读学习应用：单词书、拼写/听写、间隔复习、每日一句、阅读器、划选翻译、AI 词典与安卓离线包。

在线演示：<https://brambleaaaaaa.github.io/cike-multibook/>

## 功能

- 多语言词书：英语、法语、德语、西班牙语、意大利语、日语、粤语、拉丁语。
- 学习模式：看词回忆、拼写、听写、混合练习；拉丁语种使用屏内键盘，日/粤/中使用系统输入法。
- 间隔复习：按答题表现调整复习间隔，支持错词回炉与掌握状态。
- 多语言发音：离线音频优先，缺失时回退在线翻译语音或系统 TTS。
- 每日一句：英语使用整句离线音频；其他语言用单词音频按序拼句。
- 阅读器：目录、翻页、划选查词、段落翻译、涂鸦与标注。
- AI 词典 / 翻译 / 典故 / 作文批改：兼容 OpenAI Chat Completions 协议，可接豆包、DeepSeek、Kimi 或自定义端点。
- 本地持久化：进度、资料、设置保存在浏览器；安卓端 API Key 写入系统 Keystore。
- 安卓壳：WebView + 原生返回键桥 + 离线资源包。

## 技术栈

- 原生 JavaScript / HTML / CSS，无前端框架、无构建步骤。
- `localStorage` + IndexedDB 双层持久化。
- Service Worker 离线缓存。
- Android WebView 壳（Java），通过 `shouldInterceptRequest` 加载本地资源。
- 可选 AI 接口：OpenAI Chat Completions 兼容协议。

## 目录

```text
index.html            应用入口
app.js                主界面与业务逻辑
core.js               复习调度与判分
storage.js            IndexedDB 封装
ai-service.js         AI 词典 / 翻译 / 批改
word-audio-player.js  单词与句子音频播放
book-*.js             多语言词书数据
assets/               字体、贴纸、BGM、音效与音频索引
vendor/               PDF.js、JSZip 等第三方库
android/              Android WebView 壳源码
build-android.ps1     APK 构建脚本
```

## 本地运行

```bash
python -m http.server 8934 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8934/`。

## 部署说明

本仓库是 GitHub Pages 可部署的轻量版本：

- 保留完整源码、词书数据、BGM、音效、字体与音频索引。
- 为控制仓库体积，不包含离线单词音频（约 1GB）、六级听力音频（约 1GB）、PDF 书库与公版书全文（约 2.7GB）。
- 缺少离线音频时，应用会自动回退到在线语音或系统 TTS；阅读器可导入本地图书。

完整安卓安装包（含离线资源）不通过 GitHub 分发。

## 构建安卓包

准备 JDK、Android SDK（build-tools 35），然后：

```powershell
$env:CIKE_KEYSTORE_PASS = "你的签名证书密码"
.\build-android.ps1 -WebRoot .android-webroot -OutputDir android-dist
```

签名证书 `cike-release.keystore` 不会提交到仓库，请自行生成并妥善保管。

## 许可

程序代码使用 MIT License。词表与第三方资料的许可与出处见 [NOTICE.md](NOTICE.md) 与 [NOTICE-MULTIBOOK.md](NOTICE-MULTIBOOK.md)。
