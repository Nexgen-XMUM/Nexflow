"""Fill official forms without changing product code. Requires PyMuPDF, reportlab, pypdf.
Usage: python generate_pdfs.py /path/to/official-template-checkout
Output is unsigned and requires team review; never checks legal declarations.
"""
import io, json, sys
from pathlib import Path
import pymupdf as fitz
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from pypdf import PdfReader
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'submission'
URL = 'https://orbyte-smart-yield-nexgen.replit.app/'
TODO = 'TODO - HUMAN VERIFICATION'
SOURCE = Path(sys.argv[1]) / 'submission'
styles = getSampleStyleSheet()
styles['BodyText'].fontSize = 10
styles['BodyText'].leading = 14

def put(page, rect, text, size=11):
    result=page.insert_textbox(fitz.Rect(rect), str(text), fontsize=size, fontname='helv', color=(0.08,0.17,0.30))
    if result < 0: raise ValueError(('Text does not fit',page.number+1,rect,text[:100]))

def answer(doc, page, text, y, x=94, right=525, bottom=710, size=12):
    put(doc[page-1],(x,y,right,bottom),text,size)

def identity(doc, values, ys):
    for v,y in zip(values,ys): put(doc[1],(130,y-24,498,y-3),v,10)

def table(doc, page, rows, ymin):
    # Locate the original template's blank data cells, retaining its headings and grid.
    p=doc[page-1]; rects=[]
    for d in p.get_drawings():
        r=d['rect']
        if r.y0>=ymin-2 and r.y1<745 and 65<r.width<250 and r.height>25:
            if not any(abs(r.x0-q.x0)<2 and abs(r.y0-q.y0)<2 for q in rects):rects.append(r)
    groups=[]
    for r in sorted(rects,key=lambda r:(round(r.y0/3),r.x0)):
        group=next((g for g in groups if abs(g[0].y0-r.y0)<3),None)
        if group is None:groups.append([r])
        else:group.append(r)
    groups=[sorted(g,key=lambda r:r.x0) for g in groups]
    groups.sort(key=lambda g:g[0].y0)
    for row,g in zip(rows,groups):
        assert len(g)==len(row),(page,len(g),row)
        for text,r in zip(row,g):put(p,(r.x0+5,r.y0+4,r.x1-5,r.y1-3),text,8)
    assert len(rows)<=len(groups),(page,'not enough rows')

def extra_pdf(title, sections, screenshot=None):
    mem=io.BytesIO(); story=[Paragraph(title,styles['Title']),Spacer(1,12)]
    for heading,text in sections:
        story.extend([Paragraph(heading,styles['Heading2']),Paragraph(text.replace('\n','<br/>'),styles['BodyText']),Spacer(1,9)])
    if screenshot:
        story.extend([Spacer(1,10),Image(str(screenshot),width=490,height=276)])
    SimpleDocTemplate(mem,pagesize=(595.5,842.25),leftMargin=48,rightMargin=48,topMargin=40,bottomMargin=40).build(story)
    return fitz.open(stream=mem.getvalue(),filetype='pdf')

def save(doc,name):
    for p in doc:
        put(p,(45,14,552,34),'Nexgen / NexFlow - 24 Oct 2026 - UNSIGNED DRAFT: HUMAN REVIEW REQUIRED',8)
    doc.set_metadata({'title':name,'author':'Nexgen','subject':'Evidence-based submission draft; unsigned'})
    doc.save(OUT/name,garbage=4,deflate=True)

