from ultralytics import YOLO

# 1. 加载预训练 YOLO 模型
model = YOLO("yolo26n.pt")

# 2. 开始训练
results = model.train(
    data="C:/yolo-project/bread-dataset/data.yaml",
    epochs=100,
    imgsz=640,
    batch=8,
    device=0,
    workers=4,
    project="C:/yolo-project/runs",
    name="bread_train"
)
