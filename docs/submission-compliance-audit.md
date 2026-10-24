# NexFlow submission compliance audit

Checked 2026-10-24 (Asia/Kuala_Lumpur). Product baseline: `7e264ee20d04a3fe968d133c4ff9f26105263165` (`origin/main` after fetch). Work branch: `submission`. No business source, weights or shared fixture changes are part of this preparation.

Official source: https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template at `d74820299e6ebd5ace04b902f8ff68303c519925`. The checkout's README, all four submission PDFs, src/, runpod/, requirements.txt, .replit, .env.example and LICENSE were read. docs/ contains no tracked content. The linked Drive folder exposed no readable listing through the web tool; forms were obtained from the official Git repository. Verify whether the Drive folder has newer forms before final upload.

Required means explicit in the supplied official template; Example means replaceable sample implementation; Needs organizer confirmation means the checked sources cannot settle it.

| Official item | Classification | Current state | Evidence / remaining action |
|---|---|---|---|
| Team name, domain, SDG | Required | PARTIAL | Nexgen; Domain 2 Orbyte Smart SME; main SDG 8, related SDG 12. Registered leader, roster, institution, contacts need confirmation. |
| Repository and runnable prototype | Required | IMPLEMENTED / VERIFIED LOCALLY | README, `backend.desktop_demo`; public Replit screenshot and read-only HTTP checks. Source parity not complete. |
| Preliminary PDF and filename | Required | PARTIAL / BLOCKED FOR FINAL UPLOAD | `submission/SDC2026_Nexgen_Preliminary.pdf` uses official 14-page form, populated with actual scope. Human identity, percentage target, workshops, IP answers and signature pending. |
| Technical declaration and filename | Required | PARTIAL / BLOCKED FOR FINAL UPLOAD | Official 16-page form plus appendix. All categories addressed; unresolved items explicitly marked. No legal boxes or signatures fabricated. |
| Replit use and proof | Required | PUBLIC USE EVIDENCED / PARTIAL PROOF | URL supplied by owner; actual browser screenshot and HTTP 200 checks in evidence folder; owner project/deployment dashboard, source commit, plan/region, credit redemption still needed. Official proof PDF only says EXAMPLE ONLY, so a substantive evidence document was created. |
| RunPod use and proof | Required | NOT USED / ACCEPTED RISK | Owner explicitly confirms no use and declines integration/proof. No fake endpoint, handler or PDF. This remains a template deviation, not a reason to abandon preparation. Organizer acceptance is not assumed. |
| Slide deck and demo video links | Required | BLOCKED / NEEDS MATERIAL | No final deck/video found in project; README has TODO — HUMAN VERIFICATION. Add accessible links and confirm exact duration from latest notice. |
| src/main.py, src/utils.py | Example | NOT ADOPTED | Official main says replace with project logic; NexFlow keeps existing module entry. No source relocation. |
| runpod/handler.py echo implementation | Example | NOT ADOPTED | It is explicitly placeholder echo logic. No equivalent added. |
| .replit and RunPod environment variables | Example configuration | NOT ADOPTED | Deployment source/config not available for validation. No speculative config or unused secrets added. Existing backend/.env.example remains authoritative for local app. |
| Template Flask/FastAPI / frontend suggestions | Example | EXISTING STACK RETAINED | FastAPI and native HTML/CSS/JS already work. No React/Replit project imported. |
| Third-party libraries/models/datasets | Required declaration | PARTIAL | Declaration appendix lists scopes and licenses; Roboflow page confirms CC BY 4.0. Weight lineage, exact dataset version, font/asset rights and full AI tool use need team review. |
| Root LICENSE | Required template structure | PRESENT | Apache-2.0 retained for project; does not relicense third-party model/data. No legal compliance guarantee is made. |
| No credentials committed | Required | CURRENT TEXT SCAN PASSED, LIMITED | Current tracked small-text scan and new-file scan; no obvious credential patterns. History, binary weights and remote secrets not certified. No .env contents printed. |
| Deadline date / exact cutoff | Required / Needs organizer confirmation | DATE VERIFIED; TIME UNKNOWN | Official Preliminary says 25 October 2026; exact hour/timezone and updated announcement need human confirmation. |
| Workshop attendance / prior work / employment IP | Required form questions | BLOCKED / HUMAN ONLY | No inference from commits; authorized team must answer and sign. |
| Domain 2 synthetic-data permission | Needs organizer confirmation | OPEN RISK | Existing final README notes restriction; Roboflow samples are third-party. Keep honest attribution; obtain organizer ruling or use approved team-made demo images. Do not relabel public photos as synthetic. |

## Deployment verification

https://orbyte-smart-yield-nexgen.replit.app/ rendered as Orbyte Smart Yield / Nexgen bakery workflow. Read-only checks returned 200 for `/`, `/login`, `/app`, two scripts and demo/inventory APIs. `integration.js` matches local bytes; sampled HTML and i18n.js differ. This is a related deployment, not verified full parity. No public business mutation, paid model call, account access or deployment configuration change was made. Owner dashboard access was unavailable, not disproven.

## Scope and repository classification

| Category | Paths | Handling |
|---|---|---|
| Main product runtime | backend/, frontend/, data/, requirements.txt | Preserved. Welcome routes also read whitelisted images from impeccable/demo_images/. |
| Independent vision runtime | impeccable/app.py, static/, weights/best.pt, demo_images/, requirements.txt | Preserved, separate environment; real inference not run in this pass. FastAPI pin differs from main. |
| Browser inference prototypes | train_bread/, impeccable/web_online/ | Preserved; ONNX Runtime Web, not main-inventory integration. No model/weight edits. |
| Tests and documentation | backend/tests/, frontend/tests/, docs/, final/ | Existing assertions preserved; README reuses accurate final/ content and screenshots. |
| Historical or duplicate candidates | root customer.html/customer.js/customers.css/repository.py/router.py; deliveries/ ZIP | No deletions. Verify all references before any later cleanup; ZIP is old fixed snapshot, not current submission package. |

Existing absolute personal machine paths occur in four historical handoff documents; see repository-checks evidence. They are explanatory history, not active launch commands; this pass did not rewrite historical records. No hardcoded personal path was found in scanned runtime text. The old data/readme.md server.py instruction and old demo launch paths are historical; use root README's module launch command.

## Source references

- Official template: https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template
- Public deployment: https://orbyte-smart-yield-nexgen.replit.app/
- SDG targets: https://sdgs.un.org/goals/goal8 and https://sdgs.un.org/goals/goal12
- Dataset author/license: https://universe.roboflow.com/breaddetector/bread-detector (breaddetector; CC BY 4.0; publisher metrics not claimed as NexFlow results).
- Ultralytics license options: https://www.ultralytics.com/license (AGPL-3.0 / Enterprise). No Enterprise entitlement evidenced. Team must review model/distribution obligations before affirming compliance.

Overall: submission engineering can be committed and shared, but all official hard conditions are NOT satisfied. Missing human fields/signatures/materials remain; RunPod deviation is explicitly accepted by the team, with organizer outcome unknown.