p=fitz.open(SOURCE/'SDC2026_TeamName_Preliminary.pdf')
identity(p,['Nexgen','Domain 2 - Orbyte Smart SME','SDG 8 (main); SDG 12 (related)','NexFlow',TODO+' - registered leader',TODO+' - email and phone',TODO+' - institution(s)',TODO+' - registered member count'],[243.6,310,376.4,442.9,509.3,575.7,642.1,708.2])
answer(p,3,'Independent bakeries must count unsold bread, decide clearance prices, write promotions and arrange the remaining food at closing. These repeated tasks fragment the daily record and take staff attention away from serving customers. Owners need a clear approval step and visibility of what was paid, collected or handed over.\n\nNexFlow addresses this single-store operational problem. No store interviews, commercial results or measured time savings are claimed in this submission. The proposed value is improved consistency and productivity for small businesses (SDG 8), with responsible surplus handling as a related SDG 12 direction.',365)
answer(p,4,'NexFlow provides a three-language bakery closing workspace: staff enter surplus quantities; deterministic code calculates prices and food-footprint estimates; optional DeepSeek drafts promotional wording; the owner reviews it; customers simulate buying and collecting surprise boxes; staff record remaining-food handover. The dashboard reads the same backend ledger.\n\nThe default competition runner uses a local copy template, synthetic inventory, simulated payment and WhatsApp messages. A separate YOLOv8 prototype analyzes still images with staff correction; it does not update the main inventory. The animated welcome-page bread count is a preset replay, not live inference.\n\nWorkshop-style technologies applied include API-based text generation, SQLite records and cloud hosting on Replit. Individual workshop attendance requires team confirmation.',400,size=11)
answer(p,5,'Main app: Python, FastAPI, Pydantic, Starlette, Uvicorn, SQLite; native HTML/CSS/JavaScript and three-language dictionaries. HTTPX supports the optional DeepSeek API. Browser -> FastAPI -> SQLite/catalogue; optional API copy returns to owner review.\n\nIndependent vision prototype: Ultralytics YOLOv8, OpenCV, NumPy and PyTorch. Browser ONNX experiments remain separate. Replit hosts a public project deployment; some assets differ from this GitHub baseline.\n\nLive prototype: '+URL+'\nRunPod: Not used. Replit sponsor-credit redemption, plan and region: '+TODO+'.',405,size=11)
answer(p,6,'The workflow centers on one repeated task: closing a bakery. Staff enter quantities, owners approve offers, and customers see a focused purchase page. English, Bahasa Melayu and Chinese support the demonstration. Humans confirm promotions, counts and handovers.\n\nThe prototype separates calculated facts from generated wording and simulated external actions. Automated tests cover business rules; a fresh temporary session supports a repeatable demo. Replit provides a publicly reachable showcase and workspace, while the local runner is the reproducible baseline.\n\nA future pilot should compare closing-task time and count corrections against the same manual scenario. This is a proposed evaluation, not evidence of completed user research or deployment readiness.',330)
answer(p,8,'Main: SDG 8.2 (productivity through technology) and 8.3 (small-enterprise growth). Related: SDG 12.3 (retail/consumer food waste).\nSources: sdgs.un.org/goals/goal8 and sdgs.un.org/goals/goal12.',246,x=254,right=532,bottom=441,size=11)
answer(p,8,'Synthetic baseline: 10 croissants, retail RM60, cost RM20, 0.8 kg food; demo clearance forecast RM30 and food-footprint estimate 2 kg CO2e. These are catalogue/code fixtures, not a surveyed store or verified avoided emissions.\nReal operational baseline: not measured; human pilot needed.',473,x=254,right=532,bottom=669,size=11)
answer(p,9,'Track minutes per closing task, count corrections, food items picked up or handed over, and simulated amount paid. Do not equate the dashboard footprint estimate with certified emissions savings.',246,x=254,right=532,bottom=410,size=11)
answer(p,9,TODO+': no approved percentage target or measured comparison exists. Suggested pilot method: repeat a fixed manual scenario with and without NexFlow, then agree a target with the team. No invented improvement percentage is submitted.',443,x=254,right=532,bottom=590,size=11)
answer(p,10,'HUMAN ACTION: verify workshop attendance and all checklist statements. No compliance boxes have been checked on behalf of the team.',510,size=11)
answer(p,11,TODO+': each member must confirm whether any prior-owned code, design, model or research predates the event. Do not assume No from Git history.',360)
table(p,12,[['FastAPI / Pydantic / HTTPX','Code; others in declaration','MIT / BSD / Apache; see declaration'],['YOLOv8 / Bread Detector','Model / dataset; see declaration','AGPL-3.0 / CC BY 4.0; see appendix'],['ONNX Runtime Web 1.17.3','Browser model runtime','MIT'],['Tailwind / fonts / AI tools','Code / content; see declaration','See technology declaration'],['Additional dependencies','Complete details in declaration appendix','See technology declaration']],390)
answer(p,13,TODO+': all members must confirm employment, internship and consulting IP obligations. No Yes/No selection has been made on their behalf.',385)
answer(p,14,'Signature and date deliberately left for the authorized team leader. This document contains unresolved human-verification fields and is not ready for final upload.',465,size=11)
save(p,'SDC2026_Nexgen_Preliminary.pdf')

