# Clinical Workspace

`ClinicalWorkspace` separates document layout from clinical behavior. `ReportWindow` remains the radiology-compatible adapter and continues to own report loading, validation, signing, PACS access, and AI actions.

## Profiles

Profiles live in `src/features/clinical-workspace/profiles.ts` and describe the document resource, sections, layout, viewer, AI domain, and available actions. They do not share prompts or validation rules.

```text
ClinicalWorkspace
|-- RadiologyProfile: editor + optional studies + DICOM + radiology AI
|-- ConsultationProfile: editor + prior visits + consultation AI
|-- PathologyProfile: editor + specimens + attachments
`-- EndoscopyProfile: editor + images/videos + procedure AI
```

Laboratory and generic procedure profiles preserve the categories already supported by `ReportWindow`. Only radiology mounts the OHIF iframe today.

## Slots

The workspace accepts an editor, optional resource navigator, and optional viewer. On wide screens they form two or three columns. Below 1100 px, the same mounted slots are selected through tabs, preserving unsaved editor state.

To add a document type:

1. Add a profile with its own `resourceType`, sections, viewer mode, and AI profile.
2. Build a domain editor that owns its validation and persistence.
3. Pass the editor and only the resource/viewer slots that the document needs.
4. Add a dedicated backend AI prompt only when that domain is implemented.

Do not reuse radiology fields, validation, or prompts for consultation, pathology, or endoscopy. Database generalization is intentionally deferred until a second document workflow is implemented end to end.

## Manual Layout QA

Test `1366x768`, `1440x900`, `1920x1080`, and `2560x1440`: the document body must not scroll; editor and OHIF navigator scroll independently; the iframe stays within its panel while the report and AI panel expand or collapse.

At tablet width (`768x1024`), verify the Informe and Visor tabs preserve unsaved text. At mobile width (`390x844`), verify one pane is visible at a time, actions remain reachable, and there is no horizontal scroll.

For each viewport, cover a short and long report, collapsed/expanded AI summary, more than 10 technical findings, one and multiple DICOM instances, OHIF loading/success/error, window resize, and entry/exit from the existing full-screen link. The iframe is sized by CSS; no external resize or fit command is sent because the current OHIF integration exposes no supported parent API for it.
