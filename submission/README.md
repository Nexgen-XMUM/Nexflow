# Nexgen submission materials

These are substantive submission materials, not renamed blank templates. The two official forms are visibly **unsigned drafts with human-verification fields**. Do not upload them as complete forms before reviewing all TODOs, declarations and signatures.

- [Preliminary](SDC2026_Nexgen_Preliminary.pdf): official 14-page form populated with real prototype scope; KPI target and team declarations require approval.
- [Technical declaration](SDC2026_Nexgen_TechDeclaration.pdf): official 16-page form plus source/license appendix. No legal checklist tick or signature supplied.
- [Replit proof](SDC2026_Nexgen_Replit_POU.pdf): actual public deployment screenshot and HTTP checks; add the owner deployment dashboard if required.
- RunPod was not used; no RunPod proof exists or is planned. Owner accepts template risk.

See [status](../docs/submission-status.md) and [compliance audit](../docs/submission-compliance-audit.md) for unresolved items. Live URL: https://orbyte-smart-yield-nexgen.replit.app/ .

## Reproduce and amend

Original official templates: https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template at d74820299e6ebd5ace04b902f8ff68303c519925. Obtain that revision, confirm the Drive folder has no newer forms, then amend factual text in `docs/submission-source/generate_pdfs.py`.

In a separate document-generation environment (not the product venv):

```bash
python -m pip install pymupdf reportlab pypdf
python docs/submission-source/generate_pdfs.py /path/to/SDC_Hackathon_Submission_Template
```

The generator checks text fit and reopens outputs; render and visually inspect all pages after edits. It deliberately does not tick legal compliance boxes or sign. Remove draft labels only after authorized human verification, never simply to make the files appear complete. No original form blanks are published as completed material.