t=fitz.open(SOURCE/'SDC2026_TeamName_TechDeclaration.pdf')
identity(t,['Nexgen','NexFlow',TODO+' - registered leader',TODO+' - email and phone',TODO+' - institution(s)',URL,'https://github.com/Nexgen-XMUM/Nexflow'],[251.6,329.3,406.9,484.5,562.1,639.8,717.4])
answer(t,3,'Browser HTML/CSS/JavaScript calls the FastAPI backend. Catalogue JSON supplies product facts; SQLite stores batches, quotes, orders, points and donation records. Pricing and footprint arithmetic are deterministic. Optional DeepSeek generates wording only; the local competition launcher forces a template. Owners approve promotions. Payment, WhatsApp and recipient handover are simulated.\n\nReplit serves a public related deployment, but HTML and language assets differ from this GitHub baseline; parity is not asserted. Standalone impeccable/ uses a local YOLOv8 weight file for still-image inference, with staff correction and local JSON confirmation. It does not update the main ledger. The welcome animation is preset; browser ONNX experiments are separate. RunPod is not used.',385,size=11)
table(t,4,[['Python / HTML / CSS / JS','Main implementation languages','PSF / web standards'],['FastAPI 0.156.4\nPydantic 2.14.1','API and validation','MIT'],['Starlette 1.9.0\nUvicorn 0.54.0','ASGI routing and server','BSD-3-Clause'],['SQLite / HTTPX 0.28.1','Ledger / HTTP client','Public domain / BSD-3-Clause'],['dotenv 1.2.1 / pytest 9.1.1','Config / offline tests','BSD-3-Clause / MIT'],['Vision / browser libraries','See Appendix A for scope and versions','See Appendix A']],352)
table(t,5,[['DeepSeek (optional)','Promo opening / closing; off in competition runner','User API key; billing tier needs confirmation'],['WhatsApp / payment / logistics','None: simulated in browser or local ledger','Not used'],['Google Fonts / CDNs','Fonts; Tailwind CDN on login; ONNX CDN in experiment','Public resource delivery; see Appendix A']],290)
table(t,6,[['Replit','Public prototype: '+URL,'Plan / region / credit redemption: HUMAN VERIFICATION'],['GitHub','Repository / collaboration: Nexgen-XMUM/Nexflow','Public Git repository'],['RunPod','Not used; no endpoint, no GPU use claimed','None']],290)
table(t,7,[['YOLOv8 bread_finetune','Ultralytics; local best.pt','Reported fine-tuned; lineage / training logs need team verification','AGPL-3.0 terms; verify weight provenance'],['DeepSeek (configurable)','DeepSeek API','Optional remote text generation; local template by default','Provider API terms'],['ONNX bread export','train_bread/ and web_online/','Browser experiments only; not main ledger','Verify export lineage; runtime MIT']],342)
table(t,8,[['Bread Detector','Roboflow Universe','Public; URL in Appendix A','CC BY 4.0','Review images'],['Bakery fixtures','data/; demo runner','Synthetic records','Project fixtures','Demo IDs; verify'],['Demo images / weights','impeccable/ and train_bread/','Attributed bread dataset samples / model export','See Appendix A','No live customer collection claimed']],326)
# Do not mark legal or sponsor checkboxes without human confirmation.
put(t[8],(205,370,535,392),'YES - AI-assisted development used.',10)
table(t,9,[['ChatGPT / Codex','Code, integration, review, documentation','Major; exact model versions need confirmation'],['DeepSeek AI development harness','Code assistance / debugging (team confirmed)','Major; exact tool version needs confirmation'],['Claude artifact','Browser prototype reference documented in train_bread/README.md','Extent / model version: HUMAN VERIFICATION'],['Other tools (incl. Replit AI)','No additional AI use evidenced; team must confirm full list','HUMAN VERIFICATION']],458)
answer(t,10,'Team members review generated changes and run automated checks. This submission pass ran 285 backend tests and 49 frontend tests successfully, plus real local HTTP checks. Pricing is calculated in code, not delegated to a model. Model wording remains subject to owner review. The team must verify the final declarations and is responsible for generated output.',300)
answer(t,11,'Sponsor-resource entitlement and redemption require team confirmation.',355,size=10,bottom=372)
table(t,11,[['Replit','Public hosting at the declared live URL','Deployment observed; SDC credit redemption not evidenced'],['RunPod','None','Not used (team decision)'],['Other sponsor resources','TODO - HUMAN VERIFICATION','Mentoring / credits / other resources need team confirmation']],416)
answer(t,12,'The workflow can run locally with FastAPI and SQLite. Replit provides public access but is replaceable hosting; local copy avoids an external model dependency. No RunPod service is used. Sponsor-credit redemption and other sponsor resources have not been verified and must be confirmed by the team.',320)
answer(t,13,'The demo stores synthetic user IDs, quotes, orders, points and recipient labels. The local competition runner uses a temporary database deleted on process exit; normal service persistence differs. Optional DeepSeek receives selected product names, quantities and clearance prices, not customer contacts or product costs. Uploaded images and confirmations belong to the independent local vision prototype; retention there is manual. No real authentication is implemented. Replit deployment logging, retention and handling of any visitor-entered information require owner confirmation. Do not enter real customer information into this public prototype.',365,size=11)
answer(t,14,'Generated wording may make unsupported promises; the default local template and owner review reduce this risk. YOLO image counts may be wrong and need human correction; the welcome animation is not inference. Training lineage, sample provenance and the competition synthetic-data rule need confirmation. Public Replit files differ from the checked-out baseline. Role views are browser conventions, not authorization. Payments, messages and handovers are simulated. CO2e uses fixed factors and is not certified avoided emissions. No production safety, privacy or commercial-readiness claim is made.',365,size=11)
answer(t,15,'HUMAN ACTION: review every statement and tick only verified declarations. Licensing, sponsor use and identity details remain unresolved. No declaration boxes have been checked by the agent.',690,size=10,bottom=738)
answer(t,16,'Signature and date are reserved for the authorized team leader. Do not submit until all TODO fields, source/asset rights and declarations are reviewed.',485,size=11)
appendix=[('Appendix A Libraries and scope','Main runtime versions are pinned in requirements.txt: FastAPI 0.156.4 and Pydantic 2.14.1 (MIT), Starlette 1.9.0 and Uvicorn 0.54.0 (BSD-3-Clause), python-dotenv 1.2.1 (BSD-3-Clause), HTTPX 0.28.1 (BSD-3-Clause), pytest 9.1.1 (MIT). Python uses the PSF license; SQLite is public domain. Transitive dependency versions and licenses must be retained with distributions.'),('Independent vision dependencies','impeccable/requirements.txt pins Ultralytics 8.4.183, FastAPI 0.161.1 and Uvicorn 0.54.0. app.py imports OpenCV and NumPy; Ultralytics uses PyTorch. OpenCV (Apache-2.0 for current versions), NumPy (BSD-3-Clause), PyTorch (BSD-style); exact installed versions were not verified in an isolated vision environment. Install separately; do not mix the two FastAPI pins. No inference or model training was run in this submission pass.'),('Browser resources','Tailwind CSS CDN is used by frontend/login_signup_page.html (MIT; CDN version unpinned). ONNX Runtime Web 1.17.3 (MIT) is referenced in train_bread/index.html and the web_online backup. Fonts are fetched from Google Fonts; font-family and downloaded font licenses require team review. Root Apache-2.0 does not replace third-party licenses.'),('Dataset and model attribution','Bread Detector by breaddetector, Roboflow Universe: https://universe.roboflow.com/breaddetector/bread-detector . Publisher page identifies CC BY 4.0. Dataset page metrics are not NexFlow evaluation results. Repository notes attribute sample images and bread_finetune weights to this project; exact dataset version, split, training logs, authorship and modifications require human confirmation. Retain attribution and mark modifications when verified.'),('Ultralytics and model rights','Ultralytics documents AGPL-3.0 and Enterprise options: https://www.ultralytics.com/license . No Enterprise entitlement was evidenced. Do not assume the project Apache-2.0 license supersedes YOLO obligations. Confirm the precise weight/export origin and applicable license before signing. The team should confirm whether third-party training images are permitted under the Domain 2 synthetic-data rule.'),('AI development and deployment evidence','User confirmed ChatGPT/Codex and DeepSeek-assisted development. train_bread/README.md links a Claude artifact; tool version and extent remain human-verification items. Replit URL was supplied by the owner and observed live. Ownership dashboard, deployment source commit, plan, region and sponsor-credit redemption were not accessible. RunPod: Not used. No signature, legal affirmation or platform-use evidence is fabricated.')]
t.insert_pdf(extra_pdf('NexFlow Technical Declaration Appendix',appendix))
save(t,'SDC2026_Nexgen_TechDeclaration.pdf')

