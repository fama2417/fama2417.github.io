"use client";

import { useEffect, useState } from "react";
import { captureUrl, isCaptureKeyImage } from "@/features/reports/repository";
import type { PatientKeyImage } from "./repository";
import { formatExamDate, isReportAvailable } from "./exam-status";

/** Recibe solo las imágenes ya filtradas por rol (informes accesibles); el filtro vive en PatientHistory. */
export function PatientKeyImagesSection({ keyImages, canEditReports, limit, onViewAll }: { keyImages: PatientKeyImage[]; canEditReports: boolean; limit?: number; onViewAll?: () => void }) {
  const [captureUrls, setCaptureUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const shown = limit ? keyImages.slice(0, limit) : keyImages;

  useEffect(() => {
    shown.filter((image) => isCaptureKeyImage(image.instanceId)).forEach((image) => {
      captureUrl(image.instanceId).then((url) => setCaptureUrls((next) => ({ ...next, [image.id]: url }))).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyImages, limit]);

  if (!shown.length) return <p className="empty-state">Sin imágenes clave registradas para este paciente.</p>;
  return <>
    <section className="imaging-grid" aria-label="Imágenes clave">
      {shown.map((image) => {
        const src = isCaptureKeyImage(image.instanceId) ? captureUrls[image.id] : `/api/pacs/instances/${image.instanceId}/preview`;
        return (
          <article className="card imaging-card" key={image.id}>
            {src && !failed[image.id]
              ? <img className="key-image-preview" src={src} alt={image.caption || "Imagen clave"} loading="lazy" onError={() => setFailed((next) => ({ ...next, [image.id]: true }))} />
              : <div className="key-image-placeholder" aria-hidden="true">{failed[image.id] ? "Vista previa no disponible" : "Cargando vista previa…"}</div>}
            {image.caption && <h4>{image.caption}</h4>}
            <dl className="imaging-clinical">
              <div><dt>Examen asociado</dt><dd>{image.exam.modality} · {image.exam.reason} · {formatExamDate(image.exam.date)}{image.exam.time && ` · ${image.exam.time} h`}</dd></div>
              <div><dt>Registrada</dt><dd>{new Date(image.createdAt).toLocaleDateString("es-CL")}{image.createdBy && ` · ${image.createdBy}`}</dd></div>
            </dl>
            {isReportAvailable(image.exam, canEditReports) && <a className="text-button" href={`/informe/${image.exam.id}`}>Ver informe →</a>}
          </article>
        );
      })}
    </section>
    {onViewAll && <button className="text-button" type="button" onClick={onViewAll}>Ver todas →</button>}
  </>;
}
