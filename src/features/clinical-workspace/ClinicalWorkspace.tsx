"use client";

import { useState, type ReactNode } from "react";
import type { ClinicalDocumentProfile } from "./profiles";

type Pane = "editor" | "navigator" | "viewer";

export function ClinicalWorkspace({ profile, header, editor, resourceNavigator, viewer }: {
  profile: ClinicalDocumentProfile;
  header?: ReactNode;
  editor: ReactNode;
  resourceNavigator?: ReactNode;
  viewer?: ReactNode;
}) {
  const [activePane, setActivePane] = useState<Pane>("editor");
  const panes: { id: Pane; label: string; content?: ReactNode }[] = [
    { id: "editor", label: "Informe", content: editor },
    { id: "navigator", label: "Estudios", content: resourceNavigator },
    { id: "viewer", label: profile.viewerMode === "dicom" ? "Visor" : "Adjuntos", content: viewer },
  ].filter((pane) => pane.content) as { id: Pane; label: string; content: ReactNode }[];

  return <div className="clinical-workspace" data-layout={profile.layoutMode} data-has-navigator={!!resourceNavigator} data-has-viewer={!!viewer}>
    {header}
    {panes.length > 1 && <nav className="clinical-workspace-tabs" aria-label="Panel del documento">
      {panes.map((pane) => <button type="button" key={pane.id} aria-pressed={activePane === pane.id} onClick={() => setActivePane(pane.id)}>{pane.label}</button>)}
    </nav>}
    <div className="clinical-workspace-body">
      {panes.map((pane) => <div className={`clinical-workspace-pane clinical-workspace-${pane.id}${activePane === pane.id ? " is-active" : ""}`} key={pane.id}>{pane.content}</div>)}
    </div>
  </div>;
}
