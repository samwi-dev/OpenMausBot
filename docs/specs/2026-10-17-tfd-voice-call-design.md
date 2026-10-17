# TFD 語音通話（Windows take-turns call）設計

日期：2026-10-17
分支：`tfd-voice-call`（fork `samwi-dev/OpenMausBot`）
狀態：設計已口頭核可，待審本規格

## 目標

在 Windows 桌面版按 **call** 即可與 bot 輪流語音對話：語音辨識用 TFD `breeze-asr-25`，語音合成用 TFD `qwen3-tts`。
本機不跑任何模型（含 VAD 模型）；TFD key 不進 renderer、不進 log。

## 已定決策

| 項目 | 決策 |
|---|---|
| 換手判定 | 自動偵測停頓：RMS 音量門檻＋靜音時長（純訊號處理，非模型） |
| 範圍 | 只做通話（`CallView`）；composer 麥克風、群組通話、全雙工即時對講不做 |
| 錄音位置 | renderer `getUserMedia` 錄音，經 harness 轉送 TFD（方案 A） |
| key／網址來源 | 沿用 `config.instances.tfd`（`config.url`＋`environment[config.apiKeyEnv]`），不另存一份 |
| 雙工 | 半雙工：bot 播放期間不收音，同 macOS 現況 |

## 架構

```
Renderer (src/)                                Harness (server/)
├── lib/web-dictation.ts   新增                ├── stt/tfd.ts      新增  breeze-asr-25
│     getUserMedia · RMS 端點偵測 · WAV 編碼    ├── tts/tfd.ts      新增  qwen3-tts
│     實作 speechStart/Stop/Finish 介面         ├── tts/index.ts    加 "tfd" provider
├── lib/desktop.ts         Windows 可用判定     └── index.ts        加 POST /api/stt/transcribe
└── components/CallView.tsx  不改（沿用介面）
Electron (electron/)
├── capabilities.cjs       Windows dictation = tfd
└── app-permissions.mjs    允許本機頁面 media（麥克風）
```

### 單元職責

- **`server/tfd-credential.ts`**（新增）：`tfdCredential(cfg) → { url, key } | null`。讀 `cfg.instances.tfd`，driver 必須為 `openai-compat`；缺任一欄位回 `null`。唯一碰 key 的入口。
- **`server/tts/tfd.ts`**：`synthesize(text, voice, cred) → Audio`。`POST {url}/audio/speech`，body `{model:"qwen3-tts", input, voice, response_format:"mp3"}`。`listVoices()` 回固定 9 個：serena、vivian、uncle_fu、dylan、eric、ryan、aiden、ono_anna、sohee（TFD 無清單 API）。錯誤處理照 `grok.ts`：只回通用訊息，丟棄遠端 body。
- **`server/stt/tfd.ts`**：`transcribe(wav: Uint8Array, cred) → string`。`POST {url}/audio/transcriptions`，multipart `file`＋`model=breeze-asr-25`，回 `{text}`。逾時 30 秒。
- **`server/tts/index.ts`**：`VoiceProvider` 加 `"tfd"`；`providerConfigured`／`voiceConfigured`／`voiceReady`／`listVoices`／`speak` 各加一支 `tfd` 分支，未設定時丟 `NoVoiceConfigured("key", "Add a TFD engine in Settings → Engines to use TFD voice.")`。
- **`POST /api/stt/transcribe`**（`server/index.ts`）：body 為 `audio/wav` 原始位元組，上限 5 MB（約 60 秒 16 kHz mono）；未設定 TFD 回 409，TFD 失敗回 502（通用訊息），成功回 `{text}`。沿用既有路由的本機存取保護。
- **`src/lib/web-dictation.ts`**：
  - `createWebDictation({ transcribe })` 回傳與 `window.ogb` 同形的 `speechStart/speechStop/speechFinish/onSpeechTranscript/onSpeechEnd`。
  - 端點偵測抽成純函式 `endpointer({ thresholdDb, endpointMs, maxMs })`，輸入每幀 RMS，輸出 `"waiting" | "speaking" | "done"`；`done` 條件＝曾進入 speaking 後連續靜音 ≥ `endpointMs`，或總長 ≥ `maxMs`（60 秒）。
  - 錄音以 `AudioContext`＋`AudioWorklet`（或 `ScriptProcessor` 後備）取 PCM，降採樣 16 kHz mono，編成 WAV。
  - 結果空字串 → 不發 transcript，直接重新收音。
- **安裝點**：Windows 且 `window.ogb.speechStart` 不可用（或 capability engine 為 `tfd`）時，renderer 啟動時以 web-dictation 覆蓋 `window.ogb` 的五個 speech 函式。
- **capability**：`desktop.ts` 與 `electron/capabilities.cjs` 在 `win32` 且 TFD 已設定時回 `dictation: { available: true, engine: "tfd", onDevice: false }`；`DesktopCapabilities` 型別的 `engine` 聯集加 `"tfd"`。
- **設定 UI**：語音 provider 下拉加 **TFD**；選取後聲音清單用上述固定 9 個，預設 `serena`。

## 資料流（一輪）

1. `CallView` → `speechStart({ endpointMs })`
2. web-dictation 開麥、逐幀算 RMS → `endpointer` 判 `done` → 停錄、編 WAV
3. `POST /api/stt/transcribe` → harness 帶 key 打 TFD → `{text}`
4. 發 `onSpeechTranscript({ text })`、`onSpeechEnd({ code: 0 })`
5. 既有流程：送訊息 → bot 回覆 → `/api/tts/prepare` → `/api/tts/speak`（TFD qwen3-tts）→ 播放
6. 播放完畢 `CallView` 自行再呼叫 `speechStart`（既有邏輯，不改）

## 錯誤處理

| 情況 | 行為 |
|---|---|
| 未設定 TFD 引擎 | TTS／STT 皆回 409，沿用 `NoVoiceConfigured` 提示 |
| TFD 4xx／5xx／逾時 | 502＋通用訊息；不轉發遠端 body（防 key／內容回顯） |
| 麥克風被拒 | `onSpeechEnd({ code: 1, reason: "speech-not-authorized" })`，沿用 CallView 既有提示 |
| 錄音超過 60 秒 | 強制 `done` 並送出 |
| 辨識結果為空 | 不發 transcript，重新收音 |

## 測試

- 單元（`node --test`，fetch 以 stub 取代，比照 `server/tts/grok.test.ts`）：
  - `tfdCredential`：缺 instance、driver 錯、缺 key 皆回 `null`
  - `tts/tfd.ts`：請求格式、mp3 回傳、錯誤不洩 body
  - `stt/tfd.ts`：multipart 欄位、`{text}` 解析、錯誤處理
  - `endpointer`：純靜音不觸發、說話後靜音觸發、超長強制觸發
  - `/api/stt/transcribe`：409／413／502／200
- 既有測試套件全綠（至少 `server/tts/*.test.ts`、capabilities 相關測試）。
- 實機驗收（Windows 打包版）：按 call、說一句中文 → 辨識文字正確送出 → bot 以 serena 語音回覆，連續 3 輪成功；`~/.openmausbot` 下 log 與 DevTools network 皆查無 key 字串。

## 範圍外

composer 麥克風鈕、群組通話 `GroupCallView`、全雙工／插話、聲音複製、macOS 路徑任何改動。
