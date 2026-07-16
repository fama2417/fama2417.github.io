import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacidad y términos · Mi Salud", description: "Tratamiento de datos personales, condiciones de uso y canales de ayuda de Mi Salud." };

export default function PhrPrivacyPage() {
  const responsible = process.env.PHR_LEGAL_NAME ?? "Mi Salud · Registro Personal";
  const identifier = process.env.PHR_LEGAL_ID ?? "";
  const address = process.env.PHR_LEGAL_ADDRESS ?? "";
  const privacyEmail = process.env.PHR_PRIVACY_EMAIL ?? "";
  const supportEmail = process.env.PHR_SUPPORT_EMAIL || privacyEmail;
  const completeIdentity = !!(process.env.PHR_LEGAL_NAME && identifier && address && privacyEmail);

  return <main className="phr-app phr-legal-page">
    <header className="phr-public-header"><a className="phr-public-brand" href="/portal"><span aria-hidden="true">▰</span><strong>Mi Salud</strong></a><a className="phr-public-nav-cta" href="/portal">Entrar al portal</a></header>
    <nav className="phr-legal-nav" aria-label="Contenido legal"><a href="#privacidad">Privacidad</a><a href="#derechos">Tus derechos</a><a href="#ia">Automatización e IA</a><a href="#terminos">Términos</a><a href="#contacto">Contacto</a></nav>

    <article className="phr-legal-content" id="privacidad">
      <p className="eyebrow">Centro de privacidad</p><h1>Privacidad, términos y ayuda</h1>
      <p><strong>Versión vigente:</strong> 16 de julio de 2026.</p>
      <p>Este documento explica, en lenguaje claro, cómo funciona el registro personal de salud Mi Salud. La política se rige actualmente por la Ley N.º 19.628. También anticipa las exigencias de la Ley N.º 21.719, que entra en vigencia el 1 de diciembre de 2026. La Ley N.º 21.668 se refiere a interoperabilidad de fichas clínicas y no reemplaza la ley general de datos personales.</p>

      <h2>1. Responsable del tratamiento</h2>
      <p><strong>{responsible}</strong>{identifier && <> · {identifier}</>}{address && <> · {address}</>}.</p>
      {privacyEmail && <p>Canal de privacidad: <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.</p>}
      {!completeIdentity && <p className="phr-legal-warning"><strong>Configuración pendiente:</strong> antes de usar el portal en producción se deben informar razón social o nombre legal, RUT, domicilio y correo de privacidad mediante las variables PHR_LEGAL_* del despliegue.</p>}

      <h2>2. Alcance y naturaleza del registro</h2>
      <p>Mi Salud es un registro personal organizado por su titular. No es por sí solo la ficha clínica oficial de un prestador, no presta atención de salud y no reemplaza los documentos originales ni la evaluación de un profesional. Si autorizas a una institución a incorporar información a su ficha, esa copia queda sujeta a las obligaciones legales propias del prestador.</p>

      <h2>3. Datos que tratamos</h2>
      <ul>
        <li>Cuenta y seguridad: correo electrónico, identificadores técnicos de sesión y registros de acceso.</li>
        <li>Perfil: nombre, fecha de nacimiento, identificador opcional y datos de emergencia declarados por ti.</li>
        <li>Datos sensibles de salud: documentos, imágenes, resultados, informes, biomarcadores y notas que decides guardar.</li>
        <li>Datos de uso y auditoría: cargas, exportaciones, enlaces compartidos, revocaciones y accesos a esos enlaces.</li>
      </ul>

      <h2>4. Finalidades y autorización</h2>
      <p>Tratamos los datos para crear y proteger tu cuenta; almacenar, ordenar y mostrar tus documentos; generar resultados que tú revisas; permitir exportaciones, enlaces temporales y cuentas de cuidador; atender solicitudes de soporte, seguridad y derechos. Los datos sensibles se tratan con tu consentimiento expreso, salvo una obligación o autorización legal aplicable. Puedes revocarlo sin efecto retroactivo, aunque ello puede impedir que el servicio siga funcionando.</p>

      <h2>5. Acceso, encargados y transferencias</h2>
      <p>Los documentos son privados por defecto. Solo se comunican cuando tú compartes información, habilitas a un cuidador, solicitas una función que requiere un encargado tecnológico o cuando existe una obligación legal. Usamos proveedores de infraestructura, base de datos, almacenamiento, correo transaccional e inteligencia artificial, actualmente Supabase, Render y OpenAI según la función habilitada. Actúan para prestar el servicio y no para publicidad.</p>
      <p>Algunos proveedores o respaldos pueden operar fuera de Chile según la región contratada. Antes de producción, el responsable debe verificar las regiones efectivas, contratos, subencargados y resguardos para transferencias internacionales aplicables.</p>

      <h2 id="ia">6. Lectura automatizada e inteligencia artificial</h2>
      <ul>
        <li>Los PDF de laboratorio se leen con extracción u OCR dentro de la plataforma; el archivo original no se envía al modelo de IA.</li>
        <li>Las fotografías pueden enviarse al proveedor de IA cuando eliges analizarlas.</li>
        <li>Para explicar un informe de imagenología en lenguaje simple puede enviarse texto previamente extraído y reducido, no el PDF original.</li>
        <li>Para sugerir LOINC puede enviarse una lista compacta de analitos, unidades y tipo de muestra, no el documento completo.</li>
      </ul>
      <p>Las extracciones y códigos son sugerencias editables: no se incorporan como resultado confirmado hasta que los revisas. No se toman decisiones automatizadas que diagnostiquen, indiquen tratamiento o produzcan por sí solas efectos jurídicos o clínicos.</p>

      <h2>7. Conservación y eliminación</h2>
      <p>Conservamos la cuenta y sus documentos mientras mantengas el registro o sean necesarios para las finalidades informadas. Puedes eliminar documentos individuales o la cuenta completa desde Perfil y seguridad. La eliminación retira los datos activos; copias técnicas de respaldo pueden permanecer durante el ciclo limitado del proveedor antes de sobrescribirse. Una copia entregada previamente a un tercero o incorporada a una ficha clínica debe solicitarse al respectivo responsable.</p>

      <h2>8. Seguridad</h2>
      <p>Aplicamos autenticación, conexiones TLS, control por usuario en la base de datos, almacenamiento privado, enlaces firmados de corta duración y registro de accesos a enlaces compartidos. Ningún sistema es infalible: si detectas acceso no autorizado, repórtalo por el canal de privacidad y revoca enlaces o sesiones desde tu perfil.</p>

      <h2>9. Cookies y tecnologías similares</h2>
      <p>Usamos únicamente almacenamiento y cookies necesarios para autenticación, seguridad y continuidad de la sesión. No incorporamos publicidad comportamental ni cookies publicitarias en el portal.</p>

      <h2 id="derechos">10. Tus derechos</h2>
      <p>Puedes solicitar información y acceso a tus datos, rectificar los inexactos y pedir su eliminación o bloqueo conforme a la Ley N.º 19.628; también puedes revocar tu autorización. El portal permite editar el perfil, exportar FHIR, cerrar sesiones, revocar enlaces y eliminar la cuenta. Desde el 1 de diciembre de 2026 se aplicarán además el régimen reforzado de acceso, rectificación, supresión, oposición, portabilidad y bloqueo, junto con la supervisión de la Agencia de Protección de Datos Personales.</p>
      <p>Las solicitudes son gratuitas y deben incluir información suficiente para verificar tu identidad sin exponer más datos de los necesarios. Escríbenos al canal indicado en la sección Contacto.</p>

      <h2>11. Menores de edad</h2>
      <p>Esta versión del registro personal está disponible solo para mayores de 18 años. Las cuentas familiares para menores requieren un flujo específico de representación, interés superior y consentimiento que aún no está habilitado.</p>

      <h2 id="terminos">Términos de uso</h2>
      <h3>1. Servicio y elegibilidad</h3><p>Debes ser mayor de 18 años, entregar información veraz y mantener el control de tu correo y sesiones. Mi Salud organiza documentos personales y no es un servicio de urgencia, diagnóstico o tratamiento.</p>
      <h3>2. Tus documentos</h3><p>Conservas tus derechos sobre el contenido que subes. Otorgas al operador y sus encargados únicamente la autorización necesaria para almacenarlo, procesarlo y mostrarlo según las funciones que solicitas. No debes subir información de otra persona sin una base válida para hacerlo.</p>
      <h3>3. Revisión y uso seguro</h3><p>Debes comparar toda extracción con el original y consultar a un profesional para decisiones de salud. No uses tendencias, explicaciones simples o códigos sugeridos como diagnóstico. Ante una urgencia, utiliza los canales de emergencia correspondientes.</p>
      <h3>4. Compartir</h3><p>Eres responsable de escoger destinatarios, contenido y vigencia de cada enlace o permiso. Puedes revocarlos, pero una persona que ya accedió puede haber conservado una copia.</p>
      <h3>5. Uso prohibido</h3><p>No puedes vulnerar cuentas o controles de acceso, cargar contenido ilícito o malicioso, suplantar a otra persona, automatizar cargas abusivas ni usar el servicio para decisiones discriminatorias o atención clínica no autorizada.</p>
      <h3>6. Disponibilidad y cambios</h3><p>Podemos realizar mantenimiento o suspender funciones por seguridad. Los cambios materiales de estos términos o de la política se informarán de forma destacada y, cuando corresponda, se solicitará una nueva aceptación. Nada de estos términos limita derechos irrenunciables reconocidos por la legislación chilena.</p>
      <h3>7. Término de la cuenta y ley aplicable</h3><p>Puedes terminar la cuenta desde Perfil y seguridad. El operador puede suspender una cuenta por riesgo de seguridad o incumplimiento grave, informando la causa cuando sea posible. Se aplica la legislación de la República de Chile.</p>

      <h2 id="ayuda">Ayuda</h2>
      <ul><li>Acceso: solicita el enlace al mismo correo con que creaste el registro; revisa spam y espera antes de pedir otro.</li><li>Correcciones: edita tu perfil o elimina y vuelve a cargar un documento si el original no corresponde.</li><li>Extracciones: ninguna sugerencia cuenta como confirmada hasta que la revisas.</li><li>Seguridad: cierra todas las sesiones y revoca enlaces compartidos desde Perfil y seguridad.</li></ul>

      <h2 id="contacto">Contacto y solicitudes</h2>
      {supportEmail && <p>Soporte: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>}
      {privacyEmail ? <p>Privacidad y derechos: <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.</p> : <p className="phr-legal-warning">El responsable debe configurar PHR_PRIVACY_EMAIL antes de publicar el servicio.</p>}
      <p>No incluyas exámenes ni datos de salud en el asunto del correo. Primero te pediremos verificar tu identidad por un canal adecuado.</p>

      <h2>Fuentes legales oficiales</h2>
      <ul><li><a href="https://www.bcn.cl/leychile/navegar?idNorma=141599" target="_blank" rel="noreferrer">Ley N.º 19.628 sobre protección de la vida privada</a>.</li><li><a href="https://www.bcn.cl/leychile/navegar?idNorma=1209272" target="_blank" rel="noreferrer">Ley N.º 21.719 sobre protección y tratamiento de datos personales</a>.</li><li><a href="https://www.bcn.cl/leychile/navegar?idNorma=1039348" target="_blank" rel="noreferrer">Ley N.º 20.584 sobre derechos y deberes en salud</a>.</li><li><a href="https://www.bcn.cl/leychile/navegar?idNorma=1203827" target="_blank" rel="noreferrer">Ley N.º 21.668 sobre interoperabilidad de fichas clínicas</a>.</li></ul>
    </article>
  </main>;
}
