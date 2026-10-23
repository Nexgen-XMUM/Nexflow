# Bread Detection using YOLO

## Project Overview

This project uses YOLO object detection to identify and count different types of bread in images.

The model is trained using a bread detection dataset and can be used as part of a bakery management system.

## Features

- Detect different types of bread.
- Identify bread locations using bounding boxes.
- Display predicted classes and confidence scores.
- Support bread counting based on detection results.
- Use GPU acceleration when a compatible NVIDIA GPU and CUDA-enabled PyTorch are available.

## Technologies

- Python
- Ultralytics YOLO
- PyTorch
- OpenCV

## Project Structure

```text
your-project/
├── bread.py
├── README.md
├── requirements.txt
└── .gitignore
```

## Installation

Create and activate a Python virtual environment, then install the dependencies:

```bash
python -m venv .venv
```

Windows:

```bat
.venv\Scripts\activate
```

Install dependencies:

```bash
python -m pip install -r requirements.txt
```

## Dataset

The model uses a dataset formatted for YOLO object detection.

The dataset configuration file (`data.yaml`) specifies the paths to training, validation, and test images, as well as the class names.

The dataset is not included in this repository.

## Training

Run the training script:

```bash
python bread.py
```

Make sure the dataset paths and training configuration in `bread.py` are correct before training.

## Model Weights

Trained model weights such as `best.pt` and `last.pt` are generated during training.

These files are not included in this repository by default. Keep them in the appropriate local model directory.

## License and Dataset Attribution

Check the original dataset's license and attribution requirements before redistributing the dataset or its contents.

## Project Status

This project is under development.
