> [!IMPORTANT]
> ## 📁 Submission Documents & Templates
> Official submission templates are available in the Google Drive folder below. NexFlow's prepared documents are in [`submission/`](submission/).
>
> ### 👉 [OPEN THE GOOGLE DRIVE FOLDER](https://drive.google.com/drive/folders/1xw7c2aN8N-at8hPEULzkcU76e_FFb0Ef) 👈

---

# NexFlow

> A bakery closing-time workspace for surplus stock entry, clearance offers, customer pickup and food-rescue records.

## Team Information

| Field | Details |
|---|---|
| Team Name | Nexgen |
| Team Domain | Domain 2 — Orbyte Smart SME |
| Main SDG Track | SDG 8 — Decent Work and Economic Growth |
| Related SDG | SDG 12 — Responsible Consumption and Production |
| Team Leader | YEO JIN HONG |
| University | Xiamen University Malaysia (XMUM) |
| Number of Members | 5 |

## Links

| Resource | Link |
|---|---|
| GitHub Repository | [Nexgen-XMUM/Nexflow](https://github.com/Nexgen-XMUM/Nexflow) |
| Live Demo | [NexFlow on Replit](https://nexflow-kadenyeojinhong.replit.app/) |
| RunPod Endpoint | None — RunPod was not used |
| Slide Deck | [NexFlow presentation on Canva](https://canva.link/1k1qd953gwbq3gp) |
| Demo Video | [NexFlow project video](https://youtu.be/RVNASReQL-Y) |

## Overview

### Problem

Small bakeries must count unsold food, decide clearance prices, write promotions and arrange surplus handovers at closing. These repeated tasks create fragmented records and extra work for staff. Owners need a simple approval step and a clear view of the day's results.

### Solution

NexFlow connects stock entry, calculated clearance offers, owner-reviewed promotional copy, surprise-box purchases, pickup and food-rescue records in one three-language workspace. DeepSeek can draft promotional wording; the competition runner uses a local template by default. People retain control over approval and handover.

### Key Features

- Surplus entry with backend pricing and food-footprint estimates.
- Owner approval and simulated WhatsApp promotion.
- Surprise-box quotes, simulated payment, pickup and loyalty points.
- Remaining-food handover records and a business dashboard.
- English, Bahasa Melayu and Chinese interfaces.
- An independent YOLOv8 still-image counting prototype, separate from the main inventory workflow; the welcome-page detection animation is preset.

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS and native JavaScript |
| Backend | Python, FastAPI, Pydantic and Uvicorn |
| Database | SQLite; JSON product fixtures |
| AI / Compute | Optional DeepSeek API; independent local Ultralytics YOLOv8 prototype |
| Hosting | Replit public deployment; local competition runner |

## Project Structure

All source code is in this repository. The template's `src/` corresponds to `backend/` + `frontend/`, and its `tests/` to `backend/tests/` + `frontend/tests/`; the folder names are kept because imports, tests and the Replit entry point depend on them. RunPod is not used, so there is no `runpod/` folder.

```text
.
├── backend/                 # Source (template: src/) — FastAPI app and business rules
│   ├── main.py              # API: products, inventory, clearance pricing, promo copy
│   ├── ai_copy.py           # Optional DeepSeek promo wording
│   ├── desktop_demo.py      # Competition runner: temporary DB, demo clock, showcase pages
│   ├── blind_boxes/         # Surprise boxes: quotes, orders, points, pickup, food rescue
│   ├── tests/               # Backend tests (template: tests/) — pytest, 287 tests
│   └── .env.example         # Optional backend configuration (template: .env.example)
├── frontend/                # Source (template: src/) — HTML/CSS/JS workspace, no build step
│   └── tests/               # Frontend tests (template: tests/) — node --test, 67 tests
├── data/                    # Synthetic demo fixtures (inventory, charities, customers)
├── impeccable/              # Independent local YOLOv8 still-image counting prototype
├── train_bread/             # Browser / ONNX detection experiments
├── prototypes/orbyte-v0/    # Earlier standalone prototype (JSON + single HTML page)
├── docs/                    # Screenshots, evidence and the detailed project guide
│   └── project-guide.md     # Full guide: walkthrough, API overview, screenshots, 中文快速开始
├── submission/              # Prepared submission documents
│   ├── SDC2026_Nexgen_Preliminary.pdf
│   ├── SDC2026_Nexgen_TechDeclaration.pdf
│   └── SDC2026_Nexgen_Replit_POU.pdf
├── replit_run.py            # Replit entry point (binds 0.0.0.0:$PORT)
├── demo.py                  # Promo-only local demo with auto browser open
├── requirements.txt
├── .replit                  # Replit run configuration
├── .gitignore
├── LICENSE
└── README.md
```

### Architecture

```text
Browser workspace -> FastAPI -> SQLite / product JSON
                         |
                         +-> Local promotional template (demo default)
                         +-> DeepSeek API (optional)

Independent YOLO image prototype -> Staff review -> Local confirmation record
```

The local vision confirmation does not automatically update the main inventory. Payments, WhatsApp messages and recipient handovers are simulated; CO₂e is an estimate.

## How to Run

### Option 1 — Open the Replit Demo

Open https://nexflow-kadenyeojinhong.replit.app/ . No local installation is needed to view the public deployment. The code in `main` is the same build that is deployed: Replit reads `.replit` and runs `python replit_run.py`, which starts the competition runner on Replit's public port with a temporary database.

To run it in your own Repl: **Create Repl → Import from GitHub**, paste `https://github.com/Nexgen-XMUM/Nexflow`, then click **Run**. No secrets are required.

### Option 2 — Run Locally

From the repository root on macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m backend.desktop_demo
```

On Windows PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m backend.desktop_demo
```

Use Python 3.10–3.13 (verified on 3.13). Python 3.14 cannot install the pinned `pydantic-core`; on Windows, MSYS2 / Git Bash `python` is often 3.14, so use `py -3.13`. Open http://127.0.0.1:8000/app . The competition runner uses a temporary database and local promotional text; no API key is required. See the [detailed project guide](docs/project-guide.md) for the welcome page, role windows, independent YOLO startup, demonstration order and a Chinese quick start.

### Run Tests

```bash
# macOS / Linux
.venv/bin/python -m pytest backend/tests -q
node --test frontend/tests/*.test.cjs
```

On Windows, replace `.venv/bin/python` with `.\.venv\Scripts\python.exe`. The frontend suite starts the project's `.venv` Python for one integration test, so create `.venv` first. Current suite: 287 backend tests and 67 frontend tests, all passing on Windows 11 / Python 3.13 / Node 24.

## How We Use Replit

- **Hosting:** The public deployment is https://nexflow-kadenyeojinhong.replit.app/ , published from this repository's `.replit` (`python replit_run.py`). On 2026-10-25 the welcome page, `/login` and `/app` returned HTTP 200, the demo and blind-box APIs (`/api/demo/session`, `/api/products`, `/api/blind-boxes/inventory`, `/api/blind-boxes/dashboard`) returned HTTP 200, and the product tour passed at 1366×768, 1440×900 and 1920×1080 in headless Edge.
- **Run configuration:** `.replit` runs `python replit_run.py`, which binds the competition runner to `0.0.0.0:$PORT` with a temporary SQLite database, so every restart is a clean demo.
- **Secrets:** None are needed; the runner forces the local promotional template, so no API key is stored in the Repl or the repository.

📄 Proof of use: [`submission/SDC2026_Nexgen_Replit_POU.pdf`](submission/SDC2026_Nexgen_Replit_POU.pdf) — Replit publishing panel showing the Nexflow project published, public, at nexflow-kadenyeojinhong.replit.app.

## How We Use RunPod

RunPod was not used. No endpoint, handler or proof-of-use document is claimed. The team accepts the official template's possible scoring or format consequences.

## Challenges & Learnings

The workflow distinguishes price forecasts from simulated receipts, generated copy from calculated facts, and recommended handovers from completed records. Backend request identifiers protect repeated submissions. A fixed demonstration order and clear boundaries between the main workspace, deployed snapshot and independent vision prototype make the project easier to explain and reproduce.

## Future Improvements

Pilot with bakery staff to measure closing time and count corrections; connect reviewed image counts to stock; add production authentication and reviewed messaging/payment integrations.

## Team

All five members are affiliated with Xiamen University Malaysia (XMUM).

| Name | Role | Contact |
|---|---|---|
| YEO JIN HONG | Team leader; full-project development | kadenyeojinhong@gmail.com |
| QIU BOCHUAN | Full-project development | 194019687@qq.com |
| CHEN ZHENGXI | Backend development and presentation slides | fengmichouzi9@gmail.com |
| PAN SHIQI | Backend development and presentation slides | 482477276@qq.com |
| Chong Thing Wei | Full-project development | ivanchongtw1021@gmail.com |

---

## Submission Checklist

- [x] Team name, domain (Domain 2) and SDG track filled in
- [x] Slide deck link added
- [x] Demo video link added
- [x] Live demo published on Replit (`.replit` + `replit_run.py`)
- [x] Replit used, with proof of use in `submission/` (`SDC2026_Nexgen_Replit_POU.pdf`)
- [ ] RunPod — not used; team accepts the template-compliance risk
- [x] Preliminary submission (`SDC2026_Nexgen_Preliminary.pdf`) — unsigned fields need human confirmation
- [x] Technology declaration (`SDC2026_Nexgen_TechDeclaration.pdf`) — unsigned fields need human confirmation
- [x] Submission files renamed with the team name
- [x] "How to Run" steps verified on Windows 11 (Python 3.13) — 287 backend + 67 frontend tests pass
- [x] No API keys or secrets committed to the repository

## License

Project code retains the [Apache License 2.0](LICENSE). Third-party libraries, model weights and datasets retain their own terms; see the [technical declaration](submission/SDC2026_Nexgen_TechDeclaration.pdf). The official forms still contain human-verification fields and unsigned declarations.
