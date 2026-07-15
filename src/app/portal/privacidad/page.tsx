import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacidad · Mi Salud" };

export default function PhrPrivacyPage() {
  return <main className="portal-shell"><article className="card portal-card legal-content">
    <p className="eyebrow">Mi Salud</p><h1>Política de privacidad del registro personal</h1>
    <p><strong>Versión:</strong> 15 de julio de 2026.</p>
    <h2>Qué guardamos</h2><p>Los datos de identificación que entregas, los documentos de salud que decides subir y la metadata necesaria para ordenarlos. Los documentos se mantienen privados por defecto.</p>
    <h2>Para qué los usamos</h2><p>Para crear tu registro personal, permitirte consultar tus archivos y generar las exportaciones que solicites. No usamos tus documentos para publicidad ni los compartimos sin una acción expresa tuya.</p>
    <h2>Procesamiento automatizado</h2><p>Cuando eliges analizar un laboratorio, primero intentamos leer el texto localmente. Si el PDF requiere interpretación visual, una copia de trabajo puede procesarse con el proveedor de inteligencia artificial configurado. El PDF original no se modifica, cada sugerencia exige tu confirmación y los resultados no constituyen diagnóstico ni indicación médica.</p>
    <h2>Tus controles</h2><p>Puedes abrir y eliminar documentos, exportar tu registro y eliminar la cuenta desde Perfil y seguridad. Revocar o eliminar tu registro personal no borra una copia que un prestador haya incorporado previamente a su ficha clínica bajo su propia obligación legal.</p>
    <h2>Seguridad</h2><p>El acceso exige autenticación; la base de datos aplica aislamiento por usuario y los archivos se entregan mediante enlaces privados de corta duración.</p>
    <a className="button secondary" href="/portal">Volver a Mi Salud</a>
  </article></main>;
}