proof=extra_pdf('Nexgen Replit Proof of Use',[
 ('Public deployment observed on 24 October 2026',URL+'<br/>Team: Nexgen. Project: NexFlow / Orbyte Smart Yield. Public homepage rendered in the browser with the project name, bakery closing workflow and preset bread-count showcase.'),
 ('Read-only access evidence','HTTP 200: /, /login, /app, /app/assets/integration.js, /app/assets/i18n.js, /api/demo/session and /api/inventory. No public orders were created. Machine-readable checks and SHA256 hashes: docs/submission-evidence/replit-http-20261024.json.'),
 ('Relationship to this repository','Compared with origin/main 7e264ee20d04a3fe968d133c4ff9f26105263165. integration.js matches byte-for-byte; sampled HTML and i18n.js differ. This supports a related NexFlow deployment, not full source or feature parity. No live YOLO inference or paid model call was verified.'),
 ('Evidence still needed from the owner','TODO - HUMAN VERIFICATION: provide a Replit project/deployment dashboard screenshot showing project identity, deployed URL and successful deployment record, plus source commit if available. Confirm account ownership, plan/region and SDC voucher redemption. Redact secrets and billing details. This PDF provides public-access evidence; it is not a substitute for any additional organizer-mandated account evidence.')],ROOT/'docs/submission-evidence/replit-public-20261024.png')
proof.save(OUT/'SDC2026_Nexgen_Replit_POU.pdf',garbage=4,deflate=True)
for path in OUT.glob('*.pdf'):
 r=PdfReader(path);assert len(r.pages)>0;assert 'Nexgen' in '\n'.join(p.extract_text() for p in r.pages)
 print(path.name,len(r.pages),'pages')
