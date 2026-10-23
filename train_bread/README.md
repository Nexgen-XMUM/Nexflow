# newfea：NexFlow 面包盘点网站

在线地址（打开就能用，不用启动任何东西）：
https://claude.ai/artifact/KVU5mgHJNZ9AeTJPiX3Rbr

- 你训练的 YOLO 模型（bread_finetune，15 个品种）直接在浏览器里识别，没有后端
- 页面里有 5 张训练集的原尺寸完整图片，文件名是标注的真实数量，模型 5 张全部数对
- 店员核对、改数量后点“确认盘点”，记录保存在网站上
- 使用网页不消耗 Claude token

## 文件
| 文件 | 用途 |
|---|---|
| `index.html` | 整个网站（页面 + 识别逻辑） |
| `model.b64.txt` | 模型（ONNX 转成 base64 文本，网页启动时还原） |
| `ort-wasm-simd.wasm` | 浏览器里运行模型的引擎（onnxruntime-web 1.17.3） |
| `images/` | 5 张样图 |

## 本地预览（可选，在线版不需要）
在本文件夹打开终端，运行 `python -m http.server 8200`，然后浏览器打开 http://127.0.0.1:8200
本地预览时确认记录只显示在当前页面，不会保存。直接双击 index.html 打不开模型。

数据集署名：Roboflow Universe — breaddetector/bread-detector（CC BY 4.0）。
