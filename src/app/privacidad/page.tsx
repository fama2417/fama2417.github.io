import { AppShell } from "@/components/AppShell";
import { RequireRole } from "@/components/RequireRole";

export default function PrivacyPage() {
  return <AppShell>
    <RequireRole roles={["admin", "radiologist"]}>
    <div className="page-header"><div><p className="eyebrow">Protección de datos</p><h2>Política de privacidad y tratamiento de datos de salud</h2><p>Ley N.º 19.628 sobre protección de la vida privada y Ley N.º 21.668 que la moderniza (Chile).</p></div></div>
    <article className="legal-content">
      <h3>1. Responsable del tratamiento</h3>
      <p>Este sistema de agenda e imagenología es operado por el servicio de imagenología responsable, quien actúa como responsable del tratamiento de los datos personales y datos sensibles de salud registrados en la plataforma.</p>

      <h3>2. Datos tratados y finalidad</h3>
      <ul>
        <li><strong>Datos de identificación</strong>: nombre, identificador (RUN/pasaporte), fecha de nacimiento, sexo registral y teléfono.</li>
        <li><strong>Datos sensibles de salud</strong> (art. 2° lit. g, Ley 19.628): motivo del examen, citas, imágenes DICOM e informes radiológicos.</li>
      </ul>
      <p>La finalidad exclusiva es la gestión de citas, la realización de exámenes de imagenología, la emisión de informes radiológicos y la continuidad de la atención. Los datos no se usan para otros fines ni se ceden a terceros, salvo obligación legal.</p>

      <h3>3. Base de licitud y consentimiento</h3>
      <p>El tratamiento de datos de salud se realiza con el <strong>consentimiento expreso del titular</strong>, registrado al momento de la inscripción del paciente (fecha y usuario que lo registró quedan en el sistema), y en el marco de la atención de salud. El titular puede revocar su consentimiento en cualquier momento, sin efecto retroactivo.</p>

      <h3>4. Derechos del titular (derechos ARCO-P)</h3>
      <ul>
        <li><strong>Acceso</strong>: conocer los datos que se tratan, su origen y finalidad.</li>
        <li><strong>Rectificación</strong>: corregir datos inexactos o incompletos.</li>
        <li><strong>Cancelación/Supresión</strong>: eliminar datos cuando carezcan de fundamento o estén caducos.</li>
        <li><strong>Oposición</strong>: oponerse al tratamiento en los casos que la ley contempla.</li>
        <li><strong>Portabilidad</strong> (Ley 21.668): obtener copia de sus datos en formato estructurado.</li>
      </ul>
      <p>Las solicitudes se dirigen al responsable del tratamiento, quien debe responder en los plazos legales. El titular puede reclamar ante la <strong>Agencia de Protección de Datos Personales</strong> creada por la Ley 21.668.</p>

      <h3>5. Medidas de seguridad técnicas</h3>
      <ul>
        <li>Acceso exclusivamente autenticado, con roles diferenciados (administración, operación, radiología) y política de mínimo privilegio aplicada en la base de datos (Row Level Security).</li>
        <li>Cifrado del tránsito extremo a extremo (HTTPS/TLS) en la aplicación, la base de datos y el PACS.</li>
        <li>Registro de auditoría inalterable de toda creación, modificación o eliminación de pacientes, citas, estudios e informes, con identificación del usuario actor.</li>
        <li>Los informes firmados son inmutables; toda corrección se incorpora como una adenda firmada y auditada.</li>
        <li>Retención limitada: las imágenes DICOM se eliminan automáticamente cumplido el período de retención configurado; los datos administrativos se conservan mientras exista relación asistencial.</li>
      </ul>

      <h3>6. Encargados y ubicación de los datos</h3>
      <p>La infraestructura utiliza proveedores que actúan como encargados del tratamiento: base de datos gestionada (Supabase) y almacenamiento de imágenes en un servidor dedicado en la región Chile Central (Santiago) de Oracle Cloud. El tránsito y el reposo de las imágenes ocurren bajo control de acceso y credenciales exclusivas del responsable.</p>

      <h3>7. Incidentes de seguridad</h3>
      <p>Ante una vulneración que afecte datos personales, el responsable notificará a la autoridad y a los titulares afectados conforme al deber de reporte de la Ley 21.668, y aplicará el plan de contención y respaldo definido.</p>
    </article>
    </RequireRole>
  </AppShell>;
}
